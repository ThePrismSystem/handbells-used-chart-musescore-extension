/*
 * Every setting the chart takes, and the score field that stores it.
 *
 * The settings live in the score's Project Properties, so they travel with the
 * file. The extension reads them, the options dialog edits them, and the
 * command-line tool starts from them and lets its flags override. One list,
 * so none of the three can disagree about a field's name or its default.
 */

// The shapes a chart can be drawn in. "match" draws each bell with the
// notehead the music uses.
var SHAPES = ["match", "round", "diamond", "square", "triangle",
              "inverted-triangle", "half-circle", "cone"];

var MODES = ["combined", "separate"];

function setting(key, tag, kind, fallback, choices) {
    var entry = { key: key, tag: tag, kind: kind, fallback: fallback };
    if (choices) entry.choices = choices;
    return entry;
}

var SETTINGS = [
    setting("bellLabel", "handbellChartBellLabel", "text", null),
    setting("chimeLabel", "handbellChartChimeLabel", "text", null),
    // The same field the handbell notation plugins write.
    setting("chimeColor", "handchimesColor", "color", null),
    setting("smbLabel", "handbellChartSmbLabel", "text", null),
    setting("smbColor", "handbellChartSmbColor", "color", null),
    setting("smbsOptional", "handbellChartSmbsOptional", "yesno", false),
    // Left absent rather than defaulted: a range with no bounds marks nothing
    // optional, which is what a score that never named one wants.
    setting("requiredBellFirst", "handbellChartRequiredBellFirst", "note", null),
    setting("requiredBellLast", "handbellChartRequiredBellLast", "note", null),
    setting("requiredChimeFirst", "handbellChartRequiredChimeFirst", "note", null),
    setting("requiredChimeLast", "handbellChartRequiredChimeLast", "note", null),
    setting("skipParts", "handbellChartSkipParts", "text", null),
    setting("sharedStaff", "handbellChartSharedStaff", "yesno", false),
    setting("showInstrumentNames", "handbellChartShowInstrumentNames", "yesno", false),
    setting("quiet", "handbellChartQuiet", "yesno", false),
    setting("mode", "handbellChartMode", "choice", "combined", MODES),
    setting("bellHead", "handbellChartBellHead", "head", "normal"),
    setting("chimeHead", "handbellChartChimeHead", "head", "diamond"),
    setting("smbHead", "handbellChartSmbHead", "head", "la"),
    setting("pfHead", "handbellChartPfHead", "head", "none"),
    setting("whitechapelHead", "handbellChartWhitechapelHead", "head", "none"),
    setting("bellShape", "handbellChartBellShape", "choice", "match", SHAPES),
    setting("chimeShape", "handbellChartChimeShape", "choice", "match", SHAPES),
    setting("smbShape", "handbellChartSmbShape", "choice", "match", SHAPES),
    setting("pfShape", "handbellChartPfShape", "choice", "match", SHAPES),
    setting("whitechapelShape", "handbellChartWhitechapelShape", "choice", "match", SHAPES),
    setting("pfLabel", "handbellChartPfLabel", "text", null),
    setting("whitechapelLabel", "handbellChartWhitechapelLabel", "text", null),
    setting("pfColor", "handbellChartPfColor", "color", null),
    setting("whitechapelColor", "handbellChartWhitechapelColor", "color", null)
];

// The required-range dropdowns offer the naturals across the handbell
// compass, C2 to C9.
var NATURAL_NOTES = (function () {
    var letters = ["C", "D", "E", "F", "G", "A", "B"];
    var notes = [];
    for (var octave = 2; octave <= 8; octave++) {
        for (var i = 0; i < letters.length; i++) notes.push(letters[i] + octave);
    }
    notes.push("C9");
    return notes;
})();

// A field's text as the setting's value. A blank field is the default.
function parse(entry, text) {
    if (entry.kind === "yesno") return text === "yes";
    return text ? text : entry.fallback;
}

// read(tag) returns the field's text, or "" or null when there is none.
function readOptions(read) {
    var options = {};
    for (var i = 0; i < SETTINGS.length; i++) {
        options[SETTINGS[i].key] = parse(SETTINGS[i], read(SETTINGS[i].tag));
    }
    return options;
}

// Refused before anything is removed from the score, so a mistyped field
// leaves the old chart where it was.
function validateOptions(options) {
    for (var i = 0; i < SETTINGS.length; i++) {
        var entry = SETTINGS[i];
        if (!entry.choices) continue;
        var value = options[entry.key];
        if (entry.choices.indexOf(value) < 0) {
            throw new Error(entry.tag + " is \"" + value + "\", which is not one of: "
                + entry.choices.join(", ") + ".");
        }
    }
}

// The text a setting's value is stored as. The default is stored as a blank
// field, so a score set back to it reads like one that never changed it.
function textOf(entry, value) {
    if (entry.kind === "yesno") return value ? "yes" : "";
    if (value === null || value === undefined || value === entry.fallback) return "";
    return String(value);
}

// The fields to write so the score holds these options. Compared by meaning
// rather than by text, so saving what was read writes nothing even when a
// field holds "no", or a value this model would refuse.
function changedTags(options, read) {
    var changes = [];
    for (var i = 0; i < SETTINGS.length; i++) {
        var entry = SETTINGS[i];
        var stored = parse(entry, read(entry.tag));
        var wanted = parse(entry, textOf(entry, options[entry.key]));
        if (stored !== wanted) changes.push({ tag: entry.tag, value: textOf(entry, wanted) });
    }
    return changes;
}

module.exports = {
    SETTINGS: SETTINGS,
    SHAPES: SHAPES,
    MODES: MODES,
    NATURAL_NOTES: NATURAL_NOTES,
    readOptions: readOptions,
    validateOptions: validateOptions,
    changedTags: changedTags
};
