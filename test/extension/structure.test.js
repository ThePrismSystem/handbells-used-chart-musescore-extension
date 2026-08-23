const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore, scoreStyle, fixture, renderSvg, clefGlyphs,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

function chart(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  return { output, text: mainScore(output) };
}

function planned() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {});
}

function originalStaffCount() {
  return (fs.readFileSync(FIXTURE, "utf8").match(/<Staff id="\d+">/g) || []).length;
}

function originalPartCount() {
  return (fs.readFileSync(FIXTURE, "utf8").match(/<Part id="\d+">/g) || []).length;
}

// Every <Part> block precedes the <Staff id="N"> content elements. Chart
// parts are appended after the piece's own, so slicing the part blocks at
// originalPartCount() separates one region from the other.
function partBlocks(text) {
  const partsText = text.slice(0, text.indexOf('<Staff id="1">'));
  return partsText.match(/<Part id="\d+">[\s\S]*?<\/Part>/g) || [];
}

function chartPartsText(text) {
  return partBlocks(text).slice(originalPartCount()).join("");
}

function originalPartsText(text) {
  return partBlocks(text).slice(0, originalPartCount()).join("");
}

// The score also has un-id'd <Staff> elements nested under each <Part>, whose
// own </Staff> closes long before <Staff id="1"> even opens — the close tag
// has to be searched for from that point on, not from the start of the text.
function staffOneRegion(text) {
  const staff1Start = text.indexOf('<Staff id="1">');
  const staff1End = staff1Start + text.slice(staff1Start).indexOf("</Staff>");
  return text.slice(staff1Start, staff1End);
}

test("appends one instrument per chart, two staves each", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  assert.match(text, /<Instrument id="hand-bells">/);
  assert.match(text, /<Instrument id="hand-chimes">/);

  const after = (text.match(/<Staff id="\d+">/g) || []).length;
  assert.strictEqual(after, originalStaffCount() + 2 * planned().sections.length);
});

test("puts one measure per chart at the very front of every staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const sections = planned().sections.length;

  const source = fs.readFileSync(FIXTURE, "utf8");
  const before = (source.slice(0, source.indexOf('<Staff id="2">'))
    .match(/<Measure(?:\s[^>]*)?>/g) || []).length;

  const staff1 = staffOneRegion(text);
  const measures = staff1.match(/<Measure(?:\s[^>]*)?>/g) || [];
  assert.strictEqual(measures.length, before + sections);

  // The inserted measures come first and hold no notes.
  const firstBody = staff1.slice(0, staff1.indexOf("</Measure>"));
  assert.doesNotMatch(firstBody, /<Note>/);
});

test("MuseScore can still open what it produced", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(chart(t).output), 0);
});

test("each chart measure is as long as its own column count", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const sections = planned().sections;
  assert.ok(sections.length > 0, "fixture defines at least one chart section");
  const opens = staffOneRegion(text).match(/<Measure(?:\s[^>]*)?>/g) || [];

  sections.forEach((section, i) => {
    assert.strictEqual(opens[i], `<Measure len="${section.columns}/4">`,
      `chart measure ${i + 1}`);
  });
});

test("the chart measures are excluded from the measure count", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const sections = planned().sections;
  assert.ok(sections.length > 0, "fixture defines at least one chart section");

  // Positional, not a document-wide count: a regression that flagged the
  // piece's own measures irregular instead of the chart's would still leave
  // the total count unchanged, so each measure is checked by its place in
  // the sequence — irregular for the first N (the charts), never after.
  const measures = staffOneRegion(text).match(/<Measure(?:\s[^>]*)?>[\s\S]*?<\/Measure>/g) || [];
  assert.ok(measures.length > sections.length,
    "fixture has at least one piece measure after the charts");

  measures.forEach((measure, i) => {
    const isChartMeasure = i < sections.length;
    assert.strictEqual(measure.includes("<irregular>1</irregular>"), isChartMeasure,
      isChartMeasure
        ? `chart measure ${i + 1} is irregular`
        : `piece measure ${i + 1 - sections.length} is not irregular`);
  });
});

test("each chart carries its own label and section break, on its own measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const sections = planned().sections;
  assert.ok(sections.length > 1, "fixture defines more than one chart section");

  const measures = staffOneRegion(text).match(/<Measure(?:\s[^>]*)?>[\s\S]*?<\/Measure>/g) || [];
  sections.forEach((section, i) => {
    assert.ok(section.label.length > 0, `section ${i + 1} has a label`);
    const measure = measures[i];
    assert.ok(measure.includes(section.label),
      `chart measure ${i + 1} carries ${section.label}`);
    assert.match(measure, /<subtype>section<\/subtype>/,
      `chart measure ${i + 1} carries its section break`);

    // A label landing on the wrong measure would still satisfy a plain
    // "does the document contain this text" check, so also confirm no other
    // chart's label bled onto this measure.
    sections.forEach((other, j) => {
      if (j === i) return;
      assert.ok(!measure.includes(other.label),
        `chart measure ${i + 1} does not carry ${other.label}`);
    });
  });

  assert.strictEqual((text.match(/<subtype>section<\/subtype>/g) || []).length,
    sections.length);
});

test("chart staves are small and carry no system barline", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const chartStaves = 2 * planned().sections.length;
  assert.ok(chartStaves > 0, "fixture defines at least one chart staff pair");
  assert.ok(originalPartCount() > 0, "fixture has at least one part of its own");

  const chartText = chartPartsText(text);
  const originalText = originalPartsText(text);
  assert.ok(originalText.length > 0, "the piece's own parts precede the chart parts");

  assert.strictEqual((chartText.match(/<small>1<\/small>/g) || []).length, chartStaves);

  // The system barline is kept, not hidden: it is the rule joining each
  // chart's two staves at the left, and without it a grand staff reads as two
  // unrelated staves. So the tag must be absent on the chart's own staves.
  assert.strictEqual(
    (chartText.match(/<hideSystemBarLine>1<\/hideSystemBarLine>/g) || []).length, 0);

  // Positional, not document-wide: the piece's own staves keep their ordinary
  // size, so that tag must not appear there either.
  assert.strictEqual((originalText.match(/<small>1<\/small>/g) || []).length, 0);
  assert.strictEqual(
    (originalText.match(/<hideSystemBarLine>1<\/hideSystemBarLine>/g) || []).length, 0);
});

// Measures of one score-level staff, in order.
function measuresOfStaff(text, id) {
  const open = `<Staff id="${id}">`;
  const start = text.indexOf(open, text.indexOf('<Staff id="1">'));
  const region = text.slice(start, start + text.slice(start).indexOf("</Staff>"));
  return region.split(/(?=<Measure)/).filter((s) => s.startsWith("<Measure"));
}

test("the chart measures carry no visible barline", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const charts = planned().sections.length;
  assert.ok(charts > 0, "there is a chart to check");

  const staffIds = [...text.matchAll(/<Staff id="(\d+)">\s*(?=<VBox|<Measure)/g)].map((m) => m[1]);
  assert.ok(staffIds.length > 0, "found the score's staves");

  let seen = 0;
  for (const id of staffIds) {
    const measures = measuresOfStaff(text, id);
    for (const measure of measures.slice(0, charts)) {
      for (const bar of measure.match(/<BarLine>[\s\S]*?<\/BarLine>/g) || []) {
        seen++;
        assert.match(bar, /<visible>0<\/visible>/,
          `a barline in a chart measure is still visible on staff ${id}`);
      }
    }
    // The piece's own measures keep theirs. A run that hid every barline in
    // the score would satisfy the loop above and ruin the music.
    for (const measure of measures.slice(charts)) {
      for (const bar of measure.match(/<BarLine>[\s\S]*?<\/BarLine>/g) || []) {
        assert.doesNotMatch(bar, /<visible>0<\/visible>/,
          `a barline in the piece's own music was hidden on staff ${id}`);
      }
    }
  }
  assert.ok(seen > 0, "the chart measures actually carry barline elements to hide");
});

test("each chart label is set smaller than MuseScore's default system text", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chart(t);
  const labels = text.match(/<SystemText>[\s\S]*?<\/SystemText>/g) || [];

  // The precondition. Without it, a run that wrote no labels at all would
  // satisfy "every label is 8pt" with nothing to check.
  assert.strictEqual(labels.length, planned().sections.length,
    "one label per chart was written");
  assert.ok(labels.length > 0, "and there is at least one to size");

  for (const label of labels) {
    assert.match(label, /<size>8<\/size>/,
      `label is 8pt, not MuseScore's 10pt default: ${label.slice(0, 80)}`);
  }
});

test("the style lets empty staves hide, even on the first system", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { output } = chart(t);
  const style = scoreStyle(output);
  assert.match(style, /<hideEmptyStaves>1<\/hideEmptyStaves>/);
  assert.match(style, /<dontHideStavesInFirstSystem>0<\/dontHideStavesInFirstSystem>/);
});

test("a score with no chimes gets no handchime part or measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-bells-only-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // The precondition this rests on: the fixture must have no diamond
  // noteheads, or every assertion below passes while proving nothing.
  const source = fixture("single-measure-handbells.mscx");
  assert.doesNotMatch(fs.readFileSync(source, "utf8"), /<head>diamond<\/head>/,
    "fixture must contain no chimes, or this test proves nothing");

  const output = path.join(dir, "bells-only-out.mscz");
  runExtension(makeScore(dir, source), output);
  const text = mainScore(output);

  assert.doesNotMatch(text, /<Instrument id="hand-chimes">/);
  assert.doesNotMatch(text, /Handchimes Used/);
  assert.match(text, /<Instrument id="hand-bells">/, "the handbell chart must still be there");
  // One chart section means one recorded column count, with no separator.
  assert.doesNotMatch(text, /<metaTag name="handbellChartColumns">[^<]*\|/);
});

// A clef the user set by hand, across repeated runs.
//
// insert-measure moves a staff's starting clef into the new first measure, the
// same way it moves the time signature — and the next run's removeChart deletes
// that measure and takes the clef with it. The staff drops back to its
// instrument's default, so a bass staff silently becomes a treble one.
//
// Three runs, because the failure moved as it was fixed. The clef is a clef
// *change* to begin with, and the one put back becomes the measure's *header*
// clef, so a repair that understood only the first form worked once and lost
// the clef on the run after. Nothing short of a third run shows that.
//
// Measured from what MuseScore draws rather than from the file: which of the
// two forms the clef is written in changes from run to run, and neither form
// is what the reader cares about.
test("a hand-set clef survives repeated runs", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-clef-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("three-staff-overridden-clef.mscx");
  // The precondition. The third staff has to start on a clef that is not its
  // instrument's default, or there is nothing here to lose.
  assert.match(fs.readFileSync(source, "utf8"), /<concertClefType>F<\/concertClefType>/,
    "the fixture must set a clef by hand on its third staff");

  const STAVES = 3;
  let wanted = null;
  let input = makeScore(dir, source);
  for (let run = 1; run <= 3; run++) {
    const output = path.join(dir, `run${run}.mscz`);
    runExtension(input, output);
    const text = mainScore(output);
    // An extension that refused did not touch the score, so its clefs would
    // survive by accident and prove nothing at all. This is not hypothetical:
    // an earlier attempt at this fix threw on every run, and the clef came
    // through each one untouched because no chart was ever built.
    assert.doesNotMatch(text, /<metaTag name="handbellChartError">[^<]/,
      `run ${run} recorded a refusal`);
    assert.match(text, /Handbells Used:/, `run ${run} drew no chart`);

    // The piece's own staves are the bottom of the page: the charts sit above
    // them, and with the hand-set clef now carried into the chart measure the
    // piece's system opens with exactly one clef per staff.
    const drawn = clefGlyphs(renderSvg(output, path.join(dir, `run${run}.svg`)));
    const piece = drawn.slice(-STAVES);
    assert.strictEqual(drawn.length, STAVES + 2,
      `run ${run}: two chart staves and the piece's three`);

    if (run === 1) {
      // What "correct" is, stated rather than inherited. The fixture's second
      // and third staves start on the same clef and the first on another, so a
      // third staff that reverted to its instrument's default would match the
      // first instead — which is precisely the reported bug.
      assert.strictEqual(piece[1], piece[2],
        "the second and third staves must start on the same clef");
      assert.notStrictEqual(piece[0], piece[1],
        "the first staff must start on a different clef from the other two");
      wanted = piece;
    } else {
      assert.deepStrictEqual(piece, wanted,
        `run ${run}: the piece's own staves must keep the clefs they started with`);
    }
    input = output;
  }
});
