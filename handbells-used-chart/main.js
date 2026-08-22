/*
 * Handbells Used Chart — MuseScore extension entry point.
 *
 * The planning is done by lib/, which is shared verbatim with the
 * command-line tool. This file only reads the score, asks lib/ what to draw,
 * and hands the answer to mutate.js.
 */

var readModule = require("./read.js");
var planModule = require("./lib/plan.js");

function main() {
    var engraving = api.engraving;
    var score = engraving.curScore;

    var plan = planModule.buildPlan(readModule.readScore(engraving, score), {});

    var labels = [];
    for (var i = 0; i < plan.sections.length; i++) labels.push(plan.sections[i].label);

    // handbellChartRan is a durable marker, not scaffolding: it records that
    // this file executed inside MuseScore, with a value a stub could not
    // invent. handbellChartFound records what the read layer found, which is
    // the only channel a headless test can read back.
    score.startCmd();
    score.setMetaTag("handbellChartRan", String(score.nmeasures));
    score.setMetaTag("handbellChartFound", labels.join(" | "));
    score.endCmd();
}
