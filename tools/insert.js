"use strict";

const {
  chartStaffMeasure, pieceStaffMeasure, emptyMeasure, chartPart,
  CHART_MARKER, META_MEASURES,
} = require("./writer.js");

const MARKER_TAG = `<trackName>${CHART_MARKER}</trackName>`;

// --- locating ---------------------------------------------------------------

// MuseScore never nests a Part inside a Part, nor a score-level Staff inside
// another, so counting depth over a single tag name finds the close reliably.
function closeOf(text, tag, from) {
  const scan = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "g");
  scan.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = scan.exec(text)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return scan.lastIndex;
  }
  throw new Error(`unterminated <${tag}> block`);
}

function blocks(text, openPattern, tag) {
  const open = new RegExp(openPattern, "g");
  const found = [];
  let m;
  while ((m = open.exec(text)) !== null) {
    const end = closeOf(text, tag, m.index);
    found.push({ start: m.index, end, text: text.slice(m.index, end) });
    open.lastIndex = end;
  }
  return found;
}

const partBlocks = (text) => blocks(text, "<Part(?:\\s[^>]*)?>", "Part");
const staffBlocks = (text) => blocks(text, '<Staff id="\\d+">', "Staff");

// Removals swallow the whitespace in front of the block they delete. Without
// this, remove-then-insert leaves stray blank lines behind and the round trip
// stops being byte-identical.
function backOverWhitespace(text, start) {
  let i = start;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  return i;
}

// Applied back to front so earlier offsets stay valid.
function splice(text, edits) {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, e) => acc.slice(0, e.start) + (e.replacement || "") + acc.slice(e.end), text);
}

// metaTag helpers: read, remove, and insert-before-the-first-existing-metaTag.
// withMetaTag removes any previous copy first, so it is idempotent.
function metaTag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1] : null;
}

function withoutMetaTag(text, name) {
  return text.replace(new RegExp(`\\s*<metaTag name="${name}">[^<]*</metaTag>`), "");
}

function withMetaTag(text, name, value) {
  const stripped = withoutMetaTag(text, name);
  const existing = /<metaTag name="/.exec(stripped);
  const tag = `<metaTag name="${name}">${value}</metaTag>`;
  if (existing) {
    return stripped.slice(0, existing.index) + tag + "\n  " + stripped.slice(existing.index);
  }
  const scoreOpen = /<Score>/.exec(stripped);
  return stripped.slice(0, scoreOpen.index + scoreOpen[0].length)
    + "\n    " + tag
    + stripped.slice(scoreOpen.index + scoreOpen[0].length);
}

// --- removal ----------------------------------------------------------------

// How many measures to remove is recorded in a metaTag rather than inferred
// from <irregular>, because a genuine pickup measure is also irregular and must
// survive a chart being regenerated.
function removeChart(mscxText) {
  const measures = Number(metaTag(mscxText, META_MEASURES) || 0);
  const parts = partBlocks(mscxText);
  const chartParts = parts.filter((part) => part.text.includes(MARKER_TAG));
  if (!measures && chartParts.length === 0) return mscxText;

  // Score-level staves are numbered in part order. Chart parts are always
  // appended last, which is what keeps the surviving ids contiguous.
  const doomed = new Set();
  let nextId = 1;
  for (const part of parts) {
    const count = (part.text.match(/<Staff>/g) || []).length;
    for (let i = 0; i < count; i++) {
      const id = nextId++;
      if (chartParts.includes(part)) doomed.add(id);
    }
  }

  const edits = chartParts.map((part) => ({
    start: backOverWhitespace(mscxText, part.start), end: part.end,
  }));

  for (const staff of staffBlocks(mscxText)) {
    const id = Number(/<Staff id="(\d+)">/.exec(staff.text)[1]);
    if (doomed.has(id)) {
      edits.push({ start: backOverWhitespace(mscxText, staff.start), end: staff.end });
      continue;
    }
    const trimmed = dropLeadingMeasures(staff.text, measures);
    if (trimmed !== staff.text) {
      edits.push({ start: staff.start, end: staff.end, replacement: trimmed });
    }
  }

  return withoutMetaTag(splice(mscxText, edits), META_MEASURES);
}

// Removes the first `count` measures from a staff. Stops early at anything that
// is not a measure, so a hand-edited score loses only what this tool put there.
function dropLeadingMeasures(staffText, count) {
  const edits = [];
  const pattern = /<Measure(?:\s[^>]*)?>/g;
  let left = count;
  let m;
  while (left && (m = pattern.exec(staffText)) !== null) {
    const end = closeOf(staffText, "Measure", m.index);
    edits.push({ start: backOverWhitespace(staffText, m.index), end });
    pattern.lastIndex = end;
    left--;
  }
  return splice(staffText, edits);
}

// --- insertion --------------------------------------------------------------

// Chart measures go after the title frame if there is one, so the chart lands
// below the title block rather than above it.
function insertAtHead(staffText, elements) {
  const vbox = staffText.indexOf("</VBox>");
  const at = vbox === -1 ? staffText.indexOf(">") + 1 : vbox + "</VBox>".length;
  return staffText.slice(0, at) + "\n" + elements.join("\n") + staffText.slice(at);
}

// The piece's own measure skeleton, read off the first staff: one entry per
// measure giving its len attribute, the metre it declares (only where it
// changes), and the duration in force there. Chart staves are copied from this
// so a pickup measure or a metre change carries across.
function measureSkeleton(staffText) {
  const out = [];
  const open = /<Measure(?:\s[^>]*)?>/g;
  let signature = "4/4";
  let m;
  while ((m = open.exec(staffText)) !== null) {
    const end = closeOf(staffText, "Measure", m.index);
    const body = staffText.slice(m.index, end);
    const sig = /<TimeSig>[\s\S]*?<sigN>(\d+)<\/sigN>\s*<sigD>(\d+)<\/sigD>/.exec(body);
    if (sig) signature = `${sig[1]}/${sig[2]}`;
    const len = /^<Measure len="([^"]+)"/.exec(body);
    out.push({
      len: len ? len[1] : undefined,
      timeSig: sig ? signature : undefined,
      duration: len ? len[1] : signature,
    });
    open.lastIndex = end;
  }
  return out;
}

// One score-level staff block for one chart staff: its own chart measure at its
// section's index, rest-filled measures of the right length at the others, then
// the piece's own measures mirrored as empty ones. The staff's first measure
// declares the score's opening metre, as every staff's first measure does.
function chartStaffBlock(id, sections, sectionIndex, side, skeleton, options) {
  const opening = { timeSig: (skeleton[0] && skeleton[0].timeSig) || "4/4" };
  const measures = sections.map((section, i) => {
    const opts = i === 0 ? Object.assign({}, options, opening) : options;
    return i === sectionIndex
      ? chartStaffMeasure(section, side, opts)
      : pieceStaffMeasure(section, i === 0 ? opening : {});
  });
  // The opening metre is already declared above, so it is not repeated here.
  skeleton.forEach((measure, i) => measures.push(emptyMeasure(
    i === 0 ? Object.assign({}, measure, { timeSig: undefined }) : measure)));
  return `<Staff id="${id}">\n${measures.join("\n")}\n</Staff>`;
}

function insertChart(mscxText, plan, options) {
  const opts = options || {};
  const base = removeChart(mscxText);
  const sections = plan.sections;
  if (!sections.length) return base;

  const staves = staffBlocks(base);
  const parts = partBlocks(base);
  const skeleton = measureSkeleton(staves[0].text);
  const edits = [];

  // 1. Every existing staff gains one chart measure per chart, filled with
  //    rests. Staff 1 additionally carries the irregular flag, the section
  //    break and the label, which is where MuseScore keeps them.
  staves.forEach((staff, index) => {
    const leading = sections.map((section) => pieceStaffMeasure(section,
      index === 0
        ? { irregular: true, sectionBreak: true, label: section.label }
        : {}));
    edits.push({ start: staff.start, end: staff.end, replacement: insertAtHead(staff.text, leading) });
  });

  // 2. Two chart staves per section, appended after the last existing staff.
  const chartStaves = [];
  let nextId = staves.length + 1;
  sections.forEach((_, sectionIndex) => {
    for (const side of ["treble", "bass"]) {
      chartStaves.push(chartStaffBlock(
        nextId++, sections, sectionIndex, side, skeleton, opts));
    }
  });
  const lastStaff = staves[staves.length - 1];
  edits.push({ start: lastStaff.end, end: lastStaff.end, replacement: "\n" + chartStaves.join("\n") });

  // 3. One chart part per section, appended after the last existing part.
  const lastPart = parts[parts.length - 1];
  edits.push({
    start: lastPart.end,
    end: lastPart.end,
    replacement: "\n" + sections.map((section, i) => chartPart(section.partId, 2,
      Object.assign({}, opts, { partNumber: parts.length + i + 1 }))).join("\n"),
  });

  // 4. Optionally let the piece's own staves hide on the chart systems, by
  //    adding the part-level hideWhenEmpty the chart parts already carry.
  if (opts.hideExistingStaves) {
    for (const part of parts) {
      if (part.text.includes("<hideWhenEmpty>")) continue;
      edits.push({
        start: part.start, end: part.end,
        replacement: part.text.replace(/(\s*)(<Instrument\b)/,
          "$1<hideWhenEmpty>on</hideWhenEmpty>$1$2"),
      });
    }
  }

  return withMetaTag(splice(base, edits), META_MEASURES, sections.length);
}

module.exports = { insertChart, removeChart };
