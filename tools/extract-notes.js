"use strict";

const xml = require("./xml.js");
const { CHART_MARKER } = require("./constants.js");

function readMetaTag(mscxText, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(mscxText);
  return m ? m[1] : null;
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

  const records = [];
  let skipped = 0;
  for (const staff of score.children.filter((n) => n.name === "Staff")) {
    const staffId = staff.attrs.id;
    for (const note of xml.findAll(staff, "Note")) {
      const rawPitch = xml.childText(note, "pitch");
      const rawTpc = xml.childText(note, "tpc");
      const pitch = Number(rawPitch);
      const tpc = Number(rawTpc);
      if (rawPitch === null || rawTpc === null
          || !Number.isFinite(pitch) || !Number.isFinite(tpc)) {
        skipped++;
        continue;
      }
      records.push({
        pitch,
        tpc,
        head: xml.childText(note, "head") || "normal",
        staffId,
      });
    }
  }

  return { records, chartPartIds, skipped };
}

module.exports = { extractNotes, readMetaTag, CHART_MARKER };
