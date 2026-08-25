const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
  fixture, staffRegion, measuresOf, originalStaffCount, planned, chartBody,
} = require("./harness.js");
const { bellName } = require("../../handbells-used-chart/lib/bellname.js");

// Two fixtures, because these invariants fail for different reasons at
// different sizes.
//
// spelling-and-stacking has a genuine enharmonic pair (same sounding pitch,
// two spellings) so the tpc1/tpc2 forcing is load-bearing rather than
// accidentally matching whatever MuseScore would have spelled anyway, and a
// bell at D7 stacked over its D6 counterpart so a real multi-note chord forms.
//
// chart-wider-than-the-metre has both of those and one thing more: 12 bells
// over 10 columns and 6 chimes over 5, where the score itself is in 4/4. That
// is the ordinary shape of a real chart (the spec's reference arrangement
// needs 23 columns and 15), and no other fixture in this repository reaches
// even five. A chart written before its measure had been given its own length
// runs straight off the end of that measure into the piece's own, and only a
// fixture wider than the metre can show it.
const FIXTURES = [
  fixture("spelling-and-stacking.mscx"),
  fixture("chart-wider-than-the-metre.mscx"),
];

function chartText(t, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, file), output);
  return mainScore(output);
}

// The chart measures run across every staff in the score, the piece's own
// included, so a rest in one is padding wherever it sits. `before` is those
// measures; `after` is the piece's own, whose rests are the user's music and
// must be left exactly as they were.
function measuresAroundTheChart(text, file) {
  const staves = (text.match(/<Staff id="\d+">/g) || []).length;
  const sections = planned(file).sections.length;
  const before = [];
  const after = [];
  for (let id = 1; id <= staves; id++) {
    const measures = measuresOf(staffRegion(text, id));
    before.push(...measures.slice(0, sections));
    after.push(...measures.slice(sections));
  }
  return { before, after };
}

function restsIn(measures) {
  return measures.flatMap((m) => m.match(/<Rest>(?:(?!<\/Rest>)[\s\S])*<\/Rest>/g) || []);
}

function invisible(rests) {
  return rests.filter((rest) => rest.includes("<visible>0</visible>")).length;
}

// Counts <Chord> blocks holding more than one <Note>. The single-regex form
// tried first (matching two <Note> tags after one <Chord>) let its lazy gap
// between the two notes cross a "</Chord>" boundary, so it happily matched a
// single-note chord's lone note against the next chord's first note. It only
// looked right on a fixture that never put two single-note chords back to
// back. Splitting into whole chord blocks first removes that trap.
function multiNoteChordCount(text) {
  const chords = text.match(/<Chord>(?:(?!<\/Chord>)[\s\S])*<\/Chord>/g) || [];
  return chords.filter((chord) => (chord.match(/<Note>/g) || []).length > 1).length;
}

// True when two entries anywhere in the plan share a sounding pitch but carry
// different tpc, which is the one situation MuseScore cannot spell without
// the note.tpc1/tpc2 forcing, because addNote alone always picks the same
// spelling for the same pitch in a given context.
function hasEnharmonicPair(sections) {
  const seenTpcs = new Map();
  for (const section of sections) {
    for (const side of [section.treble, section.bass]) {
      for (const column of side) {
        for (const note of column.notes) {
          if (!seenTpcs.has(note.pitch)) seenTpcs.set(note.pitch, new Set());
          seenTpcs.get(note.pitch).add(note.tpc);
        }
      }
    }
  }
  for (const tpcs of seenTpcs.values()) {
    if (tpcs.size > 1) return true;
  }
  return false;
}

function noteCountOf(section) {
  return section.treble.concat(section.bass)
    .reduce((total, column) => total + column.notes.length, 0);
}

for (const FIXTURE of FIXTURES) {
  const named = (what) => `${what} (${path.basename(FIXTURE, ".mscx")})`;

  test(named("every bell the plan calls for is drawn, with its own spelling"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const plan = planned(FIXTURE);
    assert.ok(hasEnharmonicPair(plan.sections),
      "fixture must contain an enharmonic pair, or this test cannot catch a missing tpc1/tpc2 force");

    const text = chartText(t, FIXTURE);

    const wanted = [];
    for (const section of plan.sections) {
      for (const side of [section.treble, section.bass]) {
        for (const column of side) {
          for (const note of column.notes) wanted.push(bellName(note.pitch, note.tpc).name);
        }
      }
    }

    const drawn = [];
    const re = /<pitch>(\d+)<\/pitch>\s*<tpc>(-?\d+)<\/tpc>/g;
    let m;
    while ((m = re.exec(chartBody(text, FIXTURE))) !== null) {
      drawn.push(bellName(Number(m[1]), Number(m[2])).name);
    }
    assert.deepStrictEqual(drawn.slice().sort(), wanted.slice().sort());
  });

  // The chart measure is as long as its own column count and no longer, so a
  // chart drawn before that length was set spills the moment it has more
  // columns than the score's metre allows: cursor.addNote does not stop at a
  // measure end, it writes on into the next measure and the one after. Both
  // halves matter: the section's own measure holds all of its bells, and
  // every other measure of its own staves holds none.
  test(named("each chart's noteheads sit in its own chart measure and nowhere else"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const sections = planned(FIXTURE).sections;
    assert.ok(sections.length > 1, "fixture defines more than one chart section");

    const text = chartText(t, FIXTURE);
    const originals = originalStaffCount(FIXTURE);

    sections.forEach((section, i) => {
      assert.ok(noteCountOf(section) > 0, `section ${i + 1} draws at least one bell`);
      let inOwnMeasure = 0;
      for (const staff of [2 * i + 1, 2 * i + 2]) {
        const measures = measuresOf(staffRegion(text, originals + staff));
        assert.ok(measures.length > sections.length,
          "fixture has at least one piece measure after the charts");
        measures.forEach((measure, m) => {
          const notes = (measure.match(/<Note>/g) || []).length;
          if (m === i) inOwnMeasure += notes;
          else {
            assert.strictEqual(notes, 0,
              `staff ${originals + staff} measure ${m + 1} holds no chart ${i + 1} notehead`);
          }
        });
      }
      assert.strictEqual(inOwnMeasure, noteCountOf(section),
        `chart measure ${i + 1} holds every bell of section ${i + 1}`);
    });
  });

  // The two staves of a chart end at different columns by design, so the
  // shorter one is padded out to the measure's length with rests that a reader
  // has no use for. The command-line tool marks its own invisible and the
  // extension has to as well, or a quarter rest prints beside the noteheads.
  test(named("the rests that pad the chart measures do not print"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const { before, after } = measuresAroundTheChart(chartText(t, FIXTURE), FIXTURE);

    const padding = restsIn(before);
    assert.ok(padding.length > 0,
      "the chart measures must hold padding rests, or this test proves nothing");
    assert.strictEqual(invisible(padding), padding.length,
      "every rest in a chart measure is invisible");

    const theirs = restsIn(after);
    assert.ok(theirs.length > 0,
      "the piece must have rests of its own, or the half below proves nothing");
    assert.strictEqual(invisible(theirs), 0,
      "the piece's own rests are left visible");
  });

  test(named("stacked octaves share one chord"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const stacked = planned(FIXTURE).sections
      .flatMap((section) => section.treble.concat(section.bass))
      .filter((column) => column.notes.length > 1).length;
    assert.ok(stacked > 0,
      "fixture must contain a stacked column, or this test cannot catch a missing addNote(pitch, true)");

    const body = chartBody(chartText(t, FIXTURE), FIXTURE);
    assert.strictEqual(multiNoteChordCount(body), stacked);
  });

  test(named("chart noteheads carry no stems"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const body = chartBody(chartText(t, FIXTURE), FIXTURE);
    const chords = (body.match(/<Chord>/g) || []).length;
    assert.ok(chords > 0, "the chart has chords");
    assert.strictEqual((body.match(/<noStem>1<\/noStem>/g) || []).length, chords);
  });

  test(named("chimes are diamonds and bells are not"), (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const chimeNotes = planned(FIXTURE).sections
      .filter((section) => section.kind === "chimes")
      .flatMap((section) => section.treble.concat(section.bass))
      .flatMap((column) => column.notes).length;
    assert.ok(chimeNotes > 0,
      "fixture must contain chimes, or this test degenerates to 0 === 0");
    const body = chartBody(chartText(t, FIXTURE), FIXTURE);
    assert.strictEqual((body.match(/<head>diamond<\/head>/g) || []).length, chimeNotes);
  });
}

// --- accidentals -------------------------------------------------------------

// MuseScore works an accidental out from the running state of the measure a
// note sits in, so a plain E printed after an E flat earlier in the same chart
// comes out with a natural sign beside it. On a chart that reads as a second,
// separate bell rather than as the same one, so the chart hides every natural
// it is given. tools/writer.js writes its own naturals invisible, and the two
// front ends have to draw the same chart from the same score.
const NATURALS = fixture("naturals-beside-accidentals.mscx");

const SUBTYPE_FOR_ALTER = {
  "-2": "accidentalDoubleFlat",
  "-1": "accidentalFlat",
  "1": "accidentalSharp",
  "2": "accidentalDoubleSharp",
};

// Bells whose letter and octave also appear altered somewhere in the same
// chart. These are the ones MuseScore prints a natural beside when left to it,
// and a fixture without any cannot catch a chart that prints them.
function shadowedNaturals(sections) {
  let found = 0;
  for (const section of sections) {
    for (const side of [section.treble, section.bass]) {
      const bells = side.flatMap((column) => column.notes)
        .map((note) => bellName(note.pitch, note.tpc));
      for (const bell of bells) {
        if (bell.alter !== 0) continue;
        if (bells.some((other) => other.alter !== 0 && other.diatonic === bell.diatonic)) found++;
      }
    }
  }
  return found;
}

function accidentalOf(note) {
  const found = /<Accidental>[\s\S]*?<\/Accidental>/.exec(note);
  return found ? found[0] : null;
}

test("no natural is ever printed on a chart", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const plan = planned(NATURALS);
  const shadowed = shadowedNaturals(plan.sections);
  assert.ok(shadowed > 0,
    "fixture must spell one letter both altered and plain, or MuseScore prints "
    + "no natural here and this test proves nothing");

  const body = chartBody(chartText(t, NATURALS), NATURALS);
  const notes = body.match(/<Note>[\s\S]*?<\/Note>/g) || [];
  const drawn = plan.sections.flatMap((section) => section.treble.concat(section.bass))
    .flatMap((column) => column.notes);
  assert.strictEqual(notes.length, drawn.length, "every bell of the plan was drawn");

  let hidden = 0;
  for (const note of notes) {
    const bell = bellName(Number(/<pitch>(\d+)<\/pitch>/.exec(note)[1]),
                          Number(/<tpc>(-?\d+)<\/tpc>/.exec(note)[1]));
    const accidental = accidentalOf(note);
    if (bell.alter !== 0) continue;
    // A natural MuseScore never worked out is nothing to hide: what must not
    // happen is one that prints.
    if (!accidental) continue;
    assert.match(accidental, /<visible>0<\/visible>/,
      `the natural on ${bell.name} prints`);
    hidden++;
  }
  // Without this the loop above is satisfied by a chart carrying no naturals at
  // all, which is also what a run that drew nothing looks like.
  assert.strictEqual(hidden, shadowed,
    "every natural the fixture puts beside an accidental was drawn and hidden");
});

// The other half. A pass that hid every accidental in the chart, rather than
// the naturals alone, satisfies the test above and takes the spelling with it,
// and the spelling is what a ringer reads the chart for.
test("every altered bell still shows its own accidental", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const plan = planned(NATURALS);
  const body = chartBody(chartText(t, NATURALS), NATURALS);
  const notes = body.match(/<Note>[\s\S]*?<\/Note>/g) || [];

  let checked = 0;
  for (const note of notes) {
    const bell = bellName(Number(/<pitch>(\d+)<\/pitch>/.exec(note)[1]),
                          Number(/<tpc>(-?\d+)<\/tpc>/.exec(note)[1]));
    if (bell.alter === 0) continue;
    const accidental = accidentalOf(note);
    assert.ok(accidental, `${bell.name} carries an accidental`);
    assert.match(accidental, new RegExp(`<subtype>${SUBTYPE_FOR_ALTER[String(bell.alter)]}</subtype>`),
      `${bell.name} carries the accidental its spelling calls for`);
    assert.doesNotMatch(accidental, /<visible>0<\/visible>/,
      `the accidental on ${bell.name} prints`);
    checked++;
  }
  // Double flat through sharp, so the fixture reaches past the one alteration
  // that a natural could be confused with.
  const altered = plan.sections.flatMap((section) => section.treble.concat(section.bass))
    .flatMap((column) => column.notes)
    .filter((note) => bellName(note.pitch, note.tpc).alter !== 0).length;
  assert.strictEqual(checked, altered, "every altered bell of the plan was checked");
  assert.ok(altered >= 4, "the fixture spells enough altered bells to be worth checking");
});
