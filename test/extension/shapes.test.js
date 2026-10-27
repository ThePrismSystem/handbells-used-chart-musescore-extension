const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg, makeScore, mainScore, fixture,
  planned, originalStaffCount, staffRegion, measuresOf,
} = require("./harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// The chart measures on the given chart staves, counted from 1 after the
// piece's own.
function chartStaves(text, staves) {
  const sections = planned(FIXTURE).sections.length;
  return staves.map((n) => measuresOf(staffRegion(text, originalStaffCount(FIXTURE) + n))
    .slice(0, sections).join("")).join("");
}

// The outline of each chart notehead. The chart staves are small, so their
// noteheads are drawn through a matrix transform and the outline is the
// glyph's own, the same string for every note in one shape.
function chartGlyphs(svg) {
  const glyphs = new Set();
  for (const m of svg.matchAll(/<path class="Note"([^>]*)>/g)) {
    if (!/transform="matrix\(/.test(m[1])) continue;
    glyphs.add(/\bd="([^"]+)"/.exec(m[1])[1]);
  }
  return glyphs;
}

test("a bell chart drawn in triangles writes do on its own notes and draws it", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-shape-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const plain = path.join(dir, "plain.mscz");
  runExtension(makeScore(dir, FIXTURE, {}), plain);
  const shaped = path.join(dir, "shaped.mscz");
  runExtension(makeScore(dir, FIXTURE, { handbellChartBellShape: "triangle" }), shaped);

  assert.deepStrictEqual(planned(FIXTURE).sections.map((x) => x.kind), ["bells", "chimes"],
    "the precondition: a bell chart on staves 1-2 and a chime chart on 3-4");
  const text = mainScore(shaped);
  const bells = chartStaves(text, [1, 2]);
  const chimes = chartStaves(text, [3, 4]);
  assert.ok(count(bells, /<Note>/g) > 0 && count(chimes, /<Note>/g) > 0);
  assert.strictEqual(count(bells, /<head>do<\/head>/g), count(bells, /<Note>/g));
  assert.strictEqual(count(chimes, /<head>diamond<\/head>/g), count(chimes, /<Note>/g));
  assert.strictEqual(count(text, /<head>do<\/head>/g), count(bells, /<Note>/g),
    "no do notehead outside the bell chart");
  assert.strictEqual(count(mainScore(plain), /<head>do<\/head>/g), 0);

  const before = chartGlyphs(renderSvg(plain, path.join(dir, "plain.svg")));
  const after = chartGlyphs(renderSvg(shaped, path.join(dir, "shaped.svg")));
  assert.ok(before.size > 0 && after.size > 0, "the precondition: both charts drew noteheads");
  // The chime diamonds are in both. The plain bell glyph has to be gone and a
  // new one drawn in its place.
  assert.ok([...before].some((g) => !after.has(g)), "the plain bell glyph is still drawn");
  assert.ok([...after].some((g) => !before.has(g)), "no new glyph was drawn");
});
