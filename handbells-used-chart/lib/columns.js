/*
 * Turns a sorted list of bells into the columns of a chart.
 *
 * A column is one chord: notes sharing a tick. On the treble side a bell an
 * octave or two above a staff bell shares that bell's column, so D6, D7 and
 * D8 print as one stack. On the bass side the low bells form their own
 * columns at the left, ahead of the bells that sit on the staff.
 *
 * Because two bells with the same letter and the same alteration share a
 * tonal pitch class, an anchor can be found by (pitch - offset, tpc), which
 * matches spelling as well as pitch.
 */

function buildColumns(entries) {
    var byRegion = {
        bassRow2: [], bassRow1: [], bassStaff: [],
        trebleStaff: [], trebleRow1: [], trebleRow2: []
    };
    for (var i = 0; i < entries.length; i++) {
        byRegion[entries[i].region].push(entries[i]);
    }

    var treble = anchor(byRegion.trebleStaff, [
        { list: byRegion.trebleRow1, offset: 12 },
        { list: byRegion.trebleRow2, offset: 24 }
    ]);

    var lowBlock = anchor(byRegion.bassRow1, [
        { list: byRegion.bassRow2, offset: -12 }
    ]);
    var bass = lowBlock.concat(single(byRegion.bassStaff));

    return {
        treble: treble,
        bass: bass,
        length: Math.max(treble.length, bass.length)
    };
}

function single(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push([list[i]]);
    return out;
}

// Builds columns around `anchors`, attaching each entry in `attachments` to
// the anchor `offset` semitones away with the same spelling. An entry with no
// anchor becomes its own column, sorted as though its anchor existed, so the
// left-to-right reading order stays ascending.
function anchor(anchors, attachments) {
    var columns = [];
    var index = {};
    var i, j;

    for (i = 0; i < anchors.length; i++) {
        index[anchors[i].pitch + ":" + anchors[i].tpc] = columns.length;
        columns.push({ sortPitch: anchors[i].pitch, sortAlter: -anchors[i].alter, notes: [anchors[i]] });
    }

    for (i = 0; i < attachments.length; i++) {
        var list = attachments[i].list;
        var offset = attachments[i].offset;
        for (j = 0; j < list.length; j++) {
            var entry = list[j];
            var anchorPitch = entry.pitch - offset;
            var at = index[anchorPitch + ":" + entry.tpc];
            if (at !== undefined) {
                columns[at].notes.push(entry);
            } else {
                columns.push({ sortPitch: anchorPitch, sortAlter: -entry.alter, notes: [entry] });
            }
        }
    }

    columns.sort(function (a, b) {
        return (a.sortPitch - b.sortPitch) || (a.sortAlter - b.sortAlter);
    });

    var out = [];
    for (i = 0; i < columns.length; i++) {
        columns[i].notes.sort(function (a, b) { return a.pitch - b.pitch; });
        out.push(columns[i].notes);
    }
    return out;
}

module.exports = { buildColumns: buildColumns };
