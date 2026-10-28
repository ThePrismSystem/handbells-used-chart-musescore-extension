const test = require("node:test");
const assert = require("node:assert");
const run = require("../../handbells-used-chart/run.js");

const optionsModule = require("../../handbells-used-chart/lib/options.js");

const MISMATCH = "This MuseScore numbers its score elements differently.";

// Enough of a score for run.js to record a refusal. It claims a chart and has
// none of the parts or measures a removal would look for, so anything that
// gets as far as removeChart fails with a different message.
function chartedScore(tags = {}) {
  const writes = [];
  const all = { handbellChartParts: "2", handbellChartQuiet: "yes", ...tags };
  return {
    writes,
    metaTag: (name) => (all[name] === undefined ? "" : all[name]),
    setMetaTag: (name, value) => writes.push([name, value]),
    startCmd() {},
    endCmd() {},
  };
}

function engraving({ mismatch = false } = {}) {
  return { check() { if (mismatch) throw new Error(MISMATCH); } };
}

const silent = { say() {} };

test("the remove action checks the element numbers before it removes anything", () => {
  const score = chartedScore();
  const result = run.remove(engraving({ mismatch: true }), score, { quiet: true }, silent);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.summary, MISMATCH);
  assert.deepStrictEqual(score.writes, [["handbellChartError", MISMATCH]]);
});

test("a build checks the element numbers before it removes anything", () => {
  const score = chartedScore();
  const options = optionsModule.readOptions(score.metaTag);
  const result = run.build(engraving({ mismatch: true }), score, options, silent);
  assert.strictEqual(result.summary, MISMATCH);
  assert.deepStrictEqual(score.writes, [["handbellChartError", MISMATCH]]);
});

test("a build refuses a mode it does not know before removing anything", () => {
  const score = chartedScore({ handbellChartMode: "separat" });
  const options = optionsModule.readOptions(score.metaTag);
  const result = run.build(engraving(), score, options, silent);
  assert.match(result.summary, /^handbellChartMode is "separat"/);
  assert.deepStrictEqual(score.writes, [["handbellChartError", result.summary]]);
});
