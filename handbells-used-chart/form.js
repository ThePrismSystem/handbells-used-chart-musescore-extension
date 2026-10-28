/*
 * What the options dialog calls. Options.qml reaches these through bundle.js,
 * which tools/bundle.js generates from this file and the ones it requires.
 */

var run = require("./run.js");
var readModule = require("./read.js");
var engravingModule = require("./engraving.js");
var optionsModule = require("./lib/options.js");
var skipparts = require("./lib/skipparts.js");
var colors = require("./lib/colors.js");
var noteheads = require("./lib/noteheads.js");

var host = { api: null, interactive: null, log: null };

// A form has no require of its own for MuseApi.Interactive or the log, so
// the QML hands both in.
function setup(api, interactive, log) {
    host.api = api;
    host.interactive = interactive;
    host.log = log;
}

function engraving() {
    return engravingModule.adapt(host.api.engraving);
}

function settings() {
    return run.readOptions(host.api.engraving.curScore);
}

// The first staff of the chart's own parts, or the staff count when the score
// has no chart. The chart's parts are the last handbellChartParts parts, the
// way mutate.js records them. A tampered count is treated as no chart here;
// the build itself refuses it.
function firstChartStaff(score) {
    var count = Number(score.metaTag("handbellChartParts"));
    var first = score.parts.length - count;
    if (!count || !Number.isInteger(count) || first < 0) return score.nstaves;
    return score.parts[first].startTrack / 4;
}

// What the dialog needs to know about the score: its instruments and the
// noteheads its music uses. The chart's own parts are left out, found by
// position rather than by name, since the chart's names are its own labels
// and a user could call a part anything.
//
// An instrument is a part name, compared the way the skip list compares
// them, so two parts the skip list cannot tell apart get one toggle.
function facts() {
    var score = host.api.engraving.curScore;
    var chartStaff = firstChartStaff(score);
    var parts = [];
    var seen = {};
    for (var s = 0; s < chartStaff; s++) {
        var name = readModule.partNameOfStaff(score, s);
        if (seen[skipparts.normalise(name)]) continue;
        seen[skipparts.normalise(name)] = true;
        parts.push(name);
    }

    var all = readModule.readScore(engraving(), score);
    var records = [];
    for (var r = 0; r < all.length; r++) {
        if (all[r].staffId - 1 < chartStaff) records.push(all[r]);
    }
    var heads = [];
    var byName = {};
    for (var i = 0; i < records.length; i++) {
        var head = records[i].head;
        if (!byName[head]) {
            byName[head] = { name: head, count: 0, color: colors.mostUsedColor(records, head) };
            heads.push(byName[head]);
        }
        byName[head].count++;
    }
    return { parts: parts, heads: heads };
}

// Each instrument, and whether the skip list leaves it on the chart. A part
// with no name cannot be skipped: the skip list drops a blank entry, which
// would otherwise match every unnamed part in the score.
function instruments(parts, skipParts) {
    var skipped = {};
    var wanted = skipparts.parse(skipParts);
    for (var i = 0; i < wanted.length; i++) skipped[wanted[i].key] = true;
    var out = [];
    for (var j = 0; j < parts.length; j++) {
        var key = skipparts.normalise(parts[j]);
        out.push({ name: parts[j], charted: !skipped[key], skippable: key !== "" });
    }
    return out;
}

// The skip list to save once the user has ticked and unticked instruments.
// Names in the old list that match no instrument here are kept first: the
// dialog has no toggle for them, so it has no business dropping them.
function skipPartsFor(previous, parts, uncharted) {
    var present = {};
    for (var i = 0; i < parts.length; i++) present[skipparts.normalise(parts[i])] = true;
    var names = [];
    var wanted = skipparts.parse(previous);
    for (var j = 0; j < wanted.length; j++) {
        if (!present[wanted[j].key]) names.push(wanted[j].given);
    }
    return skipparts.format(names.concat(uncharted));
}

// The choices for one kind's notehead dropdown: the noteheads the music
// uses, in the order the music first uses them, then the kind's current
// setting if the music does not use it, then none. A notehead the read could
// not name is left out, since a kind set to it would be refused.
function headChoices(heads, current) {
    var choices = [];
    var listed = {};
    for (var i = 0; i < heads.length; i++) {
        if (!noteheads.isName(heads[i].name)) continue;
        choices.push({ text: heads[i].name + " (" + heads[i].count + " notes)", value: heads[i].name });
        listed[heads[i].name] = true;
    }
    if (current !== "none" && !listed[current]) {
        choices.push({ text: current + " (not in this score)", value: current });
    }
    choices.push({ text: "none", value: "none" });
    return choices;
}

// What a kind's colour field shows: the colour typed into it, or when it is
// blank, the colour most of the chosen notehead's notes carry in the music.
function colorFor(heads, head, current) {
    if (current) return current;
    for (var i = 0; i < heads.length; i++) {
        if (heads[i].name === head) return heads[i].color;
    }
    return "";
}

function reporter(options) {
    return run.reporter(options, host.interactive, host.log);
}

// Saves the dialog's settings into the score's fields, then builds from them.
// A setting the build would refuse is refused before the save, so it never
// reaches the fields. A chart the build cannot identify is only found once the
// save is done, and that refusal leaves the new settings saved. The save is its
// own command and the build runs outside it, because cmd() inside an open
// startCmd block takes MuseScore down.
function build(options) {
    var score = host.api.engraving.curScore;
    var report = reporter(options);
    try {
        run.precheck(engraving(), options);
    } catch (e) {
        var message = run.messageOf(e);
        report.say("error", message);
        return { ok: false, summary: message };
    }

    var changes = optionsModule.changedTags(options, function (tag) {
        return score.metaTag(tag);
    });
    if (changes.length) {
        score.startCmd();
        for (var i = 0; i < changes.length; i++) score.setMetaTag(changes[i].tag, changes[i].value);
        score.endCmd();
    }
    return run.build(engraving(), score, options, report);
}

// What the dialog shows once a build or removal is done: the summary, then
// any warnings.
function statusOf(result) {
    var warnings = result.warnings || [];
    return warnings.length ? result.summary + "\n\n" + warnings.join("\n") : result.summary;
}

function remove() {
    var score = host.api.engraving.curScore;
    var options = settings();
    return run.remove(engraving(), score, options, reporter(options));
}

function lists() {
    return {
        naturalNotes: optionsModule.NATURAL_NOTES,
        shapes: optionsModule.SHAPES,
        modes: optionsModule.MODES
    };
}

module.exports = {
    setup: setup,
    settings: settings,
    facts: facts,
    build: build,
    remove: remove,
    lists: lists,
    instruments: instruments,
    skipPartsFor: skipPartsFor,
    headChoices: headChoices,
    colorFor: colorFor,
    statusOf: statusOf
};
