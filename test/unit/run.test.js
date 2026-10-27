const test = require("node:test");
const assert = require("node:assert");
const run = require("../../handbells-used-chart/run.js");

test("names the instruments that have nothing to chart", () => {
  assert.deepStrictEqual(
    run.warningsOf({ warnings: [{ type: "empty-instrument", names: ["Handbells III", "Organ"] }] }),
    ["These instruments have nothing to chart: Handbells III, Organ"]);
});
