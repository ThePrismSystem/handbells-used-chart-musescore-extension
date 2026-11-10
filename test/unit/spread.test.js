const test = require("node:test");
const assert = require("node:assert");
const { tupletFor, columnLength } = require("../../handbells-used-chart/lib/spread.js");

test("a staff with fewer columns than its chart spreads them as one tuplet", () => {
  assert.deepStrictEqual(tupletFor(6, 10), { actual: 6, normal: 10 });
  assert.deepStrictEqual(tupletFor(2, 4), { actual: 2, normal: 4 },
    "kept as written, not reduced to 1:2");
  assert.deepStrictEqual(tupletFor(9, 10), { actual: 9, normal: 10 });
});

test("a staff that fills the chart, or holds one bell or none, has no tuplet", () => {
  assert.strictEqual(tupletFor(10, 10), null);
  assert.strictEqual(tupletFor(1, 10), null);
  assert.strictEqual(tupletFor(0, 10), null);
});

test("a column lasts a quarter, or its share of the measure inside a tuplet", () => {
  assert.deepStrictEqual(columnLength(10, 10), { numerator: 1, denominator: 4 });
  assert.deepStrictEqual(columnLength(1, 10), { numerator: 1, denominator: 4 });
  assert.deepStrictEqual(columnLength(6, 10), { numerator: 10, denominator: 24 });
});
