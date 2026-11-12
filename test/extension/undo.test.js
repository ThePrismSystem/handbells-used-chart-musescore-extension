const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, installProbe, runExtension, runJob,
  makeScore, mainScore, scoreStyle, fixture, tag, partCount, measureCount,
} = require("./harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

// More than any run here records, the steps of a rebuild's removal included.
// Undo with nothing left to undo does nothing.
const UNDOS = 20;

// Chart chords are the only stemless ones, and the fixture has none.
function stemlessChords(text) {
  return (text.match(/<noStem>1<\/noStem>/g) || []).length;
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
  assert.strictEqual(stemlessChords(original), 0, "the fixture starts with no stemless chord");
  assert.ok(tag(after, "handbellChartReport").startsWith("Handbells Used"), "and drew a chart");
  // The style check at the end means something only if the build changed the
  // style: it recorded hide-empty-staves as off before turning it on.
  assert.strictEqual(tag(after, "handbellChartStyle_hideEmptyStaves"), "false",
    "and turned hide-empty-staves on from off");

  assert.strictEqual(partCount(after), partCount(original), "the chart's instruments are gone");
  assert.strictEqual(measureCount(after), measureCount(original), "and its measures");
  assert.strictEqual(stemlessChords(after), 0, "and every chart chord");
  // Undoing the inserted measures takes their contents with them, so the
  // checks above hold even if the chart was filled outside a command. The
  // style written while filling outlives the measures and comes back only if
  // that step was recorded.
  assert.match(scoreStyle(path.join(dir, "build-undone.mscz")),
    /<hideEmptyStaves>0<\/hideEmptyStaves>/, "and the style the chart set is undone");
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

  assert.ok(stemlessChords(before) > 0, "with chords in it");
  assert.match(scoreStyle(charted), /<hideEmptyStaves>1<\/hideEmptyStaves>/,
    "and the style it turned on");

  const after = runProbe(t, dir, charted, "remove");
  assert.strictEqual(tag(after, "handbellChartReport"), "The chart was removed.", "the removal ran");
  assert.strictEqual(partCount(after), partCount(before), "the chart's instruments are back");
  assert.strictEqual(measureCount(after), measureCount(before), "and its measures");
  assert.strictEqual(stemlessChords(after), stemlessChords(before), "and its chords");
  assert.match(scoreStyle(path.join(dir, "remove-undone.mscz")),
    /<hideEmptyStaves>1<\/hideEmptyStaves>/, "and the style the chart had turned on");
});

// setMetaTag is not undoable, so undoing a removal gives back the chart's
// instruments and measures but not the record the removal cleared. The next
// run has to find the chart all the same, not read it as part of the piece
// and build a second one beside it.
test("a chart whose removal was undone is found again", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-undo-found-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE, { probeAction: "remove", probeUndos: UNDOS }), charted);
  const before = mainScore(charted);

  // The precondition: the chart is back, the style with it, and the record
  // of it is not.
  const undone = runProbe(t, dir, charted, "remove");
  const input = path.join(dir, "undone.mscz");
  fs.copyFileSync(path.join(dir, "remove-undone.mscz"), input);
  assert.strictEqual(partCount(undone), partCount(before), "the undo gave the chart back");
  assert.match(scoreStyle(input), /<hideEmptyStaves>1<\/hideEmptyStaves>/,
    "and the style it turned on");
  assert.ok(!tag(undone, "handbellChartParts"), "but not the record the build wrote");

  const rebuilt = path.join(dir, "rebuilt.mscz");
  runExtension(input, rebuilt);
  const again = mainScore(rebuilt);
  assert.strictEqual(tag(again, "handbellChartError"), "", "the run did not refuse");
  assert.strictEqual(partCount(again), partCount(before),
    "it replaced the chart rather than adding a second");
  assert.strictEqual(stemlessChords(again), stemlessChords(before), "with the same chords");

  const removed = path.join(dir, "removed.mscz");
  runExtension(input, removed, "remove");
  const gone = mainScore(removed);
  assert.strictEqual(tag(gone, "handbellChartReport"), "The chart was removed.",
    "Remove Chart finds it too");
  assert.strictEqual(partCount(gone), partCount(fs.readFileSync(FIXTURE, "utf8")),
    "and takes it out");
  assert.match(scoreStyle(removed), /<hideEmptyStaves>0<\/hideEmptyStaves>/,
    "and hands back the style");
});

// A second run removes the chart it finds and builds a fresh one. Undoing that
// has to give back the first chart, so the removal half is recorded too.
test("undoing a rebuild gives back the chart it replaced", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-undo-rerun-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE, { probeAction: "build", probeUndos: UNDOS }), charted);
  const before = mainScore(charted);
  const original = fs.readFileSync(FIXTURE, "utf8");
  assert.ok(partCount(before) > partCount(original), "the precondition: a chart to replace");
  assert.ok(stemlessChords(before) > 0, "with chords in it");

  const after = runProbe(t, dir, charted, "build");
  assert.ok(tag(after, "handbellChartReport").startsWith("Handbells Used"), "the rebuild ran");
  assert.strictEqual(partCount(after), partCount(before), "the first chart's instruments are back");
  assert.strictEqual(measureCount(after), measureCount(before), "and its measures");
  assert.strictEqual(stemlessChords(after), stemlessChords(before), "and its chords");
});

// setMetaTag is not undoable, so a build undone in full still records a chart
// in Project Properties. Nothing of it is left to find or delete, and the next
// run has to build a fresh one rather than refuse over a chart that is gone.
test("a build undone in full leaves nothing in the way of the next one", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-undo-rebuild-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const original = fs.readFileSync(FIXTURE, "utf8");
  const undone = runProbe(t, dir,
    makeScore(dir, FIXTURE, { probeAction: "build", probeUndos: UNDOS }), "build");
  // The precondition: the chart is gone but the score still records one.
  assert.strictEqual(partCount(undone), partCount(original), "the undo took the chart");
  assert.ok(tag(undone, "handbellChartParts"), "and the record of it stayed behind");

  const input = path.join(dir, "undone.mscz");
  fs.copyFileSync(path.join(dir, "build-undone.mscz"), input);
  const rebuilt = path.join(dir, "rebuilt.mscz");
  runExtension(input, rebuilt);
  const after = mainScore(rebuilt);
  assert.strictEqual(tag(after, "handbellChartError"), "", "the run did not refuse");
  assert.ok(tag(after, "handbellChartReport").startsWith("Handbells Used"), "it drew a chart");
  assert.ok(partCount(after) > partCount(original), "with instruments of its own");
});
