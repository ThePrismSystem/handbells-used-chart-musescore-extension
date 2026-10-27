const test = require("node:test");
const assert = require("node:assert");
const form = require("../../handbells-used-chart/form.js");

const HEADS = { HEAD_NORMAL: 0, HEAD_DIAMOND: 9, HEAD_LA: 18 };

// Enough of MuseScore's score for read.js to walk: parts, staves and a cursor
// that yields each staff's chords in voice 0.
function fakeScore(staffNotes, partOfStaff, parts, tags) {
  const writes = [];
  const staves = partOfStaff.map((p) => ({
    part: parts[p],
    transpose: () => ({ chromatic: 12 }),
    pitchOffset: () => 0,
  }));
  return {
    writes,
    parts,
    staves,
    nstaves: staves.length,
    nmeasures: 1,
    selection: { isRange: false },
    metaTag: (name) => (tags[name] === undefined ? "" : tags[name]),
    setMetaTag: (name, value) => writes.push([name, value]),
    startCmd() {},
    endCmd() {},
    newCursor() {
      const cursor = {
        staffIdx: 0, voice: 0, index: 0, segment: null, element: null, tick: 0,
        rewind() { this.index = 0; this.load(); },
        next() { this.index++; this.load(); },
        load() {
          const chords = this.voice === 0 ? staffNotes[this.staffIdx] : [];
          const chord = chords[this.index];
          this.segment = chord ? {} : null;
          this.element = chord ? { notes: chord } : null;
          this.tick = this.index * 480;
        },
      };
      return cursor;
    },
  };
}

function note(pitch, tpc, headGroup) {
  return { pitch, tpc1: tpc, headGroup };
}

// Two of the score's own parts share a name, and a chart part sits at the end,
// recorded by handbellChartParts the way mutate.js records it.
function scoreWithChart() {
  const parts = [
    { partName: "Handbells", instrumentId: "pitched-percussion.handbells", startTrack: 0 },
    { partName: "Handbells", instrumentId: "pitched-percussion.handbells", startTrack: 4 },
    { partName: "Handbells Used", instrumentId: "pitched-percussion.handbells", startTrack: 8 },
  ];
  return fakeScore(
    [
      [[note(72, 14, 0)], [note(74, 16, 9)]],
      [[note(76, 18, 0)]],
      [[note(60, 14, 18)], [note(62, 16, 18)]],
    ],
    [0, 1, 2],
    parts,
    { handbellChartParts: "1", handbellChartQuiet: "yes" });
}

const { ELEMENT_TYPES } = require("../../handbells-used-chart/engraving.js");
const NAME_OF = Object.fromEntries(Object.entries(ELEMENT_TYPES).map(([k, v]) => [v, k]));

function setup(score, nameOf = NAME_OF) {
  const said = [];
  const engraving = {
    curScore: score, NoteHeadGroup: HEADS, Element: {}, Align: {}, LayoutBreak: {},
    fraction: (n, d) => ({ n, d }),
    newElement: (type) => (nameOf[type] ? { type: nameOf[type] } : null),
  };
  const log = { info: (text) => said.push(text) };
  form.setup({ engraving }, { error: (t, text) => said.push(text) }, log);
  return said;
}

test("lists each instrument once, leaving the chart's own part out", () => {
  setup(scoreWithChart());
  assert.deepStrictEqual(form.facts().parts, ["Handbells"]);
});

test("counts the noteheads in the music and not in the chart", () => {
  setup(scoreWithChart());
  assert.deepStrictEqual(form.facts().heads, [
    { name: "normal", count: 2, color: "" },
    { name: "diamond", count: 1, color: "" },
  ]);
});

test("with no chart recorded, every part is the score's own", () => {
  const score = scoreWithChart();
  score.metaTag = (name) => (name === "handbellChartQuiet" ? "yes" : "");
  setup(score);
  assert.deepStrictEqual(form.facts().parts, ["Handbells", "Handbells Used"]);
  assert.ok(form.facts().heads.some((h) => h.name === "la"));
});

test("reads the settings from the score's fields", () => {
  const score = scoreWithChart();
  const tags = { handbellChartQuiet: "yes", handbellChartSharedStaff: "yes" };
  score.metaTag = (name) => tags[name] || "";
  setup(score);
  assert.strictEqual(form.settings().sharedStaff, true);
  assert.strictEqual(form.settings().mode, "combined");
});

test("a refused choice writes no field and builds nothing", () => {
  const score = scoreWithChart();
  setup(score);
  const result = form.build(Object.assign(form.settings(), { mode: "separat", sharedStaff: true }));
  assert.strictEqual(result.ok, false);
  assert.match(result.summary, /handbellChartMode is "separat"/);
  assert.deepStrictEqual(score.writes, []);
});

test("a refused range writes no field either", () => {
  const score = scoreWithChart();
  setup(score);
  const result = form.build(Object.assign(form.settings(), { requiredBellFirst: "H5" }));
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(score.writes, []);
});

// Refused before the fields are saved and before the old chart is removed.
test("a MuseScore numbering its elements differently writes no field", () => {
  const score = scoreWithChart();
  setup(score, { ...NAME_OF, [ELEMENT_TYPES.SYSTEM_TEXT]: "STAFF_TEXT" });
  const result = form.build(Object.assign(form.settings(), { sharedStaff: true }));
  assert.strictEqual(result.ok, false);
  assert.match(result.summary, /numbers its score elements differently/);
  assert.deepStrictEqual(score.writes, []);
});

test("offers the lists the dialog's dropdowns need", () => {
  const lists = form.lists();
  assert.strictEqual(lists.naturalNotes[0], "C2");
  assert.strictEqual(lists.naturalNotes.length, 50);
  assert.deepStrictEqual(lists.modes, ["combined", "separate"]);
  assert.strictEqual(lists.shapes[0], "match");
});

test("each instrument is ticked unless the skip list names it, in any case", () => {
  assert.deepStrictEqual(form.instruments(["Handbells", "Piano", "Organ"], " piano ,Bells"), [
    { name: "Handbells", charted: true },
    { name: "Piano", charted: false },
    { name: "Organ", charted: true },
  ]);
});

// The skip list matches names without regard to case, so two parts whose
// names differ only in case are one instrument to the dialog as well.
test("parts whose names differ only in case are one instrument", () => {
  const score = scoreWithChart();
  score.parts[1].partName = "HANDBELLS";
  score.metaTag = (name) => (name === "handbellChartQuiet" ? "yes" : "");
  setup(score);
  assert.deepStrictEqual(form.facts().parts, ["Handbells", "Handbells Used"]);
});

test("unticked instruments become the skip list", () => {
  assert.strictEqual(form.skipPartsFor(null, ["Handbells", "Piano", "Organ"], ["Piano", "Organ"]),
    "Piano, Organ");
  assert.strictEqual(form.skipPartsFor("Piano", ["Handbells", "Piano"], []), "");
});

// A name the dialog has no toggle for, such as a part since deleted, is kept:
// the dialog cannot show it, so it must not drop it either.
test("a skip-list name matching no instrument is kept", () => {
  assert.strictEqual(form.skipPartsFor("Celesta, Piano", ["Handbells", "Piano"], ["Piano"]),
    "Celesta, Piano");
});

test("each notehead offers the colour most of its notes carry", () => {
  const score = scoreWithChart();
  const red = (pitch, tpc) => ({ pitch, tpc1: tpc, headGroup: 9, color: "#c00000" });
  score.newCursor = fakeScore([[[note(77, 13, 9)], [red(74, 16)], [red(76, 18)]]], [0],
    score.parts, {}).newCursor;
  score.staves = [score.staves[0]];
  score.nstaves = 1;
  score.metaTag = (name) => (name === "handbellChartQuiet" ? "yes" : "");
  setup(score);
  assert.deepStrictEqual(form.facts().heads, [{ name: "diamond", count: 3, color: "#c00000" }]);
});
