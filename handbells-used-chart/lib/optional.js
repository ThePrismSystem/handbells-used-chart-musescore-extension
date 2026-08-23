/*
 * Which chart columns fall outside the required range.
 *
 * A run is the span from the first optional column on a staff to the last,
 * gaps included. That is one bracket per staff, which is what the published
 * charts draw: the optional bells sit at the extremes, so on the treble side
 * they attach as stacked octaves to the highest staff bells and come out
 * contiguous on their own.
 *
 * A column counts as optional when any bell in it is. On the treble side a
 * column can hold a required staff bell with an optional octave stacked above
 * it, and the bracket covers that column — which is what the My Neighbor
 * Totoro chart shows.
 */

var bellrange = require("./bellrange.js");

var STAVES = ["treble", "bass"];

function runFor(columns, range) {
    var first = -1;
    var last = -1;
    for (var i = 0; i < columns.length; i++) {
        var optional = false;
        for (var j = 0; j < columns[i].length; j++) {
            if (bellrange.isOptional(range, columns[i][j].pitch)) {
                optional = true;
                break;
            }
        }
        if (!optional) continue;
        if (first < 0) first = i;
        last = i;
    }
    if (first < 0) return null;
    return { firstColumn: first, lastColumn: last };
}

function optionalRuns(built, range) {
    var runs = [];
    for (var i = 0; i < STAVES.length; i++) {
        var staff = STAVES[i];
        var run = runFor(built[staff] || [], range);
        if (run) {
            runs.push({ staff: staff, firstColumn: run.firstColumn,
                        lastColumn: run.lastColumn });
        }
    }
    return runs;
}

module.exports = { optionalRuns: optionalRuns };
