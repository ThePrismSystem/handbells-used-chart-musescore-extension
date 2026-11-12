/*
 * How a chart staff with fewer columns than its chart spreads them across the
 * whole measure.
 *
 * A chart measure is as long as the staff with the most columns, a quarter
 * note each. Published charts spread each staff's bells evenly across the
 * width, so the other staff is written as one tuplet, its bells in the time of
 * the measure's quarters, with no number and no bracket. Where every chord in
 * a measure overlaps the next segment, MuseScore spaces by time alone, so the
 * tuplet's bells land evenly and the fuller staff's quarters stay evenly
 * spaced too.
 *
 * Both front ends write the chart from these, so they agree on which staff is
 * a tuplet and how long a column on it lasts.
 */

// The tuplet a staff of `count` columns is written as in a chart of `columns`,
// or null for a staff that needs none: one that fills the chart already, and
// one with a single column, which has nothing to spread. A stack of bells is
// one column. The ratio is kept as written, count:columns of quarter notes, so
// each column is one quarter inside the tuplet. Reduced, 6:10 would become 3:5
// and need half notes.
function tupletFor(count, columns) {
    if (count <= 1 || count >= columns) return null;
    return { actual: count, normal: columns };
}

// How long one column on that staff lasts, as a fraction of a whole note: a
// quarter, or inside a tuplet the measure's length shared between its bells.
function columnLength(count, columns) {
    if (!tupletFor(count, columns)) return { numerator: 1, denominator: 4 };
    return { numerator: columns, denominator: 4 * count };
}

// TupletNumberType.NO_TEXT and TupletBracketType.SHOW_NO_BRACKET, which keep
// the tuplet's number and bracket off the page. Both are 2 in MuseScore 4.7.
// tools/writer.js writes them into the XML, and the extension assigns them as
// plain numbers, which is how they read at apiversion 2.
var NO_NUMBER = 2;
var NO_BRACKET = 2;

module.exports = {
    tupletFor: tupletFor,
    columnLength: columnLength,
    NO_NUMBER: NO_NUMBER,
    NO_BRACKET: NO_BRACKET
};
