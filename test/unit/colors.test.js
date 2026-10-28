const test = require("node:test");
const assert = require("node:assert");
const { usableColor, mostUsedColor } = require("../../handbells-used-chart/lib/colors.js");

const RED = "#c00000";
const note = (head, color) => (color ? { head, color } : { head });

// The end-to-end extension test cannot tell a black colour that was written
// from one that never was: a new notehead's default colour is already black,
// so MuseScore's own serializer omits the <color> element either way,
// whether or not the black guard in usableColor runs at all. usableColor is
// what actually decides "no colour", so it is what gets tested directly here.
test("black, in any of its spellings, is not a usable colour", () => {
  for (const black of ["#000000", "000000", "#000", "000"]) {
    assert.strictEqual(usableColor(black), null, `${black} should not be usable`);
  }
});

test("a non-black colour passes through unchanged", () => {
  assert.strictEqual(usableColor("#c00000"), "#c00000");
});

// The value comes from a Project Properties field a user typed into, so both
// of these are ordinary things to find there. note.color takes whatever it is
// given without complaining, the wrapper-object trap, so an un-normalised
// value reaches MuseScore, fails to parse, and the chimes come out black with
// nothing said.
test("a colour is normalised before it reaches MuseScore", () => {
  assert.strictEqual(usableColor("c00000"), "#c00000", "a missing hash is added");
  assert.strictEqual(usableColor("  #c00000  "), "#c00000", "surrounding space is trimmed");
  assert.strictEqual(usableColor(" c00000"), "#c00000", "both at once");
  assert.strictEqual(usableColor("#C00000"), "#C00000", "case is left alone");
});

// Black in any spelling still means "no colour", and it has to survive
// normalisation to keep meaning that.
test("black is still not usable once trimmed", () => {
  for (const black of [" #000000 ", "000", " 000000"]) {
    assert.strictEqual(usableColor(black), null, `${black} should not be usable`);
  }
});

test("an unparseable colour is treated the same as none at all", () => {
  for (const bad of ["red", "#12", "", null, undefined, 42]) {
    assert.strictEqual(usableColor(bad), null, `${bad} should not be usable`);
  }
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
