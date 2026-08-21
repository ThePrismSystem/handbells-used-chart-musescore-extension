const test = require("node:test");
const assert = require("node:assert");
const {
  chartStaffMeasure, pieceStaffMeasure, emptyMeasure, chartPart,
} = require("../../tools/writer.js");

const SECTION = {
  kind: "bells",
  partId: "hand-bells",
  label: "Handbells Used: 3",
  columns: 2,
  treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 16, head: "normal" },
                              { pitch: 98, tpc: 16, head: "normal" }] }],
  bass: [{ tick: 0, notes: [{ pitch: 60, tpc: 14, head: "normal" }] },
         { tick: 1, notes: [{ pitch: 62, tpc: 16, head: "normal" }] }],
};

test("declares the measure length from the section's column count", () => {
  assert.match(chartStaffMeasure(SECTION, "treble", {}), /<Measure len="2\/4">/);
  assert.match(pieceStaffMeasure(SECTION, {}), /<Measure len="2\/4">/);
});

test("stemless goes on chart staves only, irregular on the piece staff only", () => {
  const chart = chartStaffMeasure(SECTION, "treble", {});
  assert.match(chart, /<stemless>1<\/stemless>/);
  assert.doesNotMatch(chart, /<irregular>/);

  const piece = pieceStaffMeasure(SECTION, { irregular: true });
  assert.match(piece, /<irregular>1<\/irregular>/);
  assert.doesNotMatch(piece, /<stemless>/);

  assert.doesNotMatch(pieceStaffMeasure(SECTION, {}), /<irregular>/);
});

test("writes one chord per column holding every note of that column", () => {
  const xml = chartStaffMeasure(SECTION, "treble", {});
  assert.strictEqual((xml.match(/<Chord>/g) || []).length, 1);
  assert.match(xml, /<pitch>74<\/pitch>\s*<tpc>16<\/tpc>/);
  assert.match(xml, /<pitch>98<\/pitch>\s*<tpc>16<\/tpc>/);
});

test("pads a short staff with quarter rests so the measure fills", () => {
  assert.strictEqual((chartStaffMeasure(SECTION, "treble", {}).match(/<Rest>/g) || []).length, 1);
  assert.strictEqual((chartStaffMeasure(SECTION, "bass", {}).match(/<Rest>/g) || []).length, 0);
});

test("the piece staff measure is nothing but rests", () => {
  const xml = pieceStaffMeasure(SECTION, {});
  assert.strictEqual((xml.match(/<Rest>/g) || []).length, 2);
  assert.doesNotMatch(xml, /<Chord>/);
});

test("both measure emitters open with a C key signature", () => {
  // The chart measures come before the piece's own first measure, so without
  // this the piece's key signature would be in force across the chart.
  const key = /<KeySig>\s*<concertKey>0<\/concertKey>\s*<\/KeySig>/;
  assert.match(chartStaffMeasure(SECTION, "treble", {}), key);
  assert.match(pieceStaffMeasure(SECTION, {}), key);
});

test("the label rides on the piece staff as SystemText, never on a chart staff", () => {
  assert.match(pieceStaffMeasure(SECTION, { label: SECTION.label }), /<SystemText>/);
  assert.match(pieceStaffMeasure(SECTION, { label: SECTION.label }), /Handbells Used: 3/);
  assert.doesNotMatch(chartStaffMeasure(SECTION, "treble", {}), /Handbells Used: 3/);
  assert.doesNotMatch(pieceStaffMeasure(SECTION, {}), /<SystemText>/);
});

test("a section break is emitted only when asked for", () => {
  assert.match(pieceStaffMeasure(SECTION, { sectionBreak: true }), /<subtype>section<\/subtype>/);
  assert.doesNotMatch(pieceStaffMeasure(SECTION, {}), /<LayoutBreak>/);
});

test("writes an explicit accidental for an altered note", () => {
  const flat = Object.assign({}, SECTION, {
    columns: 1,
    treble: [{ tick: 0, notes: [{ pitch: 75, tpc: 11, head: "normal" }] }],
    bass: [],
  });
  assert.match(chartStaffMeasure(flat, "treble", {}),
    /<Accidental>\s*<subtype>accidentalFlat<\/subtype>\s*<\/Accidental>/);
});

test("writes a natural when the same letter was altered earlier in the measure", () => {
  // Eb5 then E5. Without an explicit natural, MuseScore keeps the flat in
  // force and the second bell silently becomes another Eb. This is the exact
  // failure that dropped 16 bells from a hand-built chart.
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [{ tick: 0, notes: [{ pitch: 75, tpc: 11, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 76, tpc: 18, head: "normal" }] }],
    bass: [],
  });
  const xml = chartStaffMeasure(section, "treble", {});
  assert.match(xml, /accidentalFlat/);
  assert.match(xml, /accidentalNatural/);
});

test("does not repeat an accidental already in force for that letter and octave", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [{ tick: 0, notes: [{ pitch: 75, tpc: 11, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 75, tpc: 11, head: "normal" }] }],
    bass: [],
  });
  assert.strictEqual((chartStaffMeasure(section, "treble", {}).match(/accidentalFlat/g) || []).length, 1);
});

test("accidental state is tracked per octave, not per letter", () => {
  // Eb5 then E6: different octave, so E6 needs no natural.
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [{ tick: 0, notes: [{ pitch: 75, tpc: 11, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 88, tpc: 18, head: "normal" }] }],
    bass: [],
  });
  assert.doesNotMatch(chartStaffMeasure(section, "treble", {}), /accidentalNatural/);
});

test("writes diamond noteheads for a handchime section", () => {
  const chimes = Object.assign({}, SECTION, {
    kind: "chimes", columns: 1,
    treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 16, head: "diamond" }] }],
    bass: [],
  });
  assert.match(chartStaffMeasure(chimes, "treble", {}), /<head>diamond<\/head>/);
});

test("colors chime noteheads only when a non-black color is given", () => {
  const chimes = Object.assign({}, SECTION, {
    kind: "chimes", columns: 1,
    treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 16, head: "diamond" }] }],
    bass: [],
  });
  assert.match(chartStaffMeasure(chimes, "treble", { chimeColor: "#c00000" }),
    /<color r="192" g="0" b="0" a="255"\/>/);
  assert.doesNotMatch(chartStaffMeasure(chimes, "treble", { chimeColor: "#000000" }), /<color/);
});

test("an empty measure is a single full-measure rest", () => {
  const xml = emptyMeasure({});
  assert.strictEqual(xml.startsWith("<Measure>"), true);
  assert.match(xml, /<durationType>measure<\/durationType>/);
  assert.match(xml, /<duration>4\/4<\/duration>/);
  assert.doesNotMatch(xml, /<Chord>/);
  assert.doesNotMatch(xml, /<TimeSig>/);
});

test("an empty measure mirrors a metre change and an irregular length", () => {
  const xml = emptyMeasure({ duration: "2/4", len: "2/4", timeSig: "3/4" });
  assert.match(xml, /^<Measure len="2\/4">/);
  assert.match(xml, /<sigN>3<\/sigN>\s*<sigD>4<\/sigD>/);
  assert.match(xml, /<duration>2\/4<\/duration>/);
});

test("emptyMeasure defaults its options", () => {
  assert.strictEqual(emptyMeasure(), emptyMeasure({}));
});

test("both measure emitters declare a time signature only when asked to", () => {
  const chart = chartStaffMeasure(SECTION, "treble", { timeSig: "6/8" });
  assert.match(chart, /<TimeSig>\s*<sigN>6<\/sigN>\s*<sigD>8<\/sigD>\s*<\/TimeSig>/);
  assert.match(pieceStaffMeasure(SECTION, { timeSig: "6/8" }), /<sigN>6<\/sigN>/);

  assert.doesNotMatch(chartStaffMeasure(SECTION, "treble", {}), /<TimeSig>/);
  assert.doesNotMatch(pieceStaffMeasure(SECTION, {}), /<TimeSig>/);
});

test("a chart part carries the marker track name and hides when empty", () => {
  const xml = chartPart("hand-bells", 2, {});
  assert.match(xml, /<trackName>Handbells Used Chart<\/trackName>/);
  assert.match(xml, /<Instrument id="hand-bells">/);
  // hideWhenEmpty sits at part level, once, not per staff
  assert.strictEqual((xml.match(/<hideWhenEmpty>on<\/hideWhenEmpty>/g) || []).length, 1);
});

test("chart part staves are small with barlines and time signatures suppressed", () => {
  const xml = chartPart("hand-bells", 2, {});
  assert.strictEqual((xml.match(/<small>1<\/small>/g) || []).length, 2);
  assert.strictEqual((xml.match(/<barlines>0<\/barlines>/g) || []).length, 2);
  assert.match(xml, /<defaultConcertClef>G8va<\/defaultConcertClef>/);
  assert.match(xml, /<defaultConcertClef>F8va<\/defaultConcertClef>/);
});

test("a chart part carries the id it is given", () => {
  assert.match(chartPart("hand-bells", 2, { partNumber: 4 }), /^<Part id="4">/);
});

test("a chart part declares the whole bell range so nothing is drawn out of range", () => {
  // MuseScore paints notes outside an instrument's range in the out-of-range
  // colour, and hand-bells defaults to a maximum of 97 (C#7). A chart runs to
  // C9 (120), so every bell above C7 would come out red.
  const xml = chartPart("hand-bells", 2, {});
  assert.match(xml, /<minPitchP>36<\/minPitchP>/);
  assert.match(xml, /<maxPitchP>120<\/maxPitchP>/);
  assert.match(xml, /<minPitchA>36<\/minPitchA>/);
  assert.match(xml, /<maxPitchA>120<\/maxPitchA>/);
});

test("a chart part uses the handchimes instrument for a chime chart", () => {
  const xml = chartPart("hand-chimes", 2, {});
  assert.match(xml, /<Instrument id="hand-chimes">/);
  assert.match(xml, /pitched-percussion\.handchimes/);
});
