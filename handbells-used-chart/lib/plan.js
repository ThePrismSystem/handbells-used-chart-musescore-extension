/*
 * Assembles the chart plan: what the writer or the QML plugin has to draw.
 *
 * Each section becomes one chart measure. The two charts cannot share a
 * measure, because MuseScore's measure duration applies across every staff
 * and the two charts rarely have the same column count.
 */

var collectModule = require("./collect.js");
var columnsModule = require("./columns.js");

function buildPlan(records, options) {
    options = options || {};
    var collected = collectModule.collect(records);
    var sections = [];

    if (collected.bells.length) {
        sections.push(makeSection("bells", "hand-bells", "normal",
                                  collected.bells, options.bellLabel, "Handbells Used"));
    }
    if (collected.chimes.length) {
        sections.push(makeSection("chimes", "hand-chimes", "diamond",
                                  collected.chimes, options.chimeLabel, "Handchimes Used"));
    }

    var warnings = [];
    if (collected.unknown) {
        warnings.push({ type: "unknown-notehead", count: collected.unknown });
    }
    if (collected.outOfRange.length) {
        warnings.push({ type: "out-of-range", names: collected.outOfRange });
    }

    return { sections: sections, warnings: warnings };
}

function makeSection(kind, partId, head, entries, label, defaultLabel) {
    var built = columnsModule.buildColumns(entries);
    return {
        kind: kind,
        partId: partId,
        label: label || (defaultLabel + ": " + distinctPitches(entries)),
        columns: built.length,
        treble: toTicks(built.treble, head),
        bass: toTicks(built.bass, head)
    };
}

// The label counts physical bells, so two spellings of one pitch count once.
function distinctPitches(entries) {
    var seen = {};
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
        if (!seen[entries[i].pitch]) {
            seen[entries[i].pitch] = true;
            total++;
        }
    }
    return total;
}

function toTicks(columns, head) {
    var out = [];
    for (var i = 0; i < columns.length; i++) {
        var notes = [];
        for (var j = 0; j < columns[i].length; j++) {
            notes.push({
                pitch: columns[i][j].pitch,
                tpc: columns[i][j].tpc,
                head: head
            });
        }
        out.push({ tick: i, notes: notes });
    }
    return out;
}

module.exports = { buildPlan: buildPlan };
