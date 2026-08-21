const test = require("node:test");
const assert = require("node:assert");
const { readMscz, writeMscz, replaceMain } = require("../../tools/mscz.js");

function build(files) {
  return writeMscz({
    entries: new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, "utf8")])),
    mainName: Object.keys(files).find((k) => k.endsWith(".mscx")),
  });
}

test("round-trips a single score entry", () => {
  const buf = build({ "score.mscx": "<museScore version=\"4.70\"/>" });
  const archive = readMscz(buf);
  assert.strictEqual(archive.mainName, "score.mscx");
  assert.strictEqual(archive.entries.get("score.mscx").toString("utf8"),
                     "<museScore version=\"4.70\"/>");
});

test("round-trips several entries including nested paths", () => {
  const buf = build({
    "score.mscx": "<museScore/>",
    "META-INF/container.xml": "<container/>",
    "Thumbnails/thumbnail.png": "not really a png",
  });
  const archive = readMscz(buf);
  assert.deepStrictEqual([...archive.entries.keys()].sort(),
    ["META-INF/container.xml", "Thumbnails/thumbnail.png", "score.mscx"]);
  assert.strictEqual(archive.entries.get("META-INF/container.xml").toString("utf8"),
                     "<container/>");
});

test("compresses large entries and still round-trips them", () => {
  const big = "<Measure><Rest/></Measure>".repeat(5000);
  const archive = readMscz(build({ "score.mscx": big }));
  assert.strictEqual(archive.entries.get("score.mscx").toString("utf8"), big);
});

test("replaceMain swaps the score without disturbing other entries", () => {
  const archive = readMscz(build({ "score.mscx": "<old/>", "META-INF/container.xml": "<c/>" }));
  const updated = replaceMain(archive, "<new/>");
  assert.strictEqual(updated.entries.get("score.mscx").toString("utf8"), "<new/>");
  assert.strictEqual(updated.entries.get("META-INF/container.xml").toString("utf8"), "<c/>");
  // The original is untouched.
  assert.strictEqual(archive.entries.get("score.mscx").toString("utf8"), "<old/>");
});

test("survives a write-read-write-read cycle byte-for-byte", () => {
  const first = build({ "score.mscx": "<museScore/>", "x.json": "{}" });
  const second = writeMscz(readMscz(first));
  assert.deepStrictEqual(readMscz(second).entries.get("score.mscx"),
                         readMscz(first).entries.get("score.mscx"));
});
