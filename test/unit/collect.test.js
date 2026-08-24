const test = require("node:test");
const assert = require("node:assert");
const { collect } = require("../../handbells-used-chart/lib/collect.js");

const C5 = { pitch: 72, tpc: 14, head: "normal" };
const GSHARP5 = { pitch: 80, tpc: 22, head: "normal" };
const AFLAT5 = { pitch: 80, tpc: 10, head: "normal" };

test("separates handbells from handchimes by notehead", () => {
  const out = collect([C5, { pitch: 74, tpc: 16, head: "diamond" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5"]);
  assert.deepStrictEqual(out.chimes.map((b) => b.name), ["D5"]);
});

// tools/extract-notes.js drops these while parsing XML, so the command-line
// tool never presents one. read.js has no equivalent stage and hands
// MuseScore's numbers straight on, which is why the guard has to live here
// rather than in one front end: a tpc outside -1..33 decodes to no letter and
// the bell reaches the chart named "Bundefined4".
test("a note with an undecodable spelling is counted, not charted", () => {
  const out = collect([C5, { pitch: 72, tpc: 99, head: "normal" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5"]);
  assert.strictEqual(out.unreadable, 1);
  assert.strictEqual(out.unknown, 0, "an unreadable spelling is not a bad notehead");
});

test("every unreadable pitch and spelling is refused the same way", () => {
  const bad = [
    { pitch: 72, tpc: -2, head: "normal" },
    { pitch: 72, tpc: 34, head: "normal" },
    { pitch: NaN, tpc: 14, head: "normal" },
    { pitch: 72, tpc: NaN, head: "normal" },
    { pitch: undefined, tpc: 14, head: "normal" },
    { pitch: 72, tpc: "14", head: "normal" },
  ];
  for (const record of bad) {
    const out = collect([record]);
    assert.strictEqual(out.bells.length + out.chimes.length, 0,
      `${JSON.stringify(record)} should not reach the chart`);
    assert.strictEqual(out.unreadable, 1, `${JSON.stringify(record)} should be counted`);
  }
});

// The boundaries themselves are readable and must stay on the chart.
test("the ends of the tpc range are still charted", () => {
  const out = collect([{ pitch: 72, tpc: -1, head: "normal" },
    { pitch: 71, tpc: 33, head: "normal" }]);
  assert.strictEqual(out.unreadable, 0);
  assert.strictEqual(out.bells.length, 2);
});

test("counts repeats without duplicating the bell", () => {
  const out = collect([C5, C5, C5]);
  assert.strictEqual(out.bells.length, 1);
  assert.strictEqual(out.bells[0].count, 3);
});

test("keeps both spellings only when both are used", () => {
  const onlyFlat = collect([AFLAT5, AFLAT5]);
  assert.deepStrictEqual(onlyFlat.bells.map((b) => b.name), ["Ab5"]);

  const both = collect([AFLAT5, GSHARP5]);
  assert.deepStrictEqual(both.bells.map((b) => b.name), ["G#5", "Ab5"]);
});

test("sorts ascending by pitch, then sharp before flat", () => {
  const out = collect([AFLAT5, C5, GSHARP5, { pitch: 74, tpc: 16, head: "normal" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5", "D5", "G#5", "Ab5"]);
});

test("tags each bell with its region", () => {
  const out = collect([C5, { pitch: 98, tpc: 16, head: "normal" }]);
  assert.deepStrictEqual(out.bells.map((b) => b.region), ["bassStaff", "trebleRow1"]);
});

test("counts notes with an unrecognised notehead instead of dropping them", () => {
  const out = collect([C5, { pitch: 72, tpc: 14, head: "cross" }]);
  assert.strictEqual(out.unknown, 1);
  assert.strictEqual(out.bells.length, 1);
});

test("reports out-of-range bells once each", () => {
  const b1 = { pitch: 35, tpc: 19, head: "normal" }; // B1
  const out = collect([b1, b1, C5]);
  assert.deepStrictEqual(out.outOfRange, ["B1"]);
  assert.strictEqual(out.bells.length, 1);
});

test("returns empty sections for an empty score", () => {
  const out = collect([]);
  assert.deepStrictEqual(out, {
    bells: [], chimes: [], smbs: [],
    unknown: 0, unreadable: 0, outOfRange: [], smbOutOfRange: [],
  });
});

// Silver melody bells, the third kind. MuseScore has no notehead called
// "square": the filled square is the shape-note head "La", which is what both
// readers report as "la" and what the chart draws SMBs with.
test("separates silver melody bells from the other two by notehead", () => {
  const out = collect([
    C5,
    { pitch: 74, tpc: 16, head: "diamond" },
    { pitch: 76, tpc: 18, head: "la" },
  ]);
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["C5"]);
  assert.deepStrictEqual(out.chimes.map((b) => b.name), ["D5"]);
  assert.deepStrictEqual(out.smbs.map((b) => b.name), ["E5"]);
});

// A la notehead was an unrecognised one until now, and lib/ treats those as a
// warning rather than a bell. That branch must not still be catching them.
test("a la notehead is no longer an unrecognised one", () => {
  const out = collect([{ pitch: 76, tpc: 18, head: "la" }]);
  assert.strictEqual(out.unknown, 0);
  assert.strictEqual(out.smbs.length, 1);
});

// A set of silver melody bells is C5 to C7 and nothing else exists, so a
// square notehead outside that is a mistake worth naming rather than a bell to
// chart. The wider C2-C9 limit still applies to handbells and handchimes, so
// the two cannot share a warning: the same B4 is a perfectly ordinary handbell.
test("silver melody bells outside C5-C7 are named, not charted", () => {
  const out = collect([
    { pitch: 71, tpc: 19, head: "la" },   // B4, a semitone below the set
    { pitch: 72, tpc: 14, head: "la" },   // C5, the bottom of it
    { pitch: 96, tpc: 14, head: "la" },   // C7, the top
    { pitch: 97, tpc: 21, head: "la" },   // C#7, a semitone above
    { pitch: 71, tpc: 19, head: "normal" },
  ]);
  assert.deepStrictEqual(out.smbs.map((b) => b.name), ["C5", "C7"]);
  assert.deepStrictEqual(out.smbOutOfRange, ["B4", "C#7"]);
  assert.deepStrictEqual(out.outOfRange, [],
    "a handbell at the same pitch is in range and must not be named here");
  assert.deepStrictEqual(out.bells.map((b) => b.name), ["B4"]);
});

test("an out-of-range silver melody bell is named once, however often it appears", () => {
  const out = collect([
    { pitch: 71, tpc: 19, head: "la" },
    { pitch: 71, tpc: 19, head: "la" },
  ]);
  assert.deepStrictEqual(out.smbOutOfRange, ["B4"]);
});
