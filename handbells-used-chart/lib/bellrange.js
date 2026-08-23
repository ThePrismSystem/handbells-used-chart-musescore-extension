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

// Written the way bellname.js prints them. The order is not load-bearing: the
// digit check below rejects a partial match, so a shorter accidental cannot
// swallow a longer one. Were "b" to come first, "Bbb2" would leave "b2", which
// is not an octave, and the loop would go on to try "bb". Longest-first is a
// readability convention, nothing more. What the parse actually depends on is
// that digit check; without it "C5x" comes back with a pitch of NaN and "C-1"
// with pitch 0, instead of being refused.
var ACCIDENTALS = [
    { text: "bb", alter: -2 },
    { text: "x", alter: 2 },
    { text: "b", alter: -1 },
    { text: "#", alter: 1 },
    { text: "", alter: 0 }
];

// The noun names what the user was asked for, so a mistyped chime is not
// reported as a bell. It defaults rather than being required because
// parseBellName is the general-purpose entry point.
function refuse(name, noun) {
    return new Error("\"" + name + "\" is not a " + (noun || "bell") + " name. "
        + "Use a letter, an optional accidental and an octave, as the chart "
        + "prints them — for example C6, Ab3 or F#7.");
}

// The letter is matched case insensitively because a user typing "c6" means C6.
// The accidental is not: "B" and "b" are a letter and a flat, and folding case
// would make "Bb" ambiguous with "BB".
function parseBellName(name, noun) {
    if (typeof name !== "string") throw refuse(String(name), noun);
    var text = name.trim();
    if (!text) throw refuse(name, noun);

    var letter = text.charAt(0).toUpperCase();
    if (!LETTER_SEMITONE.hasOwnProperty(letter)) throw refuse(name, noun);

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
    throw refuse(name, noun);
}

function empty(value) {
    return value === null || value === undefined || String(value).trim() === "";
}

function bellRange(first, last, noun) {
    var kind = noun || "bell";
    var range = {
        first: empty(first) ? null : parseBellName(first, kind).pitch,
        last: empty(last) ? null : parseBellName(last, kind).pitch
    };
    if (range.first !== null && range.last !== null && range.first > range.last) {
        throw new Error("The first required " + kind + " (" + first + ") sounds "
            + "above the last (" + last + ").");
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
