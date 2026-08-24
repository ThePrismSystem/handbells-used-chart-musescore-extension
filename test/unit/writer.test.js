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

test("the piece staff measure is nothing but rests, and they are hidden", () => {
  const xml = pieceStaffMeasure(SECTION, {});
  assert.strictEqual((xml.match(/<Rest>/g) || []).length, 2);
  assert.strictEqual((xml.match(/<visible>0<\/visible>/g) || []).length, 2);
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

test("writes naturals invisibly so none is ever printed", () => {
  // Eb5 then E5. A natural beside the plain letter reads as a second, separate
  // bell; the chart shows one notehead per bell and lets the letter speak.
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [{ tick: 0, notes: [{ pitch: 75, tpc: 11, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 76, tpc: 18, head: "normal" }] }],
    bass: [],
  });
  const xml = chartStaffMeasure(section, "treble", {});
  assert.match(xml, /accidentalFlat/);
  // The natural is written so MuseScore does not work one out for itself, and
  // hidden so no reader sees it.
  assert.match(xml, /<subtype>accidentalNatural<\/subtype>\s*<visible>0<\/visible>/);
});

test("pads with rests nobody has to look at", () => {
  const section = Object.assign({}, SECTION, {
    columns: 3, bass: [],
    treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 16, head: "normal" }] }],
  });
  const rests = chartStaffMeasure(section, "treble", {}).match(/<Rest>[\s\S]*?<\/Rest>/g) || [];
  assert.strictEqual(rests.length, 2);
  for (const rest of rests) assert.match(rest, /<visible>0<\/visible>/);
});

test("writes the accidental on every altered bell", () => {
  // Both spellings of one pitch sit side by side in a chart, and each needs
  // its own sign for a ringer to tell them apart.
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [{ tick: 0, notes: [{ pitch: 80, tpc: 22, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 80, tpc: 10, head: "normal" }] }],
    bass: [],
  });
  const xml = chartStaffMeasure(section, "treble", {});
  assert.strictEqual((xml.match(/accidentalSharp/g) || []).length, 1);
  assert.strictEqual((xml.match(/accidentalFlat/g) || []).length, 1);
});

test("writes a double accidental in full", () => {
  const section = Object.assign({}, SECTION, {
    columns: 1, bass: [],
    treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 3, head: "normal" }] }],
  });
  assert.match(chartStaffMeasure(section, "treble", {}), /accidentalDoubleFlat/);
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

test("understands shorthand hex and ignores a colour it cannot parse", () => {
  const chimes = Object.assign({}, SECTION, {
    kind: "chimes", columns: 1,
    treble: [{ tick: 0, notes: [{ pitch: 74, tpc: 16, head: "diamond" }] }],
    bass: [],
  });
  assert.match(chartStaffMeasure(chimes, "treble", { chimeColor: "#c00" }),
    /<color r="204" g="0" b="0" a="255"\/>/);
  for (const bad of ["#000", "red", "#12", "", null, undefined]) {
    assert.doesNotMatch(chartStaffMeasure(chimes, "treble", { chimeColor: bad }), /<color/,
      `${bad} should not emit a colour`);
  }
});

test("refuses a column that falls outside the chart or is claimed twice", () => {
  // Dropping the note instead would lose a bell in silence, which is the
  // failure this tool exists to prevent.
  const stray = Object.assign({}, SECTION, {
    columns: 2, bass: [],
    treble: [{ tick: 5, notes: [{ pitch: 74, tpc: 16, head: "normal" }] }],
  });
  assert.throws(() => chartStaffMeasure(stray, "treble", {}), /outside a 2-column chart/);

  const collide = Object.assign({}, SECTION, {
    columns: 2, bass: [],
    treble: [{ tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
             { tick: 1, notes: [{ pitch: 76, tpc: 18, head: "normal" }] }],
  });
  assert.throws(() => chartStaffMeasure(collide, "treble", {}), /claimed by two entries/);
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

test("draws no spanner when nothing is optional", () => {
  const section = Object.assign({}, SECTION, { optional: [] });
  assert.doesNotMatch(chartStaffMeasure(section, "treble", {}), /<Spanner/);
});

test("brackets an optional run on the staff it names", () => {
  const section = Object.assign({}, SECTION, {
    columns: 4,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
      { tick: 2, notes: [{ pitch: 76, tpc: 18, head: "normal" }] },
      { tick: 3, notes: [{ pitch: 77, tpc: 13, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: 1, lastColumn: 3 }],
  });
  const out = chartStaffMeasure(section, "treble", {});
  assert.match(out, /<Spanner type="TextLine">/);
  assert.match(out, /<beginHookType>1<\/beginHookType>/);
  assert.match(out, /<endHookType>1<\/endHookType>/);
  // Two columns of span between column 1 and column 3, each a quarter note.
  assert.match(out, /<next><location><fractions>1\/2<\/fractions><\/location><\/next>/);
  assert.match(out, /<prev><location><fractions>-1\/2<\/fractions><\/location><\/prev>/);
  // A run on the treble staff must not appear in the bass staff's measure.
  assert.doesNotMatch(chartStaffMeasure(section, "bass", {}), /<Spanner/);
});

// The probe finding this guards: a beginText on the TextLine renders the word
// and suppresses the line. The word has to be its own element.
test("the bracket carries no text of its own", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: 0, lastColumn: 1 }],
  });
  const out = chartStaffMeasure(section, "treble", {});
  const spanner = out.slice(out.indexOf("<Spanner"), out.indexOf("</Spanner>"));
  assert.doesNotMatch(spanner, /beginText/);
  assert.match(out, /<text>optional<\/text>/);
  assert.match(out, /<italic>1<\/italic>/);
});

test("places the treble bracket above and the bass bracket below", () => {
  const base = {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [
      { tick: 0, notes: [{ pitch: 48, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 50, tpc: 16, head: "normal" }] },
    ],
  };
  const treble = Object.assign({}, SECTION, base,
    { optional: [{ staff: "treble", firstColumn: 0, lastColumn: 1 }] });
  const bass = Object.assign({}, SECTION, base,
    { optional: [{ staff: "bass", firstColumn: 0, lastColumn: 1 }] });
  assert.match(chartStaffMeasure(treble, "treble", {}), /<placement>above<\/placement>/);
  assert.match(chartStaffMeasure(bass, "bass", {}), /<placement>below<\/placement>/);
});

test("a one-column run still gets a bracket with a zero span", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: 1, lastColumn: 1 }],
  });
  const out = chartStaffMeasure(section, "treble", {});
  assert.match(out, /<fractions>0\/1<\/fractions>/);
});

// The guard against a run that does not fit the chart it belongs to. A bracket
// anchored past the last column writes XML that MuseScore either drops or
// draws in the wrong measure, so the writer refuses rather than emitting it.
test("refuses an optional run that runs off the end of the chart", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: 1, lastColumn: 2 }],
  });
  assert.throws(() => chartStaffMeasure(section, "treble", {}),
    /outside a 2-column chart/);
});

test("refuses an optional run that starts before the chart does", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: -1, lastColumn: 1 }],
  });
  assert.throws(() => chartStaffMeasure(section, "treble", {}), /outside a/);
});

test("refuses an optional run whose ends are the wrong way round", () => {
  const section = Object.assign({}, SECTION, {
    columns: 2,
    treble: [
      { tick: 0, notes: [{ pitch: 72, tpc: 14, head: "normal" }] },
      { tick: 1, notes: [{ pitch: 74, tpc: 16, head: "normal" }] },
    ],
    bass: [],
    optional: [{ staff: "treble", firstColumn: 1, lastColumn: 0 }],
  });
  assert.throws(() => chartStaffMeasure(section, "treble", {}), /outside a/);
});
