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
// the principal chord rather than appearing on their own, so a reader that
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
// everything that is not a diamond to "normal" would chart pitch 86 as a bell.
// That is the same divergence tools/extract-notes.js already guards against by
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
// one instrument for the whole score, or mapped staves to parts positionally
// and got the mapping wrong, charts one of the two an octave out. The XML
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

// A part that transposes up an octave but is not a handbell instrument. This
// is what a Piano-part handbell score looks like once the arranger has
// transposed it up an octave so it plays back at bell pitch, and it is the
// shape behind a user's report that the chart had "everything up an octave":
// the offset used to be guessed from the instrument id, which reads "piano"
// here, so every bell was lifted a second time.
//
// The extension has no unit-test route to this. lib/ is covered by
// test/unit/sourcepitch.test.js, but nothing but a real MuseScore proves that
// Staff.transpose is the property carrying the number. A Part exposes none,
// and a wrapper reads back whatever it is given, so only the chart MuseScore
// actually writes settles it.
test("a transposed part is not lifted a second time", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-transposed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("transposed-part.mscx");
  // The preconditions. Without both of these the test proves nothing: a
  // fixture that does not transpose exercises no correction at all, and one
  // whose part is a handbell instrument passes on the old guess too.
  const text = fs.readFileSync(source, "utf8");
  assert.match(text, /<transposeChromatic>12<\/transposeChromatic>/,
    "the fixture's part must transpose up an octave");
  assert.doesNotMatch(text, /<Instrument id="hand-(bells|chimes)">/,
    "the fixture's part must not be a handbell instrument");

  const output = path.join(dir, "transposed-out.mscz");
  runExtension(makeScore(dir, source), output);
  const saved = mainScore(output);
  assert.match(saved, /Handbells Used: 3/, "three bells were charted");

  const chart = chartBody(saved, source);
  // The C5, E5 and G5 bells, already stored at their own names.
  for (const pitch of [72, 76, 79]) {
    assert.match(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `the chart must contain pitch ${pitch}`);
  }
  // The bug: lifted again, they chart as C6, E6 and G6.
  for (const pitch of [84, 88, 91]) {
    assert.doesNotMatch(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `pitch ${pitch} means the transposed part was lifted a second time`);
  }
});

// An 8va line. The two front ends reach it by completely different routes. The
// extension asks staff.pitchOffset; the XML reader resolves the spanner's span
// itself out of measures and note durations. So this is the case most likely
// to leave them disagreeing, and agreeing here is most of the point.
test("reads the same bells the XML reader finds under an ottava", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  agreesWithTheXmlReader(t, fixture("ottava.mscx"));
});

// And the bells themselves, because agreement alone would be satisfied by
// both readers being wrong in the same way.
test("bells under an ottava are charted at the octave they sound", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-ottava-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("ottava.mscx");
  // The preconditions. Without the line there is no shift to test, and
  // without the second voice the staff-wide reading is never exercised, since
  // an ottava moves every voice under it, not only the one it is written in.
  const text = fs.readFileSync(source, "utf8");
  assert.match(text, /<Spanner type="Ottava">/, "the fixture needs an ottava");
  assert.strictEqual((text.match(/<voice>/g) || []).length, 3,
    "the fixture needs a second voice under the line");
  // And the count itself has to move. The second measure repeats the C6 the
  // ottava produces and the C5 it consumes, so reading the line collapses two
  // bells into ones already charted: four bells with it, five without. Without
  // that the count is the same either way, and the agreement test above, which
  // can only compare the labels the extension records, passes on a run that
  // ignored the ottava completely. It did, before this was added.
  assert.match(text, /<pitch>84<\/pitch>/,
    "the fixture needs a bell the shifted note lands on");

  const output = path.join(dir, "ottava-out.mscz");
  runExtension(makeScore(dir, source), output);
  const saved = mainScore(output);
  assert.match(saved, /Handbells Used: 4/, "four bells were charted");

  const chart = chartBody(saved, source);
  // 84 is the first voice's C5 read an octave up; 62 and 74 sit past the end
  // of the line and are charted where they are drawn.
  for (const pitch of [84, 74, 62]) {
    assert.match(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `the chart must contain pitch ${pitch}`);
  }
  // The second voice's note under the line, left where it was drawn. It is
  // written in a voice the ottava never appears in, so this is the assertion
  // that fails if the line is read as belonging to its own voice.
  assert.doesNotMatch(chart, /<pitch>60<\/pitch>/,
    "pitch 60 means the ottava did not reach the second voice");
});

// The Piano part's notes reach the chart as handbells, because a plain
// notehead is all a handbell is. A score with a piano reduction therefore
// charts the pianist's notes, and the skip list is how a user says not to.
test("a part named in the skip list is left out of the chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-skip-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("mixed-instruments.mscx");
  const text = fs.readFileSync(source, "utf8");
  // The preconditions. Without two differently named parts the filter has
  // nothing to tell apart, and without the Piano part's own pitches the
  // absence asserted below is an absence of nothing.
  assert.match(text, /<trackName>Handbells<\/trackName>/, "fixture needs a Handbells part");
  assert.match(text, /<trackName>Piano<\/trackName>/, "fixture needs a Piano part");

  // Charted first with no skip list, to establish that the Piano's bells do
  // reach the chart. A run that never charted them would pass the second half
  // of this test with the filter deleted.
  const before = path.join(dir, "skip-before.mscz");
  runExtension(makeScore(dir, source), before);
  assert.match(mainScore(before), /Handbells Used: 4/,
    "without the skip list the Piano part is charted too");

  const after = path.join(dir, "skip-after.mscz");
  runExtension(makeScore(dir, source, { handbellChartSkipParts: "Piano" }), after);
  const saved = mainScore(after);

  assert.match(saved, /Handbells Used: 3/, "only the Handbells part is charted");
  const chart = chartBody(saved, source);
  // The handbell staff writes C5 D5 E5, which store as 72, 74, 76.
  for (const pitch of [72, 74, 76]) {
    assert.match(chart, new RegExp(`<pitch>${pitch}</pitch>`),
      `the chart must still contain pitch ${pitch}`);
  }
  // 77 is the piano staff's F5, and the only pitch the two parts do not share.
  assert.doesNotMatch(chart, /<pitch>77<\/pitch>/,
    "the skipped part's own bell must not be charted");
});

test("a skip list naming no part warns and still charts", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-skipmiss-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const output = path.join(dir, "skip-miss.mscz");
  runExtension(makeScore(dir, fixture("mixed-instruments.mscx"),
    { handbellChartSkipParts: "Harpsichord" }), output);
  const saved = mainScore(output);
  // Charted, not refused: a name matching nothing must not cost the user a
  // chart. The count is the one the unfiltered run produces.
  assert.match(saved, /Handbells Used: 4/, "the chart is still built");
});
