const test = require("node:test");
const assert = require("node:assert");
const { collect } = require("../../handbells-used-chart/lib/collect.js");

const C5 = { pitch: 72, tpc: 14, head: "normal" };
const GSHARP5 = { pitch: 80, tpc: 22, head: "normal" };
const AFLAT5 = { pitch: 80, tpc: 10, head: "normal" };

test("separates handbells from handchimes by notehead", () => {
  const out = collect([C5, { pitch: 74, tpc: 16, head: "diamond" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5"]);
  assert.deepStrictEqual(out.chimes.map((b) => b.name), ["D5"]);
});

test("counts repeats without duplicating the bell", () => {
  const out = collect([C5, C5, C5]);
  assert.strictEqual(out.bells.length, 1);
  assert.strictEqual(out.bells[0].count, 3);
});

test("keeps both spellings only when both are used", () => {
  const onlyFlat = collect([AFLAT5, AFLAT5]);
  assert.deepStrictEqual(onlyFlat.bells.map((b) => b.name), ["Ab5"]);

  const both = collect([AFLAT5, GSHARP5]);
  assert.deepStrictEqual(both.bells.map((b) => b.name), ["G#5", "Ab5"]);
});

test("sorts ascending by pitch, then sharp before flat", () => {
  const out = collect([AFLAT5, C5, GSHARP5, { pitch: 74, tpc: 16, head: "normal" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5", "D5", "G#5", "Ab5"]);
});

test("tags each bell with its region", () => {
  const out = collect([C5, { pitch: 98, tpc: 16, head: "normal" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.region), ["bassStaff", "trebleRow1"]);
});

test("counts notes with an unrecognised notehead instead of dropping them", () => {
  const out = collect([C5, { pitch: 72, tpc: 14, head: "cross" }]);
  assert.strictEqual(out.unknown, 1);
  assert.strictEqual(out.bells.length, 1);
});

test("reports out-of-range bells once each", () => {
  const b1 = { pitch: 35, tpc: 19, head: "normal" }; // B1
  const out = collect([b1, b1, C5]);
  assert.deepStrictEqual(out.outOfRange, ["B1"]);
  assert.strictEqual(out.bells.length, 1);
});

test("returns empty sections for an empty score", () => {
  const out = collect([]);
  assert.deepStrictEqual(out, { bells: [], chimes: [], unknown: 0, outOfRange: [] });
});
