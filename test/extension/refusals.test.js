const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  fixture, staffRegion, measuresOf,
} = require("./harness.js");
const { readMscz, writeMscz } = require("../../tools/mscz.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1].replace(/&quot;/g, "\"") : null;
}

function partCount(text) {
  return (text.match(/<Part id="\d+">/g) || []).length;
}

function measureCount(text) {
  return measuresOf(staffRegion(text, 1)).length;
}

// Sets each field on a saved score, adding the ones it does not carry yet.
function retag(source, target, tags) {
  const archive = readMscz(fs.readFileSync(source));
  let text = archive.entries.get(archive.mainName).toString("utf8");
  for (const [name, value] of Object.entries(tags)) {
    const pattern = new RegExp(`(<metaTag name="${name}">)[^<]*(</metaTag>)`);
    text = pattern.test(text)
      ? text.replace(pattern, `$1${value}$2`)
      : text.replace("<Score>", `<Score>\n    <metaTag name="${name}">${value}</metaTag>`);
  }
  archive.entries.set(archive.mainName, Buffer.from(text, "utf8"));
  fs.writeFileSync(target, writeMscz(archive));
  return target;
}

// A score charted by a first run, so each refusal below has a chart to keep.
function charted(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbext-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "charted.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  const text = mainScore(output);
  const original = fs.readFileSync(FIXTURE, "utf8");
  assert.ok(partCount(text) > partCount(original), "the first run appended chart parts");
  return { dir, output, text };
}

test("a field the build refuses leaves the old chart where it was", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const before = charted(t, "refuse-build");
  const input = retag(before.output, path.join(before.dir, "bad-mode.mscz"),
    { handbellChartMode: "separat" });
  const output = path.join(before.dir, "after.mscz");
  runExtension(input, output);
  const after = mainScore(output);

  assert.match(tag(after, "handbellChartError"), /^handbellChartMode is "separat"/);
  assert.strictEqual(partCount(after), partCount(before.text));
  assert.strictEqual(measureCount(after), measureCount(before.text));
  assert.strictEqual(tag(after, "handbellChartParts"), tag(before.text, "handbellChartParts"));
});

test("a chart the remove action cannot identify is refused and left alone", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const before = charted(t, "refuse-remove");
  const input = retag(before.output, path.join(before.dir, "tampered.mscz"),
    { handbellChartParts: "-1" });
  const output = path.join(before.dir, "after.mscz");
  runExtension(input, output, "remove");
  const after = mainScore(output);

  assert.match(tag(after, "handbellChartError"), /records a Handbells Used chart/);
  assert.strictEqual(partCount(after), partCount(before.text));
  assert.strictEqual(measureCount(after), measureCount(before.text));
});
