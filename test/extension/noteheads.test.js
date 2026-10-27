const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore, fixture, chartBody,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const FIXTURE = fixture("pf-and-whitechapel.mscx");
const HEADS = { handbellChartPfHead: "cross", handbellChartWhitechapelHead: "triangle-up" };
const OPTIONS = { pfHead: "cross", whitechapelHead: "triangle-up" };

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

test("charts P&F and Whitechapel bells as the command-line tool does", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-pf-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE, HEADS), output);
  const text = mainScore(output);

  const expected = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, OPTIONS)
    .sections.map((s) => s.label).join(" | ");
  assert.strictEqual(expected,
    "Handbells Used: 3 | P&F Handbells Used: 3 | Whitechapel Handbells Used: 3");
  assert.strictEqual(tag(text, "handbellChartFound"), expected);

  // Drawn with the music's own noteheads, in the chart measures. The fixture
  // writes three cross and three triangle-up notes of its own, so a count over
  // the whole score would pass with none in the chart.
  const plan = buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, OPTIONS);
  const body = chartBodyFor(text, plan.sections.length);
  assert.strictEqual(count(body, /<head>cross<\/head>/g), 3);
  assert.strictEqual(count(body, /<head>triangle-up<\/head>/g), 3);
});

// chartBody in the harness plans with default settings, which here would
// leave the P&F and Whitechapel sections out.
function chartBodyFor(text, sections) {
  const originals = (fs.readFileSync(FIXTURE, "utf8").match(/<Staff id="\d+">/g) || []).length;
  let body = "";
  for (let n = 1; n <= 2 * sections; n++) {
    const start = text.indexOf(`<Staff id="${originals + n}">`);
    if (start < 0) continue;
    const region = text.slice(start, start + text.slice(start).indexOf("</Staff>"));
    body += (region.match(/<Measure(?:\s[^>]*)?>[\s\S]*?<\/Measure>/g) || []).slice(0, sections).join("");
  }
  return body;
}

test("a clash between two kinds leaves the existing chart standing", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-clash-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const charted = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE, HEADS), charted);
  const before = mainScore(charted);
  assert.ok(tag(before, "handbellChartParts"), "the precondition: the first run drew a chart");

  // Same score, now with handbells moved onto the P&F notehead.
  const clashing = path.join(dir, "clashing.mscz");
  const { readMscz, writeMscz } = require("../../tools/mscz.js");
  const archive = readMscz(fs.readFileSync(charted));
  archive.entries.set(archive.mainName, Buffer.from(before.replace("<Score>",
    "<Score>\n    <metaTag name=\"handbellChartBellHead\">cross</metaTag>"), "utf8"));
  fs.writeFileSync(clashing, writeMscz(archive));

  const output = path.join(dir, "out.mscz");
  runExtension(clashing, output);
  const after = mainScore(output);
  assert.match(tag(after, "handbellChartError"),
    /Handbells and P&F Handbells are both set to the cross notehead/);
  assert.strictEqual(tag(after, "handbellChartParts"), tag(before, "handbellChartParts"));
  assert.strictEqual(count(after, /<Part id="\d+">/g), count(before, /<Part id="\d+">/g));
});
