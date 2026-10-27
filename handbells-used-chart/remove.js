/*
 * The "Remove Chart" action: takes the chart out and leaves the music.
 */

var run = require("./run.js");

function main() {
    var engraving = api.engraving;
    var score = engraving.curScore;
    var options = run.readOptions(score);
    var interactive = options.quiet ? null : require("MuseApi.Interactive");
    run.remove(engraving, score, options, run.reporter(options, interactive, api.log));
}
