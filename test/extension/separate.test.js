const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore, fixture,
  staffRegion, measuresOf, originalStaffCount,
} = require("./harness.js");
const { bellName } = require("../../handbells-used-chart/lib/bellname.js");
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

// Counting parts and reading back the plan's labels would both pass with
// Handbells II's bells drawn on Handbells I's staves. Each chart has a part of
// its own, so section i is drawn on chart staves 2i+1 and 2i+2, in measure i.
test("each instrument's charts are drawn on staves of their own", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const text = chart(t, { handbellChartMode: "separate", handbellChartShowInstrumentNames: "yes" });
  const plan = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, { mode: "separate" });
  const originals = originalStaffCount(FIXTURE);
  assert.strictEqual(plan.sections.length, 4, "the precondition: two instruments, two charts each");

  plan.sections.forEach((section, i) => {
    const wanted = section.treble.concat(section.bass).flatMap((c) => c.notes)
      .map((n) => bellName(n.pitch, n.tpc).name).sort();
    assert.ok(wanted.length > 0, `${section.label} has bells to draw`);
    const drawn = [];
    for (const n of [1, 2]) {
      const measure = measuresOf(staffRegion(text, originals + 2 * i + n))[i] || "";
      for (const m of measure.matchAll(/<pitch>(\d+)<\/pitch>\s*<tpc>(-?\d+)<\/tpc>/g)) {
        drawn.push(bellName(Number(m[1]), Number(m[2])).name);
      }
    }
    assert.deepStrictEqual(drawn.sort(), wanted, section.label);
  });

  // Each chart part is named for its own instrument's chart.
  const head = text.slice(0, text.indexOf('<Staff id="1">'));
  const longNames = (head.match(/<Part id="\d+">[\s\S]*?<\/Part>/g) || []).slice(OWN)
    .map((p) => (/<longName>([^<]*)<\/longName>/.exec(p) || [null, ""])[1]);
  assert.deepStrictEqual(longNames, plan.sections.map((s) => s.name));
});
