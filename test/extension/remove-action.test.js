const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  fixture, staffRegion, measuresOf,
} = require("./harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1] : null;
}

function partCount(text) {
  return (text.match(/<Part id="\d+">/g) || []).length;
}

function measureCount(text) {
  return measuresOf(staffRegion(text, 1)).length;
}

test("the remove action takes the chart out and leaves the music", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-remove-action-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const original = fs.readFileSync(FIXTURE, "utf8");
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);
  const before = mainScore(charted);
  // The precondition: the first run drew a chart, so there is one to remove.
  assert.ok(partCount(before) > partCount(original), "the first run appended chart parts");
  assert.ok(measureCount(before) > measureCount(original), "and chart measures");

  const removed = path.join(dir, "removed.mscz");
  runExtension(charted, removed, "remove");
  const after = mainScore(removed);
  assert.strictEqual(partCount(after), partCount(original));
  assert.strictEqual(measureCount(after), measureCount(original));
  assert.strictEqual(tag(after, "handbellChartReport"), "The chart was removed.");
  assert.strictEqual(tag(after, "handbellChartParts"), "");
});

test("the remove action says so when there is no chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-remove-none-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const original = fs.readFileSync(FIXTURE, "utf8");
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output, "remove");
  const after = mainScore(output);
  assert.strictEqual(tag(after, "handbellChartReport"), "This score has no chart to remove.");
  assert.strictEqual(partCount(after), partCount(original));
  assert.strictEqual(measureCount(after), measureCount(original));
});
