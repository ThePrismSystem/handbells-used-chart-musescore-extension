/*
 * The engraving API as the build expects it.
 *
 * The extension runs at apiversion 2, because a composite manifest gives
 * every action the same version and the options dialog, a form, needs 2. At
 * that version Element values read as names: Element.SYSTEM_TEXT is the
 * string "SYSTEM_TEXT", and newElement given that string returns null.
 * newElement still takes MuseScore's number for the type, and nothing at
 * apiversion 2 reports those numbers. The API lists Element's keys in a
 * different order from their values, so a key's position is no substitute:
 * position 54 is STAFF_TEXT, not SYSTEM_TEXT.
 *
 * So the numbers come from MuseScore 4.7's src/engraving/types/types.h, and
 * every element is checked as it is made. An element reads its type back as
 * a name, so a version whose numbers differ is caught and refused rather
 * than drawing a chart out of the wrong elements.
 * test/extension/enum-order.test.js checks the table against the running
 * MuseScore through a probe at apiversion 1, which can read the numbers.
 *
 * Comparisons against element.type need nothing, because element.type reads
 * as the same name. note.headGroup reads and writes the key too, "HEAD_LA",
 * so at apiversion 2 NoteHeadGroup is handed out as keys. lib/noteheads.js
 * reads either.
 */

var ELEMENT_TYPES = {
    LAYOUT_BREAK: 6,
    CLEF: 29,
    TIMESIG: 32,
    STAFF_TEXT: 54,
    SYSTEM_TEXT: 55,
    INSTRUMENT_CHANGE: 63,
    TEXTLINE: 94
};

var MISMATCH = "This version of MuseScore numbers its score elements differently "
    + "from the versions this extension knows, so it cannot build the chart. "
    + "The score has not been changed.";

function make(engraving, type) {
    var made = ELEMENT_TYPES.hasOwnProperty(type)
        ? engraving.newElement(ELEMENT_TYPES[type]) : null;
    if (!made || made.type !== type) {
        throw new Error(MISMATCH + " (" + type + ")");
    }
    return made;
}

// Makes one of each element the build uses and throws on the first that
// comes back as anything else, so a build can refuse before the old chart is
// removed. The elements are never added to the score.
function check(engraving) {
    for (var type in ELEMENT_TYPES) {
        if (ELEMENT_TYPES.hasOwnProperty(type)) make(engraving, type);
    }
}

// Each NoteHeadGroup key standing for itself, for an engine that sets
// headGroup by name. Assigned a number there, headGroup writes an empty
// <head> and a chime is drawn as a plain bell.
function headGroupsFor(engraving) {
    var first = Object.keys(engraving.Element)[0];
    if (typeof engraving.Element[first] !== "string") return engraving.NoteHeadGroup;
    var keys = {};
    for (var key in engraving.NoteHeadGroup) {
        if (engraving.NoteHeadGroup.hasOwnProperty(key)) keys[key] = key;
    }
    return keys;
}

function adapt(engraving) {
    var headGroups = headGroupsFor(engraving);
    return {
        get curScore() { return engraving.curScore; },
        cmd: function (name) { return engraving.cmd(name); },
        fraction: function (numerator, denominator) {
            return engraving.fraction(numerator, denominator);
        },
        newElement: function (type) {
            return typeof type === "string" ? make(engraving, type) : engraving.newElement(type);
        },
        check: function () { check(engraving); },
        Element: engraving.Element,
        NoteHeadGroup: headGroups,
        Align: engraving.Align,
        LayoutBreak: engraving.LayoutBreak
    };
}

module.exports = { adapt: adapt, check: check, ELEMENT_TYPES: ELEMENT_TYPES };
