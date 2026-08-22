const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension,
  makeScore, mainScore, scoreStyle,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { readMscz, writeMscz, replaceMain } = require("../../tools/mscz.js");

// A score that already has "hide empty staves" switched on, which is the
// ordinary state of a handbell arrangement someone has been engraving. Every
// other fixture starts with the setting off, so this is the only one where the
// chart's own setValue changes nothing and the value dressStaves records for
// removeChart to hand back is one the user chose rather than one it set.
const FIXTURE = path.join(__dirname, "..", "fixtures", "empty-staves-already-hidden.mscx");

function sections() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {}).sections.length;
}

function styleValue(mscz, name) {
  const match = scoreStyle(mscz).match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match ? match[1] : null;
}

test("a score that already hides empty staves still gets a visible chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  assert.ok(sections() > 0, "the fixture plans a chart to draw");

  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);

  // The precondition, read back through MuseScore rather than trusted from the
  // fixture text. If MuseScore ignored the fixture's Style block the recorded
  // value would be "false", this would be the same case every other test
  // already covers, and the bounce it exists for would go unexercised.
  const text = mainScore(charted);
  assert.match(text, /<metaTag name="handbellChartStyle_hideEmptyStaves">true<\/metaTag>/,
    "the score already had hide-empty-staves on before the chart went in");

  assert.strictEqual(styleValue(charted, "hideEmptyStaves"), "1",
    "and it is still on afterwards");
  assert.strictEqual((text.match(/<irregular>1<\/irregular>/g) || []).length, sections(),
    "the chart was built");
});

// On every other fixture the setting starts off, so "restored" and "left as
// the chart set it" look the same. Here they do not: get this wrong and
// removing the chart switches off a setting the user turned on themselves.
test("removing the chart gives back the setting the user had", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), charted);
  assert.strictEqual(styleValue(charted, "hideEmptyStaves"), "1", "the chart is on the score");

  // Moving every bell out of C2-C9 makes the next run remove the chart and
  // find nothing to build, which is the only way to observe a removal on its
  // own.
  const archive = readMscz(fs.readFileSync(charted));
  const chartedText = archive.entries.get(archive.mainName).toString("utf8");
  const emptied = path.join(dir, "emptied.mscz");
  fs.writeFileSync(emptied, writeMscz(replaceMain(archive,
    chartedText.replace(/<pitch>(\d+)<\/pitch>/g,
      (whole, pitch) => `<pitch>${Number(pitch) % 12}</pitch>`))));

  const removed = path.join(dir, "removed.mscz");
  runExtension(emptied, removed);

  assert.strictEqual((mainScore(removed).match(/<irregular>1<\/irregular>/g) || []).length, 0,
    "the chart is gone");
  assert.strictEqual(styleValue(removed, "hideEmptyStaves"), "1",
    "and the user's own hide-empty-staves setting survived it");
});
