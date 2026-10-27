/*
 * Notehead colours: the ones a user types into a field, and the ones the
 * music already uses.
 */

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

// The colour most of one notehead's notes carry, or "" when that is black or
// there are none. A record carries a colour only when its note is not black.
// The dialog offers this as a kind's colour when the user picks the notehead.
function mostUsedColor(records, head) {
    var counts = {};
    var best = "";
    var bestCount = 0;
    for (var i = 0; i < records.length; i++) {
        if (records[i].head !== head) continue;
        var color = records[i].color || "";
        counts[color] = (counts[color] || 0) + 1;
        if (counts[color] > bestCount) {
            best = color;
            bestCount = counts[color];
        }
    }
    return best;
}

module.exports = { usableColor: usableColor, mostUsedColor: mostUsedColor };
