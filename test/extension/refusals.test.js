const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  fixture, tag, partCount, measureCount, withTags,
} = require("./harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

// A score charted by a first run, so each refusal below has a chart to keep.
function charted(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbext-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  const text = mainScore(output);
  const original = fs.readFileSync(FIXTURE, "utf8");
  assert.ok(partCount(text) > partCount(original), "the first run appended chart parts");
  return { dir, output, text };
}

test("a field the build refuses leaves the old chart where it was", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const before = charted(t, "refuse-build");
  const input = path.join(before.dir, "bad-mode.mscz");
  fs.writeFileSync(input, withTags(before.output, { handbellChartMode: "separat" }));
  const output = path.join(before.dir, "after.mscz");
  runExtension(input, output);
  const after = mainScore(output);

  assert.match(tag(after, "handbellChartError"), /^handbellChartMode is "separat"/);
  assert.strictEqual(partCount(after), partCount(before.text));
  assert.strictEqual(measureCount(after), measureCount(before.text));
  assert.strictEqual(tag(after, "handbellChartParts"), tag(before.text, "handbellChartParts"));
});

test("a chart the remove action cannot identify is refused and left alone", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const before = charted(t, "refuse-remove");
  const input = path.join(before.dir, "tampered.mscz");
  fs.writeFileSync(input, withTags(before.output, { handbellChartParts: "-1" }));
  const output = path.join(before.dir, "after.mscz");
  runExtension(input, output, "remove");
  const after = mainScore(output);

  assert.match(tag(after, "handbellChartError"), /records a Handbells Used chart/);
  assert.strictEqual(partCount(after), partCount(before.text));
  assert.strictEqual(measureCount(after), measureCount(before.text));
});
