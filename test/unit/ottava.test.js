const test = require("node:test");
const assert = require("node:assert");
const xml = require("../../tools/xml.js");
const { byNote } = require("../../tools/ottava.js");

// Builds one staff from measure bodies, so a test says only what it is about.
function staffOf(...measures) {
  const doc = xml.parse(`<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70"><Score>
  <Staff id="1">${measures.map((m) => `<Measure>${m}</Measure>`).join("")}</Staff>
</Score></museScore>`);
  return xml.find(doc, "Staff");
}

const OPEN = (subtype) => `<Spanner type="Ottava">
  <Ottava><subtype>${subtype}</subtype></Ottava>
  <next><location><fractions>1/1</fractions></location></next>
  </Spanner>`;
const CLOSE = `<Spanner type="Ottava">
  <prev><location><fractions>-1/1</fractions></location></prev>
  </Spanner>`;
const chord = (pitch, duration = "whole") =>
  `<Chord><durationType>${duration}</durationType>
    <Note><pitch>${pitch}</pitch><tpc>14</tpc></Note></Chord>`;

// What the map is keyed by, so a reader can look a note up as it walks.
function semitonesByPitch(staff) {
  const map = byNote(staff);
  const out = {};
  for (const note of xml.findAll(staff, "Note")) {
    out[xml.childText(note, "pitch")] = map.get(note) || 0;
  }
  return out;
}

// An 8va line is a reading instruction: the note is drawn an octave below what
// the ringer plays, so the bell it names is an octave above its stored pitch.
// MuseScore keeps that octave out of the note itself. <pitch> is the drawn
// pitch and nothing in the note records the line, so a reader that does not
// resolve the spanner charts the wrong bell.
test("a note under an 8va gains an octave", () => {
  const staff = staffOf(`<voice>${OPEN("8va")}${chord(72)}${CLOSE}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: 12 });
});

test("a note under an 8vb loses an octave", () => {
  const staff = staffOf(`<voice>${OPEN("8vb")}${chord(72)}${CLOSE}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: -12 });
});

// All six MuseScore writes. The numbers are the ones staff.pitchOffset
// reported for each, so the XML reader and the extension move a bell by the
// same amount rather than by two tables that agree until one is edited.
test("every ottava subtype moves by its own interval", () => {
  const moved = (subtype) => {
    const staff = staffOf(`<voice>${OPEN(subtype)}${chord(72)}${CLOSE}</voice>`);
    return semitonesByPitch(staff)[72];
  };
  assert.strictEqual(moved("15ma"), 24);
  assert.strictEqual(moved("15mb"), -24);
  assert.strictEqual(moved("22ma"), 36);
  assert.strictEqual(moved("22mb"), -36);
});

// The span has to end. A reader that moved every note after the opening
// spanner would chart the whole rest of the piece an octave out.
test("a note after the line ends is left where it is", () => {
  const staff = staffOf(
    `<voice>${OPEN("8va")}${chord(72, "half")}${CLOSE}${chord(74, "half")}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: 12, 74: 0 });
});

// An ottava belongs to the staff, not to the voice it was entered in.
// MuseScore moves every voice under the line. Measured: an 8va written in
// voice 1 reads back as a pitchOffset of 12 on voice 2's note at the same
// tick. So a reader that only moved the notes written between the two spanner
// elements would chart the other voice's bells an octave out. Handbell
// writing uses voices heavily, so this is the ordinary case and not a corner.
test("an ottava in one voice moves the other voices under it", () => {
  const staff = staffOf(`
    <voice>${OPEN("8va")}${chord(72, "half")}${CLOSE}${chord(74, "half")}</voice>
    <voice>${chord(60, "half")}${chord(62, "half")}</voice>`);
  // 60 sits under the line and 62 past its end, though neither is anywhere
  // near the spanner elements in the document.
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: 12, 74: 0, 60: 12, 62: 0 });
});

test("a line spanning several measures covers all of them", () => {
  const staff = staffOf(
    `<voice>${OPEN("8va")}${chord(72)}</voice>`,
    `<voice>${chord(74)}</voice>`,
    `<voice>${chord(76)}${CLOSE}</voice>`,
    `<voice>${chord(77)}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff),
    { 72: 12, 74: 12, 76: 12, 77: 0 });
});

// Grace notes take no time of their own. Counting one would push the closing
// spanner later than the line really ends.
//
// The second voice is what makes this bite. Within one voice a mistimed grace
// note moves the notes and the closing spanner together, so the same notes
// come out under the line and the test passes on a reader that counts grace
// notes as a full duration. This was written that way first and proved
// nothing. The other voice is timed independently, so an eighth of drift in
// voice 1 drags voice 2's second note under a line that has already ended.
test("grace notes do not shift where the line ends", () => {
  const grace = `<Chord><durationType>eighth</durationType><acciaccatura/>
    <Note><pitch>61</pitch><tpc>21</tpc></Note></Chord>`;
  const staff = staffOf(`
    <voice>${OPEN("8va")}${grace}${chord(72, "half")}${CLOSE}${chord(74, "half")}</voice>
    <voice>${chord(60, "half")}${chord(62, "half")}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff),
    { 61: 12, 72: 12, 74: 0, 60: 12, 62: 0 });
});

// A dotted note is half as long again, so the line ends three quarters of the
// way through the measure and not halfway. The second voice is what proves it,
// for the reason the grace-note test gives: within one voice a mistimed note
// moves the closing spanner with it and nothing shows.
test("a dot lengthens the note the line covers", () => {
  const dotted = `<Chord><durationType>half</durationType><dots>1</dots>
    <Note><pitch>72</pitch><tpc>14</tpc></Note></Chord>`;
  const staff = staffOf(`
    <voice>${OPEN("8va")}${dotted}${CLOSE}${chord(74, "quarter")}</voice>
    <voice>${chord(60, "quarter")}${chord(62, "quarter")}${chord(64, "quarter")}${chord(65, "quarter")}</voice>`);
  // 64 falls at the half-way point. It is under the line only because the
  // dotted note carried it past.
  assert.deepStrictEqual(semitonesByPitch(staff),
    { 72: 12, 74: 0, 60: 12, 62: 12, 64: 12, 65: 0 });
});

// A triplet's three quarters fill the space of two, so the line ends halfway
// through the measure rather than three quarters of the way through.
test("a tuplet's notes are measured at their played length", () => {
  const triplet = (pitch) => `<Chord><durationType>quarter</durationType>
    <Note><pitch>${pitch}</pitch><tpc>14</tpc></Note></Chord>`;
  const staff = staffOf(`
    <voice>${OPEN("8va")}
      <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet>
      ${triplet(72)}${triplet(74)}${triplet(76)}<endTuplet/>
      ${CLOSE}${chord(77, "half")}</voice>
    <voice>${chord(60, "half")}${chord(62, "half")}</voice>`);
  // 62 sits at the half-way point, just past the end of the line. Counted as
  // three plain quarters the triplet would run to three quarters and drag it
  // under.
  assert.deepStrictEqual(semitonesByPitch(staff),
    { 72: 12, 74: 12, 76: 12, 77: 0, 60: 12, 62: 0 });
});

// MuseScore moves a voice about with <location> rather than padding it with
// rests, so a voice that starts partway through a measure carries no notes
// before its first one. Ignoring the jump puts every note in that voice at the
// front of the measure, where an ottava that has already ended still covers
// them.
test("a voice moved by <location> is placed where the jump puts it", () => {
  const staff = staffOf(`
    <voice>${OPEN("8va")}${chord(72, "half")}${CLOSE}${chord(74, "half")}</voice>
    <voice><location><fractions>1/2</fractions></location>${chord(62, "half")}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: 12, 74: 0, 62: 0 });
});

test("a score with no ottava moves nothing", () => {
  const staff = staffOf(`<voice>${chord(72)}</voice>`);
  assert.strictEqual(byNote(staff).size, 0);
});

// A subtype the table does not know charts the bell where it is drawn. Moving
// it by a guessed amount would be worse than not moving it, because the chart
// would look right and name the wrong bell.
test("an unknown subtype moves nothing", () => {
  const staff = staffOf(`<voice>${OPEN("29na")}${chord(72)}${CLOSE}</voice>`);
  assert.strictEqual(byNote(staff).size, 0);
});

// A line whose closing element is missing runs to the end of the staff, which
// is what the line on the page means. Dropping it would silently chart every
// bell under it at the wrong octave.
test("a line left open runs to the end of the staff", () => {
  const staff = staffOf(`<voice>${OPEN("8va")}${chord(72)}</voice>`,
    `<voice>${chord(74)}</voice>`);
  assert.deepStrictEqual(semitonesByPitch(staff), { 72: 12, 74: 12 });
});
