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
// proves it *draws* — this file renders the tool's own output with a real
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
// result the way opening the file in MuseScore would lay it out fresh —
// the only way to tell a bracket that draws from one that is merely present
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

test("a one-column optional run draws its word with no line", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const svg = renderChart(t, "chime", "chart-wider-than-the-metre.mscx",
    ["--required-chime-first", "G5", "--required-chime-last", "B5"]);

  // The bass run is the single column C4: its bracket spans nothing, and
  // MuseScore draws no line for a zero-length spanner, so only the treble
  // run's bracket contributes a segment. The word still prints either way,
  // which is what marks the bell optional — see optional.test.js, which
  // asserts the same two numbers for the extension over this fixture.
  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 1,
    "the treble bracket draws; the single-column bass run draws no line");
  assert.strictEqual(count(svg, /class="StaffText"/g), 2,
    "both runs are worded, even the one with no line");
});

// The same claim optional.test.js makes for the extension, over the same
// fixture and range. The two front ends reach it by different means — this one
// writes a spatium offset into the file, the extension overshoots the end tick
// because the API will not lengthen a laid-out segment — so the only thing that
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
