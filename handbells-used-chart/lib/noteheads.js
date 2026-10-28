/*
 * MuseScore's notehead names, shared by both readers and both writers.
 *
 * A plugin sees a notehead as a NoteHeadGroup value and the XML spells it as a
 * word, so the two front ends need one table between them or the same score
 * gives two different charts. The words are the ones MuseScore writes into
 * <head>, from src/engraving/types/typesconv.cpp.
 *
 * Only the 26 groups the 4.7 plugin API puts on NoteHeadGroup are listed. The
 * extension cannot name any other head, so the command-line tool must not
 * either.
 */

var NAMES = [
    { key: "HEAD_NORMAL", name: "normal" },
    { key: "HEAD_CROSS", name: "cross" },
    { key: "HEAD_PLUS", name: "plus" },
    { key: "HEAD_XCIRCLE", name: "xcircle" },
    { key: "HEAD_WITHX", name: "withx" },
    { key: "HEAD_TRIANGLE_UP", name: "triangle-up" },
    { key: "HEAD_TRIANGLE_DOWN", name: "triangle-down" },
    { key: "HEAD_SLASHED1", name: "slashed1" },
    { key: "HEAD_SLASHED2", name: "slashed2" },
    { key: "HEAD_DIAMOND", name: "diamond" },
    { key: "HEAD_DIAMOND_OLD", name: "diamond-old" },
    { key: "HEAD_CIRCLED", name: "circled" },
    { key: "HEAD_CIRCLED_LARGE", name: "circled-large" },
    { key: "HEAD_LARGE_ARROW", name: "large-arrow" },
    { key: "HEAD_BREVIS_ALT", name: "altbrevis" },
    { key: "HEAD_SLASH", name: "slash" },
    { key: "HEAD_LARGE_DIAMOND", name: "large-diamond" },
    { key: "HEAD_HEAVY_CROSS", name: "heavy-cross" },
    { key: "HEAD_HEAVY_CROSS_HAT", name: "heavy-cross-hat" },
    { key: "HEAD_SOL", name: "sol" },
    { key: "HEAD_LA", name: "la" },
    { key: "HEAD_FA", name: "fa" },
    { key: "HEAD_MI", name: "mi" },
    { key: "HEAD_DO", name: "do" },
    { key: "HEAD_RE", name: "re" },
    { key: "HEAD_TI", name: "ti" }
];

function entryWhere(field, value) {
    for (var i = 0; i < NAMES.length; i++) {
        if (NAMES[i][field] === value) return NAMES[i];
    }
    return null;
}

// The file name for a notehead as a note reports it. A macros extension reads
// note.headGroup as the enum's number, and a form reads it as the enum's key,
// "HEAD_DIAMOND", so both are accepted. null for anything else: guessing
// "normal" would chart an unknown head as a handbell.
function nameOf(value, noteHeadGroup) {
    if (typeof value === "string") {
        var byKey = entryWhere("key", value);
        return byKey ? byKey.name : null;
    }
    // Otherwise an undefined head would match the first key this enum lacks.
    if (typeof value !== "number") return null;
    for (var i = 0; i < NAMES.length; i++) {
        if (noteHeadGroup[NAMES[i].key] === value) return NAMES[i].name;
    }
    return null;
}

// The NoteHeadGroup value to set for a file name. Thrown rather than skipped
// when this MuseScore has no such group, because a note left on its plain head
// draws a chart that passes for handbells.
function groupOf(name, noteHeadGroup) {
    var entry = entryWhere("name", name);
    if (!entry || noteHeadGroup[entry.key] === undefined) {
        throw new Error("This version of MuseScore has no " + name
            + " notehead, so the chart cannot be drawn in it.");
    }
    return noteHeadGroup[entry.key];
}

function isName(name) {
    return entryWhere("name", name) !== null;
}

module.exports = { NAMES: NAMES, nameOf: nameOf, groupOf: groupOf, isName: isName };
