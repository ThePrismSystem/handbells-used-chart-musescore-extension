const test = require("node:test");
const assert = require("node:assert");
const { linesOf } = require("../../handbells-used-chart/lib/warnings.js");

test("words each warning the plan carries, in order", () => {
  assert.deepStrictEqual(linesOf({ warnings: [
    { type: "unknown-notehead", count: 3, names: ["cross", "slash"] },
    { type: "unreadable-pitch", count: 1 },
    { type: "out-of-range", names: ["B1"] },
    { type: "smb-out-of-range", names: ["C#7"] },
    { type: "skipped-part-not-found", names: ["Organ"] },
    { type: "empty-instrument", names: ["Handbells III", "Organ"] },
  ] }), [
    "3 note(s) with an unrecognised notehead were skipped: cross, slash",
    "1 note(s) with an unreadable pitch were skipped",
    "Bells outside C2-C9 were skipped: B1",
    "Silver melody bells outside C5-C7 were skipped: C#7",
    "No part is named: Organ",
    "These instruments have nothing to chart: Handbells III, Organ",
  ]);
});

// lib/ is shared, so a type added there for one front end reaches the other.
test("passes over a warning type it does not know", () => {
  assert.deepStrictEqual(linesOf({ warnings: [{ type: "something-new" }] }), []);
});
