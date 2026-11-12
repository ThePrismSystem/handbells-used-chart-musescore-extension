const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg, makeScore,
  mainScore, fixture, chartNoteheads, bracketExtents, chartStaffColumns,
  chartMeasure, workspace, runCli, staffRegion, measuresOf,
} = require("./harness.js");

// Ten bells on the treble side and six on the bass, so the chart measure is
// ten columns long and the bass staff has four fewer.
const FIXTURE = fixture("uneven-staves.mscx");
const TREBLE = 10;
const BASS = 6;

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

// The fixture has two staves of its own, so the chart's treble staff is 3 and
// its bass staff 4.
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
  const dir = workspace(t, "spacing-xml");
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
  const dir = workspace(t, "spacing-render");
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  assertSpread(renderSvg(output, path.join(dir, "out.svg")));
});

test("the command-line tool spreads the shorter staff across the measure", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-render");

  const output = runCli(dir, FIXTURE);
  assertSpread(renderSvg(output, path.join(dir, "out.svg")));
});

test("the extension's bracket on a spread staff encloses its bells", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-bracket");
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE, { handbellChartRequiredBellFirst: "F4" }), output);
  assertBracketEncloses(renderSvg(output, path.join(dir, "out.svg")));
});

test("the command-line tool's bracket on a spread staff encloses its bells", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-bracket");

  const output = runCli(dir, FIXTURE, ["--required-bell-first", "F4"]);
  assertBracketEncloses(renderSvg(output, path.join(dir, "out.svg")));
});

// A seven-octave chart's bass staff is usually the shorter one, and its lowest
// row stacks onto the row above: C2 shares C3's column. That stack is a chord
// written inside the tuplet.
const STACKED = fixture("stacked-spread-staff.mscx");

function assertStackedSpread(svg) {
  assert.strictEqual(chartNoteheads(svg).length, 12, "the precondition: one notehead per bell");
  const [treble, bass] = chartStaffColumns(svg);
  assert.strictEqual(treble.length, 7, "seven treble columns");
  assert.strictEqual(bass.length, 4, "four bass columns, with C2 and C3 in one");
  const bassGaps = gaps(bass);
  const mean = bassGaps.reduce((a, b) => a + b, 0) / bassGaps.length;
  for (const gap of bassGaps) {
    assert.ok(Math.abs(gap - mean) / mean < 0.02,
      `the bass columns are evenly spaced (gaps ${bassGaps.map(Math.round).join(", ")})`);
  }
  assert.ok(bass[3].left > treble[4].left,
    "the last bass column sits past the fifth treble one, not under the fourth");
}

test("the extension writes a stacked column inside the tuplet", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-stack");
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, STACKED), output);
  const bass = chartMeasure(mainScore(output), 4);
  assert.match(bass, /<actualNotes>4<\/actualNotes>/, "the bass staff is a 4:7 tuplet");
  assert.match(bass, /<normalNotes>7<\/normalNotes>/);
  const first = /<Chord>[\s\S]*?<\/Chord>/.exec(bass);
  assert.ok(first, "the bass staff's chart measure holds a chord");
  assert.strictEqual((first[0].match(/<Note>/g) || []).length, 2, "its first chord holds C2 and C3");
  assertStackedSpread(renderSvg(output, path.join(dir, "out.svg")));
});

test("the command-line tool spreads a staff with a stacked column", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-stack");

  const output = runCli(dir, STACKED);
  assertStackedSpread(renderSvg(output, path.join(dir, "out.svg")));
});

// Handbells on three columns a staff, then handchimes with six on the treble
// staff and three on the bass. The handchimes chart is the second chart
// measure, so its bass staff is a tuplet written past the first chart.
const LATER = fixture("uneven-chimes.mscx");

function assertLaterTuplet(text, staffId) {
  const bass = measuresOf(staffRegion(text, staffId))[1];
  const tuplet = /<Tuplet>([\s\S]*?)<\/Tuplet>/.exec(bass);
  assert.ok(tuplet, `staff ${staffId}'s second chart measure holds a tuplet`);
  assert.match(tuplet[1], /<normalNotes>6<\/normalNotes>/);
  assert.match(tuplet[1], /<actualNotes>3<\/actualNotes>/);
  assert.match(tuplet[1], /<numberType>2<\/numberType>/);
  assert.match(tuplet[1], /<bracketType>2<\/bracketType>/);
  assert.strictEqual((bass.match(/<Chord>/g) || []).length, 3, "holding the three bass chimes");
}

// Each chart has a system of its own, so the handchimes chart's staves are the
// third and fourth chart staves down the page.
function assertLaterSpread(svg) {
  assert.strictEqual(chartNoteheads(svg).length, 15, "the precondition: one notehead per bell");
  const staves = chartStaffColumns(svg);
  assert.strictEqual(staves.length, 4, "two charts of two staves");
  const [, , treble, bass] = staves;
  assert.strictEqual(treble.length, 6, "six treble chime columns");
  assert.strictEqual(bass.length, 3, "three bass chime columns");
  const trebleGaps = gaps(treble);
  const trebleGap = trebleGaps.reduce((a, b) => a + b, 0) / trebleGaps.length;
  for (const gap of gaps(bass)) {
    assert.ok(Math.abs(gap / trebleGap - 2) < 0.1,
      `each bass gap is two treble gaps (${gap.toFixed(1)} against ${trebleGap.toFixed(1)})`);
  }
}

// The piece has two staves and the handbells chart two more, so the
// handchimes chart's bass staff is staff 6.
test("the extension spreads a staff of a later chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-later");
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, LATER), output);
  assertLaterTuplet(mainScore(output), 6);
  assertLaterSpread(renderSvg(output, path.join(dir, "out.svg")));
});

// On a shared staff the second chart opens with the instrument change that
// names it, on the part's first staff, and the tuplet goes on the bass staff
// below it.
test("the extension spreads a staff beside a shared staff's instrument change", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-shared");
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, LATER, { handbellChartSharedStaff: "yes" }), output);
  const text = mainScore(output);
  assert.match(measuresOf(staffRegion(text, 3))[1], /<InstrumentChange>/,
    "the precondition: the handchimes chart opens with an instrument change");
  assertLaterTuplet(text, 4);
});

test("the command-line tool spreads a staff of a later chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = workspace(t, "spacing-later");
  const output = runCli(dir, LATER, ["--hide-empty-staves"]);
  assertLaterTuplet(mainScore(output), 6);
  assertLaterSpread(renderSvg(output, path.join(dir, "out.svg")));
});
