const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, runExtensionToSvg, renderSvg,
  makeScore, mainScore, fixture, planned, staffRegion, measuresOf,
  originalStaffCount, bracketExtents, chartColumns,
} = require("./harness.js");
const { readMscz, writeMscz } = require("../../tools/mscz.js");

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

// A copy of a saved score with one metaTag rewritten.
function retag(source, target, name, value) {
  const archive = readMscz(fs.readFileSync(source));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  const pattern = new RegExp(`(<metaTag name="${name}">)[^<]*(</metaTag>)`);
  assert.match(text, pattern, `the score must already carry ${name}`);
  archive.entries.set(archive.mainName,
    Buffer.from(text.replace(pattern, `$1${value}$2`), "utf8"));
  fs.writeFileSync(target, writeMscz(archive));
  return target;
}

// One chart measure of one chart staff. The bells chart is section 0, the
// chimes chart section 1. The chart's own staves are appended after the
// piece's, treble then bass for each section in plan order, so section N owns
// staves 2N+1 and 2N+2 of them; and every chart measure runs across every
// staff in the score, so within any of them section N's own measure is
// measure N.
//
// The section is a parameter rather than an assumed 0 because getting it wrong
// is silent: on a two-section score the bells staff has a chimes chart measure
// in it, empty and padded, and an assertion scoped to that measure passes
// while proving nothing. chartBody concatenates every chart staff and every
// chart measure, so it cannot say which staff of which chart an element landed
// on; this can.
function chartMeasure(text, source, section, staff) {
  const sections = planned(source).sections.length;
  assert.ok(section < sections,
    `${path.basename(source)} charts ${sections} section(s), so there is no section ${section}`);
  const id = originalStaffCount(source) + 2 * section + (staff === "treble" ? 1 : 2);
  const measures = measuresOf(staffRegion(text, id));
  assert.ok(measures.length > section,
    `chart staff ${id} has ${measures.length} measure(s), so no measure ${section}`);
  return measures[section];
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
// which 2, 3 and 4 make a run (column 3 is E6, required, and stays under the
// bracket), and four bass columns of which 0 and 1 make a second run.
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
  assert.strictEqual(count(chartMeasure(text, source, 0, "treble"), /<Chord>/g), 6,
    "the chart has the six treble columns the bracketed run is drawn over");

  assert.strictEqual(count(text, /<Spanner type="TextLine">/g), 0);
  assert.strictEqual(count(text, /<text>optional<\/text>/g), 0);
});

test("brackets the bells outside the required range", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text, source } = chartWith(t, "range", "optional-ranges.mscx",
    REQUIRED_C4_C7);
  const treble = chartMeasure(text, source, 0, "treble");
  const bass = chartMeasure(text, source, 0, "bass");

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
  // looking much like this one, so where each end sits is the whole assertion.
  const START = /<Spanner type="TextLine">\s*<TextLine>/;
  const END = /<Spanner type="TextLine">\s*<prev>/;
  assert.strictEqual(columnOf(treble, START, "the start of the treble bracket"), 2);
  assert.strictEqual(columnOf(bass, START, "the start of the bass bracket"), 0);

  // The end reaches past the run's last column, which is what lets the bracket
  // enclose its last bell rather than stopping at the notehead's left edge. So
  // the closing half of the spanner is written after that column's chord: one
  // column further along than the run itself goes.
  assert.strictEqual(columnOf(treble, END, "the end of the treble bracket"), 5);
  assert.strictEqual(columnOf(bass, END, "the end of the bass bracket"), 2);

  // How far past. Columns 2 to 4 span two quarters and columns 0 to 1 one, so a
  // bracket that had not been widened would read exactly 1/2 and 1/4. Both must
  // now exceed that, and by less than the whole column that reaching the next
  // anchor outright would cost, which is what tells a fractional overshoot from
  // a bracket that simply ran on to the following bell.
  const spanOf = (measure) => {
    const found = /<next><location><fractions>(\d+)\/(\d+)<\/fractions>/
      .exec(measure.replace(/\s+/g, ""));
    assert.ok(found, "the bracket records no span");
    return Number(found[1]) / Number(found[2]);
  };
  const COLUMN = 1 / 4;
  const trebleSpan = spanOf(treble);
  const bassSpan = spanOf(bass);
  assert.ok(trebleSpan > 2 * COLUMN && trebleSpan < 3 * COLUMN,
    `the treble bracket must overshoot columns 2-4 by part of a column, got ${trebleSpan}`);
  assert.ok(bassSpan > COLUMN && bassSpan < 2 * COLUMN,
    `the bass bracket must overshoot columns 0-1 by part of a column, got ${bassSpan}`);

  // And by the same amount on each, which is what makes the two read as one
  // device. The overshoot is worked out from the laid-out width of a column, so
  // two brackets in one chart measure have to arrive at the same figure.
  // Compared with a tolerance because the two arrive at the figure through
  // different fractions, which agree to within floating-point noise and not to
  // the last bit.
  const trebleOvershoot = trebleSpan - 2 * COLUMN;
  const bassOvershoot = bassSpan - COLUMN;
  assert.ok(Math.abs(trebleOvershoot - bassOvershoot) < 1e-9,
    `both brackets must overshoot by the same fraction of a column, `
    + `got ${trebleOvershoot} and ${bassOvershoot}`);

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
// questions. The reopened score says the file is right, and the live one says
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

// Re-running over a score that is already charted is what the README tells
// people to do once the music changes, so it is the ordinary path, not an edge
// case. The brackets live inside the chart measures and removeChart takes those
// with time-delete, which should carry everything anchored in them away too.
// But "should" is the whole reason for this test. If they ever start surviving,
// the score gains one more bracket on top of the last every time it is run, and
// every other assertion in this file is written against a first run and would
// go on passing.
test("a second run replaces the brackets rather than adding to them", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = workspace(t, "rerun");
  const source = fixture("optional-ranges.mscx");
  // The range tags are saved into the charted score along with everything else,
  // so the second run reads them back and asks for the same two brackets.
  const input = makeScore(dir, source, REQUIRED_C4_C7);

  const first = path.join(dir, "first.mscz");
  runExtension(input, first);
  const once = mainScore(first);
  // The precondition, and the number every assertion below is measured against.
  // Without brackets on the first run there is nothing for the second to
  // duplicate, and the comparison would hold at nought against nought.
  assert.strictEqual(count(once, /<TextLine>/g), 2, "the first run drew both brackets");
  assert.strictEqual(count(once, /<Spanner type="TextLine">/g), 4);
  assert.strictEqual(count(once, /<text><i>optional<\/i><\/text>/g), 2);

  const second = path.join(dir, "second.mscz");
  runExtension(first, second);
  const twice = mainScore(second);

  // That the second run found and removed the first run's chart, rather than
  // refusing to identify it. A refusal leaves the first chart standing
  // untouched, brackets and all, and every count below would match on a run
  // that did nothing whatever.
  assert.match(twice, /<metaTag name="handbellChartReport">[^<]*An existing chart was replaced/,
    "the second run replaced the chart it found");
  assert.doesNotMatch(twice, /<metaTag name="handbellChartError">[^<]/,
    "the second run recorded no refusal");

  assert.strictEqual(count(twice, /<TextLine>/g), 2,
    "two brackets after the second run, not four");
  assert.strictEqual(count(twice, /<Spanner type="TextLine">/g), 4);
  assert.strictEqual(count(twice, /<text><i>optional<\/i><\/text>/g), 2);

  // And the rebuilt ones are live, not merely present: a spanner orphaned by
  // the removal keeps its element in the file while its anchor no longer
  // exists, which counts the same and draws nothing.
  const svg = renderSvg(second, path.join(dir, "rebuilt.svg"));
  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 2,
    "the rebuilt brackets are drawn");
});

// The refusal has to happen before removeChart, not after it. buildPlan is
// what parses the range names, and it runs once the previous chart is already
// deleted, so a refusal raised there leaves the score with no chart and
// nothing put back, and a user loses a chart by mistyping a bell name. The
// score here is charted first, then broken, which is the only arrangement that
// can see the difference: on a never-charted score there is nothing to lose.
test("a bad range name on a charted score leaves the chart standing", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = workspace(t, "bad-range-charted");
  const source = fixture("optional-ranges.mscx");

  const first = path.join(dir, "first.mscz");
  runExtension(makeScore(dir, source, REQUIRED_C4_C7), first);
  const once = mainScore(first);
  // The precondition, and the state the second run must not damage.
  assert.match(once, /Handbells Used:/, "the first run drew a chart");
  assert.strictEqual(count(once, /<TextLine>/g), 2, "the first run drew both brackets");
  const partsBefore = count(once, /<Instrument id="hand-bells">/g);
  assert.ok(partsBefore >= 2, `the chart added a part, found ${partsBefore}`);

  // Same score, same charted state, one unparseable name. makeScore builds a
  // .mscz from a bare .mscx and cannot be used here: what this needs is the
  // extension's own charted output with a single bad value put into it.
  const broken = path.join(dir, "broken.mscz");
  runExtension(retag(first, path.join(dir, "broken-in.mscz"),
    "handbellChartRequiredBellFirst", "H6"), broken);
  const after = mainScore(broken);

  // It refused, naming the bad value rather than some other guard's message.
  assert.match(after, /<metaTag name="handbellChartError">[^<]*H6/);

  // And it refused without taking the chart with it.
  assert.strictEqual(count(after, /<TextLine>/g), 2,
    "the brackets must survive a refused run");
  assert.strictEqual(count(after, /<Instrument id="hand-bells">/g), partsBefore,
    "the chart's part must survive a refused run");
  assert.match(after, /<text><i>optional<\/i><\/text>/,
    "the chart's wording must survive a refused run");
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

  // On the chimes' own staves, not the bells'. The bells chart carries no
  // bracket at all here, so a slice that reached the wrong staff would find
  // nothing and say so; a slice that reached the chimes' bells-chart measure
  // would find an empty padded measure and say the same. Five chime columns
  // with the run over 3 and 4 is what the bracket has to be placed against.
  const chimeTreble = chartMeasure(inner.text, source, 1, "treble");
  assert.strictEqual(count(chimeTreble, /<Chord>/g), 5, "five chime columns");
  assert.strictEqual(
    columnOf(chimeTreble, /<Spanner type="TextLine">\s*<TextLine>/,
      "the start of the chime bracket"), 3);
  assert.strictEqual(count(chartMeasure(inner.text, source, 0, "treble"),
    /<Spanner type="TextLine">/g), 0, "the bells chart carries no bracket");

  // The chimes are the second chart, so their measure does not start at tick
  // zero. A bracket anchored to its column within the measure rather than to
  // its position in the score writes the same XML here and draws nothing.
  //
  // Two segments for two runs. The bass run is the single column C4, and its
  // bracket is drawn as fully as the treble one, because the widening pass
  // measures a
  // chart column off the laid-out page rather than off the bracket, so a run
  // that spans no time still gets a length. The command-line tool draws only
  // the treble one here: its overhang is a correction to a segment MuseScore
  // has already laid out, and at the first column of a measure a zero-length
  // spanner is laid out no segment at all (cli-render.test.js).
  const svg = renderSvg(inner.output, path.join(inner.dir, "chimes.svg"));
  assert.strictEqual(count(svg, /class="TextLineSegment"/g), 2,
    "both chime brackets are drawn, in a chart measure that is not the first");
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

// Where the bracket ends, measured on the page rather than counted in the file.
//
// MuseScore anchors a spanner notehead-to-notehead: it begins exactly on the
// first anchor's left edge and stops 0.70sp short of the last one's. A chart
// bracket has to *enclose* the bells it covers, so the right end fell short by
// a whole notehead as well as that backoff, and the left end sat hard against
// the first bell. The anchor ticks in the saved file are identical either way,
// so only a render can tell the two apart.
test("the bracket encloses the bells it covers, evenly on both sides", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { dir, output } = chartWith(t, "extent", "optional-ranges.mscx",
    REQUIRED_C4_C7);
  const svg = renderSvg(output, path.join(dir, "extent.svg"));

  const columns = chartColumns(svg);
  const brackets = bracketExtents(svg);
  // The preconditions every measurement below rests on. Without the right
  // number of columns and brackets the pairing is meaningless, and a fixture
  // that drew nothing would sail through a loop over an empty list.
  assert.strictEqual(columns.length, 6, "six chart columns were drawn");
  assert.strictEqual(brackets.length, 2, "one bracket per optional run");

  // Sorted left to right: the bass run is columns 0-1, the treble run 2-4.
  const runs = [
    { name: "bass", bracket: brackets[0], first: columns[0], last: columns[1] },
    { name: "treble", bracket: brackets[1], first: columns[2], last: columns[4] },
  ];

  const pads = [];
  for (const run of runs) {
    assert.ok(run.bracket.left < run.first.left,
      `the ${run.name} bracket must start left of its first bell `
      + `(${run.bracket.left} vs ${run.first.left})`);
    assert.ok(run.bracket.right > run.last.right,
      `the ${run.name} bracket must end right of its last bell `
      + `(${run.bracket.right} vs ${run.last.right})`);
    pads.push(run.first.left - run.bracket.left, run.bracket.right - run.last.right);
  }

  // The same overhang everywhere, which is what makes the brackets read as one
  // device rather than four separately-judged ends.
  const spread = Math.max(...pads) - Math.min(...pads);
  assert.ok(spread < 2, `every overhang must match: ${pads.map((n) => n.toFixed(1))}`);
});

// A run of one column, which is a bell with no optional neighbour: the top
// bell of a set, or an octave stacked into a column whose staff bell is
// required. The bracket still has to go round it.
//
// A spanner anchored notehead to notehead spans no time at all here, and
// MuseScore lays that out as a line running back from the anchor rather than
// as nothing: a bracket sitting to the left of its bell, touching neither end
// of it. It is the one case the widening pass used to skip, because it worked
// the page distance out from the bracket's own laid-out length and a bracket
// of no length says nothing about how wide a column is.
//
// The fixture carries both kinds of run in one chart, which is what makes the
// comparison worth making: a one-column bracket has to enclose its bell by the
// same margin as the three-column one above it, or the chart reads as two
// devices rather than one.
test("a one-column run's bracket encloses its single bell", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { dir, output } = chartWith(t, "single", "single-column-optional.mscx", {
    handbellChartRequiredBellFirst: "C3",
    handbellChartRequiredBellLast: "E5",
  });
  const svg = renderSvg(output, path.join(dir, "single.svg"));

  const columns = chartColumns(svg);
  const brackets = bracketExtents(svg);
  // The preconditions. The one-column run is the whole point of the fixture,
  // and until this branch it drew a bracket that was there but wrong, so
  // "two brackets" is what separates the fix from the bug, and the loop below
  // would prove nothing over a shorter list.
  assert.strictEqual(columns.length, 9, "nine chart columns were drawn");
  assert.strictEqual(brackets.length, 2, "one bracket per optional run");

  // Left to right: the treble run is columns 2-4, the bass run is column 6
  // alone, B2 stacked an octave under the required B3.
  const runs = [
    { name: "treble", bracket: brackets[0], first: columns[2], last: columns[4] },
    { name: "single", bracket: brackets[1], first: columns[6], last: columns[6] },
  ];

  const pads = [];
  for (const run of runs) {
    assert.ok(run.bracket.left < run.first.left,
      `the ${run.name} bracket must start left of its first bell `
      + `(${run.bracket.left} vs ${run.first.left})`);
    assert.ok(run.bracket.right > run.last.right,
      `the ${run.name} bracket must end right of its last bell `
      + `(${run.bracket.right} vs ${run.last.right})`);
    pads.push(run.first.left - run.bracket.left, run.bracket.right - run.last.right);
  }

  const spread = Math.max(...pads) - Math.min(...pads);
  assert.ok(spread < 2, `every overhang must match: ${pads.map((n) => n.toFixed(1))}`);
});

// Each chart measures its own columns.
//
// The overhang is spent as time, so it has to be converted at the rate that
// chart measure is spaced at, and two charts in one score are spaced
// differently, because each holds a different number of quarter-note columns
// across the same system. chart-wider-than-the-metre charts ten bells and five
// chimes, so a chime column is about twice as wide as a bell column and buying
// the same distance costs about half as much time.
//
// Read out of the file rather than off the page: the two charts sit one above
// the other with their columns at similar x, so a rendered measurement cannot
// say which chart a notehead belongs to, while the recorded span can.
test("each chart's brackets are measured against its own columns", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const source = fixture("chart-wider-than-the-metre.mscx");
  const { text } = chartWith(t, "own-columns", "chart-wider-than-the-metre.mscx", {
    handbellChartRequiredBellFirst: "C4",
    handbellChartRequiredBellLast: "C9",
    handbellChartRequiredChimeFirst: "G5",
    handbellChartRequiredChimeLast: "B5",
  });

  // How far past its last column a bracket reaches, in columns. A column is a
  // quarter, so a recorded span of 1/2 is two columns.
  const overshootOf = (measure, columns, what) => {
    const found = /<next><location><fractions>(-?\d+)\/(\d+)<\/fractions>/
      .exec(measure.replace(/\s+/g, ""));
    assert.ok(found, `${what} records no span`);
    return 4 * (Number(found[1]) / Number(found[2])) - columns;
  };

  // The preconditions. The two charts have to differ in width for the
  // comparison to mean anything, and each of the two brackets read below has
  // to be the only one in the measure it is read from.
  const bells = planned(source).sections[0];
  const chimes = planned(source).sections[1];
  assert.strictEqual(bells.columns, 10, "the bells chart is ten columns wide");
  assert.strictEqual(chimes.columns, 5, "the chimes chart is five columns wide");

  const bellsBass = chartMeasure(text, source, 0, "bass");
  const chimeTreble = chartMeasure(text, source, 1, "treble");
  assert.strictEqual(count(bellsBass, /<TextLine>/g), 1, "one bracket on the bells bass staff");
  assert.strictEqual(count(chimeTreble, /<TextLine>/g), 1, "one bracket on the chimes treble staff");

  // The bells run is the single column C3, spanning nothing; the chimes run is
  // columns 3 to 4, spanning one. Column 4 is also the last of that chart, so
  // the chimes figure is the one measurement with no column after it to
  // measure against.
  const bellsOvershoot = overshootOf(bellsBass, 0, "the bells bracket");
  const chimeOvershoot = overshootOf(chimeTreble, 1, "the chimes bracket");

  // Part of a column each, never a whole one: a bracket that reached the next
  // bell outright would be covering a bell nobody marked optional, and one that
  // overshot by nothing was never widened at all.
  for (const [name, overshoot] of [["bells", bellsOvershoot], ["chimes", chimeOvershoot]]) {
    assert.ok(overshoot > 0 && overshoot < 1,
      `the ${name} bracket must overshoot by part of a column, got ${overshoot}`);
  }

  // And the two differ widely, because a column is a different width on each
  // chart and the backoff that widens a bracket is a fixed distance on the
  // page. Measure both against a single chart and they come out equal, which
  // is the mistake this guards.
  //
  // Which of the two is the larger is not asserted, because it turns on whether
  // MuseScore stretched each chart's system to the page. It stretches one that
  // carries an instrument name beside it and leaves a narrow one alone
  // otherwise, so the answer changes with an option that has nothing to do with
  // brackets. The ratio is the part that says each chart was measured on its
  // own terms.
  const ratio = bellsOvershoot / chimeOvershoot;
  assert.ok(ratio > 1.5 || ratio < 1 / 1.5,
    "each bracket is measured against its own chart, so the two overshoots "
    + `differ widely: got ${bellsOvershoot} against ${chimeOvershoot}`);
});
