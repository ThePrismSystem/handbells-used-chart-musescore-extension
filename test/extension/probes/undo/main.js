/*
 * Test-only probe. Builds or removes the chart through the installed
 * extension, then presses undo the number of times the test asks for.
 *
 * MuseScore hands a change to its playback model in the same step that puts
 * it on the undo stack, at the end of a command. A change made outside one
 * reaches neither, so undoing every step and finding something left over is
 * the observable sign of the edit playback never heard about.
 */

var run = require("../handbells-used-chart/run.js");
var engravingModule = require("../handbells-used-chart/engraving.js");

function main() {
    var engraving = engravingModule.adapt(api.engraving);
    var score = engraving.curScore;
    var options = run.readOptions(score);
    var report = run.reporter(options, null, api.log);
    if (score.metaTag("probeAction") === "remove") run.remove(engraving, score, options, report);
    else run.build(engraving, score, options, report);

    var undos = Number(score.metaTag("probeUndos"));
    for (var i = 0; i < undos; i++) engraving.cmd("action://notation/undo");

    score.startCmd();
    score.setMetaTag("probeUndone", String(undos));
    score.endCmd();
}
