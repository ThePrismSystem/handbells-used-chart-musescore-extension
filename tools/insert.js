"use strict";

const {
  chartStaffMeasure, pieceStaffMeasure, emptyMeasure, chartPart,
  CHART_MARKER, META_MEASURES,
} = require("./writer.js");
const { META_HID_STAVES, META_STYLE } = require("./constants.js");

const MARKER_TAG = `<trackName>${CHART_MARKER}</trackName>`;
const HIDE_TAG = "<hideWhenEmpty>on</hideWhenEmpty>";

// A part is ours only if it looks like something this tool built: the marker
// track name, suppressed barlines, and hide-when-empty. A user who happens to
// name a part "Handbells Used Chart" has none of the rest.
function looksGenerated(partText) {
  return partText.includes(MARKER_TAG)
    && partText.includes("<barlines>0</barlines>")
    && partText.includes(HIDE_TAG);
}

// ...and only if it is trailing. We always append, so a generated part is never
// followed by one of the user's. Scanning back from the end means a matching
// part in the middle of the score is left alone whatever it is named.
function trailingChartParts(parts) {
  let first = parts.length;
  while (first > 0 && looksGenerated(parts[first - 1].text)) first--;
  return parts.slice(first);
}

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
  // Insert the tag ahead of the first existing one, carrying a copy of that
  // tag's own leading whitespace. withoutMetaTag strips `\s*` before a tag, so
  // borrowing the indentation is what makes the pair cancel out exactly and
  // keeps removeChart(insertChart(x)) byte-identical to x.
  const existing = /(\s*)<metaTag name="/.exec(stripped);
  const tag = `<metaTag name="${name}">${value}</metaTag>`;
  if (existing) {
    return stripped.slice(0, existing.index)
      + existing[1] + tag
      + stripped.slice(existing.index);
  }
  const scoreOpen = /<Score>/.exec(stripped);
  return stripped.slice(0, scoreOpen.index + scoreOpen[0].length)
    + "\n    " + tag
    + stripped.slice(scoreOpen.index + scoreOpen[0].length);
}

// --- removal ----------------------------------------------------------------

// What to remove is derived from the score's own structure, not from a metaTag
// alone: one chart part was appended per chart, and one chart measure with it,
// so the number of trailing generated parts IS the number of chart measures.
// A stale or hand-edited metaTag can then no longer talk us into deleting the
// user's music, which is the worst thing this function could do.
function removeChart(mscxText) {
  const parts = partBlocks(mscxText);
  assertChartIsRecognisable(parts);
  const chartParts = trailingChartParts(parts);
  const measures = chartParts.length;
  const hidden = (metaTag(mscxText, META_HID_STAVES) || "")
    .split(",").filter((x) => x !== "").map(Number);
  const hidStaves = hidden.length > 0;
  const styled = metaTag(mscxText, META_STYLE) !== null;
  if (!measures && !hidStaves && !styled && metaTag(mscxText, META_MEASURES) === null) {
    return mscxText;
  }

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

  // Only the parts this tool added the element to come back off. A score that
  // already hid its own staves keeps doing so, which is why the indices are
  // recorded at insert time rather than every part being stripped blind.
  for (const index of hidden) {
    const part = parts[index];
    if (!part || chartParts.includes(part) || !part.text.includes(HIDE_TAG)) continue;
    edits.push({
      start: part.start, end: part.end,
      replacement: part.text.replace(new RegExp(`\\s*${HIDE_TAG}`), ""),
    });
  }

  let out = splice(mscxText, edits);
  out = withoutMetaTag(out, META_MEASURES);
  out = withoutMetaTag(out, META_HID_STAVES);
  return withoutMetaTag(out, META_STYLE);
}

// Removes the first `count` measures from a staff. Stops early at anything that
// is not a measure, so a hand-edited score loses only what this tool put there.
function dropLeadingMeasures(staffText, count) {
  const edits = [];
  const pattern = /<Measure(?:\s[^>]*)?>/g;
  let left = count;
  let m;
  while (left && (m = pattern.exec(staffText)) !== null) {
    // Every chart measure carries a len attribute. Stopping at the first
    // measure without one bounds the damage if the count is ever too large.
    if (!/^<Measure len="/.test(m[0])) break;
    const end = closeOf(staffText, "Measure", m.index);
    edits.push({ start: backOverWhitespace(staffText, m.index), end });
    pattern.lastIndex = end;
    left--;
  }
  return splice(staffText, edits);
}

// --- insertion --------------------------------------------------------------

// Chart measures go immediately before the staff's first measure, which puts
// them after any run of leading frames — the title block — without depending on
// a frame being there. Anchoring on the first </VBox> instead would find a
// frame anywhere in the staff, and a score whose only frame is a mid-score
// heading or a trailing credits block would get its chart spliced into the
// middle of the piece in staff 1 and at the head in every other staff.
function insertAtHead(staffText, elements) {
  const first = /(\s*)<Measure(?:\s[^>]*)?>/.exec(staffText);
  if (!first) return staffText;
  // Each measure carries a copy of the whitespace that led the one it displaces.
  // dropLeadingMeasures strips `\s*` ahead of a measure, so borrowing the
  // indentation is what makes insert and remove cancel out byte for byte.
  const lead = first[1];
  return staffText.slice(0, first.index)
    + elements.map((element) => lead + element).join("")
    + staffText.slice(first.index);
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
  assertChartIsRecognisable(partBlocks(mscxText));
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
  const hidden = [];
  if (opts.hideExistingStaves) {
    parts.forEach((part, index) => {
      if (part.text.includes("<hideWhenEmpty>")) return;
      edits.push({
        start: part.start, end: part.end,
        replacement: part.text.replace(/(\s*)(<Instrument\b)/,
          `$1${HIDE_TAG}$1$2`),
      });
      hidden.push(index);
    });
  }

  let out = withMetaTag(splice(base, edits), META_MEASURES, sections.length);
  if (hidden.length) out = withMetaTag(out, META_HID_STAVES, hidden.join(","));
  return out;
}

// --- score style ------------------------------------------------------------

// Marking a staff hide-when-empty is not enough on its own: MuseScore keeps
// empty staves on the first system unless the score's style says otherwise, and
// the chart IS the first system. These two flags live in score_style.mss, so
// they are the score's settings, not ours — the previous values travel in a
// metaTag and go back on removal.
const STYLE_FLAGS = ["hideEmptyStaves", "dontHideStavesInFirstSystem"];

function readStyleFlags(mssText) {
  return STYLE_FLAGS.map((name) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(mssText);
    return m ? m[1] : "";
  }).join(",");
}

function writeStyleFlags(mssText, values) {
  return STYLE_FLAGS.reduce((text, name, i) => {
    const value = values.split(",")[i];
    if (value === undefined || value === "") return text;
    return text.replace(new RegExp(`<${name}>[^<]*</${name}>`), `<${name}>${value}</${name}>`);
  }, mssText);
}

// --- linked parts -----------------------------------------------------------

// A linked part is a whole separate score inside the same archive, and its
// measures line up with the main score's by position, not by any link of their
// own. Add chart measures to one without the other and MuseScore cannot load
// the file at all — it exits with no message. So every excerpt gets the same
// measures, filled with rests: the chart itself lives only in the main score.

// trailingChartParts deliberately ignores anything a user part follows, so that
// a part merely NAMED like ours is safe. The cost is that our own parts stop
// being recognised once an instrument is added after them — and then a rerun
// would stack a second chart on the first while --remove reported success.
// Refusing is the only honest answer; MuseScore can delete the parts by hand.
function assertChartIsRecognisable(parts) {
  const generated = parts.filter((part) => looksGenerated(part.text));
  if (generated.length !== trailingChartParts(parts).length) {
    throw new Error(
      "this score already has a chart, but an instrument was added after it, so "
      + "the chart can no longer be identified. Delete the chart instruments in "
      + "MuseScore and run this again.");
  }
}

function chartMeasureCount(mscxText) {
  assertChartIsRecognisable(partBlocks(mscxText));
  return trailingChartParts(partBlocks(mscxText)).length;
}

function insertChartMeasures(mscxText, sections) {
  if (!sections.length) return mscxText;
  return splice(mscxText, staffBlocks(mscxText).map((staff) => ({
    start: staff.start,
    end: staff.end,
    replacement: insertAtHead(staff.text, sections.map((s) => pieceStaffMeasure(s, {}))),
  })));
}

function removeChartMeasures(mscxText, count) {
  if (!count) return mscxText;
  const edits = [];
  for (const staff of staffBlocks(mscxText)) {
    const trimmed = dropLeadingMeasures(staff.text, count);
    if (trimmed !== staff.text) {
      edits.push({ start: staff.start, end: staff.end, replacement: trimmed });
    }
  }
  return splice(mscxText, edits);
}

module.exports = {
  insertChart, removeChart,
  readStyleFlags, writeStyleFlags,
  insertChartMeasures, removeChartMeasures, chartMeasureCount,
};
