const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeMscz } = require("../../tools/mscz.js");
const {
  museScoreAvailable, renderSvg, fixture, bracketExtents, chartColumns,
} = require("./harness.js");

// The command-line tool writes its own optional-range brackets directly into
// the XML (tools/writer.js), never through the MuseScore API the extension
// uses. test/e2e/cli.test.js proves the spanner is *in the file*; nothing
// proves it *draws*. This file renders the tool's own output with a real
// MuseScore, the same way optional.test.js does for the extension, so the
// front ends' parity claim is checked rather than assumed.
const CLI = path.join(__dirname, "..", "..", "tools", "chart-cli.js");

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// The single-entry .mscz the command-line tool reads, built from a bare .mscx
// fixture the same way test/e2e/cli.test.js's makeScore does.
function inputFor(dir, fixtureName) {
  const mscx = fs.readFileSync(fixture(fixtureName));
  const file = path.join(dir, "in.mscz");
  fs.writeFileSync(file, writeMscz({
    entries: new Map([["score.mscx", mscx]]),
    mainName: "score.mscx",
  }));
  return file;
}

// Runs the tool over a fixture with the given range flags, then renders the
// result the way opening the file in MuseScore would lay it out fresh, which
// is the only way to tell a bracket that draws from one that is merely present
// as XML.
function renderChart(t, tag, fixtureName, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cli-render-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = inputFor(dir, fixtureName);
  const output = path.join(dir, "out.mscz");

  const stdout = execFileSync(process.execPath, [CLI, input, output].concat(args),
    { encoding: "utf8" });
  // The precondition: without a chart on the page, both counts below would
  // hold at nought against nought and prove nothing about the brackets.
  assert.match(stdout, /Handbells Used:/, "the run produced a chart");

  const svg = renderSvg(output, path.join(dir, "out.svg"));
  assert.ok(svg.length > 0, "MuseScore rendered the chart");
  return svg;
}

test("the command-line tool's brackets draw on the page", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "ranges", "optional-ranges.mscx",
    ["--required-bell-first", "C4", "--required-bell-last", "C7"]);

  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 2,
    "one bracket for the treble run and one for the bass run");
  assert.strictEqual(count(svg, /class="StaffText"/g), 2,
    "the word beside each bracket");
});

// The one place the two front ends do not agree, recorded here so a change to
// either is measured against it rather than discovered later.
//
// A one-column run spans no time, and this tool's overhang is a spatium
// correction applied to a segment MuseScore has already laid out. At the first
// column of a chart measure MuseScore lays out no segment for a zero-length
// spanner, since the line would run backwards off the front of the measure,
// so there is nothing for the correction to move and no line is drawn. At any
// later column the same run draws correctly, which the last test in this file
// shows over a run of one column at column 6.
//
// The extension is not limited this way: it works a chart column out from the
// laid-out page and spends the overhang as time, so the spanner has a real
// length before it is ever laid out. optional.test.js asserts it draws both
// brackets over this fixture and range.
//
// The word prints either way, which is what still marks the bell optional.
test("a one-column run at the first column draws its word with no line", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "chime", "chart-wider-than-the-metre.mscx",
    ["--required-chime-first", "G5", "--required-chime-last", "B5"]);

  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 1,
    "the treble bracket draws; the bass run at column 0 draws no line");
  assert.strictEqual(count(svg, /class="StaffText"/g), 2,
    "both runs are worded, even the one with no line");
});

// The same claim optional.test.js makes for the extension, over the same
// fixture and range. The two front ends reach it by different means. This one
// writes a spatium offset into the file; the extension overshoots the end tick
// because the API will not lengthen a laid-out segment. So the only thing that
// can show they agree is what each of them draws.
test("the command-line tool's brackets enclose their bells too", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "extent", "optional-ranges.mscx",
    ["--required-bell-first", "C4", "--required-bell-last", "C7"]);

  const columns = chartColumns(svg);
  const brackets = bracketExtents(svg);
  // The preconditions the pairing below depends on.
  assert.strictEqual(columns.length, 6, "six chart columns were drawn");
  assert.strictEqual(brackets.length, 2, "one bracket per optional run");

  // Left to right: the bass run is columns 0-1, the treble run 2-4.
  const runs = [
    { name: "bass", bracket: brackets[0], first: columns[0], last: columns[1] },
    { name: "treble", bracket: brackets[1], first: columns[2], last: columns[4] },
  ];

  const pads = [];
  for (const run of runs) {
    assert.ok(run.bracket.left < run.first.left,
      `the ${run.name} bracket must start left of its first bell`);
    assert.ok(run.bracket.right > run.last.right,
      `the ${run.name} bracket must end right of its last bell`);
    pads.push(run.first.left - run.bracket.left, run.bracket.right - run.last.right);
  }
  const spread = Math.max(...pads) - Math.min(...pads);
  assert.ok(spread < 2, `every overhang must match: ${pads.map((n) => n.toFixed(1))}`);
});

// The same claim, over the same fixture and range, for the front end that
// buys its overhang in spatium rather than in ticks. A one-column run is where
// the two mechanisms diverge most: this one writes the offsets it always
// writes and they come out right, while the extension has to work out what a
// chart column is worth on the page before it can ask for the same distance.
test("the command-line tool encloses a one-column run's single bell", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "single", "single-column-optional.mscx",
    ["--required-bell-first", "C3", "--required-bell-last", "E5"]);

  const columns = chartColumns(svg);
  const brackets = bracketExtents(svg);
  assert.strictEqual(columns.length, 9, "nine chart columns were drawn");
  assert.strictEqual(brackets.length, 2, "one bracket per optional run");

  // The treble run is columns 2-4; the bass run is column 6 on its own.
  const runs = [
    { name: "treble", bracket: brackets[0], first: columns[2], last: columns[4] },
    { name: "single", bracket: brackets[1], first: columns[6], last: columns[6] },
  ];

  const pads = [];
  for (const run of runs) {
    assert.ok(run.bracket.left < run.first.left,
      `the ${run.name} bracket must start left of its first bell`);
    assert.ok(run.bracket.right > run.last.right,
      `the ${run.name} bracket must end right of its last bell`);
    pads.push(run.first.left - run.bracket.left, run.bracket.right - run.last.right);
  }
  const spread = Math.max(...pads) - Math.min(...pads);
  assert.ok(spread < 2, `every overhang must match: ${pads.map((n) => n.toFixed(1))}`);
});

// The same claim smbs.test.js makes for the extension, over the same fixture.
// The two front ends arrive at it differently. This one leaves the <bracket>
// element out of a one-staff chart part, while the extension appends a braced
// pair, gives the lower staff back and then turns the brace off. So what they
// draw is the only thing that can show they agree.
test("the command-line tool leaves a one-staff chart unbraced", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "smb-brace", "silver-melody-bells.mscx", []);

  // Two braces for the two grand staves, and none for the silver melody
  // bells. Three would mean theirs is still drawn; one would mean the change
  // had reached the other two charts as well.
  assert.strictEqual(count(svg, /class="Bracket"/g), 2,
    "the handbell and handchime charts keep their braces, and only those");
  // The precondition: without the third chart on the page there would be no
  // one-staff part for the count above to be about. Thirteen staves at five
  // lines each. The piece's own two are drawn on every chart system, since
  // --hide-empty-staves was not asked for, so it is 2+2 for the bells, 2+2 for
  // the chimes, 2+1 for the silver melody bells and 2 for the music.
  assert.strictEqual(count(svg, /class="StaffLines"/g), 5 * 13,
    "the third chart contributes one staff, not two");
});
