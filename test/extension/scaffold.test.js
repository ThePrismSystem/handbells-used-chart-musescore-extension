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
  assert.match(mainScore(output), /<museScore/, "and it is a MuseScore file");
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
