const test = require("node:test");
const assert = require("node:assert");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { readOptions, changedTags } = require("../../handbells-used-chart/lib/options.js");

// Bells by sounding name. A bell's name is the pitch it sounds, an octave
// above where it is written, so C5 is the bell written at middle C.
const PITCH = { G3: 55, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72,
  D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83, C6: 84 };
const TPC = { C: 14, D: 16, E: 18, F: 13, G: 15, A: 17, B: 19 };
const bell = (name, head = "normal") => ({ pitch: PITCH[name], tpc: TPC[name[0]], head, staffId: "1" });
const bells = (...names) => names.map((name) => bell(name));
const chimes = (...names) => names.map((name) => bell(name, "diamond"));

const SINGLE = { singleStaff: true };
const pitchesOn = (section, staff) => section[staff].flatMap((column) => column.notes.map((n) => n.pitch));

test("moves a lone C5 up and charts on the treble staff alone", () => {
  const plan = buildPlan(bells("C5", "D5", "E5", "F5", "G5"), SINGLE);
  assert.deepStrictEqual(plan.parts, [{ partId: "hand-bells", sides: ["treble"], name: "Handbells Used" }]);
  const [section] = plan.sections;
  assert.deepStrictEqual(pitchesOn(section, "treble"), [72, 74, 76, 77, 79], "C5 leads the treble staff");
  assert.deepStrictEqual(section.bass, []);
  assert.strictEqual(section.columns, 5);
});

// G5 on the treble side keeps the treble bells from moving down in the tests
// below, so the bass side is the only one that could move.
test("moves up as many as three bells close to the split", () => {
  const plan = buildPlan(bells("G4", "A4", "C5", "D5", "E5", "G5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble"]);
  assert.deepStrictEqual(pitchesOn(plan.sections[0], "treble"), [67, 69, 72, 74, 76, 79]);
});

test("keeps both staves when four bells would have to move", () => {
  const plan = buildPlan(bells("G4", "A4", "B4", "C5", "D5", "E5", "G5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble", "bass"]);
  assert.deepStrictEqual(pitchesOn(plan.sections[0], "bass"), [67, 69, 71, 72]);
});

test("keeps both staves when a bell is too far below the split", () => {
  // G3 is written at the bottom of the bass staff, nowhere near the treble.
  const plan = buildPlan(bells("G3", "C5", "D5", "E5", "G5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble", "bass"]);
  assert.deepStrictEqual(pitchesOn(plan.sections[0], "bass"), [55, 72]);
});

test("moves a few bells close above the split down to the bass staff", () => {
  const plan = buildPlan(bells("C4", "D4", "E4", "F4", "D5", "E5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["bass"]);
  const [section] = plan.sections;
  assert.deepStrictEqual(pitchesOn(section, "bass"), [60, 62, 64, 65, 74, 76]);
  assert.deepStrictEqual(section.treble, []);
});

test("keeps both staves when a treble bell is too far above the split", () => {
  const plan = buildPlan(bells("C4", "D4", "E4", "F4", "D5", "G5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble", "bass"]);
});

test("when either side could move, the side with fewer bells does", () => {
  // One bass bell against two treble ones: C5 goes up.
  assert.deepStrictEqual(buildPlan(bells("C5", "D5", "E5"), SINGLE).parts[0].sides, ["treble"]);
  // Three bass bells against one treble one: D5 comes down.
  assert.deepStrictEqual(buildPlan(bells("A4", "B4", "C5", "D5"), SINGLE).parts[0].sides, ["bass"]);
});

test("a tie moves the bass bells up, since treble-only charts are the usual kind", () => {
  const plan = buildPlan(bells("B4", "C5", "D5", "E5"), SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble"]);
});

test("a chart with nothing on one side keeps only the other staff", () => {
  assert.deepStrictEqual(buildPlan(bells("D5", "E5"), SINGLE).parts[0].sides, ["treble"]);
  assert.deepStrictEqual(buildPlan(bells("C4", "D4"), SINGLE).parts[0].sides, ["bass"]);
});

test("without the option every chart keeps both staves", () => {
  const plan = buildPlan(bells("C5", "D5", "E5"), {});
  assert.deepStrictEqual(plan.parts[0].sides, ["treble", "bass"]);
  assert.deepStrictEqual(pitchesOn(plan.sections[0], "bass"), [72]);
});

test("each kind is judged on its own bells", () => {
  const plan = buildPlan(bells("C5", "D5", "E5").concat(chimes("G3", "C5", "D5", "G5")), SINGLE);
  assert.deepStrictEqual(plan.parts.map((p) => p.sides), [["treble"], ["treble", "bass"]]);
});

test("a shared staff takes every side its charts use", () => {
  // The handbells move up and the handchimes move down, so the one staff
  // they share needs both halves.
  const records = bells("C5", "D5", "E5").concat(chimes("C4", "D4", "E4", "D5"));
  const plan = buildPlan(records, { singleStaff: true, sharedStaff: true });
  assert.deepStrictEqual(plan.parts, [{ partId: "hand-bells", sides: ["treble", "bass"], name: "Handbells Used" }]);
  assert.deepStrictEqual(plan.sections[0].bass, [], "the handbells still write nothing below");
  assert.deepStrictEqual(plan.sections[1].treble, [], "and the handchimes nothing above");

  const treble = buildPlan(bells("C5", "D5").concat(chimes("D5", "E5")), { singleStaff: true, sharedStaff: true });
  assert.deepStrictEqual(treble.parts[0].sides, ["treble"], "two treble-only charts share a treble staff");
});

test("silver melody bells stay on their treble staff", () => {
  const plan = buildPlan([bell("C5", "la"), bell("D5", "la")], SINGLE);
  assert.deepStrictEqual(plan.parts[0].sides, ["treble"]);
});

test("the setting is stored in the score as handbellChartSingleStaff", () => {
  const options = readOptions((tag) => (tag === "handbellChartSingleStaff" ? "yes" : ""));
  assert.strictEqual(options.singleStaff, true);
  assert.strictEqual(readOptions(() => "").singleStaff, false, "off unless asked for");
  assert.deepStrictEqual(changedTags(Object.assign(readOptions(() => ""), { singleStaff: true }), () => ""),
    [{ tag: "handbellChartSingleStaff", value: "yes" }]);
});
