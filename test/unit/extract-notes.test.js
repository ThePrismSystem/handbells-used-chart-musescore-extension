const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { extractNotes, readMetaTag } = require("../../tools/extract-notes.js");

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx"), "utf8");

test("reads every note across every staff", () => {
  const { records, skipped } = extractNotes(FIXTURE);
  assert.deepStrictEqual(records, [
    { pitch: 72, tpc: 14, head: "normal", staffId: "1" },
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 0);
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

test("skips a note with a missing tpc instead of defaulting to 0", () => {
  const noTpc = FIXTURE.replace(
    "<Note><pitch>72</pitch><tpc>14</tpc></Note>",
    "<Note><pitch>72</pitch></Note>");
  const { records, skipped } = extractNotes(noTpc);
  assert.deepStrictEqual(records, [
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 1);
});

test("skips a note with a non-numeric tpc", () => {
  const badTpc = FIXTURE.replace(
    "<Note><pitch>72</pitch><tpc>14</tpc></Note>",
    "<Note><pitch>72</pitch><tpc>x</tpc></Note>");
  const { records, skipped } = extractNotes(badTpc);
  assert.deepStrictEqual(records, [
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 1);
});

test("reads a metaTag value", () => {
  const withMeta = FIXTURE.replace("<Score>",
    "<Score><metaTag name=\"handchimesColor\">#c00000</metaTag>");
  assert.strictEqual(readMetaTag(withMeta, "handchimesColor"), "#c00000");
  assert.strictEqual(readMetaTag(FIXTURE, "handchimesColor"), null);
});

test("skips a note whose spelling is outside the tonal pitch class range", () => {
  // tpc 0 decodes to Cbb and is legal; 34 decodes to no letter at all, and the
  // bell would reach the chart named "Bundefined4".
  const mscx = FIXTURE.replace(/<tpc>\d+<\/tpc>/, "<tpc>34</tpc>");
  const out = extractNotes(mscx);
  assert.strictEqual(out.skipped, 1);
  for (const record of out.records) {
    assert.ok(record.tpc >= -1 && record.tpc <= 33, `tpc ${record.tpc} is in range`);
  }
});
