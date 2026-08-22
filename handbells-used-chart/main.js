/*
 * Handbells Used Chart — MuseScore extension entry point.
 *
 * The planning is done by lib/, shared verbatim with the command-line tool.
 * This file reads the score, asks lib/ what to draw, and hands the answer to
 * mutate.js.
 *
 * Settings come from metaTags rather than a dialog. A form action would need a
 * QML panel, which cannot be run headlessly and so could not be tested; the
 * spec defers it deliberately. handchimesColor is the same field the
 * handbell-notation plugins already write.
 */

var readModule = require("./read.js");
var planModule = require("./lib/plan.js");
var mutateModule = require("./mutate.js");

var TITLE = "Handbells Used Chart";

function metaTagOr(score, name, fallback) {
    var value = score.metaTag(name);
    return value ? value : fallback;
}

function readOptions(score) {
    return {
        bellLabel: metaTagOr(score, "handbellChartBellLabel", null),
        chimeLabel: metaTagOr(score, "handbellChartChimeLabel", null),
        chimeColor: metaTagOr(score, "handchimesColor", null),
        quiet: metaTagOr(score, "handbellChartQuiet", "") === "yes"
    };
}

// Calling an Interactive method in a headless run blocks until the process is
// killed, and MuseScore saves at the end of a job, so the whole run is lost
// with no error. Nothing in the API reports whether a run is interactive, so
// the score says so.
function reporter(score, options) {
    if (options.quiet) {
        return {
            say: function (kind, text) { api.log.info(TITLE + " [" + kind + "] " + text); }
        };
    }
    var interactive = require("MuseApi.Interactive");
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

function labelsOf(plan) {
    var labels = [];
    for (var i = 0; i < plan.sections.length; i++) labels.push(plan.sections[i].label);
    return labels;
}

// One branch per warning type, rather than a two-way test that treats anything
// unrecognised as the out-of-range case: that shape reads warning.names on a
// warning that does not carry any, and a new type added in lib/ would take the
// whole run down inside the code meant to explain a problem.
function warningsOf(plan) {
    var lines = [];
    for (var i = 0; i < plan.warnings.length; i++) {
        var warning = plan.warnings[i];
        if (warning.type === "unknown-notehead") {
            lines.push(warning.count + " note(s) with an unrecognised notehead were skipped");
        } else if (warning.type === "unreadable-pitch") {
            lines.push(warning.count + " note(s) with an unreadable pitch were skipped");
        } else if (warning.type === "out-of-range") {
            lines.push("Bells outside C2-C9 were skipped: " + warning.names.join(", "));
        }
    }
    return lines;
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
}

// Cleared, not left: a refusal from an earlier run otherwise sits in Project
// Properties for the life of the score, describing a state it is no longer in.
function recordReport(score, summary) {
    score.startCmd();
    score.setMetaTag("handbellChartReport", summary);
    score.setMetaTag("handbellChartError", "");
    score.endCmd();
}

function main() {
    var engraving = api.engraving;
    var score = engraving.curScore;
    var options = readOptions(score);
    var report = reporter(score, options);

    // The read sits inside the try, not between two of them. By the time
    // readScore runs, removeChart has already deleted the previous chart, and
    // an exception escaping main() there is still saved by the job runner:
    // chart gone, nothing recorded, nothing said.
    //
    // Nothing in this block may open a startCmd/endCmd, because removeChart
    // and buildChart both call cmd(). The metaTag writes outside it take one.
    var replaced;
    var plan;
    try {
        replaced = mutateModule.removeChart(engraving, score);
        plan = planModule.buildPlan(readModule.readScore(engraving, score), options);
    } catch (e) {
        recordError(score, report, messageOf(e));
        return;
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
        score.endCmd();
    }

    // Reported before the early return below, not after it. A score whose only
    // bells lie outside C2-C9 plans no sections at all, and being told "no
    // handbells were found" is both wrong and useless when the run knows
    // exactly which bells it skipped and why.
    var warnings = warningsOf(plan);
    if (warnings.length) report.say("warning", warnings.join("\n"));

    // Nothing to draw. On a plain score that is the whole story, but on a
    // score whose chart was just removed it is not: the removal stands, and
    // saying nothing about it would leave the user looking at a vanished chart
    // with no explanation and a stale report tag still describing it.
    if (!plan.sections.length) {
        var nothing = "No handbells or handchimes were found in this score."
            + (replaced ? "\n\nThe existing chart was removed." : "");
        recordReport(score, nothing);
        report.say("warning", nothing);
        return;
    }

    try {
        mutateModule.buildChart(engraving, score, plan, options);
    } catch (e) {
        // buildChart records what it has appended as soon as it exists, so a
        // failure part way through leaves a chart that a later run can still
        // find and remove. What the user needs is to be told, rather than left
        // with an unexplained half chart and a run that reported nothing.
        recordError(score, report, messageOf(e));
        return;
    }

    var summary = labelsOf(plan).join("\n")
        + (replaced ? "\n\nAn existing chart was replaced." : "");
    recordReport(score, summary);
    report.say("info", summary);
}
