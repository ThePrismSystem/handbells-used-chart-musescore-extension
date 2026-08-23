const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, runExtensionToSvg, renderSvg,
  makeScore, mainScore, fixture, planned, staffRegion, measuresOf,
  originalStaffCount,
} = require("./harness.js");

// makeScore injects handbellChartQuiet itself and merges anything passed here,
// which is how a run is configured without a dialog.
function workspace(t, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbext-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  return dir;
}

function chartWith(t, tag, fixtureName, metaTags) {
  const dir = workspace(t, tag);
  const source = fixture(fixtureName);
  const input = makeScore(dir, source, metaTags);
  const output = path.join(dir, `${tag}-out.mscz`);
  runExtension(input, output);
  return { dir, source, input, output, text: mainScore(output) };
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// One chart measure of one chart staff. The chart's own staves are the ones
// appended after the piece's, treble then bass per section, and the chart
// occupies the first sections.length measures of each. chartBody concatenates
// both staves, so it cannot say which of them a bracket landed on; this can.
function chartMeasure(text, source, staff) {
  const sections = planned(source).sections.length;
  const id = originalStaffCount(source) + (staff === "treble" ? 1 : 2);
  return measuresOf(staffRegion(text, id)).slice(0, sections).join("");
}

// Which chart column an element sits on. Elements are written in tick order
// inside <voice> and every chart column is one <Chord>, so the chords before a
// match are the columns before it.
function columnOf(measure, pattern, what) {
  const at = measure.search(pattern);
  assert.ok(at >= 0, `${what} is not in the chart measure`);
  return count(measure.slice(0, at), /<Chord>/g);
}

// The properties block of the bracket, which MuseScore writes on the starting
// half of the spanner only.
function textLineBlock(measure) {
  const found = measure.match(/<TextLine>[\s\S]*?<\/TextLine>/);
  assert.ok(found, "the chart measure carries no TextLine");
  return found[0];
}

function staffTextBlock(measure) {
  const found = measure.match(/<StaffText>[\s\S]*?<\/StaffText>/);
  assert.ok(found, "the chart measure carries no StaffText");
  return found[0];
}

// C4 to C7 over test/fixtures/optional-ranges.mscx: six treble columns of
// which 2, 3 and 4 make a run — column 3 is E6, required, and stays under the
// bracket — and four bass columns of which 0 and 1 make a second run.
const REQUIRED_C4_C7 = {
  handbellChartRequiredBellFirst: "C4",
  handbellChartRequiredBellLast: "C7",
};

test("draws no bracket when no required range is set", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text, source } = chartWith(t, "no-range", "optional-ranges.mscx", {});

  // The precondition. Without a chart on the page there is nothing for a
  // bracket to be absent from, and both assertions below would pass over a run
  // that drew nothing at all.
  assert.match(text, /Handbells Used:/, "the run drew a chart");
  assert.strictEqual(count(chartMeasure(text, source, "treble"), /<Chord>/g), 6,
    "the chart has the six treble columns the bracketed run is drawn over");

  assert.strictEqual(count(text, /<Spanner type="TextLine">/g), 0);
  assert.strictEqual(count(text, /<text>optional<\/text>/g), 0);
});

test("brackets the bells outside the required range", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text, source } = chartWith(t, "range", "optional-ranges.mscx",
    REQUIRED_C4_C7);
  const treble = chartMeasure(text, source, "treble");
  const bass = chartMeasure(text, source, "bass");

  // The preconditions. A run starting at column 2 of six is what separates a
  // bracket that read firstColumn from one that always starts the measure, and
  // the two staves' runs differ in both position and length, so neither can
  // stand in for the other.
  assert.strictEqual(count(treble, /<Chord>/g), 6, "six treble columns");
  assert.strictEqual(count(bass, /<Chord>/g), 4, "four bass columns");

  // An extension action runs twice per conversion job, and removeChart strips
  // the previous run's chart between the two. Presence would pass on a doubled
  // bracket; two runs means exactly two TextLines in the whole score.
  assert.strictEqual(count(text, /<TextLine>/g), 2,
    "one bracket per optional run, not one per invocation");

  // Both halves of each spanner: MuseScore writes the properties and a forward
  // <next> where the bracket begins, and a bare <prev> where it stops.
  assert.strictEqual(count(treble, /<Spanner type="TextLine">/g), 2);
  assert.strictEqual(count(bass, /<Spanner type="TextLine">/g), 2);

  // Position, not presence, and both ends of it. A spanner whose start tick was
  // never set lands at -1/1, off the front of the score, and is written out
  // looking much like this one — so where each end sits is the whole assertion.
  // Columns 2 to 4 reach two quarters, which MuseScore reduces to 1/2 of a
  // whole note; columns 0 to 1 reach one, 1/4.
  const START = /<Spanner type="TextLine">\s*<TextLine>/;
  const END = /<Spanner type="TextLine">\s*<prev>/;
  assert.strictEqual(columnOf(treble, START, "the start of the treble bracket"), 2);
  assert.strictEqual(columnOf(treble, END, "the end of the treble bracket"), 4);
  assert.strictEqual(columnOf(bass, START, "the start of the bass bracket"), 0);
  assert.strictEqual(columnOf(bass, END, "the end of the bass bracket"), 1);
  assert.match(treble.replace(/\s+/g, ""),
    /<next><location><fractions>1\/2<\/fractions><\/location><\/next>/);
  assert.match(bass.replace(/\s+/g, ""),
    /<next><location><fractions>1\/4<\/fractions><\/location><\/next>/);

  // The hooks that turn a line into a bracket.
  assert.match(textLineBlock(treble), /<beginHookType>1<\/beginHookType>/);
  assert.match(textLineBlock(treble), /<endHookType>1<\/endHookType>/);

  // placement is an integer in the API and reads back 0 whether an assignment
  // of "above" was understood or ignored, so the bass side is what proves it
  // was set at all: the two staves must not both come out above.
  assert.match(textLineBlock(bass), /<placement>below<\/placement>/);
  assert.doesNotMatch(textLineBlock(treble), /<placement>below<\/placement>/);

  // The word is a separate element, centred on the middle column of its run:
  // 3 on the treble side, 0 on the bass.
  assert.strictEqual(columnOf(treble, /<StaffText>/, "the treble word"), 3);
  assert.strictEqual(columnOf(bass, /<StaffText>/, "the bass word"), 0);
  assert.match(staffTextBlock(treble), /<text><i>optional<\/i><\/text>/);
  assert.match(staffTextBlock(treble), /<italic>1<\/italic>/);
  assert.match(staffTextBlock(treble), /<align>center,baseline<\/align>/);
  assert.match(staffTextBlock(bass), /<placement>below<\/placement>/);
});

// A spanner in the saved file proves nothing about the page: a TextLine with no
// span, or one anchored to a tick that does not exist, is written out just the
// same and draws nothing. Both renders are here because they answer different
// questions — the reopened score says the file is right, and the live one says
// the run left the open score laid out with the bracket in it.
test("the bracket and the word are drawn on the page", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { dir, input, output } = chartWith(t, "draw", "optional-ranges.mscx",
    REQUIRED_C4_C7);

  const reopened = renderSvg(output, path.join(dir, "reopened.svg"));
  assert.strictEqual(count(reopened, /class="TextLineSegment"/g), 2,
    "the reopened score draws one bracket per optional run");
  assert.strictEqual(count(reopened, /class="StaffText"/g), 2,
    "the reopened score draws the word beside each bracket");

  const live = runExtensionToSvg(input, path.join(dir, "live.svg"));
  assert.strictEqual(count(live, /class="TextLineSegment"/g), 2,
    "the score the run left open draws the brackets too");
});

test("refuses a required bell name it cannot parse", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text } = chartWith(t, "bad-range", "optional-ranges.mscx",
    { handbellChartRequiredBellFirst: "H6" });

  // The name itself, not merely that something failed: the measure and
  // instrument checks in mutate.js refuse with messages of their own, and this
  // has to be the range parse doing the refusing.
  assert.match(text, /<metaTag name="handbellChartError">[^<]*H6/);
  assert.doesNotMatch(text, /Handbells Used:/, "no chart was built");
});

// The chime range has its own pair of tags, and reading either of them from the
// wrong tag is a typo nothing else here would catch: the command-line tool
// shipped that exact mistake twice, once for each chime flag.
//
// chart-wider-than-the-metre carries chimes from C4 up to D6 and no bell range
// is set, so every bracket counted below belongs to the chime chart.
test("the chime range tags reach their own options, not each other's", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const source = fixture("chart-wider-than-the-metre.mscx");
  const chimes = planned(source).sections.filter((s) => s.kind === "chimes");
  assert.strictEqual(chimes.length, 1, "the fixture charts chimes");
  assert.ok(chimes[0].columns >= 4,
    `the fixture needs chimes at several pitches, found ${chimes[0].columns} columns`);

  // Required G5 to B5 leaves C4 optional below on the bass staff and C6, D6
  // optional above on the treble: two brackets. Read either chime tag from a
  // bell tag and neither bound survives, and there are none.
  const inner = chartWith(t, "chime-inner", "chart-wider-than-the-metre.mscx", {
    handbellChartRequiredChimeFirst: "G5",
    handbellChartRequiredChimeLast: "B5",
  });
  assert.strictEqual(count(inner.text, /<TextLine>/g), 2);

  // The chimes are the second chart, so their measure does not start at tick
  // zero. A bracket anchored to its column within the measure rather than to
  // its position in the score writes the same XML here and draws nothing.
  //
  // One segment for two runs, because the bass run is the single column C4:
  // its bracket spans nothing, and MuseScore draws no line for a zero-length
  // spanner. The command-line tool writes the same 0/1 span and renders the
  // same one segment, so the two front ends agree. The word is drawn either
  // way, which is what still marks that bell optional.
  const svg = renderSvg(inner.output, path.join(inner.dir, "chimes.svg"));
  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 1,
    "the chime bracket is drawn, in a chart measure that is not the first");
  assert.strictEqual(count(svg, /class="StaffText"/g), 2,
    "both chime runs are worded");

  // Required C4 to B5 starts at the lowest chime, so only C6 and D6 are
  // optional: one bracket. Read handbellChartRequiredChimeLast into
  // requiredChimeFirst and the range becomes "required from B5", which brackets
  // the bells below it as well and gives two. The range above cannot see that
  // swap; this one can.
  const lower = chartWith(t, "chime-lower", "chart-wider-than-the-metre.mscx", {
    handbellChartRequiredChimeFirst: "C4",
    handbellChartRequiredChimeLast: "B5",
  });
  assert.strictEqual(count(lower.text, /<TextLine>/g), 1);
});
