/*
 * Builds and removes the chart. Every action calls through here: the two
 * menu entries that run from Project Properties, and the options dialog.
 *
 * The planning is done by lib/, shared verbatim with the command-line tool.
 * This file reads the score, asks lib/ what to draw, and hands the answer to
 * mutate.js.
 */

var readModule = require("./read.js");
var planModule = require("./lib/plan.js");
var mutateModule = require("./mutate.js");
var optionsModule = require("./lib/options.js");
var warningsModule = require("./lib/warnings.js");

var TITLE = "Handbells Used Chart";

function readOptions(score) {
    return optionsModule.readOptions(function (tag) { return score.metaTag(tag); });
}

// Calling an Interactive method in a headless run blocks until the process is
// killed, and MuseScore saves at the end of a job, so the whole run is lost
// with no error. Nothing in the API reports whether a run is interactive, so
// the score says so.
//
// The caller hands in Interactive and the log, because a macros action and a
// form reach them by different routes.
function reporter(options, interactive, log) {
    if (options.quiet) {
        return {
            say: function (kind, text) { log.info(TITLE + " [" + kind + "] " + text); }
        };
    }
    return {
        say: function (kind, text) { interactive[kind](TITLE, text); }
    };
}

// MuseScore's engine throws strings and wrapper objects as readily as Errors,
// and e.message on those is undefined. A thrown null would make the read
// itself throw, out of the catch and past every record of the failure, so the
// guard comes first.
function messageOf(error) {
    if (error && error.message) return String(error.message);
    return String(error);
}

// The distinct noteheads the read found, in the order it met them. A test's
// only way to compare what each front end calls a notehead.
function headsOf(records) {
    var heads = [];
    for (var i = 0; i < records.length; i++) {
        if (heads.indexOf(records[i].head) < 0) heads.push(records[i].head);
    }
    return heads;
}

// Each notehead and the colour its notes carry, as "diamond:#c00000", once per
// pair in the order the read met them. "" is black.
function colorsOf(records) {
    var pairs = [];
    for (var i = 0; i < records.length; i++) {
        var pair = records[i].head + ":" + (records[i].color || "");
        if (pairs.indexOf(pair) < 0) pairs.push(pair);
    }
    return pairs;
}

function labelsOf(plan) {
    var labels = [];
    for (var i = 0; i < plan.sections.length; i++) labels.push(plan.sections[i].label);
    return labels;
}

// The tag is written before the reporter is called, not after. On a non-quiet
// run report.say goes through Interactive, which can throw; writing second
// would lose the only durable record of the failure in exactly the case that
// produced one.
function recordError(score, report, message) {
    score.startCmd();
    score.setMetaTag("handbellChartError", message);
    score.endCmd();
    report.say("error", message);
    return { ok: false, summary: message };
}

// Cleared, not left: a refusal from an earlier run otherwise sits in Project
// Properties for the life of the score, describing a state it is no longer in.
function recordReport(score, summary) {
    score.startCmd();
    score.setMetaTag("handbellChartReport", summary);
    score.setMetaTag("handbellChartError", "");
    score.endCmd();
}

// Everything a build refuses, checked before anything is removed. buildPlan
// parses the ranges again, but it runs after removeChart has deleted the
// score's previous chart, so a name refused there would take the old chart
// with it and build nothing in its place. A user would lose a chart by
// mistyping a bell name. Refusing here leaves the score exactly as it was
// found.
//
// The element check is here for the same reason: on a MuseScore whose element
// numbers this extension does not know, the build would fail on its first new
// element, after the old chart was already gone.
function precheck(engraving, options) {
    optionsModule.validateOptions(options);
    planModule.readRanges(options);
    planModule.readHeads(options);
    engraving.check();
}

// Returns what it reported, warnings included, so the dialog can show it as
// well.
function build(engraving, score, options, report) {
    try {
        precheck(engraving, options);
    } catch (e) {
        return recordError(score, report, messageOf(e));
    }

    // The read sits inside the try, not between two of them. By the time
    // readScore runs, removeChart has already deleted the previous chart, and
    // an exception escaping main() there is still saved by the job runner:
    // chart gone, nothing recorded, nothing said.
    //
    // Nothing in this block may open a startCmd/endCmd, because removeChart
    // and buildChart both call cmd(). The metaTag writes outside it take one.
    var replaced;
    var records;
    var plan;
    try {
        replaced = mutateModule.removeChart(engraving, score);
        records = readModule.readScore(engraving, score);
        plan = planModule.buildPlan(records, options);
    } catch (e) {
        return recordError(score, report, messageOf(e));
    }

    // The only channel out of a headless run. handbellChartRan proves this
    // file executed, with a value a stub could not invent; handbellChartFound
    // records what the read layer saw, after any removal. Written on quiet runs
    // only, which is every fixture and every batch run, so someone working in
    // the MuseScore UI never sees them.
    if (options.quiet) {
        score.startCmd();
        score.setMetaTag("handbellChartRan", String(score.nmeasures));
        score.setMetaTag("handbellChartFound", labelsOf(plan).join(" | "));
        score.setMetaTag("handbellChartHeads", headsOf(records).join(","));
        score.setMetaTag("handbellChartColors", colorsOf(records).join(","));
        score.endCmd();
    }

    // Reported before the early return below, not after it. A score whose only
    // bells lie outside C2-C9 plans no sections at all, and being told "no
    // handbells were found" is both wrong and useless when the run knows
    // exactly which bells it skipped and why.
    var warnings = warningsModule.linesOf(plan);
    if (warnings.length) report.say("warning", warnings.join("\n"));

    // Nothing to draw. On a plain score that is the whole story, but on a
    // score whose chart was just removed it is not: the removal stands, and
    // saying nothing about it would leave the user looking at a vanished chart
    // with no explanation and a stale report tag still describing it.
    if (!plan.sections.length) {
        var nothing = "No handbells, handchimes or silver melody bells were "
            + "found in this score."
            + (replaced ? "\n\nThe existing chart was removed." : "");
        recordReport(score, nothing);
        report.say("warning", nothing);
        return { ok: true, summary: nothing, warnings: warnings };
    }

    try {
        mutateModule.buildChart(engraving, score, plan, options);
    } catch (e) {
        // buildChart records what it has appended as soon as it exists, so a
        // failure part way through leaves a chart that a later run can still
        // find and remove. What the user needs is to be told, rather than left
        // with an unexplained half chart and a run that reported nothing.
        return recordError(score, report, messageOf(e));
    }

    var summary = labelsOf(plan).join("\n")
        + (replaced ? "\n\nAn existing chart was replaced." : "");
    recordReport(score, summary);
    report.say("info", summary);
    return { ok: true, summary: summary, warnings: warnings };
}

// The Remove Chart action. removeChart takes the parts, the measures and the
// fields that record them, and puts the score's own style back.
//
// Nothing here may open a startCmd/endCmd around removeChart, which calls
// cmd().
//
// The element check comes first because removeChart puts each staff's clef
// back with a new element once the chart's measures and parts are gone. On a
// MuseScore with other element numbers that would fail half way through.
function remove(engraving, score, options, report) {
    var removed;
    try {
        engraving.check();
        removed = mutateModule.removeChart(engraving, score);
    } catch (e) {
        return recordError(score, report, messageOf(e));
    }
    if (options.quiet) {
        score.startCmd();
        score.setMetaTag("handbellChartRan", String(score.nmeasures));
        score.endCmd();
    }
    var summary = removed ? "The chart was removed." : "This score has no chart to remove.";
    recordReport(score, summary);
    report.say("info", summary);
    return { ok: true, summary: summary };
}

module.exports = {
    readOptions: readOptions,
    reporter: reporter,
    messageOf: messageOf,
    precheck: precheck,
    build: build,
    remove: remove
};
