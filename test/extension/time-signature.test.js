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

// The one fixture that declares a metre of its own. cmd("insert-measure") does
// not leave a time signature where it found it — it carries it into the
// measure it creates — so on a score with an explicit signature the front
// chart measure inherits it and prints a metre after the clef. No other
// fixture here declares one, and MuseScore does not write an implicit 4/4
// back, so on every one of them there was genuinely nothing to suppress and
// the spec's claim that an inserted measure "gets no time signature segment at
// all" held. It stops holding on any real score.
//
// The metre change in the second measure is what lets the other half of the
// test bite: it stays in the piece, so a pass that hid time signatures score-
// wide instead of chart-measure-wide would silence it and be caught.
const FIXTURE = path.join(__dirname, "..", "fixtures", "explicit-time-signature.mscx");

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

test("the chart measures keep the score's metre without printing it", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const sections = planned().sections.length;
  assert.ok(sections > 0, "fixture defines at least one chart section");
  assert.ok(timeSigsIn([fs.readFileSync(FIXTURE, "utf8")]).length > 0,
    "fixture must declare a time signature, or nothing migrates into the chart");

  const { text } = chart(t);
  const staves = staffIds(text);
  assert.ok(staves.length > 2, "the chart appended staves of its own");

  const inChart = [];
  const inPiece = [];
  for (const id of staves) {
    const measures = measuresOf(staffRegion(text, id));
    inChart.push(...timeSigsIn(measures.slice(0, sections)));
    inPiece.push(...timeSigsIn(measures.slice(sections)));
  }

  // Present and invisible, never absent. On a score that declared no metre
  // there is no TimeSig in a chart measure at all, and an assertion that only
  // asked for no *visible* one would pass without the hiding ever running —
  // which is exactly how this defect survived nine tasks of review.
  assert.strictEqual(inChart.length, staves.length,
    "every staff's chart measures carry the metre insert-measure moved there");
  assert.strictEqual(hidden(inChart), inChart.length,
    "and not one of them prints");

  // The other half: the piece keeps its own. The fixture changes metre in its
  // second measure, so this is a real signature on a real measure of the
  // user's music, not an empty set.
  assert.ok(inPiece.length > 0,
    "the piece must keep a signature of its own, or this half proves nothing");
  assert.strictEqual(hidden(inPiece), 0,
    "the piece's own time signatures are left visible");
});

test("MuseScore can open a chart made from a score with an explicit metre", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(chart(t).output), 0);
});
