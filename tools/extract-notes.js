"use strict";

const xml = require("./xml.js");
const { CHART_MARKER } = require("./constants.js");
const { offsetFor } = require("../handbells-used-chart/lib/sourcepitch.js");

function readMetaTag(mscxText, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(mscxText);
  return m ? m[1] : null;
}

// Which instrument each top-level <Staff id="N"> belongs to.
//
// A <Part> holds bare <Staff> children with no id of their own — that is how
// MuseScore writes them — and the top-level <Staff id="N"> blocks that carry
// the music are numbered sequentially across parts in document order. So the
// map is positional: the first part owns staves 1..n, the next owns n+1 on.
function instrumentByStaffId(score) {
  const map = new Map();
  let staffId = 1;
  for (const part of score.children.filter((n) => n.name === "Part")) {
    const instrument = part.children.find((n) => n.name === "Instrument");
    const id = instrument ? instrument.attrs.id : null;
    const staves = part.children.filter((n) => n.name === "Staff").length;
    // A part with no <Staff> child still owns one staff; MuseScore omits the
    // child in hand-authored files. Claiming zero would shift every later
    // part's staves and apply the wrong offset to all of them.
    for (let i = 0; i < Math.max(staves, 1); i++) map.set(String(staffId++), id);
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

  const instruments = instrumentByStaffId(score);

  const records = [];
  let skipped = 0;
  for (const staff of score.children.filter((n) => n.name === "Staff")) {
    const staffId = staff.attrs.id;
    // Stored pitch is the sounding pitch; a bell's name is its written pitch
    // plus an octave. Only the transposing handbell instruments already agree.
    const offset = offsetFor(instruments.get(staffId));
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
        pitch: pitch + offset,
        tpc,
        head: xml.childText(note, "head") || "normal",
        staffId,
      });
    }
  }

  return { records, chartPartIds, skipped };
}

module.exports = { extractNotes, readMetaTag, CHART_MARKER };
