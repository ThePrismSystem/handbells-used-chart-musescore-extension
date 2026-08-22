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
    score.selection.selectRange(measure.firstSegment.tick, measureEndTick(measure),
        0, score.nstaves);
}

// One tick past the end of a measure. The last measure of a score has no next
// measure to take it from, and reaching for the start of this one instead
// gives an empty range — which is what left a one-measure score with no chart
// measure inserted and its own music written over. The last segment's own tick
// plus one is past every note in the measure, so it bounds the measure the
// same way the next measure's tick does everywhere else.
function measureEndTick(measure) {
    return measure.nextMeasure ? measure.nextMeasure.firstSegment.tick
        : measure.lastSegment.tick + 1;
}

function insertChartMeasures(engraving, score, count) {
    // cmd() reports nothing: an insert-measure that did not happen looks
    // exactly like one that did, and everything downstream then takes the
    // user's own measures for chart measures — resizing them, flagging them
    // out of the measure count and drawing the chart over their music. The
    // count is the only evidence available, so it is checked, and a failure
    // becomes the refusal main.js already knows how to report.
    var before = score.nmeasures;
    for (var i = 0; i < count; i++) {
        selectFirstMeasure(score);
        engraving.cmd("insert-measure");
    }
    if (score.nmeasures !== before + count) {
        throw new Error("MuseScore did not insert the " + count + " measure(s) "
            + "this chart needs at the front of the score, so nothing was "
            + "written. The score has not been changed apart from the chart "
            + "instruments, which you can delete in MuseScore.");
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

// rewind(0) goes to the start of the score, which is chart measure 0 — right
// for the first chart and wrong for every one after it, so the cursor is walked
// forward to the chart's own measure. Chart measures are the first ones in the
// score, in plan order, so the section's index is its measure index.
function cursorAt(score, staffIdx, measureIndex) {
    var cursor = score.newCursor();
    cursor.staffIdx = staffIdx;
    cursor.voice = 0;
    cursor.rewind(0);
    for (var i = 0; i < measureIndex; i++) cursor.nextMeasure();
    return cursor;
}

// The rests that pad a chart measure out to its declared length are structural,
// not musical: MuseScore needs them, a reader does not. Nothing in a chart
// measure is music, so that covers every rest in one — on the chart's own
// staves, on the other charts' staves, and on the piece's own staves, which
// the chart measures run across as well. The command-line tool marks all three
// invisible (tools/writer.js) and this is not a corner case: the two staves of
// a chart end at different columns by design, so at least one of them is
// padded on nearly every chart.
//
// A rest is what is left when the element is not a chord: chords are the only
// thing here carrying notes, which is the test writeColumns uses to find them.
function hidePaddingRests(score, chartMeasures) {
    for (var m = 0; m < chartMeasures; m++) {
        var end = measureEndTick(chartMeasureAt(score, m));
        for (var staffIdx = 0; staffIdx < score.nstaves; staffIdx++) {
            var cursor = cursorAt(score, staffIdx, m);
            while (cursor.segment && cursor.tick < end) {
                if (cursor.element && !cursor.element.notes) {
                    cursor.element.visible = false;
                }
                cursor.next();
            }
        }
    }
}

function writeColumns(engraving, score, staffIdx, measureIndex, entries, chimeColor) {
    if (!entries.length) return;

    var cursor = cursorAt(score, staffIdx, measureIndex);
    for (var i = 0; i < entries.length; i++) writeColumn(cursor, entries[i]);

    // Dressing happens on a second pass: a cursor that has just written a note
    // is positioned past it, and the chord is only reachable by rewinding.
    cursor = cursorAt(score, staffIdx, measureIndex);
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

// Sizing comes before the columns are written, not after. Until a chart
// measure declares its own length it still holds the score's ordinary time
// signature, and cursor.addNote does not stop at a measure end — it carries on
// into the following measures. A chart with more columns than the metre allows
// would then land partly on the piece's own measures, on chart staves that
// hideEmptyStaves can no longer hide because they are no longer empty there.
function sizeMeasures(engraving, score, plan) {
    for (var i = 0; i < plan.sections.length; i++) {
        chartMeasureAt(score, i).timesigActual =
            engraving.fraction(plan.sections[i].columns, 4);
    }
}

// Elements are attached through a cursor. measure.add(element) crashes the
// process — it is not a slower route to the same place, it takes MuseScore down.
function attachAt(score, measureIndex, element) {
    cursorAt(score, 0, measureIndex).add(element);
}

function dressMeasures(engraving, score, plan) {
    for (var i = 0; i < plan.sections.length; i++) {
        var section = plan.sections[i];
        // Everything here belongs after the notes exist. The measure's own
        // length does not, and is set by sizeMeasures before they are written.
        chartMeasureAt(score, i).irregular = true;

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

// Staff.hideWhenEmpty exists in the desktop UI but not in this API: reading it
// back gives undefined, and assigning it only creates a JavaScript property on
// the wrapper, the same trap documented for Instrument.minPitch/maxPitch. There
// is therefore no per-staff switch here — hideEmptyStaves below applies to
// every staff in the score, chart and piece alike. That symmetry is what makes
// it work: the chart's own system has content only in its own two staves, and
// the piece's systems have content only in the piece's own staves, so each
// side is empty exactly where the other needs to disappear.
function dressStaves(score, placed) {
    for (var i = 0; i < placed.length; i++) {
        var staves = [score.staves[placed[i].trebleIdx], score.staves[placed[i].bassIdx]];
        for (var s = 0; s < staves.length; s++) {
            staves[s].small = true;
            staves[s].hideSystemBarLine = true;
        }
    }

    // This setting is score-wide, not chart-scoped: any staff that rests for
    // a whole system anywhere in the piece — not only under the chart — will
    // now hide there too, changing the user's own engraving beyond what they
    // asked for. It is not made optional, because there is no narrower
    // mechanism to fall back to: hideWhenEmpty is not a property a plugin can
    // set per staff, so this global flag is the only way the chart and the
    // piece's staves can take turns being visible at all.
    score.style.setValue("hideEmptyStaves", true);
    score.style.setValue("dontHideStavesInFirstSystem", false);
}

function buildChart(engraving, score, plan, options) {
    if (!plan.sections.length) return;
    var opts = options || {};

    var placed = appendChartParts(score, plan);

    // Recorded the moment there is something to record, not once the chart is
    // finished: the parts are appended above and both counts are known here,
    // and these two counts are the only way a later run can find them again.
    // See findChart below for why two counts, not a marker. Anything throwing
    // further down — the measure insert, a null element — would otherwise
    // leave parts on the score that nothing can identify, and the next run
    // would append a second set on top of them with no word to the user.
    // Recorded, the same failure is refused and explained instead.
    //
    // Written outside any startCmd/endCmd block, unlike main.js's own metaTag
    // writes, and it has to be: buildChart calls cmd(), which takes MuseScore
    // down if a command block is open anywhere on the call stack, so nothing
    // in this file may open one. The tags reach the saved score regardless —
    // the job runner saves once main() has returned.
    score.setMetaTag(META_PARTS, String(plan.sections.length));
    score.setMetaTag(META_TOTAL, String(score.parts.length));

    insertChartMeasures(engraving, score, plan.sections.length);
    sizeMeasures(engraving, score, plan);

    for (var i = 0; i < placed.length; i++) {
        var section = placed[i].section;
        var color = section.kind === "chimes" ? usableColor(opts.chimeColor) : null;
        writeColumns(engraving, score, placed[i].trebleIdx, i, section.treble, color);
        writeColumns(engraving, score, placed[i].bassIdx, i, section.bass, color);
    }

    // After every column is written, and over all the staves rather than from
    // inside writeColumns: a staff with no columns of its own never enters
    // that function and is nothing but padding.
    hidePaddingRests(score, plan.sections.length);

    dressMeasures(engraving, score, plan);
    dressStaves(score, placed);
}

var META_PARTS = "handbellChartParts";
var META_TOTAL = "handbellChartTotal";
var CHART_INSTRUMENTS = { "hand-bells": true, "hand-chimes": true };

// Every refusal below ends the same way, because the answer is always the
// same: the plugin will not guess which instruments and measures are its own,
// and the user can delete them by hand in a few seconds.
function identificationError(reason) {
    return new Error(reason + " Delete the chart instruments and their measures "
        + "in MuseScore, then run this again.");
}

var UNIDENTIFIABLE = "This score records a Handbells Used chart, but an "
    + "instrument or a measure has been added, removed or moved since, so the "
    + "chart can no longer be identified.";

// The command-line tool identifies its own chart structurally, by a track name
// on each part, and records how many measures it inserted under a tag of its
// own. This plugin can do neither: part.partName is read-only, so it cannot
// write that marker, and it cannot recognise one it did not write. What it can
// do is read the tag. Without this check a run over a command-line chart finds
// no chart of its own, concludes there is none, and builds a second one
// alongside the first.
var CLI_META_MEASURES = "handbellChartMeasures";
var CLI_CHART = "This score carries a Handbells Used chart made by the "
    + "command-line tool, which this plugin cannot identify or replace.";

// part.partName is read-only and instrumentId does not distinguish our parts
// from the user's own handbell parts, so a chart is identified by the counts the
// generating run recorded. Anything that does not match exactly is refused: the
// alternative is deleting an instrument that might be theirs.
function findChart(score) {
    if (score.metaTag(CLI_META_MEASURES)) throw identificationError(CLI_CHART);

    // Number(), not parseInt(): parseInt truncates "2.5" to 2 and stops at the
    // first non-digit, silently accepting values that are not really the
    // recorded count. An absent or non-numeric tag still parses to a falsy
    // value (Number("") is 0, Number of garbage is NaN) and still means "no
    // chart recorded" via the check below — that part is unchanged.
    var count = Number(score.metaTag(META_PARTS));
    if (!count) return { count: 0, partIndexes: [] };

    // Number() here for the same reason as the count above: parseInt("2 parts")
    // is 2, which can satisfy total === score.parts.length on a tampered tag
    // and leave instrumentId as the only thing standing between that and the
    // user's own hand-bells and hand-chimes parts being deleted.
    var total = Number(score.metaTag(META_TOTAL));
    var first = score.parts.length - count;
    // A negative or fractional recorded count means the metaTag was hand-
    // edited or corrupted, not merely stale — the same situation the total/
    // instrumentId checks below exist to catch, so it is folded into the same
    // refusal rather than treated as "no chart", which would silently build a
    // second chart on top of whatever is already there.
    var locatable = Number.isInteger(count) && count >= 0
        && first >= 0 && total === score.parts.length;

    var indexes = [];
    for (var i = first; locatable && i < score.parts.length; i++) {
        if (!CHART_INSTRUMENTS[score.parts[i].instrumentId]) locatable = false;
        indexes.push(i);
    }

    if (!locatable) throw identificationError(UNIDENTIFIABLE);
    return { count: count, partIndexes: indexes };
}

function removeChart(engraving, score) {
    var found = findChart(score);
    if (!found.count) return false;

    // findChart takes care over the parts and says nothing about the measures,
    // which are removed below purely by position — the first found.count of
    // them. A measure inserted at the front of the score between runs, an
    // intro bar or a title spacer, leaves the parts exactly as they were, so
    // findChart succeeds and that loop would delete the user's new measure and
    // leave a chart measure standing. The chart's own measures are already
    // marked irregular, so asking for the mark costs nothing and refuses
    // rather than guessing.
    for (var m = 0; m < found.count; m++) {
        var measure = chartMeasureAt(score, m);
        if (!measure || !measure.irregular) throw identificationError(UNIDENTIFIABLE);
    }

    // Resolved before anything else moves: findChart's indexes describe the
    // score as it stands right now, and removeParts (below) turns out to
    // need the Part objects themselves, not their positions.
    var parts = [];
    for (var k = 0; k < found.partIndexes.length; k++) {
        parts.push(score.parts[found.partIndexes[k]]);
    }

    // Measures first: removing the parts renumbers the staves underneath us.
    // cmd("delete") on a full-measure selection only clears the measure's
    // contents and leaves the empty measure in place; "time-delete" (Ctrl+Del
    // in the UI) is the action that actually removes it.
    for (var i = 0; i < found.count; i++) {
        selectFirstMeasure(score);
        engraving.cmd("time-delete");
    }

    // removeParts silently does nothing when passed indexes — score.parts.length
    // comes back unchanged and nothing is written to the saved score, with no
    // error to say so. It wants the Part objects themselves.
    score.removeParts(parts);

    score.setMetaTag(META_PARTS, "");
    score.setMetaTag(META_TOTAL, "");
    return true;
}

module.exports = {
    selectFirstMeasure: selectFirstMeasure,
    insertChartMeasures: insertChartMeasures,
    appendChartParts: appendChartParts,
    writeColumns: writeColumns,
    usableColor: usableColor,
    chartMeasureAt: chartMeasureAt,
    sizeMeasures: sizeMeasures,
    hidePaddingRests: hidePaddingRests,
    attachAt: attachAt,
    dressMeasures: dressMeasures,
    dressStaves: dressStaves,
    buildChart: buildChart,
    findChart: findChart,
    removeChart: removeChart
};
