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
