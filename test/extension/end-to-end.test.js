const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore,
} = require("./harness.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

function chartWith(t, metaTags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE, metaTags), output);
  return { output, text: mainScore(output) };
}

test("takes the label text from a metaTag", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chartWith(t, { handbellChartBellLabel: "5-7 Octaves" });
  assert.match(text, /5-7 Octaves/);
  assert.doesNotMatch(text, /Handbells Used: \d+/);
});

test("colours chimes from the score's own handchimesColor", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chartWith(t, { handchimesColor: "#c00000" });
  assert.match(text, /<color r="192" g="0" b="0"/);
});

// This does not exercise mutate.js's black guard: a new notehead is already
// black by default, so MuseScore's own serializer omits <color> for it either
// way, whether or not mutate.js ever calls usableColor at all. Breaking the
// guard leaves this assertion passing. What it does confirm end to end is
// that no other part of the pipeline writes an explicit black override for a
// requested black colour. The guard itself is proven by
// test/unit/mutate.test.js, which calls usableColor directly and does fail
// when the guard is removed.
test("black chimes get no colour element at all", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chartWith(t, { handchimesColor: "#000000" });
  assert.doesNotMatch(text, /<color r="0" g="0" b="0"/);
});

test("a quiet run records its summary instead of prompting", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chartWith(t, {});
  assert.match(text, /<metaTag name="handbellChartReport">[^<]*Handbells Used/);
});

test("a headless run produces a score MuseScore can open", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(chartWith(t, {}).output), 0);
});
