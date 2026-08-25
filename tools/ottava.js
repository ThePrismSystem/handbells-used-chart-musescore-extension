"use strict";

const xml = require("./xml.js");

// How many semitones each of MuseScore's ottava subtypes moves a note.
//
// The names are MuseScore's own, as it writes them into <subtype>, and the
// numbers were read back off staff.pitchOffset with one ottava of each kind
// over a whole note — the same property the extension asks, so the two front
// ends are answering with one set of figures rather than two.
const SEMITONES = {
  "8va": 12, "8vb": -12,
  "15ma": 24, "15mb": -24,
  "22ma": 36, "22mb": -36,
};

// A note's duration is otherwise unknowable from the XML, and the position of
// every later note in the voice depends on it. As a fraction of a whole note.
const WHOLES = {
  long: 4, breve: 2, whole: 1, half: 1 / 2, quarter: 1 / 4, eighth: 1 / 8,
  "16th": 1 / 16, "32nd": 1 / 32, "64th": 1 / 64, "128th": 1 / 128,
  "256th": 1 / 256, "512th": 1 / 512, "1024th": 1 / 1024,
};

// Grace notes hang off the chord they decorate and occupy no time of their
// own. Counting one would push every later note in the voice out of place.
const GRACE = /^(acciaccatura|appoggiatura|grace\d+(after)?)$/;

function isGrace(node) {
  return node.children.some((child) => GRACE.test(child.name));
}

// "3/4" and "-1/2" both occur: a <location> can move a voice backwards.
function fractionOf(text) {
  if (!text) return 0;
  const parts = text.split("/");
  const numerator = Number(parts[0]);
  const denominator = parts.length > 1 ? Number(parts[1]) : 1;
  if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function durationOf(node, tuplets) {
  if (isGrace(node)) return 0;
  const type = xml.childText(node, "durationType");
  // A full-measure rest carries its length separately, because the length is
  // the measure's rather than the note value's.
  let whole = type === "measure"
    ? fractionOf(xml.childText(node, "duration")) : WHOLES[type];
  if (whole === undefined || !isFinite(whole)) return 0;
  const dots = Number(xml.childText(node, "dots")) || 0;
  whole *= 2 - Math.pow(2, -dots);
  for (const ratio of tuplets) whole *= ratio;
  return whole;
}

// Positions are compared as a measure index and a fraction of a whole note
// within it, never as an absolute tick, so nothing here has to know a
// measure's length or follow a time signature change.
//
// The fractions are exact: every note value is a negative power of two and a
// dotted one is a sum of them, so the running total is a binary fraction that
// floating point holds without error. A tuplet is the exception — thirds do
// not divide evenly — but a tuplet's total fills an exact span, so the drift
// exists only inside one and cancels at its end. The comparisons below allow
// for it rather than trusting equality on a boundary.
const EPSILON = 1 / 4096;

function before(a, b) {
  if (a.measure !== b.measure) return a.measure < b.measure;
  return a.pos < b.pos - EPSILON;
}

function within(span, at) {
  return !before(at, span.start) && before(at, span.end);
}

function spansAndNotes(staff) {
  const notes = [];
  const spans = [];
  let open = null;
  let measure = 0;

  for (const node of staff.children) {
    if (node.name !== "Measure") continue;
    for (const voice of node.children) {
      if (voice.name !== "voice") continue;
      let pos = 0;
      const tuplets = [];
      for (const el of voice.children) {
        if (el.name === "Chord" || el.name === "Rest") {
          if (el.name === "Chord") {
            for (const child of el.children) {
              if (child.name === "Note") notes.push({ node: child, at: { measure, pos } });
            }
          }
          pos += durationOf(el, tuplets);
        } else if (el.name === "Tuplet") {
          const normal = Number(xml.childText(el, "normalNotes"));
          const actual = Number(xml.childText(el, "actualNotes"));
          tuplets.push(normal > 0 && actual > 0 ? normal / actual : 1);
        } else if (el.name === "endTuplet") {
          tuplets.pop();
        } else if (el.name === "location") {
          // MuseScore moves a voice about with these rather than padding it
          // with rests, and the move can be backwards.
          pos += fractionOf(xml.childText(el, "fractions"));
        } else if (el.name === "Spanner" && el.attrs.type === "Ottava") {
          const ottava = xml.find(el, "Ottava");
          if (ottava) {
            const semitones = SEMITONES[xml.childText(ottava, "subtype")];
            // An unknown subtype is left alone rather than guessed at. Every
            // one MuseScore writes is in the table; a new one should chart the
            // note where it is drawn, not somewhere invented for it.
            open = semitones === undefined
              ? null : { start: { measure, pos }, semitones };
          } else if (open) {
            spans.push({ start: open.start, end: { measure, pos }, semitones: open.semitones });
            open = null;
          }
        }
      }
    }
    measure++;
  }
  // A spanner MuseScore wrote both ends of always closes. One left open — a
  // hand-edited file, or a score cut short — runs to the end of the staff
  // rather than being dropped, which is what the line on the page means.
  if (open) {
    spans.push({ start: open.start, end: { measure: Infinity, pos: 0 }, semitones: open.semitones });
  }
  return { notes, spans };
}

// How many semitones each <Note> in this staff is moved by an ottava, keyed by
// the note element itself so a reader can look one up as it walks.
//
// An ottava is a property of the staff, not of the voice it is written in: an
// 8va entered in one voice moves the notes of every other voice under it too,
// which is what staff.pitchOffset reports and what MuseScore plays. So the
// spans are collected from the whole staff and applied by position.
function byNote(staff) {
  const { notes, spans } = spansAndNotes(staff);
  const map = new Map();
  if (!spans.length) return map;
  for (const note of notes) {
    let semitones = 0;
    for (const span of spans) {
      if (within(span, note.at)) semitones += span.semitones;
    }
    if (semitones) map.set(note.node, semitones);
  }
  return map;
}

module.exports = { byNote, SEMITONES };
