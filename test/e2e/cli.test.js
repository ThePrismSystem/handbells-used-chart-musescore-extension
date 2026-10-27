const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeMscz, readMscz, replaceMain } = require("../../tools/mscz.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const CLI = path.join(__dirname, "..", "..", "tools", "chart-cli.js");
const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

function makeScore(dir) {
  const mscx = fs.readFileSync(FIXTURE);
  const buf = writeMscz({ entries: new Map([["score.mscx", mscx]]), mainName: "score.mscx" });
  const file = path.join(dir, "in.mscz");
  fs.writeFileSync(file, buf);
  return file;
}

// A real .mscz carries a style file and, once the user makes a part, a whole
// second score under Excerpts/. Both are rewritten by a run, and neither is
// present in the single-entry archive above, which is why the plain fixture
// cannot catch a mistake in either.
const STYLE = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Style>
    <hideEmptyStaves>0</hideEmptyStaves>
    <dontHideStavesInFirstSystem>1</dontHideStavesInFirstSystem>
    </Style>
  </museScore>
`;

const EXCERPT = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <name>Part</name>
    <Staff id="1">
      <Measure>
        <voice>
          <Rest>
            <durationType>measure</durationType>
            <duration>4/4</duration>
            </Rest>
          </voice>
        </Measure>
      <Measure>
        <voice>
          <Rest>
            <durationType>measure</durationType>
            <duration>4/4</duration>
            </Rest>
          </voice>
        </Measure>
      </Staff>
    </Score>
  </museScore>
`;

function makeFullScore(dir) {
  const entries = new Map([
    ["score_style.mss", Buffer.from(STYLE, "utf8")],
    ["score.mscx", fs.readFileSync(FIXTURE)],
    ["Excerpts/0_Part/0_Part.mscx", Buffer.from(EXCERPT, "utf8")],
    ["META-INF/container.xml", Buffer.from("<container/>\n", "utf8")],
  ]);
  const file = path.join(dir, "full.mscz");
  fs.writeFileSync(file, writeMscz({ entries, mainName: "score.mscx" }));
  return file;
}

function entriesOf(file) {
  const a = readMscz(fs.readFileSync(file));
  return a.entries;
}

function assertArchivesMatch(a, b) {
  assert.deepStrictEqual([...b.keys()].sort(), [...a.keys()].sort(), "same entries");
  for (const [name, buffer] of a) {
    assert.strictEqual(Buffer.compare(buffer, b.get(name)), 0, `${name} is unchanged`);
  }
}

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

test("writes an output archive containing a chart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  const output = path.join(dir, "out.mscz");

  const stdout = run([input, output]);
  assert.match(stdout, /Handbells Used: \d+/);

  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  assert.match(text, /<trackName>Handbells Used<\/trackName>/);
  assert.strictEqual(extractNotes(text).chartPartIds.length, 2);
});

test("--remove strips a chart and leaves the music intact", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  const charted = path.join(dir, "charted.mscz");
  const stripped = path.join(dir, "stripped.mscz");

  run([input, charted]);
  run([charted, stripped, "--remove"]);

  const archive = readMscz(fs.readFileSync(stripped));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  assert.doesNotMatch(text, /Handbells Used|Handchimes Used/);
  assert.match(text, /<pitch>72<\/pitch>/);
});

test("custom labels reach the score", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");
  run([makeScore(dir), output, "--bell-label", "5-7 Octaves"]);
  const archive = readMscz(fs.readFileSync(output));
  assert.match(archive.entries.get(archive.mainName).toString("utf8"), /5-7 Octaves/);
});

test("--hide-empty-staves reaches the score", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");
  run([makeScore(dir), output, "--hide-empty-staves"]);
  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  const firstPart = text.slice(text.indexOf("<Part"), text.indexOf("</Part>"));
  assert.match(firstPart, /<hideWhenEmpty>on<\/hideWhenEmpty>/);
});

test("warns about notes it could not read", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A note with no <tpc> has no spelling, so it cannot be named or placed.
  const broken = fs.readFileSync(FIXTURE, "utf8")
    .replace(/<tpc>\d+<\/tpc>/, "");
  const file = path.join(dir, "broken.mscz");
  fs.writeFileSync(file, writeMscz({
    entries: new Map([["score.mscx", Buffer.from(broken, "utf8")]]),
    mainName: "score.mscx",
  }));
  assert.match(run([file, path.join(dir, "out.mscz")]), /1 note\(s\) with no readable pitch/);
});

// A chart built before the counts were separated recorded no
// handbellChartPartCount tag at all. Removal has to fall back to the old
// reading rather than treat the absent tag as a recorded count of zero parts.
test("--remove still works on a chart with no handbellChartPartCount tag", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-oldtag-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);

  const charted = path.join(dir, "charted.mscz");
  run([input, charted]);

  // The precondition: the unstripped chart removes on its own, so a pass
  // below cannot be two broken removal paths agreeing with each other.
  const cleanBack = path.join(dir, "clean-back.mscz");
  run([charted, cleanBack, "--remove"]);
  assert.doesNotMatch(mainOf(cleanBack), /Handbells Used|Handchimes Used/,
    "the unstripped chart removes cleanly");

  const archive = readMscz(fs.readFileSync(charted));
  const older = archive.entries.get(archive.mainName).toString("utf8")
    .replace(/\s*<metaTag name="handbellChartPartCount">[^<]*<\/metaTag>/, "");
  const oldStyle = path.join(dir, "old-style.mscz");
  fs.writeFileSync(oldStyle, writeMscz(replaceMain(archive, older)));

  const back = path.join(dir, "back.mscz");
  run([oldStyle, back, "--remove"]);
  const text = mainOf(back);
  assert.doesNotMatch(text, /Handbells Used|Handchimes Used/,
    "the chart is gone even without the part count tag");
  assert.strictEqual(count(text, /<Part id="\d+">/g),
    count(fs.readFileSync(FIXTURE, "utf8"), /<Part id="\d+">/g),
    "the score is back to its original part count");
});

test("a full archive comes back byte for byte after generate then remove", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeFullScore(dir);
  const charted = path.join(dir, "charted.mscz");
  const back = path.join(dir, "back.mscz");

  run([input, charted]);
  run([charted, back, "--remove"]);
  assertArchivesMatch(entriesOf(input), entriesOf(back));
});

test("and again with --hide-empty-staves, which rewrites the style file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeFullScore(dir);
  const charted = path.join(dir, "charted.mscz");
  const back = path.join(dir, "back.mscz");

  run([input, charted, "--hide-empty-staves"]);
  const style = entriesOf(charted).get("score_style.mss").toString("utf8");
  assert.match(style, /<hideEmptyStaves>1<\/hideEmptyStaves>/);
  assert.match(style, /<dontHideStavesInFirstSystem>0<\/dontHideStavesInFirstSystem>/);

  run([charted, back, "--remove"]);
  assertArchivesMatch(entriesOf(input), entriesOf(back));
});

test("a linked part gains the same chart measures as the main score", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const charted = path.join(dir, "charted.mscz");
  run([makeFullScore(dir), charted]);

  // Two sections, so two chart measures, and they must carry the same lengths
  // the main score uses or MuseScore refuses to open the file.
  const excerpt = entriesOf(charted).get("Excerpts/0_Part/0_Part.mscx").toString("utf8");
  const opens = excerpt.match(/<Measure(?:\s[^>]*)?>/g);
  assert.deepStrictEqual(opens.slice(0, 2),
    ['<Measure len="2/4">', '<Measure len="1/4">']);
  assert.strictEqual(opens.length, 4);
  assert.doesNotMatch(excerpt, /<Chord>/, "the chart notes stay in the main score");
});

test("--remove says so when there was no chart to remove", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.match(run([makeFullScore(dir), path.join(dir, "out.mscz"), "--remove"]),
    /No chart found/);
});

test("exits non-zero for a colour it cannot parse", () => {
  assert.throws(() => run(["/nonexistent.mscz", "/tmp/out.mscz", "--chime-color", "crimson"]),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr, /Not a hex colour/);
      return true;
    });
});

test("exits non-zero with a message for a missing input file", () => {
  assert.throws(() => run(["/nonexistent.mscz", "/tmp/out.mscz"]), (err) => {
    assert.strictEqual(err.status, 1);
    assert.match(err.stderr, /not found/i);
    return true;
  });
});

test("brackets the bells below the named first required bell", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-optional-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  const output = path.join(dir, "out.mscz");
  execFileSync(process.execPath, [CLI, input, output, "--required-bell-first", "C5"]);

  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  // The fixture uses C3, which is below C5 and therefore optional.
  assert.match(text, /<Spanner type="TextLine">/);
  assert.match(text, /<text>optional<\/text>/);
});

test("draws no bracket when no range is given", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-no-optional-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  const output = path.join(dir, "out.mscz");
  execFileSync(process.execPath, [CLI, input, output]);

  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");
  assert.doesNotMatch(text, /<Spanner type="TextLine">/);
});

test("refuses a bell name it cannot parse, naming the value", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-bad-bell-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  assert.throws(
    () => execFileSync(process.execPath,
      [CLI, input, path.join(dir, "out.mscz"), "--required-bell-first", "H6"],
      { stdio: "pipe" }),
    (err) => /H6/.test(String(err.stderr)) && /not a bell name/i.test(String(err.stderr)));
});

test("all remaining required-range flags reach their correct options", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-range-dispatch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  const output = path.join(dir, "out.mscz");

  // The fixture's bells are C3 (pitch 48), C5 (pitch 72) and G#5 (pitch 80);
  // its one chime is D6. Asking for bells [C5, G5] leaves C3 optional below and
  // G#5 optional above, and the chime range names a pitch the fixture does not
  // reach, so its D6 is optional too, giving three brackets in all.
  //
  // Wiring --required-bell-last to requiredBellFirst instead drops the upper
  // bound, G#5 stops being optional, and the count falls to two. Wiring
  // --required-chime-first to requiredChimeLast leaves the chime range with no
  // lower bound, which also changes the count. The one typo this cannot see is
  // --required-chime-last writing to requiredChimeFirst: with a single chime in
  // the fixture and the same value on both chime flags, the two spellings of
  // the range put the same bracket in the same place. The test below covers it.
  execFileSync(process.execPath, [CLI, input, output,
    "--required-bell-first", "C5",
    "--required-bell-last", "G5",
    "--required-chime-first", "F#6",
    "--required-chime-last", "F#6"]);

  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");

  // Precondition: fixture has the bells and chime needed for the test.
  assert.match(text, /<pitch>48<\/pitch>/, "fixture contains C3");
  assert.match(text, /<pitch>72<\/pitch>/, "fixture contains C5");
  assert.match(text, /<pitch>80<\/pitch>/, "fixture contains G#5");

  const optionalMatches = text.match(/<text>optional<\/text>/g) || [];
  assert.strictEqual(optionalMatches.length, 3, `exactly 3 optional brackets with correct ranges, found ${optionalMatches.length}`);
});

test("the chime range flags reach their own options, not each other's", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-chime-range-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A fixture with several chimes at different pitches, which the two-staff one
  // does not have. With a single chime, "required from D6" and "required D6 to
  // D6" bracket the same column, so a swapped destination is invisible.
  const wide = path.join(__dirname, "..", "fixtures", "chart-wider-than-the-metre.mscx");
  const source = fs.readFileSync(wide, "utf8");
  const input = path.join(dir, "wide.mscz");
  fs.writeFileSync(input, writeMscz({
    entries: new Map([["score.mscx", Buffer.from(source, "utf8")]]),
    mainName: "score.mscx",
  }));

  // The precondition the counts below rest on: this fixture really does carry
  // chimes above and below the ranges named, and no bell range is passed, so
  // every bracket counted belongs to the chime chart.
  const chimes = extractNotes(source).records.filter((r) => r.head === "diamond");
  assert.ok(chimes.length >= 4, `fixture needs several chimes, found ${chimes.length}`);

  function bracketsFor(name, args) {
    const output = path.join(dir, name + ".mscz");
    execFileSync(process.execPath, [CLI, input, output].concat(args));
    const archive = readMscz(fs.readFileSync(output));
    const text = archive.entries.get(archive.mainName).toString("utf8");
    return (text.match(/<text>optional<\/text>/g) || []).length;
  }

  // Chimes run C4 to D6. Required G5 to B5 leaves C4 optional below on the bass
  // staff and C6, D6 optional above on the treble: two brackets. Send
  // --required-chime-first to requiredChimeLast and the lower bound disappears,
  // C4 stops being optional, and one bracket is left.
  assert.strictEqual(bracketsFor("inner", [
    "--required-chime-first", "G5", "--required-chime-last", "B5"]), 2);

  // Required C4 to B5 starts at the lowest chime, so only C6 and D6 are
  // optional: one bracket. Send --required-chime-last to requiredChimeFirst and
  // the range becomes "required from B5", which brackets everything below it as
  // well and gives two. The range above cannot see that swap; this one can.
  assert.strictEqual(bracketsFor("lower", [
    "--required-chime-first", "C4", "--required-chime-last", "B5"]), 1);
});

// The same page, written on a Piano part and on a Handbells part, must produce
// the same chart. Any octave error shows up as a difference here.
test("a piano score and a handbell score of the same page chart identically", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-piano-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const chartPitches = (fixtureName, tag) => {
    const source = path.join(__dirname, "..", "fixtures", fixtureName);
    // How many staves the piece itself has, before the chart adds its own.
    const originals = (fs.readFileSync(source, "utf8").match(/<Staff id="\d+">/g) || []).length;

    const input = path.join(dir, `${tag}-in.mscz`);
    const output = path.join(dir, `${tag}-out.mscz`);
    fs.writeFileSync(input, writeMscz({
      entries: new Map([["score.mscx", fs.readFileSync(source)]]), mainName: "score.mscx" }));
    execFileSync(process.execPath, [CLI, input, output]);

    const archive = readMscz(fs.readFileSync(output));
    const text = archive.entries.get(archive.mainName).toString("utf8");
    // Only the chart's own staves, which the tool appends after the piece's.
    // The two fixtures' own staves hold pitches an octave apart by
    // construction, which is what makes them the same written page, so a
    // whole-file comparison would differ even when the charts agree.
    const staves = text.split(/(?=<Staff id="\d+">)/).slice(1);
    const chartStaves = staves.slice(originals).join("");
    assert.ok(chartStaves.length > 0, `${tag}: no chart staves were written`);
    return (chartStaves.match(/<pitch>\d+<\/pitch>/g) || []).join(" ");
  };

  const bells = chartPitches("single-measure-handbells.mscx", "bells");
  const piano = chartPitches("piano-instrument.mscx", "piano");
  assert.ok(bells.length > 0, "the handbell chart must contain notes");
  assert.strictEqual(piano, bells);
});

// A flag written last, or followed by another flag, used to take `undefined`
// and be silently dropped: the chart came out with no bracket and the run said
// nothing about why.
test("refuses a range flag with no value", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-flag-novalue-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  assert.throws(
    () => execFileSync(process.execPath,
      [CLI, input, path.join(dir, "out.mscz"), "--required-bell-first"],
      { stdio: "pipe" }),
    (err) => /--required-bell-first needs a value/.test(String(err.stderr)));
});

test("refuses a range flag followed by another flag", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-flag-eatsflag-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  assert.throws(
    () => execFileSync(process.execPath,
      [CLI, input, path.join(dir, "out.mscz"),
        "--required-bell-first", "--remove"],
      { stdio: "pipe" }),
    (err) => /--required-bell-first needs a value/.test(String(err.stderr)));
});

// The noun in the message. All four flags land in the same parser, and a user
// told only "not a bell name" cannot tell which of the four to correct.
test("names the chime range in the message when a chime name is bad", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-bad-chime-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeScore(dir);
  assert.throws(
    () => execFileSync(process.execPath,
      [CLI, input, path.join(dir, "out.mscz"), "--required-chime-first", "H6"],
      { stdio: "pipe" }),
    (err) => /not a chime name/i.test(String(err.stderr)));
});

// --- silver melody bells -----------------------------------------------------

const SMB_FIXTURE = path.join(__dirname, "..", "fixtures", "silver-melody-bells.mscx");

function makeSmbScore(dir, name) {
  const file = path.join(dir, name || "smb.mscz");
  fs.writeFileSync(file, writeMscz({
    entries: new Map([["score.mscx", fs.readFileSync(SMB_FIXTURE)]]),
    mainName: "score.mscx",
  }));
  return file;
}

function mainOf(file) {
  const archive = readMscz(fs.readFileSync(file));
  return archive.entries.get(archive.mainName).toString("utf8");
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// The fixture writes three kinds on one part, told apart by notehead alone,
// which is how handbell music is written. Its silver melody bells are C5, F#5
// and C7: the bottom of the set, one with an accidental, and the top.
test("charts silver melody bells as a third section of their own", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");

  const stdout = run([makeSmbScore(dir), output]);
  assert.deepStrictEqual(stdout.trim().split("\n").slice(0, 3),
    ["Handbells Used: 4", "Handchimes Used: 2", "SMBs Used: 3"]);

  const text = mainOf(output);
  // Three la noteheads came in with the fixture and three more are the chart's.
  // Counting the whole file would pass on a run that drew none of them.
  assert.strictEqual(count(text, /<head>la<\/head>/g), 6,
    "the chart's three squares as well as the fixture's own");
  assert.strictEqual(extractNotes(text).chartPartIds.length, 3,
    "one chart part per kind");
});

// C5 is a bass-staff bell on a handbell chart and a treble-staff one here: the
// same pitch, placed differently because the kinds do not share a compass. The
// fixture carries C5 as both, so one score settles it.
test("a silver melody bell chart is a single treble staff", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");
  run([makeSmbScore(dir), output]);

  const text = mainOf(output);
  // Two staves for the piece, two each for the bells and the chimes, one for
  // the silver melody bells. An empty bass staff would make this eight, and
  // MuseScore will not hide it: the treble half of the same instrument has
  // notes on it.
  assert.strictEqual(count(text, /<Staff id="\d+">/g), 7);

  // And the bells are on it, rather than lost with the staff that went. The
  // pitch stored is the bell's own, C5, F#5 and C7, because the chart staff's
  // 8va clef is a matter of display: it draws them an octave down, a ledger
  // line below the staff to two above, which is what puts two octaves on one
  // staff in the first place.
  const staves = text.split(/<Staff id="\d+">/);
  const smbStaff = staves[staves.length - 1];
  assert.strictEqual(count(smbStaff, /<head>la<\/head>/g), 3, "all three, on one staff");
  assert.deepStrictEqual([...smbStaff.matchAll(/<pitch>(\d+)<\/pitch>/g)].map((m) => m[1]),
    ["72", "78", "96"]);
});

// Two octaves fit across a page as single columns, so unlike handbells these
// do not stack an octave into one another's columns.
test("silver melody bells an octave apart keep their own columns", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");
  run([makeSmbScore(dir), output]);

  const staves = mainOf(output).split(/<Staff id="\d+">/);
  const smbStaff = staves[staves.length - 1];
  // C5 and C7 are two octaves apart, which is exactly the gap a handbell chart
  // closes up. Three chords, not two.
  assert.strictEqual(count(smbStaff, /<Chord>/g), 3);
});

test("--smbs-optional marks the label and nothing else", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");

  const stdout = run([makeSmbScore(dir), output, "--smbs-optional"]);
  assert.match(stdout, /SMBs Used: 3 \(optional\)/);
  assert.doesNotMatch(stdout, /Handbells Used: \d+ \(optional\)/,
    "the setting belongs to one section, not to every one");

  const text = mainOf(output);
  assert.match(text, /SMBs Used: 3 \(optional\)/);
  // The whole set is optional, so nothing is bracketed: a bracket would say
  // that some of these bells are more optional than the others.
  assert.strictEqual(count(text, /<Spanner type="TextLine">/g), 0);
  assert.strictEqual(count(text, /<text>optional<\/text>/g), 0);
});

test("--smb-label replaces the generated label, marker and all", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");

  const stdout = run([makeSmbScore(dir), output,
    "--smb-label", "Silver Melody Bells", "--smbs-optional"]);
  assert.match(stdout, /^Silver Melody Bells$/m);
  assert.doesNotMatch(stdout, /SMBs Used/);
});

test("--smb-color colours the squares and leaves the chimes alone", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");
  run([makeSmbScore(dir), output, "--smb-color", "#0000c0"]);

  const staves = mainOf(output).split(/<Staff id="\d+">/);
  const smbStaff = staves[staves.length - 1];
  assert.strictEqual(count(smbStaff, /<color r="0" g="0" b="192" a="255"\/>/g), 3);
  // The chimes are the pair of staves before it, and they were given no colour
  // of their own. Reading one field for the other is the mistake this tool
  // shipped twice over the chime range flags.
  assert.strictEqual(count(staves[staves.length - 3] + staves[staves.length - 2],
    /<color /g), 0, "the chimes keep the colour they were not given");
});

test("exits non-zero for a silver melody bell colour it cannot parse", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => execFileSync(process.execPath,
      [CLI, makeSmbScore(dir), path.join(dir, "out.mscz"), "--smb-color", "purple"],
      { stdio: "pipe" }),
    /Not a hex colour: purple/);
});

// Nothing above C7 or below C5 is made, so a square notehead outside the set
// is a mistake worth naming. The same pitch as a plain notehead is an ordinary
// handbell and must not be caught by it.
test("warns about silver melody bells outside C5-C7 without touching the rest", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fs.readFileSync(SMB_FIXTURE, "utf8").replace(
    "<Note><pitch>96</pitch><tpc>14</tpc><head>la</head></Note>",
    "<Note><pitch>97</pitch><tpc>21</tpc><head>la</head></Note>");
  const input = path.join(dir, "outside.mscz");
  fs.writeFileSync(input, writeMscz({
    entries: new Map([["score.mscx", Buffer.from(source, "utf8")]]),
    mainName: "score.mscx",
  }));
  const output = path.join(dir, "out.mscz");

  const stdout = run([input, output]);
  assert.match(stdout, /Warning: silver melody bells outside C5-C7 were skipped: C#7/);
  assert.match(stdout, /SMBs Used: 2/, "the two inside the set are still charted");
  assert.doesNotMatch(stdout, /bells outside C2-C9/,
    "C#7 is a perfectly ordinary handbell, so the wider warning must stay quiet");
});

test("a score with silver melody bells comes back byte for byte after --remove", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-smb-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeSmbScore(dir);
  const before = entriesOf(input);

  const charted = path.join(dir, "charted.mscz");
  run([input, charted, "--smbs-optional"]);
  // The precondition: without a chart in the middle, the comparison below is
  // between one file and a copy of itself.
  assert.match(mainOf(charted), /SMBs Used: 3 \(optional\)/);

  const stripped = path.join(dir, "stripped.mscz");
  run([charted, stripped, "--remove"]);
  assertArchivesMatch(before, entriesOf(stripped));
});

// --- --skip-parts ------------------------------------------------------------

const MIXED_FIXTURE = path.join(__dirname, "..", "fixtures", "mixed-instruments.mscx");

function makeMixedScore(dir) {
  const file = path.join(dir, "mixed.mscz");
  fs.writeFileSync(file, writeMscz({
    entries: new Map([["score.mscx", fs.readFileSync(MIXED_FIXTURE)]]),
    mainName: "score.mscx",
  }));
  return file;
}

// The Piano part's notes reach the chart as handbells, because a plain
// notehead is all a handbell is. --skip-parts is how a user tells the tool to
// leave that part's bells off.
test("--skip-parts leaves the named part's bells off the chart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-skip-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = makeMixedScore(dir);

  // The precondition, charted with no skip list: the Piano's bells do reach
  // the chart, and its own bell, pitch 77, is among them. A run that never
  // charted the Piano part would pass the assertions below with the filter
  // deleted.
  const before = path.join(dir, "before.mscz");
  const beforeOut = run([input, before]);
  assert.match(beforeOut, /Handbells Used: 4/,
    "without the skip list the Piano part is charted too");
  assert.match(mainOf(before), /<pitch>77<\/pitch>/,
    "the Piano's own bell must be present before it is skipped");

  const after = path.join(dir, "after.mscz");
  const afterOut = run([input, after, "--skip-parts", "Piano"]);
  assert.match(afterOut, /Handbells Used: 3/, "only the Handbells part is charted");

  const text = mainOf(after);
  // The handbell staff writes C5 D5 E5, which store as 72, 74, 76.
  for (const pitch of [72, 74, 76]) {
    assert.match(text, new RegExp(`<pitch>${pitch}</pitch>`),
      `the chart must still contain pitch ${pitch}`);
  }
  // 77 is the piano staff's F5, and the only pitch the two parts do not share.
  assert.doesNotMatch(text, /<pitch>77<\/pitch>/,
    "the skipped part's own bell must not be charted");
});

test("a --skip-parts name matching no part warns and still charts", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-skip-miss-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "out.mscz");

  const stdout = run([makeMixedScore(dir), output, "--skip-parts", "Harpsichord"]);
  assert.match(stdout, /Warning: no part is named: Harpsichord/);
  // Charted, not refused: a name matching nothing must not cost the user a
  // chart. The count is the one the unfiltered run produces.
  assert.match(stdout, /Handbells Used: 4/, "the chart is still built");
});

test("a shared-staff chart names each of its measures, and removes cleanly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbcli-shared-"));
  const input = makeFullScore(dir);
  const before = entriesOf(input);

  const output = path.join(dir, "shared.mscz");
  run([input, output, "--shared-staff", "--show-instrument-names"]);
  const archive = readMscz(fs.readFileSync(output));
  const text = archive.entries.get(archive.mainName).toString("utf8");

  // The precondition: more than one chart, or one name would satisfy the
  // comparison below while the instrument changes were never written at all.
  const sections = buildPlan(extractNotes(
    fs.readFileSync(FIXTURE, "utf8")).records, {}).sections;
  assert.ok(sections.length > 1, "the fixture plans more than one chart");

  assert.match(text, /<metaTag name="handbellChartPartCount">1<\/metaTag>/,
    "shared mode appends one part");

  // The first chart's wording is the appended part's own instrument. A later
  // chart shares that part, so its wording is not a second instrument on the
  // part but the one carried by its own InstrumentChange, the same way
  // MuseScore's own API writes it.
  const head = text.slice(0, text.indexOf('<Staff id="1">'));
  const own = (fs.readFileSync(FIXTURE, "utf8").match(/<Part id="\d+">/g) || []).length;
  const chartPartText = (head.match(/<Part id="\d+">[\s\S]*?<\/Part>/g) || [])
    .slice(own).join("");
  const firstName = /<longName>([^<]*)<\/longName>/.exec(chartPartText)[1];
  const laterNames = [...text.matchAll(/<InstrumentChange>[\s\S]*?<longName>([^<]*)<\/longName>/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual([firstName, ...laterNames],
    ["Handbells Used", "Handchimes Used"],
    "each chart measure carries the wording of its own chart");

  // And the whole thing undoes itself. Byte-identical is the assertion that
  // catches a removal leaving a tag, a style value or a stray measure behind.
  const stripped = path.join(dir, "stripped.mscz");
  run([output, stripped, "--remove"]);
  assertArchivesMatch(before, entriesOf(stripped));
});
