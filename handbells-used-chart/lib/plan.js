/*
 * Assembles the chart plan: what the writer or the extension has to draw.
 *
 * Each section becomes one chart measure. The two charts cannot share a
 * measure, because MuseScore's measure duration applies across every staff
 * and the two charts rarely have the same column count.
 */

var collectModule = require("./collect.js");
var columnsModule = require("./columns.js");
var optionalModule = require("./optional.js");
var bellrangeModule = require("./bellrange.js");

function buildPlan(records, options) {
    options = options || {};
    var collected = collectModule.collect(records);
    var sections = [];

    if (collected.bells.length) {
        sections.push(makeSection("bells", "hand-bells", "normal",
                                  collected.bells, options.bellLabel, "Handbells Used",
                                  bellrangeModule.bellRange(options.requiredBellFirst,
                                                            options.requiredBellLast)));
    }
    if (collected.chimes.length) {
        sections.push(makeSection("chimes", "hand-chimes", "diamond",
                                  collected.chimes, options.chimeLabel, "Handchimes Used",
                                  bellrangeModule.bellRange(options.requiredChimeFirst,
                                                            options.requiredChimeLast)));
    }

    var warnings = [];
    if (collected.unknown) {
        warnings.push({ type: "unknown-notehead", count: collected.unknown });
    }
    if (collected.unreadable) {
        warnings.push({ type: "unreadable-pitch", count: collected.unreadable });
    }
    if (collected.outOfRange.length) {
        warnings.push({ type: "out-of-range", names: collected.outOfRange });
    }

    return { sections: sections, warnings: warnings };
}

function makeSection(kind, partId, head, entries, label, defaultLabel, range) {
    var built = columnsModule.buildColumns(entries);
    return {
        kind: kind,
        partId: partId,
        label: label || (defaultLabel + ": " + distinctPitches(entries)),
        columns: built.length,
        treble: toTicks(built.treble, head),
        bass: toTicks(built.bass, head),
        // Computed from the built columns rather than the entries, because a
        // bracket spans columns and the treble side stacks octaves into them.
        optional: optionalModule.optionalRuns(built, range)
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
