const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderPdf, renderSvg,
  makeScore, mainScore, fixture, planned, originalStaffCount, staffRegion,
  measuresOf, staffGeometry,
} = require("./harness.js");

const FIXTURE = "silver-melody-bells.mscx";

function build(t, metaTags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-shared-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "shared.mscz");
  runExtension(makeScore(dir, fixture(FIXTURE), metaTags), output);
  return { output, text: mainScore(output) };
}

test("shared-staff mode appends one instrument for every chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const source = fixture(FIXTURE);
  const sections = planned(source).sections.length;
  // The precondition. With one chart there is nothing to share, and every
  // assertion below would hold on the separate-staff code path.
  assert.ok(sections > 1, "the fixture plans more than one chart");

  const separate = build(t, { handbellChartQuiet: "yes" });
  const shared = build(t, { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" });

  const before = originalStaffCount(source);
  const staffCount = (text) => (text.match(/<Staff id="\d+">\s*(?=<VBox|<Measure)/g) || []).length;
  // Summed off the plan rather than assumed to be two a chart. A silver melody
  // bell chart asks for one staff on purpose, because every SMB goes on the
  // treble side and an unwritten lower half prints a brace over a blank staff.
  const separateStaves = planned(source).parts
    .reduce((total, part) => total + part.staves, 0);
  // The precondition for the comparison: the two modes really do want
  // different numbers of staves on this fixture.
  assert.ok(separateStaves > 2, "separate mode wants more staves than shared");

  assert.strictEqual(staffCount(separate.text), before + separateStaves,
    "separate mode appends an instrument per chart");
  assert.strictEqual(staffCount(shared.text), before + 2,
    "shared mode appends one instrument for all of them");
});

test("each chart keeps a measure of its own on the shared staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const source = fixture(FIXTURE);
  const sections = planned(source).sections;
  assert.ok(sections.length > 1, "the fixture plans more than one chart");
  const { text } = build(t, { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" });

  // The chart's treble staff is the first appended one.
  const treble = measuresOf(staffRegion(text, originalStaffCount(source) + 1))
    .slice(0, sections.length);
  assert.strictEqual(treble.length, sections.length, "one chart measure per chart");

  // Bells are plain, chimes diamond, silver melody bells the shape-note head.
  // Each must appear in its own measure and in no other. A document-wide
  // search for the head would not establish that.
  const headOf = { bells: null, chimes: "diamond", smbs: "la" };
  sections.forEach((section, i) => {
    const head = headOf[section.kind];
    if (head === null) return;
    assert.match(treble[i], new RegExp(`<head>${head}</head>`),
      `measure ${i + 1} holds the ${section.kind} chart`);
    treble.forEach((measure, j) => {
      if (j === i) return;
      assert.doesNotMatch(measure, new RegExp(`<head>${head}</head>`),
        `measure ${j + 1} must not hold the ${section.kind} chart`);
    });
  });
});

// Silver melody bells ask for a single staff of their own precisely because an
// unwritten lower half prints a brace over a blank staff. Sharing gives them a
// bass staff they never write to, and that is only safe because the bells above
// them fill it, so the staff is never the empty half of anything.
test("a shared bass staff is padded under the SMB chart and filled under the bells", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const source = fixture(FIXTURE);
  const sections = planned(source).sections;
  const smbIndex = sections.findIndex((s) => s.kind === "smbs");
  const bellIndex = sections.findIndex((s) => s.kind === "bells");
  // The precondition. Without both charts this proves nothing about sharing,
  // and the fixture is the one chosen for having all three.
  assert.ok(smbIndex >= 0, "the fixture plans an SMB chart");
  assert.ok(bellIndex >= 0, "the fixture plans a handbell chart");
  assert.ok(sections[bellIndex].bass.length > 0,
    "the handbell chart writes to its bass staff");

  const { text } = build(t, { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" });
  // The staff read below has to be the shared one, not the handbell chart's own
  // bass staff. In separate mode that staff carries chords under the bells and
  // padding under everything else too, so every assertion here would hold on
  // the separate-staff code path and the test would prove nothing about
  // sharing. Two appended staves is what says the charts share an instrument.
  const before = originalStaffCount(source);
  assert.strictEqual(
    (text.match(/<Staff id="\d+">\s*(?=<VBox|<Measure)/g) || []).length, before + 2,
    "the charts share one instrument, so there is one bass staff to read");

  // The shared instrument's bass staff is the second appended one.
  const bass = measuresOf(staffRegion(text, before + 2))
    .slice(0, sections.length);

  assert.match(bass[bellIndex], /<Chord>/,
    "the bells measure writes chords on the bass staff");
  assert.doesNotMatch(bass[smbIndex], /<Chord>/,
    "the SMB measure writes none");
  assert.match(bass[smbIndex], /<Rest>[\s\S]*?<visible>0<\/visible>/,
    "the SMB measure pads its bass staff with a hidden rest instead");
});

test("shared mode breaks a section only after the last chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const sections = planned(fixture(FIXTURE)).sections.length;
  assert.ok(sections > 1, "the fixture plans more than one chart");

  const separate = build(t, { handbellChartQuiet: "yes" });
  const shared = build(t, { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" });
  const breaks = (text) => (text.match(/<subtype>section<\/subtype>/g) || []).length;

  assert.strictEqual(breaks(separate.text), sections, "separate mode breaks per chart");
  assert.strictEqual(breaks(shared.text), 1, "shared mode breaks once, after the last");
});

test("MuseScore can still open a shared-staff chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const { output } = build(t, { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" });
  assert.strictEqual(renderPdf(output), 0);
});

test("a shared-staff chart is removed as cleanly as it was built", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-sharedrm-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture(FIXTURE);
  const built = path.join(dir, "shared-built.mscz");
  runExtension(makeScore(dir, source, {
    handbellChartQuiet: "yes", handbellChartSharedStaff: "yes",
  }), built);
  // The precondition for the comparison below: the first run really did build
  // a chart, and recorded counts that disagree.
  const first = mainScore(built);
  assert.match(first, /Handbells Used/, "the first run wrote a chart");
  assert.match(first, /<metaTag name="handbellChartParts">1<\/metaTag>/,
    "shared mode appended one part");
  const columns = /<metaTag name="handbellChartColumns">([^<]*)<\/metaTag>/.exec(first);
  assert.ok(columns && columns[1].split("|").length > 1,
    "and inserted more than one measure, so the counts differ");

  // A second run over a score with no bells left removes the chart and builds
  // nothing, which is the path that has to delete the right number of measures.
  const before = originalStaffCount(source);
  const removed = path.join(dir, "shared-removed.mscz");
  runExtension(built, removed);
  const after = mainScore(removed);
  assert.strictEqual(
    (after.match(/<Staff id="\d+">\s*(?=<VBox|<Measure)/g) || []).length,
    before + 2, "the rebuild appends one staff pair, not two sets");
});

test("each chart measure on its own system is named for its own chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-sharednames-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  const source = fixture("wide-shared-charts.mscx");
  const sections = planned(source).sections;
  assert.ok(sections.length > 1, "the fixture plans more than one chart");

  const output = path.join(dir, "shared-names.mscz");
  runExtension(makeScore(dir, source, {
    handbellChartQuiet: "yes",
    handbellChartSharedStaff: "yes",
    handbellChartShowInstrumentNames: "yes",
  }), output);

  // The precondition this test cannot do without: the charts really are on
  // systems of their own. Sharing one system leaves only the first named, and
  // every assertion below would pass on a build that never wrote the second
  // name at all.
  const svg = renderSvg(output, path.join(dir, "n.svg"));
  const chartStaves = staffGeometry(svg).filter((s) => s.small);
  // One shared instrument means one staff pair, so more than two small staves
  // on the page can only mean that pair drawn on more than one system.
  assert.ok(chartStaves.length > 2,
    "the fixture is wide enough to put the charts on separate systems");

  // Each instrument on the part carries its own wording, so the margin of each
  // system names the chart beside it. The first chart's wording is the
  // appended part's own instrument; MuseScore does not duplicate that
  // instrument onto the part for a later chart, it records the later wording
  // on the InstrumentChange itself, which is why the two are read from
  // different places rather than both off the one <Part> block.
  const text = mainScore(output);
  const own = (fs.readFileSync(source, "utf8").match(/<Part id="\d+">/g) || []).length;
  const chartPart = (text.slice(0, text.indexOf('<Staff id="1">'))
    .match(/<Part id="\d+">[\s\S]*?<\/Part>/g) || []).slice(own).join("");
  // Matched, not indexed. An absent tag makes exec return null, and reading
  // [1] off that throws a TypeError instead of failing with the reason.
  const found = /<longName>([^<]*)<\/longName>/.exec(chartPart);
  assert.ok(found, "the appended part records an instrument name");
  const firstName = found[1];
  const laterNames = [...text.matchAll(/<InstrumentChange>[\s\S]*?<longName>([^<]*)<\/longName>/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual([firstName, ...laterNames], ["Handbells Used", "Handchimes Used"],
    "one name per chart, the first on the part and the rest on their own instrument changes");

  // The change that carries the second name must not print anything itself.
  assert.doesNotMatch(svg, /class="InstrumentChange"/,
    "the instrument change is invisible");
});
