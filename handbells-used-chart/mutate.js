/*
 * Turns a chart plan into changes to the open score.
 *
 * Four things about the API decide the shape of this file, all established by
 * experiment and recorded in docs/superpowers/notes/api-capabilities.md:
 *
 *   - measure.add(element) crashes the process. Use cursor.add(element).
 *   - measure.stemless and staff.stemless are read-only. Use chord.noStem.
 *   - part.partName is read-only, so a chart is identified by recorded counts.
 *   - cmd() returns before any dialog it opens is answered, and wrapping such
 *     a call in startCmd/endCmd crashes MuseScore. insert-measure opens no
 *     dialog, but calling it while a startCmd/endCmd block is already open
 *     crashes MuseScore anyway — buildChart must run with no such block
 *     active, so callers must not wrap it in one.
 */

// insert-measure is "Insert one measure before selection". It takes no count,
// so it never prompts, and it inserts ahead of the selection — which is why
// there has to be one.
function selectFirstMeasure(score) {
    var measure = score.firstMeasure;
    var from = measure.firstSegment.tick;
    var to = measure.nextMeasure ? measure.nextMeasure.firstSegment.tick : from;
    score.selection.selectRange(from, to, 0, score.nstaves);
}

function insertChartMeasures(engraving, score, count) {
    for (var i = 0; i < count; i++) {
        selectFirstMeasure(score);
        engraving.cmd("insert-measure");
    }
}

// Each of these instruments is a two-staff braced pair, treble then bass,
// appended at the end of the score.
function appendChartParts(score, plan) {
    var placed = [];
    for (var i = 0; i < plan.sections.length; i++) {
        score.appendPart(plan.sections[i].partId);
        placed.push({
            section: plan.sections[i],
            trebleIdx: score.nstaves - 2,
            bassIdx: score.nstaves - 1
        });
    }
    return placed;
}

function buildChart(engraving, score, plan, options) {
    if (!plan.sections.length) return;
    appendChartParts(score, plan);
    insertChartMeasures(engraving, score, plan.sections.length);
}

module.exports = {
    selectFirstMeasure: selectFirstMeasure,
    insertChartMeasures: insertChartMeasures,
    appendChartParts: appendChartParts,
    buildChart: buildChart
};
