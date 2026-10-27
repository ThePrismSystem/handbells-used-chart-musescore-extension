const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore, fixture,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const FIXTURE = fixture("two-choirs.mscx");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

function parts(text) {
  return (text.match(/<Part id="\d+">/g) || []).length;
}

const OWN = parts(fs.readFileSync(FIXTURE, "utf8"));

function chart(t, tags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-separate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE, tags), output);
  return mainScore(output);
}

// The two parts named "Handbells I" chart together: the first instrument's
// handbell count is 3 only when the third part's C6 joins it.
test("charts each instrument separately, as the command-line tool does", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const text = chart(t, { handbellChartMode: "separate" });
  const expected = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records,
    { mode: "separate" }).sections.map((s) => s.label).join(" | ");
  assert.strictEqual(expected, "Handbells I - Handbells Used: 3 | Handbells I - Handchimes Used: 1"
    + " | Handbells II - Handbells Used: 2 | Handbells II - Handchimes Used: 1");
  assert.strictEqual(tag(text, "handbellChartFound"), expected);
  assert.strictEqual(parts(text), OWN + 4);
  assert.strictEqual(tag(text, "handbellChartParts"), "4");
});

test("separate charts on a shared staff append one part", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const text = chart(t, { handbellChartMode: "separate", handbellChartSharedStaff: "yes" });
  assert.match(tag(text, "handbellChartFound"), /^Handbells I - Handbells Used: 3 \| /);
  assert.strictEqual(parts(text), OWN + 1);
  assert.strictEqual(tag(text, "handbellChartParts"), "1");
});
