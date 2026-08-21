"use strict";

const { CHART_MARKER, META_MEASURES } = require("./constants.js");
const { bellName } = require("../handbells-used-chart/lib/bellname.js");

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

// MuseScore keeps an accidental in force for the rest of the measure, for the
// same letter in the same octave. A chart is one long measure, so a bell whose
// letter was altered earlier silently changes pitch unless an explicit
// accidental is written. Omitting these is what dropped 16 bells from a
// hand-built chart of this very score.
const ACCIDENTAL_SUBTYPES = {
  "-2": "accidentalDoubleFlat",
  "-1": "accidentalFlat",
  "0": "accidentalNatural",
  "1": "accidentalSharp",
  "2": "accidentalDoubleSharp",
};

function renderNote(note, state, opts, level) {
  const bell = bellName(note.pitch, note.tpc);
  const key = `${bell.letter}${bell.octave}`;
  const inForce = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : 0;

  const children = [];
  if (bell.alter !== inForce) {
    children.push(block("Accidental", null,
      [el("subtype", ACCIDENTAL_SUBTYPES[bell.alter], level + 2)], level + 1));
    state[key] = bell.alter;
  }
  children.push(el("pitch", note.pitch, level + 1));
  children.push(el("tpc", note.tpc, level + 1));
  if (note.head === "diamond") {
    children.push(el("head", "diamond", level + 1));
    if (opts.chimeColor && opts.chimeColor.toLowerCase() !== "#000000") {
      const hex = opts.chimeColor.replace(/^#/, "");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      children.push(selfClosing("color", { r, g, b, a: 255 }, level + 1));
    }
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

function chartStaffMeasure(section, staff, options) {
  const opts = options || {};
  const entries = section[staff] || [];
  const byTick = new Map(entries.map((entry) => [entry.tick, entry]));
  const accidentalState = {};

  const voiceChildren = [
    block("KeySig", null, [el("concertKey", 0, 3)], 2),
    opts.timeSig && timeSig(opts.timeSig, 2),
  ];
  for (let tick = 0; tick < section.columns; tick++) {
    const entry = byTick.get(tick);
    if (!entry) {
      voiceChildren.push(block("Rest", null, [el("durationType", "quarter", 3)], 2));
      continue;
    }
    const noteLines = entry.notes.map((note) => renderNote(note, accidentalState, opts, 3));
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

  const voiceChildren = [];
  if (opts.timeSig) voiceChildren.push(timeSig(opts.timeSig, 2));
  if (opts.label) voiceChildren.push(systemText(opts.label, 2));
  for (let tick = 0; tick < section.columns; tick++) {
    voiceChildren.push(block("Rest", null, [el("durationType", "quarter", 3)], 2));
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
      i === 0 && selfClosing("bracket",
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
    el("longName", CHART_MARKER, 2),
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
