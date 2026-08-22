/*
 * Turns the open score into the note records lib/ plans from.
 *
 * The record shape is identical to the one tools/extract-notes.js produces
 * from XML, so lib/collect.js consumes either without knowing which it has.
 */

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

function readScore(engraving, score) {
    var range = readRange(score);
    var records = [];
    var diamond = engraving.NoteHeadGroup.HEAD_DIAMOND;
    var cursor = score.newCursor();

    for (var staff = range.startStaff; staff < range.endStaff; staff++) {
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
                    for (var i = 0; i < element.notes.length; i++) {
                        var note = element.notes[i];
                        records.push({
                            pitch: note.pitch,          // sounding, as lib/ expects
                            tpc: note.tpc1,             // the spelling
                            head: note.headGroup === diamond ? "diamond" : "normal",
                            staffId: staff + 1
                        });
                    }
                }
                cursor.next();
            }
        }
    }
    return records;
}

module.exports = { readScore: readScore };
