const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { bellName } = require("../../handbells-used-chart/lib/bellname.js");

// A fixture built specifically to exercise the two invariants this file gates:
// a genuine enharmonic pair (same sounding pitch, two spellings) so the tpc1/
// tpc2 forcing is load-bearing rather than accidentally matching whatever
// MuseScore would have spelled anyway, and a bell at D7 stacked over its D6
// counterpart so a real multi-note chord forms. two-staff-handbells.mscx (used
// by Tasks 1-3's tests) has neither case, which is why this file gets its own.
const FIXTURE = path.join(__dirname, "..", "fixtures", "spelling-and-stacking.mscx");

function chartText(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  return mainScore(output);
}

function planned() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {});
}

// The chart staves are the ones appended after the piece's own.
function chartBody(text) {
  const originals = (fs.readFileSync(FIXTURE, "utf8").match(/<Staff id="\d+">/g) || []).length;
  return text.slice(text.indexOf(`<Staff id="${originals + 1}">`));
}

// Counts <Chord> blocks holding more than one <Note>. The single-regex form
// tried first (matching two <Note> tags after one <Chord>) let its lazy gap
// between the two notes cross a "</Chord>" boundary, so it happily matched a
// single-note chord's lone note against the next chord's first note — it only
// looked right on a fixture that never put two single-note chords back to
// back. Splitting into whole chord blocks first removes that trap.
function multiNoteChordCount(text) {
  const chords = text.match(/<Chord>(?:(?!<\/Chord>)[\s\S])*<\/Chord>/g) || [];
  return chords.filter((chord) => (chord.match(/<Note>/g) || []).length > 1).length;
}

// True when two entries anywhere in the plan share a sounding pitch but carry
// different tpc — the one situation MuseScore cannot spell correctly without
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

test("every bell the plan calls for is drawn, with its own spelling", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const plan = planned();
  assert.ok(hasEnharmonicPair(plan.sections),
    "fixture must contain an enharmonic pair, or this test cannot catch a missing tpc1/tpc2 force");

  const text = chartText(t);

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
  while ((m = re.exec(chartBody(text))) !== null) {
    drawn.push(bellName(Number(m[1]), Number(m[2])).name);
  }
  assert.deepStrictEqual(drawn.slice().sort(), wanted.slice().sort());
});

test("stacked octaves share one chord", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const stacked = planned().sections
    .flatMap((section) => section.treble.concat(section.bass))
    .filter((column) => column.notes.length > 1).length;
  assert.ok(stacked > 0,
    "fixture must contain a stacked column, or this test cannot catch a missing addNote(pitch, true)");

  const body = chartBody(chartText(t));
  assert.strictEqual(multiNoteChordCount(body), stacked);
});

test("chart noteheads carry no stems", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const body = chartBody(chartText(t));
  const chords = (body.match(/<Chord>/g) || []).length;
  assert.ok(chords > 0, "the chart has chords");
  assert.strictEqual((body.match(/<noStem>1<\/noStem>/g) || []).length, chords);
});

test("chimes are diamonds and bells are not", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const chimeNotes = planned().sections
    .filter((section) => section.kind === "chimes")
    .flatMap((section) => section.treble.concat(section.bass))
    .flatMap((column) => column.notes).length;
  assert.strictEqual((chartBody(chartText(t)).match(/<head>diamond<\/head>/g) || []).length, chimeNotes);
});
