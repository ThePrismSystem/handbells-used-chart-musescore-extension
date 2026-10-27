const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg,
  makeScore, mainScore, fixture, planned,
} = require("./harness.js");

const FIXTURE = "two-staff-handbells.mscx";

function build(t, metaTags, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-names-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, `${label}.mscz`);
  runExtension(makeScore(dir, fixture(FIXTURE), metaTags), output);
  return { output, dir, text: mainScore(output) };
}

// Every <Part> block, in document order. The chart's are the ones appended
// after the piece's own.
function partBlocks(text) {
  const head = text.slice(0, text.indexOf('<Staff id="1">'));
  return head.match(/<Part id="\d+">[\s\S]*?<\/Part>/g) || [];
}

function chartParts(text) {
  const source = fs.readFileSync(fixture(FIXTURE), "utf8");
  const own = (source.match(/<Part id="\d+">/g) || []).length;
  return partBlocks(text).slice(own);
}

test("chart instruments are named, and the name is blank unless asked for", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const sections = planned(fixture(FIXTURE)).sections;
  assert.ok(sections.length > 1, "the fixture plans more than one chart");

  const off = build(t, { handbellChartQuiet: "yes" }, "off");
  const on = build(t, {
    handbellChartQuiet: "yes", handbellChartShowInstrumentNames: "yes",
  }, "on");

  const longNames = (text) => chartParts(text)
    .map((p) => (/<longName>([^<]*)<\/longName>/.exec(p) || [null, ""])[1]);

  // The precondition. Without chart parts to read there is nothing here to be
  // blank or named, and both halves would pass over an empty list.
  assert.strictEqual(chartParts(off.text).length, sections.length,
    "one chart part per chart");

  assert.deepStrictEqual(longNames(off.text), sections.map(() => ""),
    "with the option off no chart instrument prints a name");
  assert.deepStrictEqual(longNames(on.text), ["Handbells Used", "Handchimes Used"],
    "with the option on each names its own chart");
});

test("the name is drawn beside the staff, not merely recorded", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const on = build(t, {
    handbellChartQuiet: "yes", handbellChartShowInstrumentNames: "yes",
  }, "drawn");
  const off = build(t, { handbellChartQuiet: "yes" }, "undrawn");

  const drawn = (result, name) => (renderSvg(result.output,
    path.join(result.dir, `${name}.svg`)).match(/class="InstrumentName"/g) || []).length;

  // A name set and a name drawn are different claims, and the file only settles
  // the first. Counted rather than read, because MuseScore draws the text as
  // outlines: what matters is that turning the option on adds names to the page
  // and turning it off does not.
  assert.ok(drawn(on, "on") > drawn(off, "off"),
    "showing the names puts more of them on the page");
});

test("the chart's label is unaffected by the instrument name", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const on = build(t, {
    handbellChartQuiet: "yes", handbellChartShowInstrumentNames: "yes",
  }, "label");
  for (const section of planned(fixture(FIXTURE)).sections) {
    assert.ok(on.text.includes(section.label),
      `the label ${section.label} is still written`);
  }
});
