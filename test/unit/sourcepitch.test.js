const test = require("node:test");
const assert = require("node:assert");
const { offsetForTransposition } = require("../../handbells-used-chart/lib/sourcepitch.js");

// A part that already transposes up an octave stores each bell at its own
// name, so nothing is added. MuseScore's hand-bells and hand-chimes templates
// are the usual way to get here, but they are not the only one: a Piano part
// the arranger transposed up an octave by hand — which is how a piano-part
// handbell score is made to play back at bell pitch — reads exactly the same,
// and the instrument id this used to key off called it "piano" and charted the
// whole score an octave high.
test("a part transposed up an octave needs no correction", () => {
  assert.strictEqual(offsetForTransposition(12), 0);
});

// MuseScore writes no <transposeChromatic> at all for a part that does not
// transpose, which is most of them, so the reader has nothing to hand over.
// Left to arithmetic that is NaN, and a NaN pitch reaches lib/collect.js as an
// unreadable record and the bell is dropped from the chart without a word.
test("a part with no transposition recorded is read as not transposing", () => {
  assert.strictEqual(offsetForTransposition(undefined), 12);
  assert.strictEqual(offsetForTransposition(null), 12);
});

// The bug the offset exists for. MuseScore stores sounding pitch, and a piano
// does not transpose, so its written middle C is stored as 60 while the same
// written note on a transposing handbell part is stored as 72.
test("a part that does not transpose is written an octave below its bells", () => {
  assert.strictEqual(offsetForTransposition(0), 12);
});

// The XML reader hands over the text it found between the tags rather than
// parsing it first, so the rule has to take a numeric string.
test("the transposition may arrive as text", () => {
  assert.strictEqual(offsetForTransposition("12"), 0);
  assert.strictEqual(offsetForTransposition("0"), 12);
});

// One subtraction covers every transposition, not just the two that name a
// handbell instrument. A glockenspiel sounds two octaves above its written
// pitch and a treble-clef guitar one octave below; bells written on either —
// and people do write bells on whatever staff is to hand — used to chart two
// octaves high and one octave low respectively.
test("transpositions other than an octave up are corrected too", () => {
  assert.strictEqual(offsetForTransposition(24), -12);
  assert.strictEqual(offsetForTransposition(-12), 24);
});
