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

// Black is what a chime chart falls back to, and it is expressed by writing no
// colour at all; an unparseable value is treated the same way.
function usableColor(value) {
    if (typeof value !== "string") return null;
    if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
    return /^#?0+$/.test(value) ? null : value;
}

// A column is one chord. The first note starts it; the rest join it, which is
// what stacks a bell an octave or two above its counterpart into the same
// column with ledger lines.
function writeColumn(cursor, column) {
    cursor.setDuration(1, 4);
    for (var i = 0; i < column.notes.length; i++) {
        cursor.addNote(column.notes[i].pitch, i > 0);
    }
}

// addNote spells from the key signature, so G sharp and A flat both arrive as
// whichever the key prefers. The chart has to show the spelling the score
// actually used — ringers read it to work out position splits — so tpc1 and
// tpc2 are both forced afterwards.
function dressChord(engraving, chord, column, chimeColor) {
    chord.noStem = true;
    for (var i = 0; i < chord.notes.length && i < column.notes.length; i++) {
        var note = chord.notes[i];
        var wanted = column.notes[i];
        note.tpc1 = wanted.tpc;
        note.tpc2 = wanted.tpc;
        if (wanted.head === "diamond") {
            note.headGroup = engraving.NoteHeadGroup.HEAD_DIAMOND;
            if (chimeColor) note.color = chimeColor;
        }
    }
}

function writeColumns(engraving, score, staffIdx, entries, chimeColor) {
    if (!entries.length) return;

    var cursor = score.newCursor();
    cursor.staffIdx = staffIdx;
    cursor.voice = 0;
    cursor.rewind(0);
    for (var i = 0; i < entries.length; i++) writeColumn(cursor, entries[i]);

    // Dressing happens on a second pass: a cursor that has just written a note
    // is positioned past it, and the chord is only reachable by rewinding.
    cursor.staffIdx = staffIdx;
    cursor.voice = 0;
    cursor.rewind(0);
    for (var j = 0; j < entries.length; j++) {
        if (cursor.element && cursor.element.notes) {
            dressChord(engraving, cursor.element, entries[j], chimeColor);
        }
        cursor.next();
    }
}

// The chart measures are the first ones in the score, in order, one per chart.
function chartMeasureAt(score, index) {
    var measure = score.firstMeasure;
    for (var i = 0; i < index && measure; i++) measure = measure.nextMeasure;
    return measure;
}

// Elements are attached through a cursor. measure.add(element) crashes the
// process — it is not a slower route to the same place, it takes MuseScore down.
function attachAt(score, measureIndex, element) {
    var cursor = score.newCursor();
    cursor.staffIdx = 0;
    cursor.voice = 0;
    cursor.rewind(0);
    for (var i = 0; i < measureIndex; i++) cursor.nextMeasure();
    cursor.add(element);
}

function dressMeasures(engraving, score, plan) {
    for (var i = 0; i < plan.sections.length; i++) {
        var section = plan.sections[i];
        var measure = chartMeasureAt(score, i);

        // The measure holds exactly its own columns, one quarter each, and does
        // not count towards the piece's measure numbering.
        measure.timesigActual = engraving.fraction(section.columns, 4);
        measure.irregular = true;

        var label = engraving.newElement(engraving.Element.SYSTEM_TEXT);
        label.text = section.label;
        attachAt(score, i, label);

        // A break per chart: each chart gets its own system, and the piece
        // starts a fresh section so its first measure is numbered 1.
        var brk = engraving.newElement(engraving.Element.LAYOUT_BREAK);
        brk.layoutBreakType = engraving.LayoutBreak.SECTION;
        attachAt(score, i, brk);
    }
}

function buildChart(engraving, score, plan, options) {
    if (!plan.sections.length) return;
    var opts = options || {};

    var placed = appendChartParts(score, plan);
    insertChartMeasures(engraving, score, plan.sections.length);

    for (var i = 0; i < placed.length; i++) {
        var section = placed[i].section;
        var color = section.kind === "chimes" ? usableColor(opts.chimeColor) : null;
        writeColumns(engraving, score, placed[i].trebleIdx, section.treble, color);
        writeColumns(engraving, score, placed[i].bassIdx, section.bass, color);
    }

    dressMeasures(engraving, score, plan);
}

module.exports = {
    selectFirstMeasure: selectFirstMeasure,
    insertChartMeasures: insertChartMeasures,
    appendChartParts: appendChartParts,
    writeColumns: writeColumns,
    usableColor: usableColor,
    chartMeasureAt: chartMeasureAt,
    attachAt: attachAt,
    dressMeasures: dressMeasures,
    buildChart: buildChart
};
