const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { extractNotes, readMetaTag } = require("../../tools/extract-notes.js");

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx"), "utf8");

test("reads every note across every staff", () => {
  const { records, skipped } = extractNotes(FIXTURE);
  assert.deepStrictEqual(records, [
    { pitch: 72, tpc: 14, head: "normal", staffId: "1" },
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 0);
});

test("defaults a missing head element to a standard notehead", () => {
  const { records } = extractNotes(FIXTURE);
  assert.strictEqual(records[0].head, "normal");
});

test("reports no chart parts for a score without a chart", () => {
  const { chartPartIds } = extractNotes(FIXTURE);
  assert.deepStrictEqual(chartPartIds, []);
});

test("finds chart parts by their marker track name", () => {
  const marked = FIXTURE.replace(
    "<Part id=\"1\">",
    "<Part id=\"9\"><trackName>Handbells Used Chart</trackName></Part><Part id=\"1\">");
  assert.deepStrictEqual(extractNotes(marked).chartPartIds, ["9"]);
});

test("ignores rests", () => {
  const { records } = extractNotes(FIXTURE);
  assert.ok(records.every((r) => typeof r.pitch === "number"));
});

test("skips a note with a missing tpc instead of defaulting to 0", () => {
  const noTpc = FIXTURE.replace(
    "<Note><pitch>72</pitch><tpc>14</tpc></Note>",
    "<Note><pitch>72</pitch></Note>");
  const { records, skipped } = extractNotes(noTpc);
  assert.deepStrictEqual(records, [
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 1);
});

test("skips a note with a non-numeric tpc", () => {
  const badTpc = FIXTURE.replace(
    "<Note><pitch>72</pitch><tpc>14</tpc></Note>",
    "<Note><pitch>72</pitch><tpc>x</tpc></Note>");
  const { records, skipped } = extractNotes(badTpc);
  assert.deepStrictEqual(records, [
    { pitch: 80, tpc: 22, head: "normal", staffId: "1" },
    { pitch: 86, tpc: 16, head: "diamond", staffId: "1" },
    { pitch: 48, tpc: 14, head: "normal", staffId: "2" },
  ]);
  assert.strictEqual(skipped, 1);
});

test("reads a metaTag value", () => {
  const withMeta = FIXTURE.replace("<Score>",
    "<Score><metaTag name=\"handchimesColor\">#c00000</metaTag>");
  assert.strictEqual(readMetaTag(withMeta, "handchimesColor"), "#c00000");
  assert.strictEqual(readMetaTag(FIXTURE, "handchimesColor"), null);
});

test("skips a note whose spelling is outside the tonal pitch class range", () => {
  // tpc 0 decodes to Cbb and is legal; 34 decodes to no letter at all, and the
  // bell would reach the chart named "Bundefined4".
  const mscx = FIXTURE.replace(/<tpc>\d+<\/tpc>/, "<tpc>34</tpc>");
  const out = extractNotes(mscx);
  assert.strictEqual(out.skipped, 1);
  for (const record of out.records) {
    assert.ok(record.tpc >= -1 && record.tpc <= 33, `tpc ${record.tpc} is in range`);
  }
});

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");

test("a handbell part's stored pitches are already its bell names", () => {
  const { records } = extractNotes(fixture("single-measure-handbells.mscx"));
  assert.deepStrictEqual(records.map((r) => r.pitch), [72, 74, 76, 77]);
});

// The piano fixture holds the same written notes as the handbell one, an
// octave lower in stored pitch because a piano does not transpose. Both must
// reach lib/ as the same bells, or the same page charts two different ways.
test("a piano part's pitches are lifted to their bell names", () => {
  const piano = extractNotes(fixture("piano-instrument.mscx"));
  const bells = extractNotes(fixture("single-measure-handbells.mscx"));
  assert.deepStrictEqual(piano.records.map((r) => r.pitch), [72, 74, 76, 77]);
  assert.deepStrictEqual(piano.records.map((r) => r.pitch),
    bells.records.map((r) => r.pitch));
});

test("spelling survives the octave shift", () => {
  const { records } = extractNotes(fixture("piano-instrument.mscx"));
  assert.deepStrictEqual(records.map((r) => r.tpc), [14, 16, 18, 13]);
});

// Parts own staves positionally: a Part's bare <Staff> children are counted in
// document order against the top-level <Staff id="N"> blocks that carry the
// music. Getting this wrong applies one part's offset to another part's notes.
test("each part's offset reaches only its own staves", () => {
  const mixed = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Part id="1">
      <Staff/>
      <trackName>Handbells</trackName>
      <Instrument id="hand-bells"><instrumentId>pitched-percussion.handbells</instrumentId>
        <transposeChromatic>12</transposeChromatic></Instrument>
      </Part>
    <Part id="2">
      <Staff/>
      <trackName>Piano</trackName>
      <Instrument id="piano"><instrumentId>keyboard.piano</instrumentId></Instrument>
      </Part>
    <Staff id="1">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>72</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    <Staff id="2">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    </Score>
  </museScore>`;
  const { records } = extractNotes(mixed);
  assert.strictEqual(records.length, 2, "both staves must be read");
  // Both are the C5 bell: staff 1 stores it at 72 already, staff 2 at 60.
  assert.deepStrictEqual(records.map((r) => r.pitch), [72, 72]);
});

test("a part with two staves claims both of them", () => {
  const { records } = extractNotes(fixture("two-staff-handbells.mscx"));
  // The fixture's one hand-bells part owns both staves, so nothing is lifted.
  assert.deepStrictEqual(records.map((r) => r.pitch).sort((a, b) => a - b),
    [48, 72, 80, 86]);
});

// A part with no <Staff> child still owns one staff. Claiming zero would shift
// every later part's staves onto the wrong instrument, so the fallback in
// transpositionByStaffId is load-bearing — this is the case that proves it.
test("a part with no staff child does not shift the parts after it", () => {
  const staffless = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Part id="1">
      <trackName>Handbells</trackName>
      <Instrument id="hand-bells"><instrumentId>pitched-percussion.handbells</instrumentId>
        <transposeChromatic>12</transposeChromatic></Instrument>
      </Part>
    <Part id="2">
      <Staff/>
      <trackName>Piano</trackName>
      <Instrument id="piano"><instrumentId>keyboard.piano</instrumentId></Instrument>
      </Part>
    <Staff id="1">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>72</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    <Staff id="2">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    </Score>
  </museScore>`;
  const { records } = extractNotes(staffless);
  assert.strictEqual(records.length, 2, "both staves must be read");
  // Both notes are the C5 bell: the handbell staff already stores it at 72,
  // the piano staff at 60. Without the fallback the handbell staff inherits
  // the piano part's offset and comes out at 84.
  assert.deepStrictEqual(records.map((r) => r.pitch), [72, 72]);
});

// MuseScore writes the instrument's id as an attribute, but a file need not
// carry one: an <Instrument> holding only <instrumentId> is what hand-authored
// XML and older files have, and MuseScore resolves the id from it on load — a
// probe reads part.instrumentId back as "hand-bells" for exactly this input.
// The XML reader does no such resolution, so an offset keyed off the attribute
// found nothing, shifted a part that already transposes, and charted the score
// an octave high — while the extension, reading the same score through
// MuseScore, charted it correctly. One score, two charts, which is the
// divergence lib/ exists to prevent.
test("a transposing part with no instrument id attribute is not shifted", () => {
  const noAttribute = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Part id="1">
      <Staff/>
      <trackName>Handbells</trackName>
      <Instrument>
        <instrumentId>pitched-percussion.handbells</instrumentId>
        <transposeChromatic>12</transposeChromatic>
        </Instrument>
      </Part>
    <Staff id="1">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>72</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    </Score>
  </museScore>`;
  const { records } = extractNotes(noAttribute);
  // The C5 bell, already stored at its own name. Shifted, it charts as C6.
  assert.deepStrictEqual(records.map((r) => r.pitch), [72]);
});

// The other half of the same change. A part carrying a handbell instrument id
// but no transposition is what MuseScore's MusicXML importer produces — it
// keeps the id and the 8va clefs and drops the transposition — so its stored
// pitches are written pitches and do need lifting. An offset keyed off the id
// left them alone and charted every bell an octave low.
test("a handbell part that does not transpose is still lifted", () => {
  const imported = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Part id="1">
      <Staff/>
      <trackName>Handbells</trackName>
      <Instrument id="hand-bells">
        <instrumentId>pitched-percussion.handbells</instrumentId>
        </Instrument>
      </Part>
    <Staff id="1">
      <Measure><voice><Chord><durationType>quarter</durationType>
        <Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></voice></Measure>
      </Staff>
    </Score>
  </museScore>`;
  const { records } = extractNotes(imported);
  assert.deepStrictEqual(records.map((r) => r.pitch), [72]);
});

// An 8va line is a reading instruction: the ringer plays an octave above what
// is drawn, so the bell is an octave above the stored pitch. MuseScore keeps
// that octave out of <pitch> — it is carried only by the spanner — so a reader
// that does not resolve it charts the wrong bell for every note under the line.
test("a note under an 8va is read at the octave it sounds", () => {
  const withOttava = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Part id="1">
      <Staff/>
      <trackName>Handbells</trackName>
      <Instrument id="hand-bells"><instrumentId>pitched-percussion.handbells</instrumentId>
        <transposeChromatic>12</transposeChromatic></Instrument>
      </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Spanner type="Ottava">
            <Ottava><subtype>8va</subtype></Ottava>
            <next><location><fractions>1/2</fractions></location></next>
            </Spanner>
          <Chord><durationType>half</durationType>
            <Note><pitch>72</pitch><tpc>14</tpc></Note></Chord>
          <Spanner type="Ottava">
            <prev><location><fractions>-1/2</fractions></location></prev>
            </Spanner>
          <Chord><durationType>half</durationType>
            <Note><pitch>74</pitch><tpc>16</tpc></Note></Chord>
          </voice>
        </Measure>
      </Staff>
    </Score>
  </museScore>`;
  const { records } = extractNotes(withOttava);
  // The first is drawn at C5 under the line, so it is the C6 bell; the second
  // is past the line's end and is the D5 bell it is drawn as.
  assert.deepStrictEqual(records.map((r) => r.pitch), [84, 74]);
});
