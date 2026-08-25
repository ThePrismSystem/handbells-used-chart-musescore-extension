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

// One measure and nothing after it. That is the shape selectFirstMeasure has
// no next measure to reach for, so the range it selects collapses to a single
// point; cmd("insert-measure") does nothing on an empty range and says nothing
// about it, and every step after it then works on the user's own measure
// instead of a chart measure of its own: resizing it to the column count,
// flagging it irregular, and drawing the chart on top of the music.
const FIXTURE = path.join(__dirname, "..", "fixtures", "single-measure-handbells.mscx");

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

function staffOneRegion(text) {
  const start = text.indexOf('<Staff id="1">');
  return text.slice(start, start + text.slice(start).indexOf("</Staff>"));
}

function measuresOf(region) {
  return region.match(/<Measure(?:\s[^>]*)?>[\s\S]*?<\/Measure>/g) || [];
}

function pitchesOf(text) {
  return (text.match(/<pitch>(\d+)<\/pitch>/g) || []).map((p) => Number(p.match(/\d+/)[0]));
}

test("a one-measure score keeps its measure, its metre and every note in it", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const sections = planned().sections;
  assert.strictEqual(sections.length, 1, "fixture plans exactly one chart");
  const original = pitchesOf(fs.readFileSync(FIXTURE, "utf8"));
  assert.ok(original.length > sections[0].columns,
    "fixture must hold more notes than the chart has columns, or a truncated"
    + " measure would still look complete");

  const measures = measuresOf(staffOneRegion(chart(t).text));
  assert.strictEqual(measures.length, sections.length + 1,
    "the chart measure was inserted rather than taken over");

  const mine = measures[sections.length];
  assert.match(mine, /^<Measure>/,
    "the piece's own measure keeps the score's metre, not the chart's length");
  assert.ok(!mine.includes("<irregular>1</irregular>"),
    "the piece's own measure is still counted in the measure numbering");
  assert.deepStrictEqual(pitchesOf(mine), original,
    "every note the piece started with is still in it");
});

test("the chart measure of a one-measure score is a chart measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const sections = planned().sections;
  const measures = measuresOf(staffOneRegion(chart(t).text));

  sections.forEach((section, i) => {
    assert.match(measures[i], new RegExp(`^<Measure len="${section.columns}/4">`),
      `chart measure ${i + 1} is as long as its own column count`);
    assert.ok(measures[i].includes("<irregular>1</irregular>"),
      `chart measure ${i + 1} is irregular`);
    assert.ok(measures[i].includes(section.label),
      `chart measure ${i + 1} carries ${section.label}`);
  });
});

test("MuseScore can open the chart made from a one-measure score", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(chart(t).output), 0);
});
