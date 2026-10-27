/*
 * What the options dialog calls. Options.qml reaches these through bundle.js,
 * which tools/bundle.js generates from this file and the ones it requires.
 */

var run = require("./run.js");
var readModule = require("./read.js");
var engravingModule = require("./engraving.js");
var optionsModule = require("./lib/options.js");
var planModule = require("./lib/plan.js");
var skipparts = require("./lib/skipparts.js");

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
        var name = score.staves[s].part ? score.staves[s].part.partName : "";
        if (seen[skipparts.normalise(name)]) continue;
        seen[skipparts.normalise(name)] = true;
        parts.push(name);
    }

    var records = readModule.readScore(engraving(), score);
    var heads = [];
    var byName = {};
    for (var i = 0; i < records.length; i++) {
        if (records[i].staffId - 1 >= chartStaff) continue;
        var head = records[i].head;
        if (!byName[head]) {
            byName[head] = { name: head, count: 0, color: records[i].color || "" };
            heads.push(byName[head]);
        }
        byName[head].count++;
    }
    return { parts: parts, heads: heads };
}

// Each instrument, and whether the skip list leaves it on the chart.
function instruments(parts, skipParts) {
    var skipped = {};
    var wanted = skipparts.parse(skipParts);
    for (var i = 0; i < wanted.length; i++) skipped[wanted[i].key] = true;
    var out = [];
    for (var j = 0; j < parts.length; j++) {
        out.push({ name: parts[j], charted: !skipped[skipparts.normalise(parts[j])] });
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
    return names.concat(uncharted).join(", ");
}

function reporter(options) {
    return run.reporter(options, host.interactive, host.log);
}

// Saves the dialog's settings into the score's fields, then builds from them.
// Everything the build would refuse is refused first, so a refusal leaves the
// fields as they were. The save is its own command and the build runs outside
// it, because cmd() inside an open startCmd block takes MuseScore down.
function build(options) {
    var score = host.api.engraving.curScore;
    var report = reporter(options);
    try {
        optionsModule.validateOptions(options);
        planModule.readRanges(options);
        engraving().check();
    } catch (e) {
        var message = e && e.message ? String(e.message) : String(e);
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
    skipPartsFor: skipPartsFor
};
