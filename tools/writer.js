"use strict";

const { CHART_MARKER, META_MEASURES } = require("./constants.js");
const { bellName } = require("../handbells-used-chart/lib/bellname.js");
const {
  spanColumns, wordColumn, isAbove, startOffset, endOffset,
} = require("../handbells-used-chart/lib/optional.js");

// --- emission primitives: escaping and indentation live here only ----------

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad(level) {
  return "  ".repeat(level);
}

function attrString(attrs) {
  if (!attrs) return "";
  return Object.entries(attrs).map(([key, value]) => ` ${key}="${esc(value)}"`).join("");
}

// A leaf element rendered on one line: <name attrs>value</name>.
function el(name, value, level, attrs) {
  return `${pad(level)}<${name}${attrString(attrs)}>${esc(value)}</${name}>`;
}

// A self-closing element: <name attrs/>.
function selfClosing(name, attrs, level) {
  return `${pad(level)}<${name}${attrString(attrs)}/>`;
}

// A block element with attributes and rendered child lines. Filters out
// falsy children so optional elements can be inlined with `condition && ...`.
// MuseScore indents a closing tag one level deeper than its opening tag, so
// the close lines up with the block's own children rather than its open.
function block(name, attrs, children, level) {
  const kids = children.filter(Boolean);
  const open = `${pad(level)}<${name}${attrString(attrs)}>`;
  const close = `${pad(level + 1)}</${name}>`;
  return [open, ...kids, close].join("\n");
}

// --- accidentals ------------------------------------------------------------

// A chart shows one notehead per distinct bell, so a letter never repeats
// within an octave at the same alteration. Sharps and flats are written out;
// naturals are not, because a natural sign next to a plain letter reads as a
// separate bell rather than the same one.
const ACCIDENTAL_SUBTYPES = {
  "-2": "accidentalDoubleFlat",
  "0": "accidentalNatural",
  "-1": "accidentalFlat",
  "1": "accidentalSharp",
  "2": "accidentalDoubleSharp",
};

// Accepts #rgb and #rrggbb. Black is the default a chime chart falls back to,
// so it is rendered by writing no colour at all. Anything unparseable is
// treated the same way rather than emitting NaN into the attribute; the CLI
// validates what the user types before it ever reaches here.
function parseColor(value) {
  if (typeof value !== "string") return null;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return null;
  const digits = hex[1].length === 3
    ? hex[1].split("").map((c) => c + c).join("")
    : hex[1];
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return (r || g || b) ? { r, g, b, a: 255 } : null;
}

function renderNote(note, opts, level) {
  const bell = bellName(note.pitch, note.tpc);

  const children = [];
  if (bell.alter !== 0) {
    children.push(block("Accidental", null,
      [el("subtype", ACCIDENTAL_SUBTYPES[bell.alter], level + 2)], level + 1));
  } else {
    // MuseScore derives accidentals from the measure's own running state, so a
    // plain E after an E flat earlier in the chart comes out with a natural
    // sign printed beside it, which reads as a second, separate bell. Writing
    // the natural explicitly and marking it invisible settles it either way.
    children.push(block("Accidental", null, [
      el("subtype", "accidentalNatural", level + 2),
      el("visible", 0, level + 2),
    ], level + 1));
  }
  children.push(el("pitch", note.pitch, level + 1));
  children.push(el("tpc", note.tpc, level + 1));
  // A plain handbell takes the default head and no colour, so it needs no
  // element of either kind. The other two name their head and take a colour
  // from a field of their own. Reading one kind's colour for the other is a
  // typo nothing downstream would catch, so the two are paired here.
  const COLORED_HEADS = { diamond: "chimeColor", la: "smbColor" };
  if (COLORED_HEADS[note.head]) {
    children.push(el("head", note.head, level + 1));
    const rgb = parseColor(opts[COLORED_HEADS[note.head]]);
    if (rgb) children.push(selfClosing("color", rgb, level + 1));
  }
  return block("Note", null, children, level);
}

// --- measures ---------------------------------------------------------------

// A staff's own first measure declares the score's time signature the way
// every staff's first measure does. A chart staff is brand new and has no
// history, so the caller passes options.timeSig on the first measure it
// appends to each chart staff, and nowhere else.
function timeSig(fraction, level) {
  const [n, d] = fraction.split("/");
  return block("TimeSig", null, [el("sigN", n, level + 1), el("sigD", d, level + 1)], level);
}

// The rests that pad a chart measure out to its declared length are structural,
// not musical. MuseScore needs them; a reader does not.
function hiddenRest(level) {
  return block("Rest", null, [
    el("durationType", "quarter", level + 1),
    el("visible", 0, level + 1),
  ], level);
}

// --- optional-range brackets -------------------------------------------------

// The span between two chart columns as a fraction of a whole note. Each column
// is a quarter, so N columns apart is N/4, reduced, since MuseScore writes 1/2
// where
// this would otherwise say 2/4.
function columnSpan(columns) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  if (columns === 0) return "0/1";
  const divisor = gcd(columns, 4);
  return `${columns / divisor}/${4 / divisor}`;
}

// The bracket over an optional run.
//
// It carries no text. A <beginText> on a TextLine renders the word and
// suppresses the line entirely; with <beginTextPlace>above</beginTextPlace>
// both draw, but the line strikes through the word. Both were rendered and
// measured. So the word is a separate element, and MuseScore's automatic
// placement lifts it clear of the bracket with no manual offset.
//
// beginHookType and endHookType 1 are 90-degree hooks. They turn toward the
// staff on their own: down for a bracket placed above, up for one below.
function optionalBracketStart(run, level) {
  const placement = isAbove(run) ? "above" : "below";
  return block("Spanner", { type: "TextLine" }, [
    block("TextLine", null, [
      el("placement", placement, level + 2),
      el("beginHookType", 1, level + 2),
      el("endHookType", 1, level + 2),
      // The overhang that makes the bracket enclose its bells. It has to go in
      // a Segment: MuseScore ignores an offset written straight onto the line,
      // and off2 outside one does nothing at all. Both were rendered to check.
      block("Segment", { subtype: 0 }, [
        selfClosing("offset", { x: startOffset(), y: 0 }, level + 3),
        selfClosing("off2", { x: endOffset(), y: 0 }, level + 3),
      ], level + 2),
    ], level + 1),
    `${pad(level + 1)}<next><location><fractions>`
      + `${columnSpan(spanColumns(run))}`
      + `</fractions></location></next>`,
  ], level);
}

function optionalBracketEnd(run, level) {
  return block("Spanner", { type: "TextLine" }, [
    `${pad(level + 1)}<prev><location><fractions>`
      + `-${columnSpan(spanColumns(run))}`
      + `</fractions></location></prev>`,
  ], level);
}

// The word itself, anchored to the middle column of the run so it centres on
// the bracket. Italic, as the published charts print it.
function optionalText(run, level) {
  const placement = isAbove(run) ? "above" : "below";
  return block("StaffText", null, [
    el("placement", placement, level + 1),
    el("align", "center,baseline", level + 1),
    el("italic", 1, level + 1),
    el("text", "optional", level + 1),
  ], level);
}

function chartStaffMeasure(section, staff, options) {
  const opts = options || {};
  const entries = section[staff] || [];
  // A tick outside the measure, or two entries sharing one, would drop a bell
  // from the chart without a word, the precise failure this tool exists to
  // prevent. A plan that disagrees with its own column count is a bug, so it
  // stops here rather than producing a quietly wrong chart.
  const byTick = new Map();
  for (const entry of entries) {
    if (!(entry.tick >= 0 && entry.tick < section.columns)) {
      throw new Error(
        `${staff} column ${entry.tick} lies outside a ${section.columns}-column chart`);
    }
    if (byTick.has(entry.tick)) {
      throw new Error(`${staff} column ${entry.tick} is claimed by two entries`);
    }
    byTick.set(entry.tick, entry);
  }

  for (const run of section.optional || []) {
    if (run.firstColumn < 0 || run.lastColumn >= section.columns
        || run.firstColumn > run.lastColumn) {
      throw new Error(
        `optional run ${run.firstColumn}-${run.lastColumn} lies outside a `
        + `${section.columns}-column chart`);
    }
  }

  const voiceChildren = [
    block("KeySig", null, [el("concertKey", 0, 3)], 2),
    opts.timeSig && timeSig(opts.timeSig, 2),
  ];
  const runs = (section.optional || []).filter((run) => run.staff === staff);
  for (let tick = 0; tick < section.columns; tick++) {
    for (const run of runs) {
      if (run.firstColumn === tick) voiceChildren.push(optionalBracketStart(run, 2));
      if (wordColumn(run) === tick) voiceChildren.push(optionalText(run, 2));
      if (run.lastColumn === tick) voiceChildren.push(optionalBracketEnd(run, 2));
    }
    const entry = byTick.get(tick);
    if (!entry) {
      voiceChildren.push(hiddenRest(2));
      continue;
    }
    const noteLines = entry.notes.map((note) => renderNote(note, opts, 3));
    voiceChildren.push(block("Chord", null, [el("durationType", "quarter", 3), ...noteLines], 2));
  }

  return block("Measure", { len: `${section.columns}/4` }, [
    el("stemless", 1, 1),
    block("voice", null, voiceChildren, 1),
  ], 0);
}

function systemText(label, level) {
  return [
    `${pad(level)}<SystemText>`,
    el("size", 6, level + 1),
    `${pad(level + 1)}<text><font size="6"/>${esc(label)}</text>`,
    `${pad(level + 1)}</SystemText>`,
  ].join("\n");
}

function pieceStaffMeasure(section, options) {
  const opts = options || {};

  // The chart measures sit ahead of the piece's own first measure, so without
  // a key signature of their own the piece's key would be in force across the
  // chart. Concert key 0 prints nothing, so a repeat in a later chart measure
  // is invisible.
  const voiceChildren = [block("KeySig", null, [el("concertKey", 0, 3)], 2)];
  if (opts.timeSig) voiceChildren.push(timeSig(opts.timeSig, 2));
  if (opts.label) voiceChildren.push(systemText(opts.label, 2));
  for (let tick = 0; tick < section.columns; tick++) {
    voiceChildren.push(hiddenRest(2));
  }

  return block("Measure", { len: `${section.columns}/4` }, [
    opts.irregular && el("irregular", 1, 1),
    opts.sectionBreak && block("LayoutBreak", null, [el("subtype", "section", 2)], 1),
    block("voice", null, voiceChildren, 1),
  ], 0);
}

function emptyMeasure(options) {
  const { duration = "4/4", len, timeSig: sig } = options || {};
  return block("Measure", len ? { len } : null, [
    block("voice", null, [
      sig && timeSig(sig, 2),
      block("Rest", null, [
        el("durationType", "measure", 3),
        el("duration", duration, 3),
      ], 2),
    ], 1),
  ], 0);
}

// --- parts -------------------------------------------------------------------

const CHART_CLEFS = [
  { concert: "G8va", transposing: "G" },
  { concert: "F8va", transposing: "F" },
];

function chartPart(partId, staffCount, options) {
  const opts = options || {};
  const attrs = opts.partNumber === undefined ? null : { id: opts.partNumber };

  const staves = [];
  const clefEntries = [];
  for (let i = 0; i < staffCount; i++) {
    const clef = CHART_CLEFS[i] || CHART_CLEFS[CHART_CLEFS.length - 1];

    const staffTypeChildren = [
      el("name", "stdNormal", 3),
      el("small", 1, 3),
      el("barlines", 0, 3),
      el("timesig", 0, 3),
    ];
    const staffChildren = [
      block("StaffType", { group: "pitched" }, staffTypeChildren, 2),
      el("defaultConcertClef", clef.concert, 2),
      el("defaultTransposingClef", clef.transposing, 2),
      // The brace, on the first staff of a grand staff only. A one-staff
      // chart has no second half for it to join, and MuseScore draws it all
      // the same: a curly bracket beside a single staff, joining it to
      // nothing.
      i === 0 && staffCount > 1 && selfClosing("bracket",
        { type: 1, span: staffCount, col: 0, visible: 1 }, 2),
      i === 0 && el("barLineSpan", staffCount - 1, 2),
    ];
    staves.push(block("Staff", null, staffChildren, 1));

    clefEntries.push(i === 0
      ? el("concertClef", clef.concert, 2)
      : el("concertClef", clef.concert, 2, { staff: i + 1 }));
    clefEntries.push(i === 0
      ? el("transposingClef", clef.transposing, 2)
      : el("transposingClef", clef.transposing, 2, { staff: i + 1 }));
  }

  const instrumentId = partId === "hand-chimes"
    ? "pitched-percussion.handchimes"
    : "pitched-percussion.handbells";

  const instrumentChildren = [
    el("longName", "", 2),
    el("shortName", "", 2),
    el("trackName", CHART_MARKER, 2),
    el("minPitchP", 36, 2),
    el("maxPitchP", 120, 2),
    el("minPitchA", 36, 2),
    el("maxPitchA", 120, 2),
    el("transposeDiatonic", 7, 2),
    el("transposeChromatic", 12, 2),
    el("instrumentId", instrumentId, 2),
    ...clefEntries,
    el("singleNoteDynamics", 0, 2),
    block("Channel", null, [
      selfClosing("program", { value: 112 }, 3),
      el("synti", "Fluid", 3),
    ], 2),
  ];

  return block("Part", attrs, [
    ...staves,
    el("trackName", CHART_MARKER, 1),
    el("hideWhenEmpty", "on", 1),
    el("preferSharpFlat", "none", 1),
    block("Instrument", { id: partId }, instrumentChildren, 1),
  ], 0);
}

module.exports = {
  chartStaffMeasure, pieceStaffMeasure, emptyMeasure, chartPart,
  CHART_MARKER, META_MEASURES,
};
