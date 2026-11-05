const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  renderSvg, staffGeometry, staffRegion, measuresOf, originalStaffCount, planned, fixture,
} = require("./harness.js");

// Both of the piece's staves are set to "Never hide" in the Layout panel. That
// setting outranks the score-wide hide-empty-staves style the chart turns on,
// so the style alone leaves both staves printed, empty, above every chart.
const FIXTURE = fixture("never-hide-staves.mscx");
const SHARED = { handbellChartSharedStaff: "yes" };

function chart(t, metaTags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE, metaTags), output);
  return { dir, output, text: mainScore(output) };
}

// Counted in the score MuseScore saved, which shows MuseScore read the
// fixture's setting and the run left it as it was.
function neverHideCount(text) {
  return (text.match(/<hideWhenEmpty>off<\/hideWhenEmpty>/g) || []).length;
}

function overrideCount(text) {
  return (text.match(/<hideIfEmpty>/g) || []).length;
}

// chartStaffCount is how many small staves the render should show: a pair per
// chart in separate mode, one pair in all in shared mode.
function assertOffTheChart({ dir, output, text }, chartStaffCount) {
  const pieceStaves = originalStaffCount(FIXTURE);
  const sections = planned(FIXTURE).sections.length;

  assert.strictEqual(neverHideCount(text), pieceStaves,
    "every staff of the piece is still set to Never hide after the run");

  const staves = staffGeometry(renderSvg(output, path.join(dir, "page.svg")));
  const chartStaves = staves.filter((s) => s.small);
  const own = staves.filter((s) => !s.small);
  assert.strictEqual(chartStaves.length, chartStaffCount, "the render shows every chart");
  assert.ok(own.length > 0, "the render shows the piece's own staves");

  // The chart sits between the title and the piece, so any full-size staff
  // printed above the last chart staff belongs to a chart's system.
  const chartBottom = Math.max(...chartStaves.map((s) => s.bottom));
  for (const staff of own) {
    assert.ok(staff.top > chartBottom,
      `a staff of the piece prints at y ${staff.top}, beside a chart ending at y ${chartBottom}`);
  }

  // The override belongs on the chart's measures only. On the piece's own it
  // would turn Never hide off for the music too.
  for (let id = 1; id <= pieceStaves; id++) {
    const measures = measuresOf(staffRegion(text, id));
    for (const measure of measures.slice(0, sections)) {
      assert.match(measure, /<hideIfEmpty>on<\/hideIfEmpty>/,
        `a chart measure on staff ${id} has no override`);
    }
    for (const measure of measures.slice(sections)) {
      assert.doesNotMatch(measure, /<hideIfEmpty>/,
        `a measure of the piece on staff ${id} carries an override`);
    }
  }
}

test("staves set to Never hide stay off the chart's systems", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assertOffTheChart(chart(t), 2 * planned(FIXTURE).sections.length);
});

// Here every chart measure shares one system, so the override is written onto
// the same system once per chart.
test("staves set to Never hide stay off a shared chart staff's system", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  assert.ok(planned(FIXTURE).sections.length > 1, "the fixture has more than one chart to share a staff");
  assertOffTheChart(chart(t, SHARED), 2);
});

test("removing the chart takes its overrides with it and keeps Never hide", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { dir, output, text } = chart(t);
  assert.ok(overrideCount(text) > 0, "the run wrote overrides for the removal to take away");

  const removed = path.join(dir, "removed.mscz");
  runExtension(output, removed, "remove");
  const after = mainScore(removed);
  assert.strictEqual(overrideCount(after), 0, "an override outlived the chart");
  assert.strictEqual(neverHideCount(after), originalStaffCount(FIXTURE),
    "the piece's staves are still set to Never hide");
});
