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
// With no diamond left the score charts no chimes at all, so mapping
// everything that is not a diamond to "normal" would chart pitch 86 as a bell
// — the same divergence tools/extract-notes.js already guards against by
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
  // The precondition. chartBody returns "" when it finds no chart staff, and a
  // lone doesNotMatch over "" passes just as happily on a run that refused and
  // built nothing at all. The fixture's other bells must be on the page before
  // the absence of 86 means anything.
  assert.match(chart, /<pitch>72<\/pitch>/,
    "the fixture's remaining bells must have charted");
  assert.doesNotMatch(chart, /<pitch>86<\/pitch>/,
    "an unrecognised notehead must not be charted as a bell");
});

// Two parts of different instruments in one score. The offset is decided per
// staff, from the instrument that staff's part carries, so a reader that took
// one instrument for the whole score — or mapped staves to parts positionally
// and got the mapping wrong — charts one of the two an octave out. The XML
// reader has unit tests for exactly this; until now the extension had none,
// because every extension fixture held a single part.
test("applies each part's own octave offset, not one score-wide", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-mixed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("mixed-instruments.mscx");
  // The precondition: the fixture really does carry two instruments that need
  // different offsets. With one instrument the test proves nothing at all.
  const text = fs.readFileSync(source, "utf8");
  assert.match(text, /<Instrument id="hand-bells">/, "fixture needs a transposing part");
  assert.match(text, /<Instrument id="piano">/, "fixture needs a non-transposing part");

  const output = path.join(dir, "mixed-out.mscz");
  runExtension(makeScore(dir, source), output);
  const saved = mainScore(output);

  // The handbell staff writes C5 D5 E5 and the piano staff the same written
  // C5 D5 F5 an octave lower in stored pitch, so the chart is four bells:
  // 72, 74, 76, 77. C5 is written by both parts and is charted once.
  assert.match(saved, /Handbells Used: 4/, "four distinct bells were charted");

  const chart = chartBody(saved, source);
  for (const pitch of [72, 74, 76, 77]) {
    assert.match(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `the chart must contain pitch ${pitch}`);
  }
  // The two ways to get this wrong. 60 and 62 are the piano staff left
  // unshifted; 84, 86 and 88 are the handbell staff shifted as though it were
  // the piano's.
  for (const pitch of [60, 62, 84, 86, 88]) {
    assert.doesNotMatch(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `pitch ${pitch} means one part got the other part's offset`);
  }
});
