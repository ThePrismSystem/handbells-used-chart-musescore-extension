const test = require("node:test");
const assert = require("node:assert");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");

const bell = (pitch, tpc) => ({ pitch, tpc, head: "normal" });
const chime = (pitch, tpc) => ({ pitch, tpc, head: "diamond" });

test("counts distinct pitches, not distinct spellings", () => {
  // G#5 and Ab5 are one physical bell shown twice.
  const plan = buildPlan([bell(80, 22), bell(80, 10), bell(72, 14)]);
  assert.strictEqual(plan.sections[0].label, "Handbells Used: 2");
});

test("omits the handchime section when no chimes are used", () => {
  const plan = buildPlan([bell(72, 14)]);
  assert.deepStrictEqual(plan.sections.map((s) => s.kind), ["bells"]);
});

test("emits both sections with their own part ids", () => {
  const plan = buildPlan([bell(72, 14), chime(74, 16)]);
  assert.deepStrictEqual(plan.sections.map((s) => s.kind), ["bells", "chimes"]);
  assert.deepStrictEqual(plan.sections.map((s) => s.partId), ["hand-bells", "hand-chimes"]);
  assert.strictEqual(plan.sections[1].label, "Handchimes Used: 1");
});

test("each section carries its own column count", () => {
  const plan = buildPlan([
    bell(60, 14), bell(62, 16), bell(64, 18),  // C4 D4 E4 -> three bass columns
    chime(74, 16),                             // D5 -> one treble column
  ]);
  assert.strictEqual(plan.sections[0].columns, 3);
  assert.strictEqual(plan.sections[1].columns, 1);
});

test("ticks are sequential from zero and carry the right notehead", () => {
  const plan = buildPlan([chime(74, 16), chime(76, 18)]);
  assert.deepStrictEqual(plan.sections[0].treble, [
    { tick: 0, notes: [{ pitch: 74, tpc: 16, head: "diamond" }] },
    { tick: 1, notes: [{ pitch: 76, tpc: 18, head: "diamond" }] },
  ]);
});

test("custom labels override the defaults", () => {
  const plan = buildPlan([bell(72, 14)], { bellLabel: "5-7 Octaves" });
  assert.strictEqual(plan.sections[0].label, "5-7 Octaves");
});

test("surfaces unknown noteheads and out-of-range bells as warnings", () => {
  const plan = buildPlan([
    bell(72, 14),
    { pitch: 72, tpc: 14, head: "cross" },
    bell(35, 19),
  ]);
  assert.deepStrictEqual(plan.warnings, [
    { type: "unknown-notehead", count: 1 },
    { type: "out-of-range", names: ["B1"] },
  ]);
});

test("an empty score produces no sections and no warnings", () => {
  assert.deepStrictEqual(buildPlan([]), { sections: [], warnings: [] });
});

test("every section carries an optional list, empty by default", () => {
  const plan = buildPlan([bell(72, 14), chime(74, 16)]);
  assert.deepStrictEqual(plan.sections.map((s) => s.optional), [[], []]);
});

test("brackets the bells below the first required bell", () => {
  // C3 lands in bassRow1 and gets its own column at the left of the bass staff;
  // C5 sits on the bass staff after it.
  const plan = buildPlan([bell(48, 14), bell(72, 14)],
    { requiredBellFirst: "C5" });
  const section = plan.sections[0];
  assert.ok(section.bass.length >= 2, "fixture must have two bass columns");
  assert.deepStrictEqual(section.optional,
    [{ staff: "bass", firstColumn: 0, lastColumn: 0 }]);
});

test("the bell range does not touch the chime section", () => {
  const plan = buildPlan([bell(48, 14), chime(48, 14)],
    { requiredBellFirst: "C5" });
  const bells = plan.sections.find((s) => s.kind === "bells");
  const chimes = plan.sections.find((s) => s.kind === "chimes");
  assert.strictEqual(bells.optional.length, 1);
  assert.deepStrictEqual(chimes.optional, [], "chimes take their own range only");
});

test("the chime range brackets only the chime section", () => {
  const plan = buildPlan([bell(48, 14), chime(48, 14)],
    { requiredChimeFirst: "C5" });
  assert.deepStrictEqual(plan.sections.find((s) => s.kind === "bells").optional, []);
  assert.strictEqual(plan.sections.find((s) => s.kind === "chimes").optional.length, 1);
});

test("an unparseable range name refuses the whole run", () => {
  assert.throws(() => buildPlan([bell(72, 14)], { requiredBellFirst: "H6" }),
    /not a bell name/i);
});

test("an inverted range refuses the whole run", () => {
  assert.throws(
    () => buildPlan([bell(72, 14)], { requiredBellFirst: "C8", requiredBellLast: "C5" }),
    /above/i);
});
