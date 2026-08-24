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

// The geometry of one run's bracket. The two front ends draw it through
// different machinery — tools/writer.js emits XML text, mutate.js builds
// elements through the MuseScore API — but they have to place it identically,
// and each of these was written twice and had to be kept in step by hand until
// it moved here. What stays with each front end is only the formatting: a
// fraction reduced into a string on one side, an engraving.fraction on the
// other, "above" against the integer 0.

// How many columns the bracket reaches across. Zero for a one-column run,
// which draws no line at all — the word alone marks that bell optional.
function spanColumns(run) {
    return run.lastColumn - run.firstColumn;
}

// The column the word is anchored to, so it centres on its bracket. An
// even-length run floors to the earlier column rather than sitting on a
// half-column boundary neither front end can express.
function wordColumn(run) {
    return Math.floor((run.firstColumn + run.lastColumn) / 2);
}

// Which side of the staff the bracket and its word sit on. Optional bells are
// the extremes of the range, so the treble staff's sit above it and the bass
// staff's below, each clear of the notes it belongs to.
function isAbove(run) {
    return run.staff === "treble";
}

// How far each end of the bracket is nudged past the bells it covers, in
// spatium. Both front ends need these, and both had to be measured off a real
// render to arrive at, so they belong here rather than in either one.
//
// A spanner is anchored notehead to notehead, and MuseScore then draws it from
// the first anchor's left edge to 0.70sp short of the last anchor's left edge.
// A chart bracket has to enclose its bells instead, so the end has that 0.70sp
// backoff to make up, plus the width of the last notehead, before either end
// gets the overhang that keeps the bracket clear of the noteheads.
//
// These are the score's spatium, not the chart staves' own — which is why the
// notehead is 0.91 and not the 1.30 a full-size one measures. tools/writer.js's
// XML offsets are read in the score's spatium and take these unchanged; the
// API's offsets are read in the staff's, so mutate.js divides by the chart
// staves' magnification before it can use them.
var NOTEHEAD_WIDTH = 0.91;
var END_BACKOFF = 0.70;
var OVERHANG = 0.25;

// The bracket as a whole slides left by the overhang, because the mechanism
// both front ends have for the start moves both ends together.
function startOffset() {
    return -OVERHANG;
}

// And the end then reaches further still, measured from the shifted start
// rather than from the anchor — which is why this is not simply the distance
// the end has to travel. tools/writer.js writes it as a spatium offset, which
// MuseScore honours exactly; mutate.js has to spend it as time instead, and
// divides it by what one chart column measures on the page.
function endOffset() {
    return END_BACKOFF + NOTEHEAD_WIDTH + OVERHANG - startOffset();
}

module.exports = {
    optionalRuns: optionalRuns,
    spanColumns: spanColumns,
    wordColumn: wordColumn,
    isAbove: isAbove,
    startOffset: startOffset,
    endOffset: endOffset
};
