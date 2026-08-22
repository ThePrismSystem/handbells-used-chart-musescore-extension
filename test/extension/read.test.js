const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

test("reads the same bells the XML reader finds", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  installExtension();
  const input = makeScore(dir, FIXTURE);
  const output = path.join(dir, "out.mscz");
  runExtension(input, output);

  // The extension records what it found in a metaTag, which is the only
  // channel out of a headless run that the test can read back.
  const found = /<metaTag name="handbellChartFound">([^<]*)<\/metaTag>/
    .exec(mainScore(output));
  assert.ok(found, "the extension recorded what it read");

  const expected = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {});
  const labels = expected.sections.map((section) => section.label).join(" | ");
  assert.strictEqual(found[1], labels);
});
