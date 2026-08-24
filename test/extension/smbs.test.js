const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, renderSvg,
  makeScore, mainScore, fixture, originalStaffCount, staffRegion, planned,
} = require("./harness.js");

// Silver melody bells, the third kind of bell the chart knows.
//
// The fixture writes all three on one part, told apart by notehead alone,
// which is how handbell music is written. Its silver melody bells are C5, F#5
// and C7: the bottom of the set, one carrying an accidental, and the top.
//
// The extension is the front end that has to work these out through the
// MuseScore API rather than by writing XML, and two of its answers are things
// only a real MuseScore can give: whether NoteHeadGroup.HEAD_LA is what the
// reader sees for a square notehead, and whether a chart part appended as a
// braced pair can be reduced to one staff.
const FIXTURE = "silver-melody-bells.mscx";

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function chartWith(t, tag, metaTags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbext-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const source = fixture(FIXTURE);
  const input = makeScore(dir, source, metaTags);
  const output = path.join(dir, `${tag}.mscz`);
  runExtension(input, output);
  return { dir, source, input, output, text: mainScore(output) };
}

test("charts silver melody bells as a section of their own", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text } = chartWith(t, "smb", {});

  // Every label, in order, read from the tag the run writes rather than from
  // the drawn text: it says what the extension planned, so a chart that was
  // planned and not drawn cannot pass as one that was drawn.
  assert.match(text,
    /<metaTag name="handbellChartFound">Handbells Used: 4 \| Handchimes Used: 2 \| SMBs Used: 3<\/metaTag>/);
  assert.doesNotMatch(text, /<metaTag name="handbellChartError">[^<]/);
  assert.match(text, /SMBs Used: 3/, "the label is on the page too");

  // Three came in with the fixture and three are the chart's. Counting the
  // file as a whole would pass on a run that drew none of them, because the
  // fixture's own three are there either way.
  assert.strictEqual(count(text, /<head>la<\/head>/g), 6,
    "MuseScore wrote the chart's squares as la, the way the reader found them");
});

// The two readers have to report a square notehead as the same thing, or one
// score produces two different charts. This one goes through the MuseScore
// API and matches HEAD_LA; tools/extract-notes.js reads <head>la</head> out of
// the XML. planned() runs the second over the same fixture, so the comparison
// is between what each reader made of the same three squares.
//
// A square was an unrecognised notehead until now, and read.js reported those
// as "other" for lib/ to warn about and skip — that branch catching them still
// would show up here as a missing section rather than a differing one.
test("both readers make the same chart of a square notehead", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text, source } = chartWith(t, "parity", {});
  const expected = planned(source).sections.map((s) => s.label);
  // The precondition: a fixture the XML reader found no silver melody bells in
  // would make the comparison below agree about nothing.
  assert.deepStrictEqual(expected,
    ["Handbells Used: 4", "Handchimes Used: 2", "SMBs Used: 3"]);
  assert.match(text,
    new RegExp(`<metaTag name="handbellChartFound">${expected.join(" \\| ")}</metaTag>`));
});

// C5 is a bass-staff bell on a handbell chart and a treble-staff one here. The
// fixture carries C5 as both a handbell and a silver melody bell, so a single
// score settles which compass each kind is placed by.
test("the silver melody bell chart is a single treble staff", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text, source } = chartWith(t, "one-staff", {});

  // Two for the piece, two each for the bells and the chimes, one for these.
  // An empty bass staff would make it eight, and MuseScore would not hide it:
  // hide-empty-staves keeps both halves of an instrument while either has
  // notes, which is why the staff is given back rather than left blank.
  assert.strictEqual(originalStaffCount(source), 2, "the fixture has two staves");
  assert.strictEqual(count(text, /<Staff id="\d+">/g), 7);

  // And the bells went onto the staff that stayed, rather than away with the
  // one that went. The chart's own staff is the last in the score.
  const smbStaff = staffRegion(text, 7);
  assert.strictEqual(count(smbStaff, /<head>la<\/head>/g), 3);
  // Two octaves fit across a page as separate columns, so C5 and C7 keep their
  // own — a handbell chart would stack them into one.
  assert.strictEqual(count(smbStaff, /<Chord>/g), 3);
});

test("the optional setting marks this label and no other", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text } = chartWith(t, "optional", { handbellChartSmbsOptional: "yes" });

  assert.match(text, /SMBs Used: 3 \(optional\)/);
  assert.doesNotMatch(text, /Handbells Used: 4 \(optional\)/);
  assert.doesNotMatch(text, /Handchimes Used: 2 \(optional\)/);
  // The whole set is optional, so no column is singled out. A bracket here
  // would say some of these bells are more optional than the others.
  assert.strictEqual(count(text, /<Spanner type="TextLine">/g), 0);
});

test("a custom label replaces the generated one, marker and all", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { text } = chartWith(t, "label", {
    handbellChartSmbLabel: "Silver Melody Bells",
    handbellChartSmbsOptional: "yes",
  });
  assert.match(text, /Silver Melody Bells/);
  assert.doesNotMatch(text, /SMBs Used/);
});

// note.color takes any string without complaining, so the only proof a colour
// was understood is a rendered page. The chimes are given none, which is what
// separates a colour that reached its own section from one applied to every
// coloured kind at once.
test("the colour reaches the squares and not the chimes", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const { dir, output, text } = chartWith(t, "color",
    { handbellChartSmbColor: "#0000c0" });

  const smbStaff = staffRegion(text, 7);
  assert.strictEqual(count(smbStaff, /<color r="0" g="0" b="192" a="255"\/>/g), 3);
  assert.strictEqual(count(staffRegion(text, 5) + staffRegion(text, 6), /<color /g), 0,
    "the chimes keep the colour they were not given");

  const svg = renderSvg(output, path.join(dir, "color.svg"));
  assert.strictEqual(count(svg, /fill="#0000c0"/g), 3, "three blue noteheads are drawn");
});

// Re-running over a charted score is the ordinary path, and a section whose
// part has one staff where its instrument gives two is the thing most likely
// to come apart on the way back out. Three runs, because a removal that leaves
// a staff behind grows the score by one each time and a single run cannot see
// it.
test("a second and third run replace the chart rather than adding to it", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-smb-rerun-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  let input = makeScore(dir, fixture(FIXTURE), { handbellChartSmbsOptional: "yes" });
  let first = null;
  for (let run = 1; run <= 3; run++) {
    const output = path.join(dir, `run${run}.mscz`);
    runExtension(input, output);
    const text = mainScore(output);
    assert.doesNotMatch(text, /<metaTag name="handbellChartError">[^<]/,
      `run ${run} recorded a refusal`);

    const shape = {
      staves: count(text, /<Staff id="\d+">/g),
      parts: count(text, /<Part id="\d+">/g),
      // Counted where it is drawn, on the piece's first staff, rather than
      // across the file: the same words are in two metaTags as well, and those
      // are overwritten each run whether the drawn one was replaced or not.
      labels: count(staffRegion(text, 1), /SMBs Used: 3 \(optional\)/g),
      squares: count(text, /<head>la<\/head>/g),
    };
    if (run === 1) {
      // Pinned here rather than inherited, so a run that drew nothing cannot
      // agree with two more runs that drew nothing either.
      assert.deepStrictEqual(shape, { staves: 7, parts: 4, labels: 1, squares: 6 });
      first = shape;
    } else {
      assert.deepStrictEqual(shape, first, `run ${run} changed the score's shape`);
    }
    input = output;
  }
});

// Nothing outside C5 to C7 is made, so a square notehead there is skipped and
// warned about. The warning itself goes to MuseScore's log on a quiet run and
// never reaches the file, so what is checked here is the charted consequence:
// the bell is gone from the chart, and nothing else moved. The warning's own
// wording is covered where it can be read — test/unit/plan.test.js for the
// warning, test/e2e/cli.test.js for the sentence a user sees.
test("a silver melody bell outside C5-C7 is left off, and only it", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore is not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-smb-range-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();

  // C7 moved up a semitone to C#7, which no set contains. The same file still
  // holds handbells well outside C5-C7, so the wider limit is exercised too.
  const source = path.join(dir, "outside.mscx");
  fs.writeFileSync(source, fs.readFileSync(fixture(FIXTURE), "utf8").replace(
    "<Note><pitch>96</pitch><tpc>14</tpc><head>la</head></Note>",
    "<Note><pitch>97</pitch><tpc>21</tpc><head>la</head></Note>"));
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, source), output);
  const text = mainScore(output);

  // Two of the three, and the other two sections untouched: C#7 is an ordinary
  // handbell, so a compass check reaching the wrong kind would show up as a
  // handbell missing from a chart that still has four.
  assert.match(text,
    /<metaTag name="handbellChartFound">Handbells Used: 4 \| Handchimes Used: 2 \| SMBs Used: 2<\/metaTag>/);
  assert.doesNotMatch(text, /<metaTag name="handbellChartError">[^<]/);

  // And it is C#7 that went. The chart staff carries the two that stayed and
  // not the pitch that was refused.
  const smbStaff = staffRegion(text, 7);
  assert.strictEqual(count(smbStaff, /<head>la<\/head>/g), 2);
  assert.doesNotMatch(smbStaff, /<pitch>97<\/pitch>/);
});
