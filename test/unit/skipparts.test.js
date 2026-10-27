const test = require("node:test");
const assert = require("node:assert");
const { applySkipList } = require("../../handbells-used-chart/lib/skipparts.js");

function record(partName, pitch) {
  return { pitch, tpc: 14, head: "normal", staffId: "1", partName };
}

test("an unset list keeps every record", () => {
  const records = [record("Handbells", 72), record("Piano", 60)];
  const result = applySkipList(records, null);
  assert.deepStrictEqual(result.records, records);
  assert.deepStrictEqual(result.unmatched, []);
});

test("a named part is dropped and the others kept", () => {
  const result = applySkipList([record("Handbells", 72), record("Piano", 60)], "Piano");
  assert.deepStrictEqual(result.records.map((r) => r.partName), ["Handbells"]);
  assert.deepStrictEqual(result.unmatched, []);
});

test("names are matched after trimming and ignoring case", () => {
  const result = applySkipList([record("Piano", 60), record("Handbells", 72)],
    "  pIaNo  ");
  assert.deepStrictEqual(result.records.map((r) => r.partName), ["Handbells"]);
});

test("several names separated by commas", () => {
  const records = [record("Piano", 60), record("Organ", 60), record("Handbells", 72)];
  const result = applySkipList(records, "Piano, Organ");
  assert.deepStrictEqual(result.records.map((r) => r.partName), ["Handbells"]);
});

// Empty entries come from a trailing comma, which a user editing a Project
// Properties field leaves behind constantly. Treated as a name they would
// match every part whose name is empty and silently empty the chart.
test("empty entries are ignored rather than matching anything", () => {
  const records = [record("", 60), record("Handbells", 72)];
  const result = applySkipList(records, "Piano,,");
  assert.deepStrictEqual(result.records.map((r) => r.partName), ["", "Handbells"]);
  assert.deepStrictEqual(result.unmatched, ["Piano"]);
});

test("a name matching no part is reported, once, in the spelling given", () => {
  const result = applySkipList([record("Handbells", 72)], "Pianoo, Pianoo");
  assert.deepStrictEqual(result.records.length, 1);
  assert.deepStrictEqual(result.unmatched, ["Pianoo"]);
});

// The precondition the test above cannot state for itself: a name that DOES
// match must not be reported, or "unmatched" would just be the whole list.
test("a name that matches is not reported as unmatched", () => {
  const result = applySkipList([record("Piano", 60), record("Handbells", 72)],
    "Piano, Pianoo");
  assert.deepStrictEqual(result.unmatched, ["Pianoo"]);
});
