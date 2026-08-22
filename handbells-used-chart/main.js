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

function describe(plan) {
    var lines = [];
    for (var i = 0; i < plan.sections.length; i++) lines.push(plan.sections[i].label);
    return lines.join("\n");
}

function warningsOf(plan) {
    var lines = [];
    for (var i = 0; i < plan.warnings.length; i++) {
        var warning = plan.warnings[i];
        lines.push(warning.type === "unknown-notehead"
            ? warning.count + " note(s) with an unrecognised notehead were skipped"
            : "Bells outside C2-C9 were skipped: " + warning.names.join(", "));
    }
    return lines;
}

function main() {
    var engraving = api.engraving;
    var score = engraving.curScore;
    var options = readOptions(score);
    var report = reporter(score, options);

    // removeChart and buildChart both call cmd(), which crashes MuseScore if a
    // startCmd/endCmd block is open anywhere on the call stack. Neither may be
    // wrapped. MuseScore's job runner saves after main() returns, so nothing
    // needs the wrap; only the metaTag writes take one.
    var replaced;
    try {
        replaced = mutateModule.removeChart(engraving, score);
    } catch (e) {
        report.say("error", String(e.message));
        score.startCmd();
        score.setMetaTag("handbellChartError", String(e.message));
        score.endCmd();
        return;
    }

    var plan = planModule.buildPlan(readModule.readScore(engraving, score), options);

    var labels = [];
    for (var i = 0; i < plan.sections.length; i++) labels.push(plan.sections[i].label);

    // handbellChartRan records that this file executed inside MuseScore, with a
    // value a stub could not invent; handbellChartFound records what the read
    // layer found. Both are asserted by earlier tasks' tests and must keep
    // being written. They describe the score as read, before any mutation.
    score.startCmd();
    score.setMetaTag("handbellChartRan", String(score.nmeasures));
    score.setMetaTag("handbellChartFound", labels.join(" | "));
    score.endCmd();

    if (!plan.sections.length) {
        report.say("warning", "No handbells or handchimes were found in this score.");
        return;
    }

    var warnings = warningsOf(plan);
    if (warnings.length) report.say("warning", warnings.join("\n"));

    // The same treatment removeChart gets, and for a sharper reason: buildChart
    // records what it has appended as soon as it exists, so a failure part way
    // through leaves a chart that a later run can still find and remove. What
    // the user needs is to be told, rather than left with an unexplained half
    // chart and a run that reported nothing at all.
    try {
        mutateModule.buildChart(engraving, score, plan, options);
    } catch (e) {
        report.say("error", String(e.message));
        score.startCmd();
        score.setMetaTag("handbellChartError", String(e.message));
        score.endCmd();
        return;
    }

    var summary = describe(plan) + (replaced ? "\n\nAn existing chart was replaced." : "");
    score.startCmd();
    score.setMetaTag("handbellChartReport", summary);
    score.endCmd();
    report.say("info", summary);
}
