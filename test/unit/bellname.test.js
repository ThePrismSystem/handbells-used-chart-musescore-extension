const test = require("node:test");
const assert = require("node:assert");
const bn = require("../../handbells-used-chart/lib/bellname.js");

test("decodes tonal pitch class into letter and alteration", () => {
  assert.strictEqual(bn.letterOfTpc(14), "C");
  assert.strictEqual(bn.alterOfTpc(14), 0);
  assert.strictEqual(bn.letterOfTpc(18), "E");
  assert.strictEqual(bn.alterOfTpc(18), 0);
  assert.strictEqual(bn.letterOfTpc(12), "B");
  assert.strictEqual(bn.alterOfTpc(12), -1);
});

test("tpcOf is the inverse of letterOfTpc and alterOfTpc", () => {
  for (let tpc = 6; tpc <= 26; tpc++) {
    assert.strictEqual(bn.tpcOf(bn.letterOfTpc(tpc), bn.alterOfTpc(tpc)), tpc);
  }
});

test("names a natural bell from sounding pitch", () => {
  const bell = bn.bellName(72, 14);
  assert.strictEqual(bell.name, "C5");
  assert.strictEqual(bell.octave, 5);
  assert.strictEqual(bell.diatonic, 35);
});

test("octave follows the written letter, not the sounding pitch", () => {
  // Cb5 sounds as B4 but is a C, so it belongs to octave 5.
  const cFlat = bn.bellName(71, 7);
  assert.strictEqual(cFlat.name, "Cb5");
  assert.strictEqual(cFlat.octave, 5);

  // B#4 sounds as C5 but is a B, so it belongs to octave 4.
  const bSharp = bn.bellName(72, 26);
  assert.strictEqual(bSharp.name, "B#4");
  assert.strictEqual(bSharp.octave, 4);
});

test("assigns each region by written letter and octave", () => {
  const cases = [
    [36, 14, "bassRow2"],    // C2
    [47, 19, "bassRow2"],    // B2
    [48, 14, "bassRow1"],    // C3
    [59, 19, "bassRow1"],    // B3
    [60, 14, "bassStaff"],   // C4
    [72, 14, "bassStaff"],   // C5
    [74, 16, "trebleStaff"], // D5
    [96, 14, "trebleStaff"], // C7
    [98, 16, "trebleRow1"],  // D7
    [108, 14, "trebleRow1"], // C8
    [110, 16, "trebleRow2"], // D8
    [120, 14, "trebleRow2"], // C9
  ];
  for (const [pitch, tpc, region] of cases) {
    const bell = bn.bellName(pitch, tpc);
    assert.strictEqual(bn.regionOf(bell), region, `${bell.name} should be ${region}`);
  }
});

test("splits enharmonics by letter, not by pitch", () => {
  // C#5 and Db5 are the same pitch but land on opposite staves.
  assert.strictEqual(bn.regionOf(bn.bellName(73, 21)), "bassStaff");   // C#5
  assert.strictEqual(bn.regionOf(bn.bellName(73, 9)), "trebleStaff");  // Db5
  // C#7 stays on the treble staff while Db7 moves up a row.
  assert.strictEqual(bn.regionOf(bn.bellName(97, 21)), "trebleStaff"); // C#7
  assert.strictEqual(bn.regionOf(bn.bellName(97, 9)), "trebleRow1");   // Db7
});

test("returns null outside the C2 to C9 handbell range", () => {
  assert.strictEqual(bn.regionOf(bn.bellName(35, 19)), null);  // B1
  assert.strictEqual(bn.regionOf(bn.bellName(122, 16)), null); // D9
});
