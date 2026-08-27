const test = require("node:test");
const assert = require("node:assert");
const { buildPlan, readRanges } = require("../../handbells-used-chart/lib/plan.js");

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
  assert.deepStrictEqual(plan.parts.map((p) => p.partId), ["hand-bells", "hand-chimes"]);
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
  assert.deepStrictEqual(buildPlan([]), { parts: [], sections: [], warnings: [] });
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

// Both ranges are parsed whatever the score contains. Parsing one only when its
// own section exists means a mistyped chime name on a bells-only score is
// silently ignored, and the range the user set does nothing with no explanation.
test("a bad chime name is refused even on a score with no chimes", () => {
  assert.throws(() => buildPlan([bell(72, 14)], { requiredChimeFirst: "H6" }),
    /not a chime name/i);
});

test("a bad bell name is refused even on a score with no bells", () => {
  assert.throws(() => buildPlan([chime(72, 14)], { requiredBellFirst: "H6" }),
    /not a bell name/i);
});

// The noun in the message, so a user reading it knows which of the four fields
// to go and correct.
test("names the kind of range whose name was refused", () => {
  assert.throws(() => buildPlan([bell(72, 14)], { requiredChimeLast: "H6" }),
    /not a chime name/i);
  assert.throws(
    () => buildPlan([chime(72, 14)],
      { requiredChimeFirst: "C8", requiredChimeLast: "C5" }),
    /first required chime/i);
});

test("readRanges parses both ranges without needing a score", () => {
  assert.deepStrictEqual(
    readRanges({ requiredBellFirst: "C5", requiredChimeLast: "C7" }),
    { bells: { first: 72, last: null }, chimes: { first: null, last: 96 } });
  assert.throws(() => readRanges({ requiredBellFirst: "H6" }), /not a bell name/i);
});

const smb = (pitch, tpc) => ({ pitch, tpc, head: "la" });

test("emits a silver melody bell section of its own, after the other two", () => {
  const plan = buildPlan([bell(72, 14), chime(74, 16), smb(76, 18)]);
  assert.deepStrictEqual(plan.sections.map((s) => s.kind), ["bells", "chimes", "smbs"]);
  assert.strictEqual(plan.sections[2].label, "SMBs Used: 1");
});

// Every silver melody bell is on the treble staff, whatever its pitch. The
// regions the other two kinds use would put C5 on the bass staff, leaving the
// lower half of a grand staff carrying that one note.
test("silver melody bells all go on the treble staff", () => {
  const plan = buildPlan([smb(72, 14), smb(84, 14), smb(96, 14)]);
  const section = plan.sections[0];
  assert.strictEqual(section.columns, 3, "C5, C6 and C7 are three columns");
  assert.deepStrictEqual(section.bass, [], "nothing is written on the bass staff");
  assert.deepStrictEqual(section.treble.map((c) => c.notes.map((n) => n.pitch)),
    [[72], [84], [96]]);
});

// Handbells stack an octave apart into one column, because a five-octave set
// spread over single columns would not fit the page. Two octaves do fit, and a
// ringer reading an SMB chart wants each bell at its own position.
test("silver melody bells an octave apart do not share a column", () => {
  const plan = buildPlan([smb(72, 14), smb(84, 14)]);
  assert.strictEqual(plan.sections[0].columns, 2);
});

test("silver melody bells carry the la notehead", () => {
  const plan = buildPlan([smb(76, 18)]);
  assert.deepStrictEqual(plan.sections[0].treble, [
    { tick: 0, notes: [{ pitch: 76, tpc: 18, head: "la" }] },
  ]);
});

// A set of silver melody bells is usually the last thing a group buys, so a
// piece that uses them normally says they can be left out. That is a fact
// about the whole set rather than about particular bells, so it marks the
// label rather than bracketing columns the way a bell range does.
test("the optional setting marks the label, not the columns", () => {
  const plan = buildPlan([smb(72, 14), smb(76, 18)], { smbsOptional: true });
  assert.strictEqual(plan.sections[0].label, "SMBs Used: 2 (optional)");
  assert.deepStrictEqual(plan.sections[0].optional, [],
    "the whole section is optional, so no column is singled out");
});

test("the optional setting reaches no other section's label", () => {
  const plan = buildPlan([bell(72, 14), chime(74, 16), smb(76, 18)],
    { smbsOptional: true });
  assert.deepStrictEqual(plan.sections.map((s) => s.label),
    ["Handbells Used: 1", "Handchimes Used: 1", "SMBs Used: 1 (optional)"]);
});

test("a custom silver melody bell label replaces the whole generated one", () => {
  const plan = buildPlan([smb(72, 14)],
    { smbLabel: "Silver Melody Bells", smbsOptional: true });
  assert.strictEqual(plan.sections[0].label, "Silver Melody Bells");
});

test("silver melody bells outside C5-C7 are reported as their own warning", () => {
  const plan = buildPlan([smb(71, 19), bell(71, 19)]);
  assert.deepStrictEqual(plan.warnings,
    [{ type: "smb-out-of-range", names: ["B4"] }]);
  assert.deepStrictEqual(plan.sections.map((s) => s.kind), ["bells"],
    "the handbell at the same pitch is in range and is still charted");
});

test("a skip-parts name matching no part is reported as its own warning", () => {
  const plan = buildPlan(
    [{ pitch: 72, tpc: 14, head: "normal", partName: "Handbells" }],
    { skipParts: "Piano" });
  assert.deepStrictEqual(plan.warnings,
    [{ type: "skipped-part-not-found", names: ["Piano"] }]);
  assert.deepStrictEqual(plan.sections.map((s) => s.kind), ["bells"],
    "a name matching no part must not cost the chart its bells");
});

// partId and staves describe the instrument a chart is appended on, never the
// chart itself, and shared-staff mode puts several charts on one instrument.
// Keeping them on the section forces one section to mean a chart, an appended
// instrument and a measure all at once, and only two of those stay in step.
test("the plan lists its appended instruments apart from its sections", () => {
  const plan = buildPlan([
    { pitch: 72, tpc: 14, head: "normal", staffId: "1" },
    { pitch: 74, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 76, tpc: 18, head: "la", staffId: "1" },
  ], {});

  assert.strictEqual(plan.sections.length, 3, "bells, chimes and SMBs all planned");
  assert.deepStrictEqual(plan.parts, [
    { partId: "hand-bells", staves: 2 },
    { partId: "hand-chimes", staves: 2 },
    { partId: "hand-bells", staves: 1 },
  ]);
  assert.deepStrictEqual(plan.sections.map((s) => s.part), [0, 1, 2],
    "separate mode gives each section an instrument of its own");

  for (const section of plan.sections) {
    assert.strictEqual(section.partId, undefined, "partId moved to the part");
    assert.strictEqual(section.staves, undefined, "staves moved to the part");
  }
});
