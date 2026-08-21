const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { extractNotes, readMetaTag } = require("../../tools/extract-notes.js");

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx"), "utf8");

test("reads every note across every staff", () => {
  const { records } = extractNotes(FIXTURE);
  assert.deepStrictEqual(records, [
    { pitch: 72, tpc: 14, head: "normal", staffId: "1" },
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
});

test("defaults a missing head element to a standard notehead", () => {
  const { records } = extractNotes(FIXTURE);
  assert.strictEqual(records[0].head, "normal");
});

test("reports no chart parts for a score without a chart", () => {
  const { chartPartIds } = extractNotes(FIXTURE);
  assert.deepStrictEqual(chartPartIds, []);
});

test("finds chart parts by their marker track name", () => {
  const marked = FIXTURE.replace(
    "<Part id=\"1\">",
    "<Part id=\"9\"><trackName>Handbells Used Chart</trackName></Part><Part id=\"1\">");
  assert.deepStrictEqual(extractNotes(marked).chartPartIds, ["9"]);
});

test("ignores rests", () => {
  const { records } = extractNotes(FIXTURE);
  assert.ok(records.every((r) => typeof r.pitch === "number"));
});

test("reads a metaTag value", () => {
  const withMeta = FIXTURE.replace("<Score>",
    "<Score><metaTag name=\"handchimesColor\">#c00000</metaTag>");
  assert.strictEqual(readMetaTag(withMeta, "handchimesColor"), "#c00000");
  assert.strictEqual(readMetaTag(FIXTURE, "handchimesColor"), null);
});
