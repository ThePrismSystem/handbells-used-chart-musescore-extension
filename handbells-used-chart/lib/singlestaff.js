/*
 * Whether a chart can go on one staff, with the singleStaff setting on.
 *
 * A chart whose bells sit almost all on one side of the split, with a few just
 * across it, wastes a staff on those few: a piece starting at middle C prints
 * C5 alone on a bass staff under a full treble one. With the setting on, up to
 * three bells move across, as long as each is close to the split already. On
 * the treble staff that is G4 and up, written no lower than about two ledger
 * lines below it. On the bass staff it is F5 and down, the mirror of that. A
 * bell further away keeps the chart on two staves.
 *
 * So does a move that would leave one staff with optional bells from both ends
 * of the required range. A staff draws a single bracket, from its first
 * optional column to its last, and it would cover every required bell between.
 *
 * A bell's name is its sounding pitch, an octave above where it is written,
 * so C5 is the bell written at middle C. See bellname.js.
 */

var BASS_REGIONS = { bassRow2: true, bassRow1: true, bassStaff: true };

// How many bells may move across.
var MOST = 3;

// Diatonic indexes, octave * 7 + letter step: G4 and F5.
var LOWEST_TO_MOVE_UP = 32;
var HIGHEST_TO_MOVE_DOWN = 38;

function optionalAtBothEnds(entries, range) {
    var below = false;
    var above = false;
    for (var i = 0; i < entries.length; i++) {
        if (range.first !== null && entries[i].pitch < range.first) below = true;
        if (range.last !== null && entries[i].pitch > range.last) above = true;
    }
    return below && above;
}

// The entries with `which` moved into `region`. The moved ones are copies, so
// the caller's entries keep the regions collect gave them.
function moved(entries, which, region) {
    var out = [];
    for (var i = 0; i < entries.length; i++) {
        if (which.indexOf(entries[i]) < 0) {
            out.push(entries[i]);
            continue;
        }
        var copy = {};
        for (var key in entries[i]) {
            if (entries[i].hasOwnProperty(key)) copy[key] = entries[i][key];
        }
        copy.region = region;
        out.push(copy);
    }
    return out;
}

// The one staff a chart's entries can go on, as { sides, entries } with the
// moved bells' regions rewritten, or null when it needs both. When either side
// could move, the one with fewer bells does, and a tie moves the bass bells
// up, because treble-only charts are the usual kind. A side with no bells at
// all moves trivially, so a chart writing nothing on one staff loses it. That
// move changes no bracket either, so it goes ahead whatever range is set.
function oneStaff(entries, range) {
    var bass = [];
    var treble = [];
    for (var i = 0; i < entries.length; i++) {
        (BASS_REGIONS[entries[i].region] ? bass : treble).push(entries[i]);
    }
    var bracketed = optionalAtBothEnds(entries, range);
    var up = bass.length <= MOST && !(bracketed && bass.length)
        && bass.every(function (bell) { return bell.diatonic >= LOWEST_TO_MOVE_UP; });
    var down = treble.length <= MOST && !(bracketed && treble.length)
        && treble.every(function (bell) { return bell.diatonic <= HIGHEST_TO_MOVE_DOWN; });
    if (up && (!down || bass.length <= treble.length)) {
        return { sides: ["treble"], entries: moved(entries, bass, "trebleStaff") };
    }
    if (down) return { sides: ["bass"], entries: moved(entries, treble, "bassStaff") };
    return null;
}

module.exports = { oneStaff: oneStaff };
