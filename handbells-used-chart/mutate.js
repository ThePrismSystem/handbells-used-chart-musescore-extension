/*
 * Turns a chart plan into changes to the open score.
 *
 * Eight API facts shape this file, each found the hard way:
 *
 *   - measure.add(element) crashes the process. Use cursor.add(element).
 *   - cursor.add(spanner) sets neither end of it. See drawOptional.
 *   - measure.stemless and staff.stemless are read-only. Use chord.noStem.
 *   - part.partName is read-only, so a chart is identified by recorded counts.
 *   - cmd() called while a startCmd/endCmd block is open anywhere on the stack
 *     crashes MuseScore. buildChart calls cmd(), so no caller may wrap it.
 *   - nothing changed from a plugin lays the score out. See relayout.
 *   - note.accidentalType moves the note rather than restyling it. See
 *     hideNaturalAccidentals.
 *   - insert-measure carries the starting clef into the new measure along with
 *     the time signature. See readStartingClefs.
 */

var bellname = require("./lib/bellname.js");
var optional = require("./lib/optional.js");

// insert-measure is "Insert one measure before selection". It takes no count,
// so it never prompts, and it inserts ahead of the selection — which is why
// there has to be one.
function selectFirstMeasure(score) {
    var measure = score.firstMeasure;
    score.selection.selectRange(measure.firstSegment.tick, measureEndTick(measure),
        0, score.nstaves);
}

// One tick past the end of a measure. The last measure has no next measure to
// take it from, and using this measure's own start gives an empty range, which
// once left a one-measure score with no chart and its music overwritten.
function measureEndTick(measure) {
    return measure.nextMeasure ? measure.nextMeasure.firstSegment.tick
        : measure.lastSegment.tick + 1;
}

function insertChartMeasures(engraving, score, count) {
    // cmd() reports nothing, so an insert that did not happen looks exactly
    // like one that did, and everything downstream would then treat the user's
    // own measures as chart measures. The count is the only evidence there is.
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

// A chime chart falls back to black by writing no colour at all, and an
// unparseable value is treated the same way.
//
// Trimmed and given its "#" first. The value is whatever a user typed into
// Project Properties, so " #c00000" and "c00000" both turn up, and note.color
// accepts anything without complaint: an unparseable string just leaves the
// chimes black with nothing to say why.
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
    // Fewer notes than the column asked for means a stacked column did not
    // stack. Walking the shorter list would hide that, leaving a bell off the
    // chart and its neighbours spelled from the key signature.
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
        // nextMeasure returns false at the end of the score and parks the
        // cursor on the last measure instead of moving it. Every caller writes
        // through this cursor, so ignoring that lands columns, labels and
        // breaks in the user's last bar.
        if (!cursor.nextMeasure()) {
            throw new Error("The chart needed measure " + (measureIndex + 1)
                + " of the score, which does not exist. Nothing further was "
                + "written. Delete the chart instruments and their measures in "
                + "MuseScore, then run this again.");
        }
    }
    return cursor;
}

// Every chord and rest in the chart measures, on every staff in the score —
// the chart's own, the other charts', and the piece's, which these measures run
// across as well. Voice 0 only: inserted measures have just the one.
function eachChartElement(score, chartMeasures, visit) {
    for (var m = 0; m < chartMeasures; m++) {
        var end = measureEndTick(chartMeasureAt(score, m));
        for (var staffIdx = 0; staffIdx < score.nstaves; staffIdx++) {
            var cursor = cursorAt(score, staffIdx, m);
            while (cursor.segment && cursor.tick < end) {
                if (cursor.element) visit(cursor.element);
                cursor.next();
            }
        }
    }
}

// The rests padding a chart measure out to its length are structural, not
// musical, so every one of them is hidden. The two staves of a chart end at
// different columns by design, so at least one is padded on nearly every chart.
//
// Anything without notes is a rest, since chords are the only thing here that
// carries them.
function hidePaddingRests(score, chartMeasures) {
    eachChartElement(score, chartMeasures, function (element) {
        if (!element.notes) element.visible = false;
    });
}

// A chart is an inventory of the bells a piece needs, so no natural sign
// belongs on one. MuseScore prints one whenever a plain letter follows an
// altered spelling of the same letter earlier in the measure — E four columns
// along from E flat — and a ringer reads that as a second, separate bell rather
// than the same one. tools/writer.js writes its naturals invisible for exactly
// this reason.
//
// Nothing to hide until the score has been laid out, because that is when
// MuseScore works each accidental out; buildChart lays it out either side of
// this call. And note.accidentalType is not a shortcut past that: assigning it
// moves the note, the way picking an accidental off the palette does in the UI,
// so setting NATURAL on a chart of nine bells lands seven of them on one pitch.
function hideNaturalAccidentals(score, chartMeasures) {
    eachChartElement(score, chartMeasures, function (element) {
        for (var i = 0; element.notes && i < element.notes.length; i++) {
            var note = element.notes[i];
            if (bellname.alterOfTpc(note.tpc1) === 0 && note.accidental) {
                note.accidental.visible = false;
            }
        }
    });
}

// Every time signature in one measure. A cursor only stops at chord and rest
// segments, so finding one means walking the measure's segments directly. Over
// every track, not staff 0 alone: each staff carries its own copy of the
// signature, and a chart measure runs across the piece's own staves as well as
// the chart's. Both halves of the hide-and-restore below need this same walk.
function elementsIn(score, measure, type) {
    var found = [];
    for (var seg = measure.firstSegment; seg; seg = seg.nextInMeasure) {
        for (var track = 0; track < score.ntracks; track++) {
            var element = seg.elementAt(track);
            if (element && element.type === type) found.push(element);
        }
    }
    return found;
}

function timeSignaturesIn(engraving, score, measure) {
    return elementsIn(score, measure, engraving.Element.TIMESIG);
}

// cmd("insert-measure") carries the score's time signature into the measure it
// creates rather than leaving it with the music, so the metre must be read
// before the chart measures go in. Copied out as plain values, because the
// element and its Fraction are both about to move.
//
// Every field, not just the fraction: timesigType holds the cut-time and
// common-time symbols, the two strings hold additive metres like 2+3/8,
// showCourtesy and visible hold whether it prints. Any staff's copy will do;
// they agree.
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

// The other half of hideTimeSignatures: hidden where insert-measure put it,
// written back where it came from. A score that never declared a metre must
// not acquire one, so timeSignatureOf returns null there and both halves do
// nothing.
//
// cursor.add, never measure.add: measure.add takes the process down.
//
// Written to every staff, the chart's included. Those staves are part of the
// score by now and need the metre declared on them too.
//
// One thing is lost: <Groups>, the measure's own beaming groups, reads
// undefined before assignment, so there is no property to copy. A first
// measure with hand-edited beam groups loses them. Looked for, not found.
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

// The clef changes the piece's own staves carry at their very start.
//
// insert-measure moves these into the new first measure exactly as it moves the
// time signature, so after a build the piece's clef is sitting in a chart
// measure. That reads correctly, and the first run looks perfect — but the next
// run's removeChart deletes those measures and takes the clef with it, and the
// staff drops back to its instrument's default. A bass staff quietly becomes a
// treble one, one run later than the change that caused it.
//
// A staff's own starting clef is a header segment and is never at risk. What
// moves is a clef *change* written at tick 0, which is what MuseScore records
// when the clef is set from the palette rather than in Staff properties.
function readStartingClefs(score) {
    var byStaff = {};
    var order = [];
    var measure = score.firstMeasure;
    if (!measure) return [];
    for (var seg = measure.firstSegment; seg; seg = seg.nextInMeasure) {
        // Both kinds. The clef a run has to preserve starts life as a change,
        // but the one this puts back becomes the measure's header clef, and a
        // reader that knew only about changes found nothing on the run after
        // that and lost the clef anyway. Later segments overwrite earlier ones,
        // so what each staff ends up with is the clef actually in force where
        // the music begins.
        if (seg.segmentType !== CLEF_SEGMENT
            && seg.segmentType !== HEADER_CLEF_SEGMENT) continue;
        for (var staffIdx = 0; staffIdx < score.nstaves; staffIdx++) {
            var element = seg.elementAt(staffIdx * VOICES);
            if (!element || element.name !== "Clef") continue;
            if (byStaff[staffIdx] === undefined) order.push(staffIdx);
            byStaff[staffIdx] = {
                staffIdx: staffIdx,
                concert: element.concertClefType,
                transposing: element.transposingClefType
            };
        }
    }
    var clefs = [];
    for (var i = 0; i < order.length; i++) clefs.push(byStaff[order[i]]);
    return clefs;
}

// Put back after the chart measures are gone, which is the only moment this
// works. Add the same clef while the chart measure still carries a copy and
// MuseScore drops it as redundant — silently, so the score looks right until
// the run after next loses it too. Once the measure holding the copy has been
// deleted the clef is a real change again and stays.
//
// Every staff is offered its clef back, not just the ones that had a clef of
// their own. Redundancy is what makes that safe: a staff already starting on
// this clef has the offer dropped, so only a clef that genuinely differs from
// the staff's own default survives — which is exactly the set worth keeping.
//
// Both types are set because a transposing instrument's concert and transposing
// clefs need not agree. subtype is read-only — assigning it throws, and the
// throw escapes as a refusal that builds no chart at all — so it is left for
// MuseScore to derive from the two that can be set.
function restoreStartingClefs(engraving, score, clefs, measureIndex) {
    for (var i = 0; i < clefs.length; i++) {
        // Staves the removal took with it. A chart staff's index would land on
        // one of the piece's own staves now that the chart's parts are gone.
        if (clefs[i].staffIdx >= score.nstaves) continue;
        var clef = engraving.newElement(engraving.Element.CLEF);
        clef.concertClefType = clefs[i].concert;
        clef.transposingClefType = clefs[i].transposing;
        cursorAt(score, clefs[i].staffIdx, measureIndex).add(clef);
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

// A chart is an inventory, so it gets no barlines closing it off. The staff
// setting for this is "Show barlines", which belongs to StaffType and is not
// something a plugin can reach, so the barlines are hidden one element at a
// time instead. Same result on the page, different route.
//
// The system barline is untouched: it is a separate setting (hideSystemBarLine
// in dressStaves), and it is wanted — it joins each chart's two staves.
function hideBarLines(engraving, score, chartMeasures) {
    for (var m = 0; m < chartMeasures; m++) {
        var found = elementsIn(score, chartMeasureAt(score, m), engraving.Element.BAR_LINE);
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

// The cursor parked on one chart column. A column is a quarter note from the
// start of the chart measure, so anything belonging to a column other than the
// first has to be walked forward to it.
function columnCursor(score, staffIdx, measureIndex, column) {
    var cursor = cursorAt(score, staffIdx, measureIndex);
    for (var i = 0; i < column; i++) cursor.next();
    return cursor;
}

// The bracket over an optional run, and the word beside it.
//
// Two elements, not one: a TextLine carrying begin text renders the word and
// suppresses its own line, and with beginTextPlace above both draw but the line
// strikes through the word. tools/writer.js writes them separately for exactly
// that reason, measured on the page.
function drawOptional(engraving, score, staffIdx, measureIndex, run) {
    var placement = optional.isAbove(run) ? PLACEMENT_ABOVE : PLACEMENT_BELOW;

    var line = engraving.newElement(engraving.Element.TEXTLINE);
    line.placement = placement;
    line.beginHookType = RIGHT_ANGLE_HOOK;
    line.endHookType = RIGHT_ANGLE_HOOK;
    // Both ticks, because cursor.add sets neither of them. It puts the spanner
    // on the cursor's staff and stops there: one added without these keeps the
    // defaults it was made with, a start of -1/1 and a length of 0/1, which
    // lands the whole bracket off the front of the score. That writes a
    // <Spanner type="TextLine"> into the file looking much like a good one, and
    // draws nothing whatever, so reading the saved XML cannot tell them apart.
    //
    // spannerTick is where the bracket starts, as a fraction of a whole note
    // from the start of the score; spannerTicks is how far it reaches from
    // there. A column is a quarter, so a run ending N columns along reaches N/4.
    line.spannerTicks = engraving.fraction(optional.spanColumns(run), 4);
    var cursor = columnCursor(score, staffIdx, measureIndex, run.firstColumn);
    line.spannerTick = engraving.fraction(cursor.tick, TICKS_PER_WHOLE);
    cursor.add(line);

    var word = engraving.newElement(engraving.Element.STAFF_TEXT);
    word.text = "optional";
    word.placement = placement;
    word.fontStyle = ITALIC_FONT_STYLE;
    // Both halves of the alignment, because assigning the horizontal one alone
    // resets the vertical to TOP rather than leaving the baseline it had.
    word.align = engraving.Align.HCENTER | engraving.Align.BASELINE;
    // The middle column of the run, so the word centres on its bracket.
    columnCursor(score, staffIdx, measureIndex,
        optional.wordColumn(run)).add(word);

    return line;
}

// The bracket has to enclose its bells, not stop inside them. Two passes do
// it, because the API gives no single lever for either end.
//
// The end: there is no way to lengthen a laid-out segment. off2, offset2,
// minLength and userLen are not properties the API puts on one; userOff2 is,
// and reads back whatever it is given, but changes neither the layout nor the
// saved file — all four were set and rendered to check. What does work is a
// spannerTicks that lands between segments: MuseScore interpolates the end
// position rather than snapping it, which is exactly what the XML front end's
// <location><fractions> will not do. So the extension buys the overhang in
// time where tools/writer.js buys it in space.
//
// The conversion needs to know what a chart column is worth on the page, and
// nothing says so until the score has been laid out. pos2 reports the bracket's
// laid-out length, which covers its columns less the gap MuseScore leaves
// before the end anchor. Like offsetX it is read in the score's spatium, so it
// is scaled to the staff's before being compared with the figures from lib/.
function widenOptionalBrackets(engraving, brackets) {
    for (var i = 0; i < brackets.length; i++) {
        var line = brackets[i].line;
        var columns = optional.spanColumns(brackets[i].run);
        var segments = line.spannerSegments;
        // A one-column run spans no time, so MuseScore lays out no segment for
        // it and draws no line: nothing to measure, and nothing to widen. A
        // bracket broken across systems would need a width per segment, and a
        // chart bracket never leaves its own measure.
        if (columns < 1 || !segments || segments.length !== 1) continue;
        var laid = segments[0].pos2.x * SMALL_STAFF_MAG;
        var perColumn = (laid + optional.endBackoff()) / columns;
        if (!(perColumn > 0)) continue;
        var reach = columns + optional.endOffset() / perColumn;
        // A column is a quarter, so TICKS_PER_WHOLE / 4 ticks. Rounding to
        // whole ticks keeps it a fraction MuseScore can hold exactly.
        line.spannerTicks = engraving.fraction(
            Math.round(reach * TICKS_PER_WHOLE / 4), TICKS_PER_WHOLE);
    }
}

// The start, in a pass of its own because the widening above rebuilds the
// segments this writes to.
//
// offsetX moves both ends together, which is why endOffset already carries the
// overhang a second time. It is read in the score's spatium rather than the
// staff's, so on the chart's small staves the figure has to be divided by their
// magnification to come out the size it asks for on the page.
function shiftOptionalBrackets(brackets) {
    for (var i = 0; i < brackets.length; i++) {
        var segments = brackets[i].line.spannerSegments;
        if (!segments) continue;
        for (var s = 0; s < segments.length; s++) {
            segments[s].offsetX = optional.startOffset() / SMALL_STAFF_MAG;
        }
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
        // Smaller than MuseScore's 10pt default for system text. The label
        // names an inventory, not a musical instruction, and at the default it
        // competes with the title sitting directly above it.
        label.fontSize = LABEL_POINT_SIZE;
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
            // The system barline stays. It is the vertical rule joining the
            // chart's two staves at the left, and a grand staff without it
            // reads as two unrelated staves rather than one chart.
            staves[s].hideSystemBarLine = false;
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
    // Each previous value is recorded first so removeChart can hand it back,
    // rather than leaving the change to outlive the chart that needed it.
    //
    // Writing a style does not lay the score out, whether or not the value
    // changes, which is why relayout runs at the end of the build.
    for (var name in STYLE_FOR_CHART) {
        score.setMetaTag(META_STYLE_PREFIX + name, String(score.style.value(name)));
        score.style.setValue(name, STYLE_FOR_CHART[name]);
    }
}

// Nothing a plugin changes lays the score out. MuseScore keeps the layout it
// had when the run started and the open score goes on being drawn from that:
// the chart is written into the file correctly and the user sees the piece as
// it was, with the chart's staves standing empty through every system, until
// they toggle a style setting or close and reopen the score. So laying the
// whole score out is the last thing every change here does.
//
// doLayout is the range form and refuses to be called without one —
// "Insufficient arguments" is what a bare doLayout() throws. An end below zero
// means "to the end of the score", so this is all of it.
function relayout(engraving, score) {
    score.doLayout(engraving.fraction(0, 1), engraving.fraction(-1, 1));
}

function buildChart(engraving, score, plan, options) {
    if (!plan.sections.length) return;
    var opts = options || {};

    // Read before anything moves. This is the last point at which the piece's
    // own metre can be read from the piece's own first measure.
    var metre = timeSignatureOf(engraving, score);

    var placed = appendChartParts(score, plan);

    // Recorded as soon as there is something to record, not once the chart is
    // finished. These counts are the only way a later run finds these parts
    // again, so anything throwing below would otherwise strand them and the
    // next run would append a second set in silence.
    //
    // No startCmd/endCmd around these, unlike main.js: buildChart calls cmd(),
    // which crashes if a command block is open anywhere on the stack. The job
    // runner saves once main() returns, so the tags land anyway.
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

    var brackets = [];
    for (var i = 0; i < placed.length; i++) {
        var section = placed[i].section;
        var color = section.kind === "chimes" ? usableColor(opts.chimeColor) : null;
        writeColumns(engraving, score, placed[i].trebleIdx, i, section.treble, color);
        writeColumns(engraving, score, placed[i].bassIdx, i, section.bass, color);
        // After the columns, because both elements are anchored to the segments
        // writing those columns created.
        for (var r = 0; r < section.optional.length; r++) {
            var run = section.optional[r];
            brackets.push({
                run: run,
                line: drawOptional(engraving, score,
                    run.staff === "treble" ? placed[i].trebleIdx : placed[i].bassIdx,
                    i, run)
            });
        }
    }

    // After every column is written, and over all the staves rather than from
    // inside writeColumns: a staff with no columns of its own never enters
    // that function and is nothing but padding.
    hidePaddingRests(score, plan.sections.length);
    hideTimeSignatures(engraving, score, plan.sections.length);
    hideBarLines(engraving, score, plan.sections.length);
    restoreTimeSignature(engraving, score, metre, plan.sections.length);

    dressMeasures(engraving, score, plan);
    dressStaves(score, placed);

    // The first layout is what creates the accidentals, and the brackets'
    // segments along with them; the second draws the chart without the
    // naturals among them and with the brackets at their full width.
    relayout(engraving, score);
    hideNaturalAccidentals(score, plan.sections.length);
    widenOptionalBrackets(engraving, brackets);
    relayout(engraving, score);
    shiftOptionalBrackets(brackets);
    relayout(engraving, score);
}

// MuseScore's default for system text is 10pt.
var LABEL_POINT_SIZE = 8;

// placement is an integer here, not a string: assigning "above" reads back 0,
// which is also what a successful assignment of 0 reads, so nothing about the
// property says whether a string was understood.
var PLACEMENT_ABOVE = 0;
var PLACEMENT_BELOW = 1;

// Hook type 1 is the 90-degree hook that turns a line into a bracket. It turns
// toward the staff on its own: down under a bracket placed above, up over one
// placed below.
var RIGHT_ANGLE_HOOK = 1;

// fontStyle is a bitmask — 1 bold, 2 italic, 4 underline. The API publishes an
// Align enum but no FontStyle one, so the italic bit is named here instead.
var ITALIC_FONT_STYLE = 2;

// MuseScore counts 480 ticks to a quarter note, so 1920 to a whole one. A
// cursor reports ticks; a spanner's position is a fraction of a whole note.
var TICKS_PER_WHOLE = 1920;

// MuseScore's SegmentType for a clef change, as against the header clef that
// opens a staff. Only the change is at risk when the front of the score moves.
var CLEF_SEGMENT = 1024;

// And the segment holding the clef that opens a staff, which is what a restored
// clef becomes once it is the first thing in the score again.
var HEADER_CLEF_SEGMENT = 2;

// Tracks per staff. A clef sits in the staff's first voice.
var VOICES = 4;

// MuseScore's own magnification for a small staff, which every chart staff is.
// A segment offset is read in the score's spatium, so a figure meant as staff
// spatium has to be divided by this to travel the distance it names.
var SMALL_STAFF_MAG = 0.7;

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

    // findChart vouches for the parts, not the measures, and the measures are
    // removed by position. So a measure inserted at the front between runs
    // would be deleted and a chart measure left standing.
    //
    // Two marks are checked, because irregular alone is not enough: the
    // measure MuseScore's pickup wizard writes reads irregular true as well.
    // The recorded lengths settle it, since a chart measure was sized to its
    // own column count and nothing else has reason to match. A chart with no
    // recorded lengths is refused rather than removed on the weaker mark.
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

    // Read while the measures about to be deleted still hold them.
    var clefs = readStartingClefs(score);

    // Measures first: removing the parts renumbers the staves underneath us.
    // cmd("delete") only clears a measure's contents; "time-delete" removes
    // the measure itself.
    //
    // Counted afterwards, as insertChartMeasures counts its own work. cmd()
    // reports nothing, and carrying on from a delete that never happened would
    // strand chart measures that nothing can identify again.
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

    restoreStartingClefs(engraving, score, clefs, 0);

    restoreChartStyle(score);
    score.setMetaTag(META_PARTS, "");
    score.setMetaTag(META_TOTAL, "");
    score.setMetaTag(META_COLUMNS, "");
    // A removal that is about to be followed by a build lays the score out
    // twice. The alternative is for the caller to remember, which is the shape
    // that produced this bug.
    relayout(engraving, score);
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
