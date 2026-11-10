/*
 * How a chart staff with fewer bells than its chart has columns spreads them
 * across the whole measure.
 *
 * A chart measure is as long as the staff with the most columns, a quarter
 * note each. The other staff used to write its bells at the left and pad the
 * rest with hidden rests, which published charts do not do: each staff spreads
 * its own bells evenly across the width. That staff is written as one tuplet
 * instead, its bells in the time of the measure's quarters, with no number and
 * no bracket. Where every chord in a measure overlaps the next segment,
 * MuseScore spaces by time alone, so the tuplet's bells land evenly and the
 * fuller staff keeps the spacing it had.
 *
 * Both front ends write the chart from these, so they agree on which staff is
 * a tuplet and how long a column on it lasts.
 */

// The tuplet a staff of `count` columns is written as in a chart of `columns`,
// or null for a staff that needs none: one that fills the chart already, and
// one with a single bell, which has nothing to spread. The ratio is kept as
// written. Reduced, 6:10 would become 3:5 of half notes.
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

module.exports = { tupletFor: tupletFor, columnLength: columnLength };
