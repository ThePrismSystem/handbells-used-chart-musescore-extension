const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { adapt, check, ELEMENT_TYPES } = require("../../handbells-used-chart/engraving.js");

// MuseScore 4.7.4's numbers, from src/engraving/types/types.h. At apiversion 2
// Element.SYSTEM_TEXT reads as the string "SYSTEM_TEXT", newElement wants the
// number, and the API lists its keys in a different order from the values, so
// a key's position gives the wrong element: position 54 is STAFF_TEXT.
const BY_NUMBER = {
  6: "LAYOUT_BREAK", 29: "CLEF", 32: "TIMESIG", 54: "STAFF_TEXT", 55: "SYSTEM_TEXT",
  63: "INSTRUMENT_CHANGE", 94: "TEXTLINE",
};

// newElement here makes whatever type the number names in BY_NUMBER, the way
// MuseScore does, and the element reports its type as a name, as it does at
// apiversion 2.
function fakeEngraving(byNumber = BY_NUMBER) {
  const made = [];
  return {
    made,
    curScore: { name: "score" },
    Element: { INVALID: "INVALID", SYSTEM_TEXT: "SYSTEM_TEXT", STAFF_TEXT: "STAFF_TEXT" },
    NoteHeadGroup: { HEAD_NORMAL: 0, HEAD_DIAMOND: 9 },
    Align: { HCENTER: 2 },
    LayoutBreak: { LINE: 1 },
    newElement(type) { made.push(type); return byNumber[type] ? { type: byNumber[type] } : null; },
    cmd(name) { made.push("cmd:" + name); },
    fraction(n, d) { return { n, d }; },
  };
}

test("asks for an element by MuseScore's number for it, not the key's position", () => {
  const engraving = fakeEngraving();
  assert.strictEqual(adapt(engraving).newElement("SYSTEM_TEXT").type, "SYSTEM_TEXT");
  assert.strictEqual(adapt(engraving).newElement("TEXTLINE").type, "TEXTLINE");
  assert.deepStrictEqual(engraving.made, [55, 94]);
});

test("passes a number through, as the macros context gives one", () => {
  const engraving = fakeEngraving();
  adapt(engraving).newElement(54);
  assert.deepStrictEqual(engraving.made, [54]);
});

// On a MuseScore whose numbers differ, the element made is the wrong one.
// Building with it would draw a chart of the wrong elements.
test("refuses an element that comes back as another type", () => {
  const shifted = fakeEngraving({ 55: "STAFF_TEXT" });
  assert.throws(() => adapt(shifted).newElement("SYSTEM_TEXT"), /numbers its score elements differently/);
});

test("refuses a type it has no number for", () => {
  assert.throws(() => adapt(fakeEngraving()).newElement("BEAM"), /BEAM/);
});

test("check passes when every type comes back as itself", () => {
  assert.doesNotThrow(() => check(fakeEngraving()));
  assert.doesNotThrow(() => adapt(fakeEngraving()).check());
});

test("check fails on the first type that does not", () => {
  assert.throws(() => check(fakeEngraving({ ...BY_NUMBER, 63: "INSTRUMENT_NAME" })),
    /INSTRUMENT_CHANGE/);
  assert.throws(() => check(fakeEngraving({ ...BY_NUMBER, 94: undefined })), /TEXTLINE/);
  assert.throws(() => adapt(fakeEngraving({ ...BY_NUMBER, 6: "CLEF" })).check(), /LAYOUT_BREAK/);
});

// A new element type added to the build without a number here would be
// refused for everyone.
test("has a number for every element type the build creates", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "handbells-used-chart", "mutate.js"), "utf8");
  const names = [...source.matchAll(/newElement\(engraving\.Element\.([A-Z_]+)\)/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, "the precondition: mutate.js creates elements");
  for (const name of names) assert.ok(name in ELEMENT_TYPES, name);
});

test("hands the rest of the API through", () => {
  const engraving = fakeEngraving();
  const adapted = adapt(engraving);
  assert.strictEqual(adapted.curScore, engraving.curScore);
  assert.deepStrictEqual(adapted.fraction(1, 4), { n: 1, d: 4 });
  adapted.cmd("time-delete");
  assert.deepStrictEqual(engraving.made, ["cmd:time-delete"]);
  for (const name of ["Element", "Align", "LayoutBreak"]) {
    assert.strictEqual(adapted[name], engraving[name], name);
  }
});

// At apiversion 2 note.headGroup reads and writes the key, "HEAD_DIAMOND".
// Assigned the number, it writes an empty <head> and the chime is drawn as a
// plain bell.
test("at apiversion 2 a notehead is set by its key", () => {
  const adapted = adapt(fakeEngraving());
  assert.strictEqual(adapted.NoteHeadGroup.HEAD_DIAMOND, "HEAD_DIAMOND");
  assert.strictEqual(adapted.NoteHeadGroup.HEAD_NORMAL, "HEAD_NORMAL");
});

test("at apiversion 1 a notehead is set by its number", () => {
  const engraving = fakeEngraving();
  engraving.Element = { INVALID: 0, SYSTEM_TEXT: 55 };
  assert.strictEqual(adapt(engraving).NoteHeadGroup, engraving.NoteHeadGroup);
});

// The score is read when it is used, not when the adapter is made, because the
// dialog stays open while the user switches scores.
test("reads the current score each time", () => {
  const engraving = fakeEngraving();
  const adapted = adapt(engraving);
  engraving.curScore = { name: "another" };
  assert.strictEqual(adapted.curScore.name, "another");
});
