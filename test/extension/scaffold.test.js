const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore,
} = require("./harness.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

test("the extension runs headlessly and hands back a readable score", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const input = makeScore(dir, FIXTURE);
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  // A run that produced no file is the signature of a blocked prompt: MuseScore
  // saves at the end of a job, so a hang loses everything.
  assert.ok(fs.existsSync(output), "the extension produced a score");
  const mscx = mainScore(output);
  assert.match(mscx, /<museScore/, "and it is a MuseScore file");
  // A stub conversion job produces a readable score whether or not the
  // extension actually executed; only the fixture's own measure count, written
  // back by main.js, proves the extension ran inside MuseScore.
  assert.match(mscx, /<metaTag name="handbellChartRan">2<\/metaTag>/,
    "and the extension itself ran");
});

test("the harness marks fixtures quiet so prompts cannot block", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = makeScore(dir, FIXTURE);
  assert.match(mainScore(file), /<metaTag name="handbellChartQuiet">yes<\/metaTag>/);
});

test("renderPdf reports 0 for a score MuseScore can open", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.strictEqual(renderPdf(makeScore(dir, FIXTURE)), 0);
});
