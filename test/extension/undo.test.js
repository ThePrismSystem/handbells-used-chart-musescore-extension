const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, installProbe, runExtension, runJob,
  makeScore, mainScore, fixture, staffRegion, measuresOf,
} = require("./harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

// More than any run here records: one step for the chart's instruments, one
// per inserted measure and one for the rest. Undo with nothing left to undo
// does nothing.
const UNDOS = 20;

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

function runProbe(t, dir, input, action) {
  installExtension();
  const probe = installProbe("undo");
  t.after(probe.remove);
  const output = path.join(dir, `${action}-undone.mscz`);
  const { text } = runJob(probe.uri, input, output);
  assert.strictEqual(tag(text, "probeUndone"), String(UNDOS), "the probe ran to the end");
  return text;
}

// Playback drifted from the cursor after a run because most of the build
// changed the score outside any command, where MuseScore neither records the
// change for undo nor tells the playback model about it.
test("undoing a build gives back the score it started from", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-undo-build-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const original = fs.readFileSync(FIXTURE, "utf8");
  const after = runProbe(t, dir,
    makeScore(dir, FIXTURE, { probeAction: "build", probeUndos: UNDOS }), "build");

  // The precondition: the build ran and drew a chart before it was undone.
  assert.ok(tag(after, "handbellChartRan"), "the build ran");
  assert.ok(tag(after, "handbellChartReport").startsWith("Handbells Used"), "and drew a chart");

  assert.strictEqual(partCount(after), partCount(original), "the chart's instruments are gone");
  assert.strictEqual(measureCount(after), measureCount(original), "and its measures");
  assert.ok(!after.includes("<stemless>"), "no chart measure is left");
});

test("undoing a removal gives back the chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-undo-remove-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE, { probeAction: "remove", probeUndos: UNDOS }), charted);
  const before = mainScore(charted);
  const original = fs.readFileSync(FIXTURE, "utf8");
  assert.ok(partCount(before) > partCount(original), "the precondition: a chart to remove");

  const after = runProbe(t, dir, charted, "remove");
  assert.strictEqual(tag(after, "handbellChartReport"), "The chart was removed.", "the removal ran");
  assert.strictEqual(partCount(after), partCount(before), "the chart's instruments are back");
  assert.strictEqual(measureCount(after), measureCount(before), "and its measures");
});
