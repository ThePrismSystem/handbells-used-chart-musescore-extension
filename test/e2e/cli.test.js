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
