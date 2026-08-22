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

// The count, not a match anywhere in the document: a dressChord that applied
// the colour outside the diamond branch would colour the handbells too, and
// still satisfy "this colour appears somewhere".
function chimeNoteCount() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {}).sections
    .filter((section) => section.kind === "chimes")
    .flatMap((section) => section.treble.concat(section.bass))
    .flatMap((column) => column.notes).length;
}

test("colours chimes from the score's own handchimesColor", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const chimes = chimeNoteCount();
  assert.ok(chimes > 0, "the fixture has chimes to colour");
  const { text } = chartWith(t, { handchimesColor: "#c00000" });
  assert.strictEqual((text.match(/<color r="192" g="0" b="0"/g) || []).length, chimes);
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

test("a run that succeeds clears the refusal an earlier one recorded", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = chartWith(t, { handbellChartError: "a refusal from an earlier run" });
  assert.match(text, /<metaTag name="handbellChartReport">[^<]*Handbells Used/,
    "this run succeeded");
  assert.doesNotMatch(text, /<metaTag name="handbellChartError">[^<]/,
    "and left no error behind to describe a score that has since been put right");
});

test("a headless run produces a score MuseScore can open", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(chartWith(t, {}).output), 0);
});
