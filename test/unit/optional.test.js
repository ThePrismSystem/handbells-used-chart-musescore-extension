const test = require("node:test");
const assert = require("node:assert");
const { optionalRuns } = require("../../handbells-used-chart/lib/optional.js");
const { bellRange } = require("../../handbells-used-chart/lib/bellrange.js");

// Columns as buildColumns returns them: an array per staff, each column an
// array of entries. Only `pitch` is read.
const col = (...pitches) => pitches.map((pitch) => ({ pitch }));

test("no range means no runs at all", () => {
  const built = { treble: [col(72), col(74)], bass: [col(48)] };
  assert.deepStrictEqual(optionalRuns(built, bellRange(null, null)), []);
});

test("brackets the low columns of the bass staff", () => {
  const built = {
    treble: [col(74)],
    bass: [col(36), col(38), col(60), col(62)],
  };
  assert.deepStrictEqual(optionalRuns(built, bellRange("C4", null)),
    [{ staff: "bass", firstColumn: 0, lastColumn: 1 }]);
});

test("brackets the high columns of the treble staff", () => {
  const built = {
    treble: [col(74), col(76), col(105), col(107)],
    bass: [col(60)],
  };
  assert.deepStrictEqual(optionalRuns(built, bellRange(null, "C7")),
    [{ staff: "treble", firstColumn: 2, lastColumn: 3 }]);
});

test("brackets both staves when both ends are limited", () => {
  const built = {
    treble: [col(74), col(105)],
    bass: [col(36), col(60)],
  };
  assert.deepStrictEqual(optionalRuns(built, bellRange("C4", "C7")), [
    { staff: "treble", firstColumn: 1, lastColumn: 1 },
    { staff: "bass", firstColumn: 0, lastColumn: 0 },
  ]);
});

// The case the published charts actually show. A treble column holds a staff
// bell with its octave stacked above it; the stacked bell is optional and the
// staff bell is not, and the bracket still covers that column.
test("a column counts as optional when any stacked bell in it is", () => {
  const built = { treble: [col(74), col(76, 100)], bass: [] };
  const runs = optionalRuns(built, bellRange(null, "C7"));
  assert.ok(built.treble[1].length > 1, "fixture must stack, or this proves nothing");
  assert.deepStrictEqual(runs, [{ staff: "treble", firstColumn: 1, lastColumn: 1 }]);
});

// Min to max, deliberately. Publishers draw one bracket per end, and a gap in
// the middle of a run is covered rather than splitting the bracket in two.
test("spans from the first optional column to the last, gaps included", () => {
  const built = { treble: [col(100), col(74), col(102)], bass: [] };
  assert.deepStrictEqual(optionalRuns(built, bellRange(null, "C7")),
    [{ staff: "treble", firstColumn: 0, lastColumn: 2 }]);
});

test("an empty staff contributes no run", () => {
  const built = { treble: [], bass: [col(36)] };
  assert.deepStrictEqual(optionalRuns(built, bellRange("C4", null)),
    [{ staff: "bass", firstColumn: 0, lastColumn: 0 }]);
});

test("a range that excludes nothing present produces no runs", () => {
  const built = { treble: [col(74)], bass: [col(60)] };
  assert.deepStrictEqual(optionalRuns(built, bellRange("C2", "C9")), []);
});
