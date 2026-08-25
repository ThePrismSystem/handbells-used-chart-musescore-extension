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
const { readMscz, writeMscz, replaceMain } = require("../../tools/mscz.js");

function fixture(name) {
  return path.join(__dirname, "..", "fixtures", name);
}

// cmd("insert-measure") does not leave the score's time signature with the
// music. It carries the element into the measure it creates. So on a score
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

function openingTagOf(measure) {
  return /^<Measure(?:\s[^>]*)?>/.exec(measure)[0];
}

function subtypesOf(text) {
  return timeSigsIn([text]).map((sig) => {
    const found = /<subtype>(\d+)<\/subtype>/.exec(sig);
    return found ? found[1] : null;
  });
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

    // And nothing else in the piece was touched on the way past. The later
    // change must still read as its own fraction: a restore that wrote the
    // opening metre over every signature it found would leave these visible
    // and be missed by the line above alone.
    assert.ok(laterInPiece.length > 0,
      "the piece must change metre later, or this half proves nothing");
    assert.strictEqual(hidden(laterInPiece), 0,
      "the piece's later metre changes are left visible");
    for (const sig of laterInPiece) {
      assert.notStrictEqual(fractionOf(sig), metre,
        "the piece's later metre change is still its own fraction");
    }

    // The piece's first measure is also the one the signature is added to, and
    // on a pickup that measure is irregular. Adding to it must not resize it,
    // so its opening tag, len and all, is the fixture's own.
    const fixtureOpening = openingTagOf(
      measuresOf(fs.readFileSync(FIXTURE, "utf8"))[0]);
    for (const id of staves) {
      const measures = measuresOf(staffRegion(text, id));
      assert.strictEqual(openingTagOf(measures[sections]), fixtureOpening,
        `staff ${id}: the piece's first measure keeps its own length`);
    }
  });

  test(named("MuseScore can open a chart made from a score with a metre"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    assert.strictEqual(renderPdf(chart(t, FIXTURE).output), 0);
  });
}

// Cut time is ordinary in handbell writing, and a time signature is more than
// the two numbers in it: the ¢ is a subtype on the element, alongside the
// strings that carry additive metres and the courtesy-signature flag. A
// restore that copied only sigN and sigD silently rewrote a cut-time score to
// a bare 2/2, and since the original element goes away with the chart
// measures, removing the chart could not give the symbol back.
//
// So both halves are asserted. The build alone is not enough: the original,
// still carrying its subtype, is sitting hidden in a chart measure at that
// point, so an assertion over the whole document passes while the copy on the
// music is bare. Only removing the chart, which deletes that original, shows
// whether the symbol was really preserved.
test("cut time survives a chart, and survives removing it again", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const FIXTURE = fixture("cut-time-handbells.mscx");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const original = fs.readFileSync(FIXTURE, "utf8");
  const wanted = subtypesOf(original);
  assert.ok(wanted.length > 0 && wanted.every((sub) => sub === "2"),
    "fixture must be in cut time, or this test proves nothing");

  const sections = planned(FIXTURE).sections.length;
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);

  // The copy on the music, not merely one somewhere in the document.
  const text = mainScore(charted);
  const onTheMusic = [];
  for (const id of staffIds(text)) {
    onTheMusic.push(...timeSigsIn([measuresOf(staffRegion(text, id))[sections]]));
  }
  assert.strictEqual(onTheMusic.length, staffIds(text).length,
    "the piece's first measure carries a metre on every staff");
  assert.deepStrictEqual(subtypesOf(onTheMusic.join("")),
    onTheMusic.map(() => "2"),
    "and every one of them is still cut time, not a bare 2/2");

  // Now take the chart away, which deletes the original the build had hidden,
  // and see what the user is left holding.
  const archive = readMscz(fs.readFileSync(charted));
  const charTedText = archive.entries.get(archive.mainName).toString("utf8");
  fs.writeFileSync(path.join(dir, "emptied.mscz"), writeMscz(replaceMain(archive,
    charTedText.replace(/<pitch>(\d+)<\/pitch>/g,
      (whole, pitch) => `<pitch>${Number(pitch) % 12}</pitch>`))));
  const removed = path.join(dir, "removed.mscz");
  runExtension(path.join(dir, "emptied.mscz"), removed);

  const back = mainScore(removed);
  assert.strictEqual((back.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "the chart is gone");
  assert.deepStrictEqual(subtypesOf(back), wanted,
    "and the score is back to the cut time it started in");
  assert.strictEqual(hidden(timeSigsIn([back])), 0,
    "with nothing left hidden");
});

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
