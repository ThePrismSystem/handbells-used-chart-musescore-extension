/*
 * The inverse of bellname.bellName, plus the required-range arithmetic built
 * on it.
 *
 * A user types a bell name into Project Properties; everything downstream
 * compares sounding pitches. Doing the conversion once, here, is what keeps a
 * range from having to know about spelling: G#5 and Ab5 are one pitch, so a
 * range can never mark one of them optional while the other stays required.
 */

// Semitones above C for each natural letter.
var LETTER_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Written the way bellname.js prints them. Order matters: "bb" must be tried
// before "b", or "Bbb2" parses as "Bb" with a stray trailing "b".
var ACCIDENTALS = [
    { text: "bb", alter: -2 },
    { text: "x", alter: 2 },
    { text: "b", alter: -1 },
    { text: "#", alter: 1 },
    { text: "", alter: 0 }
];

function refuse(name) {
    return new Error("\"" + name + "\" is not a bell name. Use a letter, an "
        + "optional accidental and an octave, as the chart prints them — for "
        + "example C6, Ab3 or F#7.");
}

// The letter is matched case insensitively because a user typing "c6" means C6.
// The accidental is not: "B" and "b" are a letter and a flat, and folding case
// would make "Bb" ambiguous with "BB".
function parseBellName(name) {
    if (typeof name !== "string") throw refuse(String(name));
    var text = name.trim();
    if (!text) throw refuse(name);

    var letter = text.charAt(0).toUpperCase();
    if (!LETTER_SEMITONE.hasOwnProperty(letter)) throw refuse(name);

    var rest = text.slice(1);
    for (var i = 0; i < ACCIDENTALS.length; i++) {
        var accidental = ACCIDENTALS[i];
        if (rest.slice(0, accidental.text.length) !== accidental.text) continue;
        var digits = rest.slice(accidental.text.length);
        if (!/^[0-9]+$/.test(digits)) continue;
        var octave = Number(digits);
        return {
            letter: letter,
            alter: accidental.alter,
            octave: octave,
            // The mirror of bellName's octave calculation, which subtracts the
            // alteration before taking the octave so Cb5 counts as octave 5.
            pitch: (octave + 1) * 12 + LETTER_SEMITONE[letter] + accidental.alter
        };
    }
    throw refuse(name);
}

function empty(value) {
    return value === null || value === undefined || String(value).trim() === "";
}

function bellRange(first, last) {
    var range = {
        first: empty(first) ? null : parseBellName(first).pitch,
        last: empty(last) ? null : parseBellName(last).pitch
    };
    if (range.first !== null && range.last !== null && range.first > range.last) {
        throw new Error("The first required bell (" + first + ") sounds above "
            + "the last (" + last + ").");
    }
    return range;
}

function isOptional(range, pitch) {
    if (range.first !== null && pitch < range.first) return true;
    if (range.last !== null && pitch > range.last) return true;
    return false;
}

module.exports = {
    parseBellName: parseBellName,
    bellRange: bellRange,
    isOptional: isOptional
};
