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

function runTwice(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const once = path.join(dir, "once.mscz");
  const twice = path.join(dir, "twice.mscz");
  runExtension(makeScore(dir, FIXTURE), once);
  runExtension(once, twice);
  return { once, twice };
}

function sections() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {}).sections.length;
}

// The fixture is named two-staff-handbells for a reason: it already carries a
// user hand-bells part of its own, distinct from the chart's own hand-bells
// section. So a single, correct run leaves TWO <Instrument id="hand-bells">
// blocks, not one — the fixture's own plus the chart's. What must not change
// between one run and two is that count, so it is derived from the fixture
// and the plan rather than hard-coded, and checked on both files.
function expectedBellsInstrumentCount() {
  const original = (fs.readFileSync(FIXTURE, "utf8").match(/<Instrument id="hand-bells">/g)
    || []).length;
  const plan = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {});
  const chartAddsBells = plan.sections.some((section) => section.partId === "hand-bells");
  return original + (chartAddsBells ? 1 : 0);
}

test("running twice leaves one chart, not two", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { once, twice } = runTwice(t);
  for (const file of [once, twice]) {
    const text = mainScore(file);
    assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length,
      sections(), `${path.basename(file)} has one chart`);
    assert.strictEqual((text.match(/<Instrument id="hand-bells">/g) || []).length,
      expectedBellsInstrumentCount(), `${path.basename(file)} has the right bells instrument count`);
  }
});

test("the chart's own notes are never counted as bells used", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { once, twice } = runTwice(t);
  const labelsOf = (file) =>
    (mainScore(file).match(/Handbells Used: \d+|Handchimes Used: \d+/g) || []).sort();
  assert.deepStrictEqual(labelsOf(twice), labelsOf(once));
});

test("a chart that can no longer be located is refused, not duplicated", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // Claim a chart exists that does not: the recorded total will not match.
  const input = makeScore(dir, FIXTURE, {
    handbellChartParts: "2", handbellChartTotal: "99",
  });
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  const text = mainScore(output);
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart was written");
  assert.match(text, /<metaTag name="handbellChartError">/);
});

function originalPartCount() {
  return (fs.readFileSync(FIXTURE, "utf8").match(/<Part id="\d+">/g) || []).length;
}

function pitchesOf(text) {
  return (text.match(/<pitch>\d+<\/pitch>/g) || []).map((p) => Number(p.match(/\d+/)[0]));
}

test("measures that are not the chart's own are refused, not deleted", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // Claim the fixture's own — and only — hand-bells part as the chart, with a
  // total that matches the score exactly. Every check findChart makes over the
  // parts passes: the count is a positive integer, the total agrees, and the
  // instrument is one the chart uses. What does not agree is the score's first
  // measure, which is the user's music and carries no irregular flag, so this
  // isolates the measure guard the way the negative-count test isolates the
  // count guard. Removing it hands the user's only part and their first
  // measure to a positional delete.
  const input = makeScore(dir, FIXTURE, {
    handbellChartParts: "1", handbellChartTotal: String(originalPartCount()),
  });
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  const text = mainScore(output);
  assert.match(text, /<metaTag name="handbellChartError">/);
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart was written");
  assert.strictEqual((text.match(/<Part id="\d+">/g) || []).length, originalPartCount(),
    "the piece keeps its own instruments");
  assert.deepStrictEqual(pitchesOf(text),
    pitchesOf(fs.readFileSync(FIXTURE, "utf8")),
    "the piece keeps its own music");
});

test("a negative recorded count is refused, not read as no chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // The total is set to match the fixture's own part count exactly, so this
  // isolates the negative-count guard: score.parts.length - (-3) is a
  // positive, in-bounds "first" here, so the total/instrumentId checks alone
  // would let this through. If it is still refused, the count check is what
  // caught it, not one of the others.
  const input = makeScore(dir, FIXTURE, {
    handbellChartParts: "-3", handbellChartTotal: String(originalPartCount()),
  });
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  const text = mainScore(output);
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart was written");
  assert.match(text, /<metaTag name="handbellChartError">/);
});

test("MuseScore can open the regenerated score", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(runTwice(t).twice), 0);
});
