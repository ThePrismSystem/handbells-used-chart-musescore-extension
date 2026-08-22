const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

function fixture(name) {
  return path.join(__dirname, "..", "fixtures", name);
}

// cmd("insert-measure") does not leave the score's time signature with the
// music — it carries the element into the measure it creates. So on a score
// that declares a metre, the front chart measure inherits it and prints it
// after the clef, and the piece's own first measure has none left. Hiding it
// where it landed is only half the answer: hidden, it is the score's only copy,
// and the whole piece prints with no metre anywhere. Both halves are asserted
// here, against each other, because either alone passes on a broken score.
//
// No other fixture declares a metre, and MuseScore writes no implicit 4/4
// back, so on all of them there is genuinely nothing to move, hide or restore.
//
// explicit-time-signature is in 3/4, which is not the default, so "the same
// fraction the score started with" is a real claim rather than one 4/4 would
// satisfy by accident. Its second measure changes to 2/4, which stays in the
// piece, so a pass that hid signatures score-wide would silence it and be
// caught. pickup-and-metre-change is here for a different shape: its first
// measure is a 1/4 pickup declaring 4/4, and putting a signature back onto an
// irregular measure is exactly where a re-add would resize the user's music.
const FIXTURES = [
  fixture("explicit-time-signature.mscx"),
  fixture("pickup-and-metre-change.mscx"),
];

function chart(t, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, file), output);
  return { output, text: mainScore(output) };
}

function planned(file) {
  return buildPlan(extractNotes(fs.readFileSync(file, "utf8")).records, {});
}

function staffIds(text) {
  return (text.match(/<Staff id="(\d+)">/g) || []).map((open) => open.match(/\d+/)[0]);
}

// The un-id'd <Staff> elements nested under each <Part> close long before
// <Staff id="1"> opens, so the close tag is searched for from here on.
function staffRegion(text, id) {
  const start = text.indexOf(`<Staff id="${id}">`);
  return text.slice(start, start + text.slice(start).indexOf("</Staff>"));
}

function measuresOf(region) {
  return region.match(/<Measure(?:\s[^>]*)?>[\s\S]*?<\/Measure>/g) || [];
}

function timeSigsIn(measures) {
  return measures.flatMap(
    (m) => m.match(/<TimeSig>(?:(?!<\/TimeSig>)[\s\S])*<\/TimeSig>/g) || []);
}

function hidden(sigs) {
  return sigs.filter((sig) => sig.includes("<visible>0</visible>")).length;
}

function fractionOf(sig) {
  const n = /<sigN>(\d+)<\/sigN>/.exec(sig);
  const d = /<sigD>(\d+)<\/sigD>/.exec(sig);
  return n && d ? `${n[1]}/${d[1]}` : null;
}

function metreOfFixture(file) {
  const sigs = timeSigsIn([fs.readFileSync(file, "utf8")]);
  return sigs.length ? fractionOf(sigs[0]) : null;
}

for (const FIXTURE of FIXTURES) {
  const named = (what) => `${what} (${path.basename(FIXTURE, ".mscx")})`;

  test(named("the chart hides the metre and the music keeps it"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const sections = planned(FIXTURE).sections.length;
    assert.ok(sections > 0, "fixture defines at least one chart section");
    const metre = metreOfFixture(FIXTURE);
    assert.ok(metre, "fixture must declare a time signature, or nothing moves");

    const { text } = chart(t, FIXTURE);
    const staves = staffIds(text);
    assert.ok(staves.length > 2, "the chart appended staves of its own");

    const inChart = [];
    const onFirstPieceMeasure = [];
    const laterInPiece = [];
    for (const id of staves) {
      const measures = measuresOf(staffRegion(text, id));
      assert.ok(measures.length > sections + 1,
        `staff ${id} has the chart measures, the piece's first, and more after`);
      inChart.push(...timeSigsIn(measures.slice(0, sections)));
      onFirstPieceMeasure.push(...timeSigsIn([measures[sections]]));
      laterInPiece.push(...timeSigsIn(measures.slice(sections + 1)));
    }

    // First half. Present and invisible, never absent: on a score that
    // declared no metre there is no TimeSig in a chart measure at all, and an
    // assertion that only asked for no *visible* one would pass without the
    // hiding ever running.
    assert.strictEqual(inChart.length, staves.length,
      "every staff's chart measures hold the metre insert-measure moved there");
    assert.strictEqual(hidden(inChart), inChart.length,
      "and not one of them prints");

    // Second half, and the reason the first is not enough on its own: that
    // hidden signature is the score's only copy, so unless one is put back the
    // music prints with no metre at all.
    assert.strictEqual(onFirstPieceMeasure.length, staves.length,
      "the piece's first measure carries a metre on every staff");
    assert.strictEqual(hidden(onFirstPieceMeasure), 0,
      "and prints it");
    for (const sig of onFirstPieceMeasure) {
      assert.strictEqual(fractionOf(sig), metre,
        "the metre on the music is the one the score started with");
    }

    // And nothing else in the piece was touched on the way past.
    assert.ok(laterInPiece.length > 0,
      "the piece must change metre later, or this half proves nothing");
    assert.strictEqual(hidden(laterInPiece), 0,
      "the piece's later metre changes are left visible");
  });

  test(named("MuseScore can open a chart made from a score with a metre"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    assert.strictEqual(renderPdf(chart(t, FIXTURE).output), 0);
  });
}

// Putting a signature back is the one part of building a chart that adds an
// element to the piece's own music, so it is the one part that could pile up:
// the second run removes the chart measures, taking the hidden signature with
// them, and then reads the metre from the measure the first run wrote it onto.
// If it ever added rather than replaced, the count would climb with every run.
test("rebuilding a chart does not pile up time signatures", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const FIXTURE = fixture("explicit-time-signature.mscx");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const once = path.join(dir, "once.mscz");
  const twice = path.join(dir, "twice.mscz");
  runExtension(makeScore(dir, FIXTURE), once);
  runExtension(once, twice);

  function count(file) {
    const sigs = timeSigsIn([mainScore(file)]);
    return { all: sigs.length, hidden: hidden(sigs) };
  }
  const first = count(once);
  assert.ok(first.all > 0 && first.hidden > 0,
    "the first run left both a hidden and a visible signature to compare against");
  assert.deepStrictEqual(count(twice), first,
    "a second run leaves exactly the signatures the first one did");
});
