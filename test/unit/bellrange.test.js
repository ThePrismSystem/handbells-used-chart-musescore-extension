const test = require("node:test");
const assert = require("node:assert");
const { parseBellName, bellRange, isOptional } =
  require("../../handbells-used-chart/lib/bellrange.js");
const { bellName } = require("../../handbells-used-chart/lib/bellname.js");

test("parses a plain bell name to its sounding pitch", () => {
  assert.strictEqual(parseBellName("C5").pitch, 72);
  assert.strictEqual(parseBellName("C4").pitch, 60);
  assert.strictEqual(parseBellName("A4").pitch, 69);
});

test("parses every accidental the charts print", () => {
  assert.strictEqual(parseBellName("Ab3").pitch, 56);
  assert.strictEqual(parseBellName("F#7").pitch, 102);
  assert.strictEqual(parseBellName("Bbb2").pitch, 45);
  assert.strictEqual(parseBellName("Cx4").pitch, 62);
});

// The semitone each natural letter sits at. Local to the test because the
// point is to check bellrange.js against bellname.js, not to reuse either
// one's internals as the yardstick.
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// The round trip is the real guarantee: whatever bellName prints, parseBellName
// must read back. Without this the two can drift and a user's typed name stops
// matching the chart's own labels.
test("round-trips every name bellName can print across C2-C9", () => {
  let checked = 0;
  for (let pitch = 36; pitch <= 108; pitch++) {
    for (let tpc = 6; tpc <= 26; tpc++) {
      const bell = bellName(pitch, tpc);
      if (bell.octave < 2 || bell.octave > 9) continue;
      // Only spellings that can actually occur. bellName derives the octave
      // from the pitch and the alteration alone, so an inconsistent pair —
      // tpc 6 spells Fb, which is never pitch 36 — produces a name whose
      // letter contradicts its own pitch, and no inverse can recover it.
      // MuseScore never writes such a pair.
      if ((SEMITONE[bell.letter] + bell.alter + 12) % 12 !== pitch % 12) continue;
      assert.strictEqual(parseBellName(bell.name).pitch, pitch,
        `${bell.name} (pitch ${pitch}, tpc ${tpc}) did not round trip`);
      checked++;
    }
  }
  // Without this the filter above could skip everything and the test would
  // pass having proved nothing.
  assert.ok(checked > 100, `only ${checked} spellings were checked`);
});

test("is case insensitive on the letter only", () => {
  assert.strictEqual(parseBellName("c5").pitch, 72);
  assert.strictEqual(parseBellName(" C5 ").pitch, 72);
});

test("refuses a name that is not a bell", () => {
  for (const bad of ["H6", "C", "5", "Cb", "C5x", "", "C-1", "#C5"]) {
    assert.throws(() => parseBellName(bad), /not a bell name/i, `accepted ${JSON.stringify(bad)}`);
  }
});

test("an unset end means no limit at that end", () => {
  assert.deepStrictEqual(bellRange("", ""), { first: null, last: null });
  assert.deepStrictEqual(bellRange(null, undefined), { first: null, last: null });
  assert.deepStrictEqual(bellRange("C5", null), { first: 72, last: null });
  assert.deepStrictEqual(bellRange(null, "C8"), { first: null, last: 108 });
});

test("refuses a range whose ends are the wrong way round", () => {
  assert.throws(() => bellRange("C8", "C5"), /above/i);
});

test("equal ends are a legal one-bell range", () => {
  assert.deepStrictEqual(bellRange("C5", "C5"), { first: 72, last: 72 });
});

test("marks bells outside the range optional and those inside required", () => {
  const range = bellRange("C5", "C8");
  assert.strictEqual(isOptional(range, 71), true, "B4 is below the range");
  assert.strictEqual(isOptional(range, 72), false, "C5 is the first required bell");
  assert.strictEqual(isOptional(range, 90), false);
  assert.strictEqual(isOptional(range, 108), false, "C8 is the last required bell");
  assert.strictEqual(isOptional(range, 109), true, "C#8 is above the range");
});

test("nothing is optional when neither end is set", () => {
  const range = bellRange(null, null);
  for (const pitch of [36, 72, 108]) assert.strictEqual(isOptional(range, pitch), false);
});

test("one open end leaves that side entirely required", () => {
  const low = bellRange("C5", null);
  assert.strictEqual(isOptional(low, 71), true);
  assert.strictEqual(isOptional(low, 108), false, "no upper limit was set");
});
