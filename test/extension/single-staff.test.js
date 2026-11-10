const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeMscz } = require("../../tools/mscz.js");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg, makeScore,
  mainScore, fixture, staffRegion, measuresOf, clefGlyphs,
} = require("./harness.js");

// A piece starting at middle C, whose only bell below the treble staff is C5.
const MIDDLE_C = fixture("middle-c-upward.mscx");
// Seven bass bells, with D5 and E5 just above the split.
const FEW_TREBLE = fixture("few-treble-bells.mscx");
const CLI = path.join(__dirname, "..", "..", "tools", "chart-cli.js");
const SINGLE = { handbellChartSingleStaff: "yes" };

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function staffCount(text) {
  return count(text, /<Staff id="\d+">/g);
}

function pitches(measure) {
  return [...measure.matchAll(/<pitch>(\d+)<\/pitch>/g)].map((m) => Number(m[1]));
}

// Each fixture has two staves of its own, so the chart's first staff is 3.
function chartMeasure(text, staffId) {
  return measuresOf(staffRegion(text, staffId))[0];
}

function workspace(t, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbext-single-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function extensionChart(t, tag, source, metaTags) {
  const dir = workspace(t, tag);
  installExtension();
  const output = path.join(dir, `${tag}.mscz`);
  runExtension(makeScore(dir, source, metaTags), output);
  return { dir, output, text: mainScore(output) };
}

function cliChart(t, tag, source, args) {
  const dir = workspace(t, tag);
  const input = path.join(dir, "in.mscz");
  fs.writeFileSync(input, writeMscz({
    entries: new Map([["score.mscx", fs.readFileSync(source)]]),
    mainName: "score.mscx",
  }));
  const output = path.join(dir, `${tag}.mscz`);
  execFileSync(process.execPath, [CLI, input, output].concat(args), { encoding: "utf8" });
  return { dir, output, text: mainScore(output) };
}

test("without the option, a lone C5 keeps a bass staff of its own", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { text } = extensionChart(t, "off", MIDDLE_C, {});
  assert.strictEqual(staffCount(text), 4, "two staves of the piece's and a grand staff");
  assert.deepStrictEqual(pitches(chartMeasure(text, 4)), [72], "C5 alone on the bass staff");
});

test("the extension charts a piece starting at C5 on one treble staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { dir, output, text } = extensionChart(t, "up", MIDDLE_C, SINGLE);
  assert.strictEqual(staffCount(text), 3, "one chart staff");
  assert.deepStrictEqual(pitches(chartMeasure(text, 3)), [72, 74, 76, 77, 79, 81, 83, 84],
    "C5 leads the treble staff");
  assert.strictEqual(count(renderSvg(output, path.join(dir, "up.svg")), /class="Bracket"/g), 0,
    "a one-staff chart is not braced");
});

test("the extension charts a few bells above the split on one bass staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const both = extensionChart(t, "both", FEW_TREBLE, {});
  const bassOnly = extensionChart(t, "down", FEW_TREBLE, SINGLE);

  assert.strictEqual(staffCount(bassOnly.text), 3, "one chart staff");
  assert.deepStrictEqual(pitches(chartMeasure(bassOnly.text, 3)),
    [60, 62, 64, 65, 67, 69, 71, 74, 76], "D5 and E5 follow the bass bells");

  // The staff left is the bass one, so it draws the clef the grand staff's
  // lower half draws. Rendered from the saved file, which is where a staff
  // could fall back to its instrument's first clef.
  const grand = clefGlyphs(renderSvg(both.output, path.join(both.dir, "both.svg")));
  const single = clefGlyphs(renderSvg(bassOnly.output, path.join(bassOnly.dir, "down.svg")));
  assert.notStrictEqual(grand[0], grand[1], "the precondition: the grand staff's clefs differ");
  assert.strictEqual(single[0], grand[1], "the one chart staff has the bass clef");
});

test("the command-line tool charts a piece starting at C5 on one treble staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { dir, output, text } = cliChart(t, "cli-up", MIDDLE_C, ["--single-staff"]);
  assert.strictEqual(staffCount(text), 3, "one chart staff");
  assert.deepStrictEqual(pitches(chartMeasure(text, 3)), [72, 74, 76, 77, 79, 81, 83, 84]);
  assert.strictEqual(count(renderSvg(output, path.join(dir, "cli-up.svg")), /class="Bracket"/g), 0);
});

test("the command-line tool charts a few bells above the split on one bass staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  // --hide-empty-staves so the piece's own staves leave the chart's system,
  // as the extension's always do, and the chart's clefs come first on the page.
  const both = cliChart(t, "cli-both", FEW_TREBLE, ["--hide-empty-staves"]);
  const bassOnly = cliChart(t, "cli-down", FEW_TREBLE, ["--single-staff", "--hide-empty-staves"]);

  assert.strictEqual(staffCount(bassOnly.text), 3, "one chart staff");
  assert.deepStrictEqual(pitches(chartMeasure(bassOnly.text, 3)),
    [60, 62, 64, 65, 67, 69, 71, 74, 76]);

  const grand = clefGlyphs(renderSvg(both.output, path.join(both.dir, "both.svg")));
  const single = clefGlyphs(renderSvg(bassOnly.output, path.join(bassOnly.dir, "down.svg")));
  assert.notStrictEqual(grand[0], grand[1], "the precondition: the grand staff's clefs differ");
  assert.strictEqual(single[0], grand[1], "the one chart staff has the bass clef");
});
