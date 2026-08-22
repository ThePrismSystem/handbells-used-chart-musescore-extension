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
//
// Trimmed and given its "#" before it goes any further. The value comes from a
// Project Properties field a user typed, so " #c00000" and "c00000" are both
// ordinary things to find there, and note.color takes whatever it is handed —
// per the wrapper-object trap documented in CLAUDE.md, an unparseable colour
// string is assigned without complaint and the chimes simply come out black,
// with nothing to say why. tools/writer.js trims for the same reason.
function usableColor(value) {
    if (typeof value !== "string") return null;
    var text = value.replace(/^\s+|\s+$/g, "");
    if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) return null;
    if (/^#?0+$/.test(text)) return null;
    return text.charAt(0) === "#" ? text : "#" + text;
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
    // A chord that came back with fewer notes than the column asked for is a
    // stacked column that did not stack. Walking the shorter of the two would
    // dress what arrived and say nothing about what did not, leaving a bell
    // missing from the chart and its neighbours spelled from the key signature
    // — the exact failure the tpc forcing below exists to prevent, made
    // invisible.
    if (chord.notes.length !== column.notes.length) {
        throw new Error("A chart column asked for " + column.notes.length
            + " bell(s) but MuseScore wrote " + chord.notes.length
            + ". The chart is incomplete. Delete the chart instruments and "
            + "their measures in MuseScore, then run this again.");
    }
    for (var i = 0; i < chord.notes.length; i++) {
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
    for (var i = 0; i < measureIndex; i++) {
        // nextMeasure returns false at the end of the score and leaves the
        // cursor parked on the last measure rather than moving it. Ignoring
        // that hands back a cursor pointing at the wrong measure, and every
        // caller here writes through it — columns, labels, breaks and the
        // restored time signature would all land silently in the last measure
        // of the user's music.
        if (!cursor.nextMeasure()) {
            throw new Error("The chart needed measure " + (measureIndex + 1)
                + " of the score, which does not exist. Nothing further was "
                + "written. Delete the chart instruments and their measures in "
                + "MuseScore, then run this again.");
        }
    }
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
//
// Voice 0 only, because cursorAt addresses voice 0 and that is all a chart
// measure has. cmd("insert-measure") creates measures with a single voice and
// nothing here ever adds another, so voice 0 covers every rest one of these
// measures can hold — unlike read.js, which walks all four because the user's
// own music does use them.
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

// Every time signature in one measure. A cursor only stops at chord and rest
// segments, so finding one means walking the measure's segments directly. Over
// every track, not staff 0 alone: each staff carries its own copy of the
// signature, and a chart measure runs across the piece's own staves as well as
// the chart's. Both halves of the hide-and-restore below need this same walk.
function timeSignaturesIn(engraving, score, measure) {
    var found = [];
    for (var seg = measure.firstSegment; seg; seg = seg.nextInMeasure) {
        for (var track = 0; track < score.ntracks; track++) {
            var element = seg.elementAt(track);
            if (element && element.type === engraving.Element.TIMESIG) found.push(element);
        }
    }
    return found;
}

// cmd("insert-measure") does not leave the score's time signature with the
// music: it carries the element into the measure it creates. So this has to be
// read before the chart measures go in — afterwards the only copy is already
// sitting in the chart, and hiding it there (below) would leave the score with
// no visible metre anywhere at all. Copied out as plain values rather than
// held as the element or its Fraction, both of which are about to move.
//
// Everything reachable is copied, not just the fraction. A time signature is
// more than two numbers: timesigType carries the cut-time and common-time
// symbols, which is ordinary in handbell writing and would otherwise be
// rewritten to a bare 2/2 that no later removal could undo; the two strings
// carry additive metres like 2+3/8; showCourtesy carries whether a courtesy
// signature prints at the previous system's end; visible carries whether it
// printed at all.
//
// The first one found is the one taken. Every staff carries its own copy and
// they agree, so which one is immaterial.
function timeSignatureOf(engraving, score) {
    var found = timeSignaturesIn(engraving, score, score.firstMeasure);
    if (!found.length) return null;
    var element = found[0];
    return {
        numerator: element.timesig.numerator,
        denominator: element.timesig.denominator,
        timesigType: element.timesigType,
        numeratorString: element.numeratorString,
        denominatorString: element.denominatorString,
        showCourtesy: element.showCourtesy,
        visible: element.visible
    };
}

// The other half of hideTimeSignatures: the metre is hidden where insert-measure
// put it and written back where it came from, so the chart shows none and the
// music shows its own. Only when there was one to begin with — a score that
// never declared a metre must not acquire one here, and on such a score
// timeSignatureOf returns null and both halves do nothing.
//
// cursor.add, never measure.add: measure.add takes the process down.
//
// visible is copied along with the rest. A score can carry a deliberately
// hidden metre — the command-line tool's own chart staves are engraved that
// way — and restoring it visible would print a time signature the user had
// taken off the page, on music that never showed one.
//
// One thing does not come through. <Groups>, the measure's own beaming groups,
// is enumerated on the element but reads undefined before anything is assigned
// to it — the same shape as staff.hideWhenEmpty, so there is no property here
// to copy. A score whose first measure carries hand-edited beam groups loses
// them. Looked for and not found, rather than not looked for.
//
// Written to every staff, including the chart's own, which never carried a
// metre of their own. That is deliberate and not a copy of anything: the chart
// staves are appended before this runs and are part of the score from here on,
// so the metre in force at this measure has to be declared on them too or
// MuseScore has no signature for those staves at all.
function restoreTimeSignature(engraving, score, signature, measureIndex) {
    if (!signature) return;
    for (var staffIdx = 0; staffIdx < score.nstaves; staffIdx++) {
        var sig = engraving.newElement(engraving.Element.TIMESIG);
        sig.timesig = engraving.fraction(signature.numerator, signature.denominator);
        // After the fraction, which resets the symbol the type selects.
        sig.timesigType = signature.timesigType;
        sig.numeratorString = signature.numeratorString;
        sig.denominatorString = signature.denominatorString;
        sig.showCourtesy = signature.showCourtesy;
        sig.visible = signature.visible;
        cursorAt(score, staffIdx, measureIndex).add(sig);
    }
}

// cmd("insert-measure") moves the piece's own time signature into the measure
// it creates, so the front chart measure inherits it and prints a metre after
// the clef. A published Handbells Used chart shows none: it is an inventory of
// the bells a piece needs, not music, and the command-line tool suppresses its
// own through the chart staves' StaffType. Hidden rather than deleted — the
// metre is still in force for everything that follows, it simply does not
// print, which is how this file already treats anything structural it does not
// want on the page. restoreTimeSignature above puts a visible one back on the
// music; neither half is correct without the other.
function hideTimeSignatures(engraving, score, chartMeasures) {
    for (var m = 0; m < chartMeasures; m++) {
        var found = timeSignaturesIn(engraving, score, chartMeasureAt(score, m));
        for (var i = 0; i < found.length; i++) found[i].visible = false;
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
        // Not "dress it if it happens to be a chord". Every entry was just
        // written as one on the pass above, so anything else here means a
        // column went missing, and skipping quietly would print that bell with
        // whatever spelling the key signature chose — which is the one thing
        // dressChord exists to override.
        if (!cursor.element || !cursor.element.notes) {
            throw new Error("The chart column for " + entries[j].notes.length
                + " bell(s) was not written to the score. The chart is "
                + "incomplete. Delete the chart instruments and their measures "
                + "in MuseScore, then run this again.");
        }
        dressChord(engraving, cursor.element, entries[j], chimeColor);
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
    //
    // What each one was is recorded first, so removeChart can hand it back.
    // Without that the change outlives the chart that needed it: a user who
    // adds a chart, dislikes it and removes it is left with their own staves
    // silently vanishing from systems where they rest, and nothing on the
    // score to say what did it.
    for (var name in STYLE_FOR_CHART) {
        score.setMetaTag(META_STYLE_PREFIX + name, String(score.style.value(name)));
        score.style.setValue(name, STYLE_FOR_CHART[name]);
    }
}

function buildChart(engraving, score, plan, options) {
    if (!plan.sections.length) return;
    var opts = options || {};

    // Read before anything moves. This is the last point at which the piece's
    // own metre can be read from the piece's own first measure.
    var metre = timeSignatureOf(engraving, score);

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
    // The lengths sizeMeasures is about to give the chart measures, recorded
    // now because this is where the plan is in hand. removeChart checks the
    // measures it is about to delete against these.
    var columns = [];
    for (var c = 0; c < plan.sections.length; c++) columns.push(plan.sections[c].columns);
    score.setMetaTag(META_COLUMNS, columns.join("|"));

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
    hideTimeSignatures(engraving, score, plan.sections.length);
    restoreTimeSignature(engraving, score, metre, plan.sections.length);

    dressMeasures(engraving, score, plan);
    dressStaves(score, placed);
}

var META_PARTS = "handbellChartParts";
var META_TOTAL = "handbellChartTotal";
// The chart measures' own lengths, one per chart, in the order they were
// written. See removeChart for what they are checked against.
var META_COLUMNS = "handbellChartColumns";
var META_STYLE_PREFIX = "handbellChartStyle_";
var CHART_INSTRUMENTS = { "hand-bells": true, "hand-chimes": true };

// The score-wide style the chart needs, and the values it needs them at.
// dressStaves records what each one was before overwriting it; removeChart
// puts those back.
var STYLE_FOR_CHART = {
    hideEmptyStaves: true,
    dontHideStavesInFirstSystem: false
};

// metaTags hold strings, so a style value makes the trip as one. Only booleans
// go through here — both settings above are checkboxes in Format > Style — and
// an unrecognised value means the tag was hand-edited or never written, in
// which case the score keeps what it currently has rather than being handed a
// guess.
function restoreChartStyle(score) {
    for (var name in STYLE_FOR_CHART) {
        var recorded = score.metaTag(META_STYLE_PREFIX + name);
        if (recorded === "true" || recorded === "false") {
            score.style.setValue(name, recorded === "true");
        }
        score.setMetaTag(META_STYLE_PREFIX + name, "");
    }
}

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
    if (!count) return { count: 0, parts: [], columns: [] };

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
    if (!Number.isInteger(count) || count < 0 || first < 0
        || total !== score.parts.length) {
        throw identificationError(UNIDENTIFIABLE);
    }

    // The Part objects, not their positions. removeParts needs the objects
    // themselves — passing indexes silently does nothing — and they are read
    // here, before anything moves, because that is the only moment the
    // recorded positions are known to describe the score in front of us.
    var parts = [];
    for (var i = first; i < score.parts.length; i++) {
        if (!CHART_INSTRUMENTS[score.parts[i].instrumentId]) {
            throw identificationError(UNIDENTIFIABLE);
        }
        parts.push(score.parts[i]);
    }

    return { count: count, parts: parts, columns: recordedColumns(score) };
}

// The chart measures' lengths as the generating run recorded them. An absent
// or malformed tag gives an empty list, which removeChart treats as a chart it
// cannot identify.
function recordedColumns(score) {
    var recorded = score.metaTag(META_COLUMNS);
    if (!recorded) return [];
    var parts = recorded.split("|");
    var columns = [];
    for (var i = 0; i < parts.length; i++) {
        var value = Number(parts[i]);
        if (!Number.isInteger(value) || value <= 0) return [];
        columns.push(value);
    }
    return columns;
}

function removeChart(engraving, score) {
    var found = findChart(score);
    if (!found.count) return false;

    // findChart takes care over the parts and says nothing about the measures,
    // which are removed below purely by position — the first found.count of
    // them. A measure inserted at the front of the score between runs leaves
    // the parts exactly as they were, so findChart succeeds and that loop
    // would delete the user's new measure and leave a chart measure standing.
    //
    // Two marks are asked for, because one is not enough. irregular alone was:
    // a pickup measure carries that same mark — a bare len= does not, but the
    // measure MuseScore's own wizard writes for a pickup reads irregular true
    // — so a user who added a pickup ahead of the chart would have it silently
    // deleted and one chart measure left behind. The lengths pin it down: a
    // chart measure was sized to its own column count by sizeMeasures and
    // nothing else in the score has any reason to match, so a shifted or
    // resized front measure is caught. Both are checked, not either, and a
    // chart with no recorded lengths is refused rather than removed on the
    // weaker mark.
    if (found.columns.length !== found.count) throw identificationError(UNIDENTIFIABLE);
    for (var m = 0; m < found.count; m++) {
        var measure = chartMeasureAt(score, m);
        if (!measure || !measure.irregular) throw identificationError(UNIDENTIFIABLE);
        // Compared as a duration, not as a pair of numbers. sizeMeasures asks
        // for columns/4, but what comes back is whatever terms MuseScore chose
        // to keep it in: a four-column chart on a cut-time score reads 2/2,
        // because that is the measure's nominal length and MuseScore had no
        // reason to write anything else down. Cross-multiplied rather than
        // divided, so the comparison stays exact.
        var actual = measure.timesigActual;
        if (!actual || actual.numerator * 4 !== found.columns[m] * actual.denominator) {
            throw identificationError(UNIDENTIFIABLE);
        }
    }

    // Measures first: removing the parts renumbers the staves underneath us.
    // cmd("delete") on a full-measure selection only clears the measure's
    // contents and leaves the empty measure in place; "time-delete" (Ctrl+Del
    // in the UI) is the action that actually removes it.
    //
    // Counted afterwards, the way insertChartMeasures counts its own work.
    // cmd() reports nothing, so a time-delete that did not happen looks exactly
    // like one that did; carrying on would drop the parts and blank the tags
    // below, leaving chart measures on the score that nothing can ever
    // identify again and a next run that builds a second chart in front of
    // them.
    var measuresBefore = score.nmeasures;
    for (var i = 0; i < found.count; i++) {
        selectFirstMeasure(score);
        engraving.cmd("time-delete");
    }
    if (score.nmeasures !== measuresBefore - found.count) {
        throw identificationError("This score records a Handbells Used chart, "
            + "but MuseScore did not remove the chart's measures.");
    }

    // removeParts silently does nothing when passed indexes — score.parts.length
    // comes back unchanged and nothing is written to the saved score, with no
    // error to say so. It wants the Part objects themselves, and it gets the
    // same post-condition check for the same reason: unreported failure here
    // leaves the chart's instruments on the score with the tags that identify
    // them about to be blanked.
    var partsBefore = score.parts.length;
    score.removeParts(found.parts);
    if (score.parts.length !== partsBefore - found.count) {
        throw identificationError("This score records a Handbells Used chart, "
            + "but MuseScore did not remove the chart's instruments.");
    }

    restoreChartStyle(score);
    score.setMetaTag(META_PARTS, "");
    score.setMetaTag(META_TOTAL, "");
    score.setMetaTag(META_COLUMNS, "");
    return true;
}

// The three things outside this file actually use: main.js drives the chart
// through buildChart and removeChart, and test/unit/mutate.test.js reaches for
// usableColor, which is the only piece here that decides anything without a
// live score. Everything else is internal — the extension tests exercise it by
// running MuseScore, not by importing it — and exporting it would advertise a
// surface with no callers and no tests.
module.exports = {
    usableColor: usableColor,
    buildChart: buildChart,
    removeChart: removeChart
};
