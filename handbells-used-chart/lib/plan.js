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

// The kinds, in chart order. key is the prefix of a kind's settings, as in
// bellHead, bellShape, bellLabel and bellColor. name is what to call the kind
// when two of them clash over a notehead, and words is its generated label.
//
// Silver melody bells go on a hand-bells part like the handbell chart, because
// that is the part shape the chart needs (an 8va clef, transposing an octave),
// and MuseScore has no instrument for them. What makes theirs a chart of its
// own is the notehead and the label, not the instrument. It has one staff,
// because every silver melody bell goes on the treble side and
// hide-empty-staves keeps both halves of an instrument while either has notes.
// A chart writing nothing to its lower staff has to not have one. It has no
// range either: the whole set is optional or none of it is, so there is
// nothing for a bracket to single out, and the marker goes on the label.
//
// P&F and Whitechapel sets are handbells by another maker, charted on the
// handbell part shape and compass. They have no required range: neither set is
// commonly split into the bells a piece needs and the ones it can do without.
var KINDS = [
    { kind: "bells", key: "bell", name: "Handbells", words: "Handbells Used",
      partId: "hand-bells", staves: 2 },
    { kind: "chimes", key: "chime", name: "Handchimes", words: "Handchimes Used",
      partId: "hand-chimes", staves: 2 },
    { kind: "smbs", key: "smb", name: "Silver melody bells", words: "SMBs Used",
      partId: "hand-bells", staves: 1, optional: "smbsOptional" },
    { kind: "pf", key: "pf", name: "P&F Handbells", words: "P&F Handbells Used",
      partId: "hand-bells", staves: 2 },
    { kind: "whitechapel", key: "whitechapel", name: "Whitechapel Handbells",
      words: "Whitechapel Handbells Used", partId: "hand-bells", staves: 2 }
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
    for (var i = 0; i < KINDS.length; i++) {
        var entry = KINDS[i];
        var setting = settingFor(entry.key + "Head");
        var value = options[setting.key] ? options[setting.key] : setting.fallback;
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
// Exported because run.js has to refuse a bad name *before* it removes the
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
    // Without a shared staff every chart gets one of its own. A shared staff
    // gives them all the first, and widens it to a grand staff as soon as a
    // chart needs one: a shared staff carrying nothing but silver melody bells
    // writes only its treble half, and an unwritten lower half prints a brace
    // over a blank staff whatever hide-empty-staves is set to.
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

    // In separate mode, the instrument a chart belongs to, as "Handbells I - ".
    var prefix = "";

    // A custom label is prefixed like a generated one, so a reader can tell
    // whose chart it is either way.
    function custom(label) {
        return label ? prefix + label : label;
    }

    // Every chart one set of notes needs, each label and name led by prefix.
    function addSections(kinds) {
        for (var k = 0; k < KINDS.length; k++) {
            var entry = KINDS[k];
            if (!kinds[entry.kind].length) continue;
            var words = prefix + entry.words;
            sections.push(makeSection(entry.kind, place(entry.partId, entry.staves, words),
                                      shapes.chartHead(options[entry.key + "Shape"], heads[entry.kind]),
                                      colorsModule.usableColor(options[entry.key + "Color"]),
                                      kinds[entry.kind], custom(options[entry.key + "Label"]),
                                      words,
                                      ranges[entry.kind] || bellrangeModule.bellRange(null, null),
                                      entry.optional ? options[entry.optional] : false));
        }
        return sections.length;
    }

    var empty = [];
    var instruments = options.mode === "separate" ? byInstrument(skipped.records) : [];
    if (instruments.length < 2) {
        addSections(collected);
    } else {
        for (var i = 0; i < instruments.length; i++) {
            prefix = instruments[i].name + " - ";
            var before = sections.length;
            if (addSections(collectModule.collect(instruments[i].records, heads)) === before) {
                empty.push(instruments[i].name);
            }
        }
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
    if (empty.length) {
        warnings.push({ type: "empty-instrument", names: empty });
    }

    return { parts: parts, sections: sections, warnings: warnings };
}

// The records grouped by instrument, in the order the instruments first
// appear. An instrument is a part name, compared the way the skip list
// compares them, so two parts with one name chart together under the name
// the first of them gives.
function byInstrument(records) {
    var instruments = [];
    var byKey = {};
    for (var i = 0; i < records.length; i++) {
        var key = skippartsModule.normalise(records[i].partName);
        if (!byKey[key]) {
            byKey[key] = { name: String(records[i].partName).trim(), records: [] };
            instruments.push(byKey[key]);
        }
        byKey[key].records.push(records[i]);
    }
    return instruments;
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
