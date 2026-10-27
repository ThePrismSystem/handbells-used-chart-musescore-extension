const test = require("node:test");
const assert = require("node:assert");
const { usableColor, mostUsedColor } = require("../../handbells-used-chart/lib/colors.js");

const RED = "#c00000";
const note = (head, color) => (color ? { head, color } : { head });

test("usableColor still normalises what a user types and refuses black", () => {
  assert.strictEqual(usableColor(" c00000 "), "#c00000");
  assert.strictEqual(usableColor("#000"), null);
  assert.strictEqual(usableColor("red"), null);
});

// What the dialog fills a kind's colour field with when the user picks the
// notehead the music already colours.
test("the colour most of a notehead's notes carry", () => {
  assert.strictEqual(mostUsedColor([note("diamond", RED), note("diamond", RED), note("diamond")],
    "diamond"), RED);
});

// A record with no colour is black, and black means no colour at all.
test("no colour when most of them are black", () => {
  assert.strictEqual(mostUsedColor([note("diamond"), note("diamond"), note("diamond", RED)],
    "diamond"), "");
});

test("only that notehead's notes count", () => {
  assert.strictEqual(mostUsedColor([note("cross", RED), note("cross", RED), note("diamond")],
    "diamond"), "");
  assert.strictEqual(mostUsedColor([], "diamond"), "");
});
