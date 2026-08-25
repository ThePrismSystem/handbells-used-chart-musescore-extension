"use strict";

const xml = require("./xml.js");
const ottava = require("./ottava.js");
const { CHART_MARKER } = require("./constants.js");
const { offsetForTransposition } = require("../handbells-used-chart/lib/sourcepitch.js");

function readMetaTag(mscxText, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(mscxText);
  return m ? m[1] : null;
}

// How far each top-level <Staff id="N"> transposes, in semitones.
//
// Read rather than guessed from the instrument id. The two handbell
// instruments transpose up an octave and most others do not, but that is a
// correlation and not the rule: a Piano part an arranger transposed up an
// octave by hand — which is how a piano-part handbell score is made to play
// back at bell pitch — reads "piano" and transposes, and MuseScore's MusicXML
// importer keeps the handbell id while dropping the transposition, so a
// handbell part need not transpose either. Both charted an octave out.
//
// It also means nothing here depends on the <Instrument> id attribute, which a
// hand-authored or older file need not carry at all. MuseScore resolves the id
// from <instrumentId> on load and the extension therefore saw one, so keying
// off the attribute made the two front ends chart the same score an octave
// apart.
//
// A <Part> holds bare <Staff> children with no id of their own — that is how
// MuseScore writes them — and the top-level <Staff id="N"> blocks that carry
// the music are numbered sequentially across parts in document order. So the
// map is positional: the first part owns staves 1..n, the next owns n+1 on.
function transpositionByStaffId(score) {
  const map = new Map();
  let staffId = 1;
  for (const part of score.children.filter((n) => n.name === "Part")) {
    const instrument = part.children.find((n) => n.name === "Instrument");
    // Absent for a part that does not transpose, which is most of them.
    const chromatic = instrument
      ? xml.childText(instrument, "transposeChromatic") : null;
    const staves = part.children.filter((n) => n.name === "Staff").length;
    // A part with no <Staff> child still owns one staff; MuseScore omits the
    // child in hand-authored files. Claiming zero would shift every later
    // part's staves and apply the wrong offset to all of them.
    for (let i = 0; i < Math.max(staves, 1); i++) map.set(String(staffId++), chromatic);
  }
  return map;
}

function extractNotes(mscxText) {
  const doc = xml.parse(mscxText);
  const score = xml.find(doc, "Score");
  if (!score) return { records: [], chartPartIds: [], skipped: 0 };

  const chartPartIds = [];
  for (const part of score.children.filter((n) => n.name === "Part")) {
    if (xml.childText(part, "trackName") === CHART_MARKER) {
      chartPartIds.push(part.attrs.id);
    }
  }

  const transpositions = transpositionByStaffId(score);

  const records = [];
  let skipped = 0;
  for (const staff of score.children.filter((n) => n.name === "Staff")) {
    const staffId = staff.attrs.id;
    // Stored pitch is the sounding pitch; a bell's name is its written pitch
    // plus an octave. Only a part transposing up an octave already agrees.
    const offset = offsetForTransposition(transpositions.get(staffId));
    // An ottava is the one thing <pitch> leaves out. It is per staff and per
    // position rather than per part, so it is looked up note by note.
    const ottavas = ottava.byNote(staff);
    for (const note of xml.findAll(staff, "Note")) {
      const rawPitch = xml.childText(note, "pitch");
      const rawTpc = xml.childText(note, "tpc");
      const pitch = Number(rawPitch);
      const tpc = Number(rawTpc);
      if (rawPitch === null || rawTpc === null
          || !Number.isFinite(pitch) || !Number.isFinite(tpc)
          // Outside this range a tpc decodes to no letter at all and the bell
          // would reach the chart named "Bundefined4".
          || tpc < -1 || tpc > 33) {
        skipped++;
        continue;
      }
      records.push({
        pitch: pitch + offset + (ottavas.get(note) || 0),
        tpc,
        head: xml.childText(note, "head") || "normal",
        staffId,
      });
    }
  }

  return { records, chartPartIds, skipped };
}

module.exports = { extractNotes, readMetaTag, CHART_MARKER };
