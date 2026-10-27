const test = require("node:test");
const assert = require("node:assert");
const shapes = require("../../handbells-used-chart/lib/shapes.js");

test("lists match first, then every shape a chart can be drawn in", () => {
  assert.deepStrictEqual(shapes.SHAPES, ["match", "round", "diamond", "square", "triangle",
    "inverted-triangle", "half-circle", "cone"]);
});

test("match draws the chart in the notehead the music uses", () => {
  assert.strictEqual(shapes.chartHead("match", "cross"), "cross");
  assert.strictEqual(shapes.chartHead("match", "diamond"), "diamond");
});

// Options that never mention a shape come from callers that predate them.
test("no shape at all is match", () => {
  assert.strictEqual(shapes.chartHead(undefined, "cross"), "cross");
  assert.strictEqual(shapes.chartHead(null, "la"), "la");
});

test("every other shape names one MuseScore notehead whatever the music uses", () => {
  const expected = {
    round: "normal",
    diamond: "diamond",
    square: "la",
    triangle: "do",
    "inverted-triangle": "triangle-down",
    "half-circle": "re",
    cone: "ti",
  };
  for (const [shape, head] of Object.entries(expected)) {
    assert.strictEqual(shapes.chartHead(shape, "cross"), head, shape);
  }
});
