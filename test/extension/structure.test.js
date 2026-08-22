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

  // The score also has un-id'd <Staff> elements nested under each <Part>,
  // whose own </Staff> closes long before <Staff id="1"> even opens — the
  // close tag has to be searched for from that point on, not from the start
  // of the document.
  const staff1Start = text.indexOf('<Staff id="1">');
  const staff1End = staff1Start + text.slice(staff1Start).indexOf("</Staff>");
  const staff1 = text.slice(staff1Start, staff1End);
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
