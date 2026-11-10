const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeMscz } = require("../../tools/mscz.js");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg, makeScore,
  mainScore, fixture, staffRegion, measuresOf, chartNoteheads, bracketExtents,
} = require("./harness.js");

// Ten bells on the treble side and six on the bass, so the chart measure is
// ten columns long and the bass staff has four fewer.
const FIXTURE = fixture("uneven-staves.mscx");
const TREBLE = 10;
const BASS = 6;
const CLI = path.join(__dirname, "..", "..", "tools", "chart-cli.js");

// The chart's noteheads split by staff. The bass staff is drawn below the
// treble, so its six are the six lowest on the page.
function byStaff(svg) {
  const notes = chartNoteheads(svg);
  assert.strictEqual(notes.length, TREBLE + BASS, "the precondition: one notehead per bell");
  const lowest = [...notes].sort((a, b) => b.y - a.y);
  const bass = lowest.slice(0, BASS).sort((a, b) => a.left - b.left);
  const treble = lowest.slice(BASS).sort((a, b) => a.left - b.left);
  return { treble, bass };
}

function gaps(notes) {
  return notes.slice(1).map((note, i) => note.left - notes[i].left);
}

// Published charts spread each staff's bells across the whole width. Packed at
// the left, the six bass bells would sit under the first six treble ones.
function assertSpread(svg) {
  const { treble, bass } = byStaff(svg);
  const bassGaps = gaps(bass);
  const mean = bassGaps.reduce((a, b) => a + b, 0) / bassGaps.length;
  for (const gap of bassGaps) {
    assert.ok(Math.abs(gap - mean) / mean < 0.02,
      `the bass bells are evenly spaced (gaps ${bassGaps.map(Math.round).join(", ")})`);
  }
  const trebleGap = gaps(treble).reduce((a, b) => a + b, 0) / (TREBLE - 1);
  assert.ok(Math.abs(mean / trebleGap - TREBLE / BASS) < 0.05,
    `a bass gap is ten sixths of a treble gap (${mean.toFixed(1)} against ${trebleGap.toFixed(1)})`);
  assert.ok(bass[BASS - 1].left > treble[7].left,
    "the last bass bell sits past the eighth treble bell, not under the sixth");
}

// The chart's own measure on one chart staff. The fixture has two staves of
// its own, so the chart's treble staff is 3 and its bass staff 4.
function chartMeasure(text, staffId) {
  return measuresOf(staffRegion(text, staffId))[0];
}

// C4, D4 and E4 are optional with F4 the first required bell: the first three
// of the bass staff's six, so the bracket spans two of its wider columns.
function assertBracketEncloses(svg) {
  const { bass } = byStaff(svg);
  const brackets = bracketExtents(svg);
  assert.strictEqual(brackets.length, 1, "the precondition: one bracket");
  const [bracket] = brackets;
  assert.ok(bracket.left < bass[0].left,
    `the bracket starts left of C4 (${bracket.left.toFixed(1)} vs ${bass[0].left.toFixed(1)})`);
  assert.ok(bracket.right > bass[2].right,
    `the bracket ends right of E4 (${bracket.right.toFixed(1)} vs ${bass[2].right.toFixed(1)})`);
  assert.ok(bracket.right < bass[3].left,
    `and stops short of F4 (${bracket.right.toFixed(1)} vs ${bass[3].left.toFixed(1)})`);
  const before = bass[0].left - bracket.left;
  const after = bracket.right - bass[2].right;
  assert.ok(Math.abs(before - after) < 2,
    `the same overhang at both ends (${before.toFixed(1)}, ${after.toFixed(1)})`);
}

test("the extension writes the shorter staff as one hidden tuplet", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-spacing-xml-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  const text = mainScore(output);

  const treble = chartMeasure(text, 3);
  const bass = chartMeasure(text, 4);
  assert.strictEqual((treble.match(/<Chord>/g) || []).length, TREBLE, "the precondition: ten treble columns");
  assert.doesNotMatch(treble, /<Tuplet>/, "the fuller staff is plain quarters");

  const tuplet = /<Tuplet>([\s\S]*?)<\/Tuplet>/.exec(bass);
  assert.ok(tuplet, "the bass staff's chart measure holds a tuplet");
  assert.match(tuplet[1], /<normalNotes>10<\/normalNotes>/);
  assert.match(tuplet[1], /<actualNotes>6<\/actualNotes>/);
  assert.match(tuplet[1], /<numberType>2<\/numberType>/);
  assert.match(tuplet[1], /<bracketType>2<\/bracketType>/);
  assert.strictEqual((bass.match(/<Chord>/g) || []).length, BASS);
  assert.doesNotMatch(bass, /<Rest>/, "nothing pads the bass staff out");
});

test("the extension spreads the shorter staff across the measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-spacing-render-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  assertSpread(renderSvg(output, path.join(dir, "out.svg")));
});

test("the command-line tool spreads the shorter staff across the measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-spacing-render-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const input = path.join(dir, "in.mscz");
  fs.writeFileSync(input, writeMscz({
    entries: new Map([["score.mscx", fs.readFileSync(FIXTURE)]]),
    mainName: "score.mscx",
  }));
  const output = path.join(dir, "out.mscz");
  execFileSync(process.execPath, [CLI, input, output], { encoding: "utf8" });
  assertSpread(renderSvg(output, path.join(dir, "out.svg")));
});

test("the extension's bracket on a spread staff encloses its bells", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-spacing-bracket-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE, { handbellChartRequiredBellFirst: "F4" }), output);
  assertBracketEncloses(renderSvg(output, path.join(dir, "out.svg")));
});

test("the command-line tool's bracket on a spread staff encloses its bells", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-spacing-bracket-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const input = path.join(dir, "in.mscz");
  fs.writeFileSync(input, writeMscz({
    entries: new Map([["score.mscx", fs.readFileSync(FIXTURE)]]),
    mainName: "score.mscx",
  }));
  const output = path.join(dir, "out.mscz");
  execFileSync(process.execPath, [CLI, input, output, "--required-bell-first", "F4"],
    { encoding: "utf8" });
  assertBracketEncloses(renderSvg(output, path.join(dir, "out.svg")));
});
