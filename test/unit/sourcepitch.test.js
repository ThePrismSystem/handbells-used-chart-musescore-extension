const test = require("node:test");
const assert = require("node:assert");
const { offsetFor } = require("../../handbells-used-chart/lib/sourcepitch.js");

test("transposing handbell parts need no correction", () => {
  assert.strictEqual(offsetFor("hand-bells"), 0);
  assert.strictEqual(offsetFor("hand-chimes"), 0);
});

// The bug this exists for. MuseScore stores sounding pitch; a piano does not
// transpose, so its written middle C is stored as pitch 60 while the same
// written note on a handbell part is stored as 72. Without the offset the
// chart draws a piano score an octave low and on the wrong staff.
test("every other instrument is written an octave below its bell names", () => {
  assert.strictEqual(offsetFor("piano"), 12);
  assert.strictEqual(offsetFor("keyboard.piano"), 12);
  assert.strictEqual(offsetFor("marimba"), 12);
});

test("a missing instrument id is treated as non-transposing", () => {
  assert.strictEqual(offsetFor(null), 12);
  assert.strictEqual(offsetFor(undefined), 12);
  assert.strictEqual(offsetFor(""), 12);
});
