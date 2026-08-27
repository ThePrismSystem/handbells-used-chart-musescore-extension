/*
 * Assembles the chart plan: what the writer or the extension has to draw.
 *
 * Each section becomes one chart measure, and each entry in `parts` becomes one
 * appended instrument. They are separate lists because they are separate
 * counts: separate mode gives every chart an instrument of its own, and shared
 * mode puts every chart on one. A section names its instrument by index.
 *
 * Two charts still cannot share a measure. MuseScore's measure duration applies
 * across every staff, and two charts rarely have the same column count.
 */

var collectModule = require("./collect.js");
var columnsModule = require("./columns.js");
var optionalModule = require("./optional.js");
var bellrangeModule = require("./bellrange.js");
var skippartsModule = require("./skipparts.js");

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
    var skipped = skippartsModule.applySkipList(records, options.skipParts);
    var collected = collectModule.collect(skipped.records);
    var parts = [];
    var sections = [];

    // Which appended instrument a chart goes on.
    //
    // Separate mode gives every chart one of its own. Shared mode gives them
    // all the first, and widens it to a grand staff as soon as a chart needs
    // one: a shared staff carrying nothing but silver melody bells writes only
    // its treble half, and an unwritten lower half prints a brace over a blank
    // staff whatever hide-empty-staves is set to.
    function place(partId, staves) {
        if (!options.sharedStaff) {
            parts.push({ partId: partId, staves: staves });
            return parts.length - 1;
        }
        if (!parts.length) parts.push({ partId: "hand-bells", staves: staves });
        else if (staves > parts[0].staves) parts[0].staves = staves;
        return 0;
    }

    if (collected.bells.length) {
        sections.push(makeSection("bells", place("hand-bells", 2), "normal",
                                  collected.bells, options.bellLabel, "Handbells Used",
                                  ranges.bells));
    }
    if (collected.chimes.length) {
        sections.push(makeSection("chimes", place("hand-chimes", 2), "diamond",
                                  collected.chimes, options.chimeLabel, "Handchimes Used",
                                  ranges.chimes));
    }
    // On a hand-bells part like the handbell chart, because that is the part
    // shape the chart needs (an 8va clef, transposing an octave), and MuseScore
    // has no instrument for silver melody bells. What makes these a chart of
    // their own is the notehead and the label, not the instrument they are
    // written on.
    //
    // One staff, because every silver melody bell goes on the treble side and
    // hide-empty-staves keeps both halves of an instrument while either has
    // notes. A chart writing nothing to its lower staff has to not have one.
    //
    // No range: the whole set is optional or none of it is, so there is
    // nothing for a bracket to single out and the marker goes on the label.
    if (collected.smbs.length) {
        sections.push(makeSection("smbs", place("hand-bells", 1), "la",
                                  collected.smbs, options.smbLabel, "SMBs Used",
                                  bellrangeModule.bellRange(null, null),
                                  options.smbsOptional));
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
    // Its own type, because the compasses differ: B4 is an ordinary handbell
    // and a silver melody bell nobody makes, so one message cannot name both
    // the pitch and the limit it broke.
    if (collected.smbOutOfRange.length) {
        warnings.push({ type: "smb-out-of-range", names: collected.smbOutOfRange });
    }
    // Its own warning rather than a refusal. A stale entry naming a part the
    // arranger has since deleted costs nothing, and refusing would block the
    // chart over one typo in an option working correctly for every other name.
    if (skipped.unmatched.length) {
        warnings.push({ type: "skipped-part-not-found", names: skipped.unmatched });
    }

    return { parts: parts, sections: sections, warnings: warnings };
}

function makeSection(kind, part, head, entries, label, defaultLabel,
                     range, allOptional) {
    var built = columnsModule.buildColumns(entries);
    return {
        kind: kind,
        // An index into plan.parts, not an instrument id. Several sections
        // share one index in shared-staff mode.
        part: part,
        // A custom label replaces the whole of the generated one, the marker
        // included: someone who writes their own wording says everything they
        // want said, and having the plugin append to it would be a surprise.
        label: label || (defaultLabel + ": " + distinctPitches(entries)
                         + (allOptional ? " (optional)" : "")),
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
