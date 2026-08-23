const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeMscz, readMscz } = require("../../tools/mscz.js");
const { extractNotes } = require("../../tools/extract-notes.js");

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
// present in the single-entry archive above — which is why the plain fixture
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
  assert.match(text, /Handbells Used Chart/);
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
  assert.doesNotMatch(text, /Handbells Used Chart/);
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
