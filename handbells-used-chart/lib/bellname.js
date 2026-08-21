/*
 * Bell naming and region assignment.
 *
 * Handbells sound one octave above written pitch. A bell's name is its
 * sounding pitch: what MuseScore shows as "sounding as" for the hand-bells
 * and hand-chimes instruments. All region boundaries below are bell names.
 *
 * Tonal pitch class decoding is adapted from get-handbells-used.qml,
 * copyright 2025 Andy Lyttle, GPL-3.0-only.
 */

var TPC_LETTERS = "FCGDAEB";
var LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
var ACCIDENTAL_TEXT = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "x" };

// Diatonic index is octave * 7 + letterStep, so the six regions are
// contiguous integer ranges covering C2 (14) through C9 (63).
var REGIONS = [
    { name: "bassRow2",    min: 14, max: 20 },  // C2 - B2
    { name: "bassRow1",    min: 21, max: 27 },  // C3 - B3
    { name: "bassStaff",   min: 28, max: 35 },  // C4 - C5
    { name: "trebleStaff", min: 36, max: 49 },  // D5 - C7
    { name: "trebleRow1",  min: 50, max: 56 },  // D7 - C8
    { name: "trebleRow2",  min: 57, max: 63 }   // D8 - C9
];

function letterOfTpc(tpc) {
    return TPC_LETTERS[(tpc + 1) % 7];
}

function alterOfTpc(tpc) {
    return Math.floor((tpc + 1) / 7) - 2;
}

function tpcOf(letter, alter) {
    return 7 * (alter + 2) + TPC_LETTERS.indexOf(letter) - 1;
}

function bellName(pitch, tpc) {
    var letter = letterOfTpc(tpc);
    var alter = alterOfTpc(tpc);
    // Subtracting the alteration moves the pitch to its natural before the
    // octave is taken, so Cb5 counts as octave 5 rather than octave 4.
    var octave = Math.floor((pitch - alter) / 12) - 1;
    return {
        pitch: pitch,
        tpc: tpc,
        letter: letter,
        alter: alter,
        octave: octave,
        name: letter + ACCIDENTAL_TEXT[String(alter)] + octave,
        diatonic: octave * 7 + LETTER_STEP[letter]
    };
}

function regionOf(bell) {
    for (var i = 0; i < REGIONS.length; i++) {
        if (bell.diatonic >= REGIONS[i].min && bell.diatonic <= REGIONS[i].max) {
            return REGIONS[i].name;
        }
    }
    return null;
}

module.exports = {
    letterOfTpc: letterOfTpc,
    alterOfTpc: alterOfTpc,
    tpcOf: tpcOf,
    bellName: bellName,
    regionOf: regionOf,
    REGIONS: REGIONS
};
