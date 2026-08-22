const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore, scoreStyle,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { readMscz, writeMscz, replaceMain } = require("../../tools/mscz.js");

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
  // The precondition the whole test rests on. Every assertion below compares a
  // count against sections(), so a plan that collapsed to nothing would make
  // each one 0 === 0 and the test would pass against a plugin that wrote no
  // chart at all, twice.
  assert.ok(sections() > 0, "the fixture plans at least one chart");
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
  // Asserted before the comparison, because the comparison alone cannot tell
  // "both runs counted the same bells" from "neither run wrote a label at
  // all": [] and [] are deep-equal. This is the only guard in the suite
  // against the second run counting the first run's chart as music, so it must
  // not be able to pass empty-handed.
  assert.ok(labelsOf(once).length > 0, "the first run wrote a count to compare");
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
  // [^<] and not a bare presence check: a successful run clears this tag by
  // writing an empty string, and MuseScore keeps the emptied element, so
  // "the tag is there" is satisfied by every run that worked.
  assert.match(text, /<metaTag name="handbellChartError">[^<]/);
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
  assert.match(text, /<metaTag name="handbellChartError">[^<]/);
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
  assert.match(text, /<metaTag name="handbellChartError">[^<]/);
});

test("a fractional recorded count is refused, not truncated", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // "1.5" is the case Number()-not-parseInt() exists for: parseInt would hand
  // back 1 and the run would go on to delete one part and one measure on the
  // strength of a tag that says no such thing. The total matches the fixture
  // exactly, so as with the negative-count test the other guards would let
  // this through and only the integer check can catch it.
  const input = makeScore(dir, FIXTURE, {
    handbellChartParts: "1.5", handbellChartTotal: String(originalPartCount()),
  });
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  const text = mainScore(output);
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart was written");
  assert.match(text, /<metaTag name="handbellChartError">[^<]/);
  assert.strictEqual((text.match(/<Part id="\d+">/g) || []).length, originalPartCount(),
    "the piece keeps its own instruments");
});

test("a chart the command-line tool made is refused, not doubled", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // handbellChartMeasures is the command-line tool's own record of how many
  // measures it inserted; nothing in the extension writes it, and the tool
  // deletes it outright when it removes a chart, so its presence means a chart
  // this plugin cannot see. Its parts carry a track name instead of a recorded
  // count, so without this every check in findChart passes trivially and the
  // plugin builds a second chart beside the first.
  const input = makeScore(dir, FIXTURE, { handbellChartMeasures: "2" });
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  const text = mainScore(output);
  assert.match(text, /<metaTag name="handbellChartError">[^<]/);
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart was written");
  assert.strictEqual((text.match(/<Part id="\d+">/g) || []).length, originalPartCount(),
    "the piece keeps its own instruments");
});

// main() removes the chart it finds and then builds a new one, so there is no
// removal on its own to observe — unless the second run has nothing to build.
// Moving every bell out of C2-C9 between the two runs does exactly that: the
// chart is found and removed as usual, the plan that follows is empty, and the
// run returns. Only the octave changes, so every count below is untouched by
// the move itself.
function unplannable(mscz) {
  const archive = readMscz(fs.readFileSync(mscz));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  // pitch % 12 lands in C0-B0, far below C2, and keeps the pitch class, so the
  // tpc beside it still spells the same letter and the score still loads.
  return writeMscz(replaceMain(archive, text.replace(/<pitch>(\d+)<\/pitch>/g,
    (whole, pitch) => `<pitch>${Number(pitch) % 12}</pitch>`)));
}

function measuresPerStaff(text) {
  return (text.match(/<Staff id="\d+">/g) || []).map((open) => {
    const start = text.indexOf(open);
    const region = text.slice(start, start + text.slice(start).indexOf("</Staff>"));
    return (region.match(/<Measure(?:\s[^>]*)?>/g) || []).length;
  });
}

test("removing a chart gives the score back as it was", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);
  assert.strictEqual((mainScore(charted).match(/<irregular>1<\/irregular>/g) || []).length,
    sections(), "the first run built a chart to remove");

  const emptied = path.join(dir, "emptied.mscz");
  fs.writeFileSync(emptied, unplannable(charted));
  const removed = path.join(dir, "removed.mscz");
  runExtension(emptied, removed);

  const back = mainScore(removed);
  const original = fs.readFileSync(FIXTURE, "utf8");
  assert.strictEqual((back.match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "no chart measure is left behind");
  assert.strictEqual((back.match(/<Part id="\d+">/g) || []).length, originalPartCount(),
    "the piece is back to its own parts");
  assert.strictEqual((back.match(/<Staff id="\d+">/g) || []).length,
    (original.match(/<Staff id="\d+">/g) || []).length,
    "the piece is back to its own staves");
  assert.deepStrictEqual(measuresPerStaff(back), measuresPerStaff(original),
    "every staff is back to its own measures");
  assert.strictEqual((back.match(/<Note>/g) || []).length,
    (original.match(/<Note>/g) || []).length,
    "every note the piece started with is still there");

  // The style the chart turned on is score-wide and outlives every measure and
  // part the removal takes out, so "the score is back as it was" is not true
  // until this is too. Checked against the charted score rather than a literal,
  // so the assertion still means something if the default ever changes: the
  // build must have turned it on, and the removal must have turned it back off.
  assert.match(scoreStyle(charted), /<hideEmptyStaves>1<\/hideEmptyStaves>/,
    "the chart turned hide-empty-staves on");
  assert.match(scoreStyle(removed), /<hideEmptyStaves>0<\/hideEmptyStaves>/,
    "removing the chart turned it back off");
  assert.match(scoreStyle(removed),
    /<dontHideStavesInFirstSystem>1<\/dontHideStavesInFirstSystem>/,
    "removing the chart restored the first-system exception");

  assert.strictEqual(renderPdf(removed), 0);
});

// Swaps the instrument on the score's last part — one of the chart's own —
// for one the chart never uses, the way replacing an instrument in MuseScore
// would. Nothing else moves: the part count, the measures and the recorded
// tags all still agree.
function lastPartBecomesAPiano(mscz) {
  const archive = readMscz(fs.readFileSync(mscz));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  const last = text.lastIndexOf(`<Instrument id="hand-`);
  assert.notStrictEqual(last, -1, "the charted score ends on a chart instrument");
  const end = text.indexOf(">", last);
  return writeMscz(replaceMain(archive,
    `${text.slice(0, last)}<Instrument id="piano"${text.slice(end)}`));
}

test("an instrument that is not the chart's own is refused, not deleted", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // This has to start from a real chart, or it proves nothing. On a score that
  // was never charted, the recorded lengths and the irregular mark both fail
  // first and refuse the run before the instrument is ever looked at — so the
  // check under test could be deleted outright and the test would still pass.
  // Building the chart and then swapping only the instrument leaves every
  // other guard satisfied: the count and total still agree, the measures are
  // still the chart's own and still the right lengths. The instrument is the
  // one thing that changed, so it is the only thing that can catch this.
  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);
  const before = mainScore(charted);
  assert.strictEqual((before.match(/<irregular>1<\/irregular>/g) || []).length,
    sections(), "the first run built a chart to tamper with");

  const swapped = path.join(dir, "swapped.mscz");
  fs.writeFileSync(swapped, lastPartBecomesAPiano(charted));
  const swappedText = mainScore(swapped);
  assert.strictEqual((swappedText.match(/<Part id="\d+">/g) || []).length,
    (before.match(/<Part id="\d+">/g) || []).length,
    "the swap left the part count alone, so the total still matches");
  assert.ok(/<Instrument id="piano">/.test(swappedText), "and put a piano at the end");

  const output = path.join(dir, "out.mscz");
  runExtension(swapped, output);

  const text = mainScore(output);
  assert.match(text, /<metaTag name="handbellChartError">[^<]/, "the run refused");
  assert.ok(/<Instrument id="piano">/.test(text), "the piano was not deleted");
  assert.strictEqual((text.match(/<Part id="\d+">/g) || []).length,
    (swappedText.match(/<Part id="\d+">/g) || []).length,
    "and neither was anything else");
});

// A pickup as MuseScore's own wizard writes one: a short measure carrying the
// irregular mark. Inserted at the front of every score staff, which is where a
// user adding one to a charted score would put it — ahead of the chart.
function withPickupInFront(mscz) {
  const archive = readMscz(fs.readFileSync(mscz));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  const rest = `<Measure len="1/4">$IRR<voice><Rest>`
    + `<durationType>measure</durationType><duration>1/4</duration>`
    + `</Rest></voice></Measure>`;
  // The first staff carries the title frame, and the measure-level irregular
  // mark, which MuseScore records on staff 1 alone.
  let out = text.replace(/(<\/VBox>\s*)(?=<Measure)/,
    (whole) => whole + rest.replace("$IRR", "<irregular>1</irregular>"));
  // Every other score staff opens straight onto its first measure; the part
  // definitions above open onto a StaffType instead and are left alone.
  out = out.replace(/(<Staff id="\d+">\s*)(?=<Measure)/g,
    (whole) => whole + rest.replace("$IRR", ""));
  return writeMscz(replaceMain(archive, out));
}

test("a pickup measure added ahead of the chart is refused, not deleted", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);
  const chartedText = mainScore(charted);
  assert.strictEqual((chartedText.match(/<irregular>1<\/irregular>/g) || []).length,
    sections(), "the first run built a chart to add a pickup to");

  // The measure guard cannot be the irregular mark alone, because this is the
  // one thing that carries the same mark and is not the chart's. Left to that
  // check, all of the first sections() measures still look irregular, the
  // removal goes ahead by position, and it eats the user's pickup and leaves
  // the last chart measure standing. The recorded lengths are what tell the
  // two apart: this measure is 1/4 where the chart's first is its own column
  // count.
  const withPickup = path.join(dir, "pickup.mscz");
  fs.writeFileSync(withPickup, withPickupInFront(charted));
  assert.strictEqual((mainScore(withPickup).match(/<irregular>1<\/irregular>/g) || []).length,
    sections() + 1, "the pickup went in carrying the same mark as a chart measure");

  const output = path.join(dir, "out.mscz");
  runExtension(withPickup, output);

  const text = mainScore(output);
  assert.match(text, /<metaTag name="handbellChartError">[^<]/,
    "the run refused and said why");
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length,
    sections() + 1, "the pickup and every chart measure are still there");
  assert.deepStrictEqual(measuresPerStaff(text), measuresPerStaff(mainScore(withPickup)),
    "no measure was deleted from any staff");
});

test("MuseScore can open the regenerated score", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.strictEqual(renderPdf(runTwice(t).twice), 0);
});
