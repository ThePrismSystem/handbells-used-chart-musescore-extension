const test = require("node:test");
const assert = require("node:assert");
const { collect } = require("../../handbells-used-chart/lib/collect.js");
const { buildColumns } = require("../../handbells-used-chart/lib/columns.js");

// Helper: build entries the way collect() would, from bell names.
const NAT = { C: 14, D: 16, E: 18, F: 13, G: 15, A: 17, B: 19 };
function bell(name) {
  const letter = name[0];
  const rest = name.slice(1);
  const flat = rest.startsWith("b");
  const sharp = rest.startsWith("#");
  const octave = parseInt(rest.replace(/^[b#]/, ""), 10);
  const tpc = NAT[letter] + (flat ? -7 : sharp ? 7 : 0);
  const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
  const pitch = (octave + 1) * 12 + step + (flat ? -1 : sharp ? 1 : 0);
  return { pitch, tpc, head: "normal" };
}
const cols = (names) => buildColumns(collect(names.map(bell)).bells);
const shape = (columns) => columns.map((c) => c.map((n) => n.name));

test("treble staff bells each get their own column", () => {
  assert.deepStrictEqual(shape(cols(["D5", "E5", "F5"]).treble), [["D5"], ["E5"], ["F5"]]);
});

test("a D7 stacks onto the D6 column, one octave below it", () => {
  const out = cols(["D5", "D6", "D7", "E6"]);
  assert.deepStrictEqual(shape(out.treble), [["D5"], ["D6", "D7"], ["E6"]]);
});

test("a D8 stacks two octaves onto the same column", () => {
  const out = cols(["D6", "D7", "D8"]);
  assert.deepStrictEqual(shape(out.treble), [["D6", "D7", "D8"]]);
});

test("stacking matches spelling, not just pitch", () => {
  // Ab7 anchors to Ab6, not to G#6.
  const out = cols(["G#6", "Ab6", "Ab7"]);
  assert.deepStrictEqual(shape(out.treble), [["G#6"], ["Ab6", "Ab7"]]);
});

test("a high bell with no anchor gets its own column in reading order", () => {
  // F7 has no F6 to sit on, so it takes a column positioned as if F6 existed.
  const out = cols(["E6", "F7", "G6"]);
  assert.deepStrictEqual(shape(out.treble), [["E6"], ["F7"], ["G6"]]);
});

test("low bells form their own columns ahead of the bass staff bells", () => {
  const out = cols(["C3", "D3", "C4", "D4"]);
  assert.deepStrictEqual(shape(out.bass), [["C3"], ["D3"], ["C4"], ["D4"]]);
});

test("a C2 stacks below the C3 sharing its column", () => {
  const out = cols(["C2", "C3", "C4"]);
  assert.deepStrictEqual(shape(out.bass), [["C2", "C3"], ["C4"]]);
});

test("a low bell with no anchor gets its own column in reading order", () => {
  const out = cols(["C2", "D3", "C4"]);
  assert.deepStrictEqual(shape(out.bass), [["C2"], ["D3"], ["C4"]]);
});

test("length is the longer of the two staves", () => {
  const out = cols(["C4", "D4", "E4", "D5"]);
  assert.strictEqual(out.bass.length, 3);
  assert.strictEqual(out.treble.length, 1);
  assert.strictEqual(out.length, 3);
});

test("notes within a column are ordered low to high", () => {
  const out = cols(["D6", "D8", "D7"]);
  assert.deepStrictEqual(shape(out.treble), [["D6", "D7", "D8"]]);
});
