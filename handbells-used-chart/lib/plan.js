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

// The two ranges the options name, parsed and checked.
//
// Exported because main.js has to refuse a bad name *before* it removes the
// score's previous chart: buildPlan runs after that removal, so a refusal
// raised here would leave the score with no chart and nothing to put back.
//
// Both are parsed whatever the score turns out to contain. Parsing a range
// only when its own section exists means a mistyped chime name on a
// bells-only score is silently ignored, and the user is never told why the
// range they set did nothing.
function readRanges(options) {
    options = options || {};
    return {
        bells: bellrangeModule.bellRange(options.requiredBellFirst,
                                         options.requiredBellLast, "bell"),
        chimes: bellrangeModule.bellRange(options.requiredChimeFirst,
                                          options.requiredChimeLast, "chime")
    };
}

function buildPlan(records, options) {
    options = options || {};
    var ranges = readRanges(options);
    var collected = collectModule.collect(records);
    var sections = [];

    if (collected.bells.length) {
        sections.push(makeSection("bells", "hand-bells", "normal",
                                  collected.bells, options.bellLabel, "Handbells Used",
                                  ranges.bells));
    }
    if (collected.chimes.length) {
        sections.push(makeSection("chimes", "hand-chimes", "diamond",
                                  collected.chimes, options.chimeLabel, "Handchimes Used",
                                  ranges.chimes));
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

module.exports = { buildPlan: buildPlan, readRanges: readRanges };
