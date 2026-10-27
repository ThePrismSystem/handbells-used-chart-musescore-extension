/*
 * The "Run with Project Properties" action: builds the chart from the
 * settings stored in the score. The options dialog edits the same settings.
 */

var run = require("./run.js");
var engravingModule = require("./engraving.js");

function main() {
    var engraving = engravingModule.adapt(api.engraving);
    var score = engraving.curScore;
    var options = run.readOptions(score);
    // Required only when it will be used. A quiet run must never reach
    // Interactive; see run.reporter.
    var interactive = options.quiet ? null : require("MuseApi.Interactive");
    run.build(engraving, score, options, run.reporter(options, interactive, api.log));
}
