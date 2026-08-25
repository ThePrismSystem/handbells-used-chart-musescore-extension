/*
 * Turns the open score into the note records lib/ plans from.
 *
 * The record shape is identical to the one tools/extract-notes.js produces
 * from XML, so lib/collect.js consumes either without knowing which it has.
 */

var sourcepitch = require("./lib/sourcepitch.js");

// A cursor addresses one staff and one voice at a time. Handbell writing uses
// voices heavily, and reading only voice 0 silently under-reports: 55 bells
// instead of 58 on the reference arrangement.
var VOICES = 4;

// Read the selection when there is one, the whole score otherwise. A headless
// run never has a selection, so endTick -1 (meaning "to the end") is the only
// case the automated tests exercise.
function readRange(score) {
    var selection = score.selection;
    if (!selection.isRange || !selection.startSegment) {
        return { startTick: 0, endTick: -1, startStaff: 0, endStaff: score.nstaves };
    }
    return {
        startTick: selection.startSegment.tick,
        endTick: selection.endSegment ? selection.endSegment.tick : -1,
        startStaff: selection.startStaff,
        endStaff: selection.endStaff
    };
}

// How far this staff's part transposes, in semitones.
//
// Staff.transpose is a function taking a Fraction, the way clefType and key
// are, and it returns an interval whose chromatic is the number wanted. It is
// asked at tick 0, so a mid-score instrument change is not followed — the same
// staff-wide reading this has always taken.
//
// Part exposes nothing of the kind: part.transpose and part.instrument both
// read undefined, which is what once made this look like a question only the
// instrument id could answer. The id is a poor proxy — a Piano part transposed
// up an octave by hand charted an octave high, and a handbell part imported
// from MusicXML, which keeps the id and loses the transposition, charted an
// octave low.
function transpositionOfStaff(engraving, score, staffIdx) {
    return score.staves[staffIdx].transpose(engraving.fraction(0, 1)).chromatic;
}

function readChord(chord, records, heads, staff, offset) {
    if (!chord || !chord.notes) return;
    for (var i = 0; i < chord.notes.length; i++) {
        var note = chord.notes[i];
        records.push({
            // The bell's sounding pitch. MuseScore stores the score's sounding
            // pitch, which is an octave below the bell's name on any part that
            // does not transpose — a Piano part, which is how handbell music
            // was written before MuseScore had the instrument. note.pitch is
            // that sounding pitch whether or not the score is shown in concert
            // pitch, and an ottava is not in it: an 8va line is a playback and
            // reading instruction MuseScore leaves out of both pitch and line,
            // so bells written under one are read at the octave they are drawn.
            pitch: note.pitch + offset,
            tpc: note.tpc1,             // the spelling
            // Four outcomes, not three. Mapping everything that is not a
            // diamond to "normal" made a cross notehead a handbell here while
            // tools/extract-notes.js counted the same note as unknown and
            // warned. lib/ trusts the head a reader gives it, so the two
            // readers are where one score turns into two different charts
            // with nothing downstream to catch it.
            //
            // "la" is the shape-note head that draws as a filled square, which
            // is what a silver melody bell is written with; the name is the
            // one MuseScore itself writes into the XML, so both readers report
            // the same word for it.
            head: note.headGroup === heads.diamond ? "diamond"
                : note.headGroup === heads.la ? "la"
                : note.headGroup === heads.normal ? "normal"
                : "other",
            staffId: staff + 1
        });
    }
}

function readScore(engraving, score) {
    var range = readRange(score);
    var records = [];
    var heads = {
        diamond: engraving.NoteHeadGroup.HEAD_DIAMOND,
        la: engraving.NoteHeadGroup.HEAD_LA,
        normal: engraving.NoteHeadGroup.HEAD_NORMAL
    };
    var cursor = score.newCursor();

    for (var staff = range.startStaff; staff < range.endStaff; staff++) {
        var offset = sourcepitch.offsetForTransposition(
            transpositionOfStaff(engraving, score, staff));
        for (var voice = 0; voice < VOICES; voice++) {
            // The track goes on before the rewind. rewind(0) does not clear it,
            // and setting it afterwards leaves the cursor's segment positioned
            // for the previous track, which quietly loses notes.
            cursor.staffIdx = staff;
            cursor.voice = voice;
            cursor.rewind(0);

            while (cursor.segment) {
                if (range.endTick >= 0 && cursor.tick >= range.endTick) break;
                var element = cursor.tick >= range.startTick ? cursor.element : null;
                if (element && element.notes) {
                    // The grace notes before the principal chord, then the
                    // chord itself. cursor.element gives only the principal
                    // one, so without this a bell a piece uses solely as a
                    // grace note never reaches the chart — while
                    // tools/extract-notes.js, which walks every <Note> in the
                    // XML, does find it. Same score, two different charts, in
                    // the one place lib/ cannot see the difference.
                    var chords = element.graceNotes ? element.graceNotes : [];
                    for (var g = 0; g < chords.length; g++) {
                        readChord(chords[g], records, heads, staff, offset);
                    }
                    readChord(element, records, heads, staff, offset);
                }
                cursor.next();
            }
        }
    }
    return records;
}

module.exports = { readScore: readScore };
