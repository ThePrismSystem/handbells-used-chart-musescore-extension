const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  fixture, chartBody,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");
const VOICES = path.join(__dirname, "..", "fixtures", "voices-and-grace-notes.mscx");

// The extension records what it found in a metaTag, which is the only channel
// out of a headless run that the test can read back. What it should record is
// whatever the XML reader finds in the same file: the two front ends share
// lib/ precisely so that one score cannot produce two different charts.
function agreesWithTheXmlReader(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, fixture), output);

  const found = /<metaTag name="handbellChartFound">([^<]*)<\/metaTag>/
    .exec(mainScore(output));
  assert.ok(found, "the extension recorded what it read");

  const expected = buildPlan(extractNotes(fs.readFileSync(fixture, "utf8")).records, {});
  const labels = expected.sections.map((section) => section.label).join(" | ");
  assert.strictEqual(found[1], labels);
}

test("reads the same bells the XML reader finds", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  agreesWithTheXmlReader(t, FIXTURE);
});

// A cursor addresses one voice at a time, and a chord's grace notes hang off
// the principal chord rather than appearing on their own — so a reader that
// takes cursor.element at voice 0 and stops finds neither. Both cost bells off
// the chart, and neither shows up on a fixture that has only one voice and no
// grace notes, which is every other fixture here.
test("reads every voice and the grace notes, as the XML reader does", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");

  // The preconditions. Without them a fixture that quietly lost its extra
  // voices would turn this into the single-voice test above, passing while the
  // branch it exists for went unrun.
  const text = fs.readFileSync(VOICES, "utf8");
  assert.strictEqual((text.match(/<voice>/g) || []).length, 4,
    "the fixture writes all four voices");
  assert.ok(/<acciaccatura\/>/.test(text), "the fixture has a grace note");

  // Every voice and the grace note must carry a bell no other note does, or
  // dropping them would not change the count the assertion compares.
  const bells = new Set((text.match(/<pitch>\d+<\/pitch>/g) || []));
  assert.strictEqual(bells.size, 5, "all five notes are distinct bells");

  agreesWithTheXmlReader(t, VOICES);
});

test("charts a piano score at its written octave", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-piano-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("piano-instrument.mscx");
  const input = makeScore(dir, source);
  const output = path.join(dir, "piano-out.mscz");
  runExtension(input, output);

  // The fixture's written middle C is the C5 bell. An octave error draws the
  // same four bells a staff lower, so assert on the pitches in the chart
  // measures rather than on the label, which would count four either way.
  const chart = chartBody(mainScore(output), source);
  assert.match(chart, /<pitch>72<\/pitch>/, "written middle C must chart as the C5 bell");
  assert.doesNotMatch(chart, /<pitch>60<\/pitch>/, "nothing may chart an octave low");
});

// FIXTURE's one diamond, turned into a notehead neither diamond nor normal.
// Mapping everything that is not a diamond to "normal" would chart pitch 86 a
// second time, as a bell rather than the chime it no longer even looks like —
// the same divergence tools/extract-notes.js already guards against by
// counting an unrecognised <head> as unknown rather than "normal".
test("does not chart an unrecognised notehead as a bell", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-notehead-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const original = fs.readFileSync(FIXTURE, "utf8");
  const altered = original.replace("<head>diamond</head>", "<head>cross</head>");
  // A silent no-op from replace() would leave FIXTURE's own diamond in place,
  // and the assertion below would then be checking an unaltered score.
  assert.notStrictEqual(altered, original,
    "the fixture must still spell <head>diamond</head> for this test to alter");

  const source = path.join(dir, "cross-notehead.mscx");
  fs.writeFileSync(source, altered);

  const input = makeScore(dir, source);
  const output = path.join(dir, "cross-notehead-out.mscz");
  runExtension(input, output);

  const chart = chartBody(mainScore(output), source);
  assert.doesNotMatch(chart, /<pitch>86<\/pitch>/,
    "an unrecognised notehead must not be charted as a bell");
});
