const test = require("node:test");
const assert = require("node:assert");
const { NAMES, nameOf, groupOf } = require("../../handbells-used-chart/lib/noteheads.js");

// A stand-in for api.engraving.NoteHeadGroup. The numbers are not MuseScore's,
// on purpose: the lookup has to go through the enum it is handed, never through
// a table position that happens to match one version of it.
const FAKE = { HEAD_NORMAL: 0, HEAD_DIAMOND: 9, HEAD_BREVIS_ALT: 14, HEAD_LA: 18 };

test("names a notehead from the number apiversion 1 reads", () => {
  assert.strictEqual(nameOf(9, FAKE), "diamond");
  assert.strictEqual(nameOf(0, FAKE), "normal");
});

// At apiversion 2, note.headGroup reads as the enum's key rather than its value.
test("names a notehead from the key apiversion 2 reads", () => {
  assert.strictEqual(nameOf("HEAD_DIAMOND", FAKE), "diamond");
  assert.strictEqual(nameOf("HEAD_LA", FAKE), "la");
});

test("uses MuseScore's own file name for the alternative brevis", () => {
  assert.strictEqual(nameOf("HEAD_BREVIS_ALT", FAKE), "altbrevis");
  assert.strictEqual(nameOf(14, FAKE), "altbrevis");
});

// Reporting "normal" here would chart an unknown head as a handbell.
test("an unknown notehead has no name", () => {
  assert.strictEqual(nameOf(99, FAKE), null);
  assert.strictEqual(nameOf("HEAD_NONSENSE", FAKE), null);
  assert.strictEqual(nameOf(undefined, FAKE), null);
});

test("finds the group to set from a notehead's name", () => {
  assert.strictEqual(groupOf("la", FAKE), 18);
  assert.strictEqual(groupOf("altbrevis", FAKE), 14);
});

// Left plain instead, a chart meant to be drawn in crosses would come out
// looking like handbells, with nothing said.
test("refuses a notehead this MuseScore does not have", () => {
  assert.throws(() => groupOf("cross", FAKE),
    { message: "This version of MuseScore has no cross notehead, so the chart cannot be drawn in it." });
  assert.throws(() => groupOf("nonsense", FAKE), /has no nonsense notehead/);
});

// The table is the 26 groups MuseScore 4.7's plugin API exposes. Every file
// name but one is the key with HEAD_ dropped, lowercased and hyphenated.
test("every name matches MuseScore's file names", () => {
  assert.strictEqual(NAMES.length, 26);
  assert.deepStrictEqual(NAMES.slice(0, 3).map((n) => n.name), ["normal", "cross", "plus"]);
  for (const entry of NAMES) {
    if (entry.key === "HEAD_BREVIS_ALT") continue;
    assert.strictEqual(entry.name, entry.key.slice(5).toLowerCase().replace(/_/g, "-"));
  }
  assert.ok(NAMES.some((n) => n.name === "triangle-up"));
  assert.ok(NAMES.some((n) => n.name === "heavy-cross-hat"));
});
