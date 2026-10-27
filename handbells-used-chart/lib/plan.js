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
var colorsModule = require("./colors.js");
var noteheads = require("./noteheads.js");
var shapes = require("./shapes.js");
var optionsModule = require("./options.js");

// The settings naming each kind's notehead, and what to call the kind when
// two of them clash.
var HEAD_SETTINGS = [
    { kind: "bells", key: "bellHead", name: "Handbells" },
    { kind: "chimes", key: "chimeHead", name: "Handchimes" },
    { kind: "smbs", key: "smbHead", name: "Silver melody bells" },
    { kind: "pf", key: "pfHead", name: "P&F Handbells" },
    { kind: "whitechapel", key: "whitechapelHead", name: "Whitechapel Handbells" }
];

function settingFor(key) {
    for (var i = 0; i < optionsModule.SETTINGS.length; i++) {
        if (optionsModule.SETTINGS[i].key === key) return optionsModule.SETTINGS[i];
    }
    return null;
}

// The notehead each kind is read from, null for a kind set to none.
//
// Refused before anything is removed, like a mistyped range. Two kinds on one
// notehead would split the same notes between two charts, and a notehead
// MuseScore does not have can never match anything, so either one means the
// settings are not what the user meant.
function readHeads(options) {
    options = options || {};
    var heads = {};
    var owner = {};
    for (var i = 0; i < HEAD_SETTINGS.length; i++) {
        var entry = HEAD_SETTINGS[i];
        var setting = settingFor(entry.key);
        var value = options[entry.key] ? options[entry.key] : setting.fallback;
        if (value === "none") {
            heads[entry.kind] = null;
            continue;
        }
        if (!noteheads.isName(value)) {
            throw new Error(setting.tag + " is \"" + value + "\", which is not a MuseScore "
                + "notehead. Use one of its notehead names, such as cross or "
                + "triangle-up, or none.");
        }
        if (owner[value]) {
            throw new Error(owner[value] + " and " + entry.name + " are both set to the "
                + value + " notehead. Choose a different notehead for one of them.");
        }
        owner[value] = entry.name;
        heads[entry.kind] = value;
    }
    return heads;
}

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
    var heads = readHeads(options);
    var skipped = skippartsModule.applySkipList(records, options.skipParts);
    var collected = collectModule.collect(skipped.records, heads);
    var parts = [];
    var sections = [];

    // Which appended instrument a chart goes on.
    //
    // Separate mode gives every chart one of its own. Shared mode gives them
    // all the first, and widens it to a grand staff as soon as a chart needs
    // one: a shared staff carrying nothing but silver melody bells writes only
    // its treble half, and an unwritten lower half prints a brace over a blank
    // staff whatever hide-empty-staves is set to.
    // The wording is the generated default and never the user's own label.
    // A custom label replaces the whole of the words above the measure; the
    // name beside the staff is a different thing in a different place, and
    // taking the label's count into it would print "Handbells Used: 23" twice.
    function place(partId, staves, name) {
        if (!options.sharedStaff) {
            parts.push({ partId: partId, staves: staves, name: name });
            return parts.length - 1;
        }
        if (!parts.length) parts.push({ partId: "hand-bells", staves: staves, name: name });
        else if (staves > parts[0].staves) parts[0].staves = staves;
        return 0;
    }

    if (collected.bells.length) {
        sections.push(makeSection("bells", place("hand-bells", 2, "Handbells Used"), shapes.chartHead(options.bellShape, heads.bells),
                                  null, collected.bells, options.bellLabel, "Handbells Used",
                                  ranges.bells));
    }
    if (collected.chimes.length) {
        sections.push(makeSection("chimes", place("hand-chimes", 2, "Handchimes Used"), shapes.chartHead(options.chimeShape, heads.chimes),
                                  colorsModule.usableColor(options.chimeColor),
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
        sections.push(makeSection("smbs", place("hand-bells", 1, "SMBs Used"), shapes.chartHead(options.smbShape, heads.smbs),
                                  colorsModule.usableColor(options.smbColor),
                                  collected.smbs, options.smbLabel, "SMBs Used",
                                  bellrangeModule.bellRange(null, null),
                                  options.smbsOptional));
    }

    // P&F and Whitechapel sets are handbells by another maker, charted on the
    // handbell part shape and compass. They have no required range: neither
    // set is commonly split into the bells a piece needs and the ones it can
    // do without.
    if (collected.pf.length) {
        sections.push(makeSection("pf", place("hand-bells", 2, "P&F Handbells Used"), shapes.chartHead(options.pfShape, heads.pf),
                                  colorsModule.usableColor(options.pfColor),
                                  collected.pf, options.pfLabel, "P&F Handbells Used",
                                  bellrangeModule.bellRange(null, null)));
    }
    if (collected.whitechapel.length) {
        sections.push(makeSection("whitechapel",
                                  place("hand-bells", 2, "Whitechapel Handbells Used"),
                                  shapes.chartHead(options.whitechapelShape, heads.whitechapel),
                                  colorsModule.usableColor(options.whitechapelColor),
                                  collected.whitechapel, options.whitechapelLabel,
                                  "Whitechapel Handbells Used",
                                  bellrangeModule.bellRange(null, null)));
    }

    var warnings = [];
    if (collected.unknown) {
        warnings.push({ type: "unknown-notehead", count: collected.unknown,
                        names: collected.unknownNames });
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

// Each kind's notes take the head and colour the section gives them, so
// the two writers draw what the plan says and decide neither.
function makeSection(kind, part, head, color, entries, label, defaultLabel,
                     range, allOptional) {
    var built = columnsModule.buildColumns(entries);
    return {
        kind: kind,
        // An index into plan.parts, not an instrument id. Several sections
        // share one index in shared-staff mode.
        part: part,
        // The wording for this chart's own instrument name, which on a shared
        // staff is not the same as the part's: the part takes the first chart's
        // wording and every measure after that carries its own.
        name: defaultLabel,
        // A custom label replaces the whole of the generated one, the marker
        // included: someone who writes their own wording says everything they
        // want said, and having the plugin append to it would be a surprise.
        label: label || (defaultLabel + ": " + distinctPitches(entries)
                         + (allOptional ? " (optional)" : "")),
        columns: built.length,
        treble: toTicks(built.treble, head, color),
        bass: toTicks(built.bass, head, color),
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

// A note carries a colour only when it has one.
function toTicks(columns, head, color) {
    var out = [];
    for (var i = 0; i < columns.length; i++) {
        var notes = [];
        for (var j = 0; j < columns[i].length; j++) {
            var note = {
                pitch: columns[i][j].pitch,
                tpc: columns[i][j].tpc,
                head: head
            };
            if (color) note.color = color;
            notes.push(note);
        }
        out.push({ tick: i, notes: notes });
    }
    return out;
}

module.exports = { buildPlan: buildPlan, readRanges: readRanges, readHeads: readHeads };
