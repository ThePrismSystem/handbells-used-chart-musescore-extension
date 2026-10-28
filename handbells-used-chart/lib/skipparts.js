/*
 * Drops the records belonging to parts the user asked to leave out.
 *
 * A score often carries more than the handbell part. Every plain notehead in a
 * piano reduction or a vocal line reaches the chart as a handbell, so a piece
 * with a piano reduction charts the pianist's notes alongside the ringers'.
 *
 * The filter lives here rather than in either reader because both readers feed
 * it. read.js takes the name off staff.part.partName and extract-notes.js off
 * <trackName>, and the two agree on a given score, so one implementation over
 * the records keeps the two charts the same.
 */

function normalise(name) {
    return String(name === undefined || name === null ? "" : name)
        .trim().toLowerCase();
}

// The field split at its commas. A backslash keeps the character after it in
// the name, so a part called "Bells, Large" is written "Bells\, Large".
function split(text) {
    var names = [];
    var name = "";
    for (var i = 0; i < text.length; i++) {
        var c = text.charAt(i);
        if (c === "\\" && i + 1 < text.length) {
            name += text.charAt(++i);
        } else if (c === ",") {
            names.push(name);
            name = "";
        } else {
            name += c;
        }
    }
    names.push(name);
    return names;
}

// The field that names these parts, escaped so parse reads them back.
function format(names) {
    var escaped = [];
    for (var i = 0; i < names.length; i++) {
        escaped.push(String(names[i]).replace(/\\/g, "\\\\").replace(/,/g, "\\,"));
    }
    return escaped.join(", ");
}

// The names the option asks for, in the spelling the user typed, with the
// blanks a trailing comma leaves behind taken out. An empty entry kept as a
// name would match every part MuseScore left unnamed and quietly empty the
// chart.
function parse(value) {
    var wanted = [];
    var seen = {};
    var raw = split(String(value === undefined || value === null ? "" : value));
    for (var i = 0; i < raw.length; i++) {
        var key = normalise(raw[i]);
        if (key === "" || seen[key]) continue;
        seen[key] = true;
        wanted.push({ key: key, given: raw[i].trim() });
    }
    return wanted;
}

function applySkipList(records, value) {
    var wanted = parse(value);
    if (!wanted.length) return { records: records, unmatched: [] };

    var drop = {};
    for (var i = 0; i < wanted.length; i++) drop[wanted[i].key] = false;

    var kept = [];
    for (var j = 0; j < records.length; j++) {
        var key = normalise(records[j].partName);
        if (drop[key] === undefined) {
            kept.push(records[j]);
        } else {
            drop[key] = true;
        }
    }

    // Reported in the spelling the user typed, not the normalised one, so the
    // message names the field they have to go and fix.
    var unmatched = [];
    for (var k = 0; k < wanted.length; k++) {
        if (!drop[wanted[k].key]) unmatched.push(wanted[k].given);
    }
    return { records: kept, unmatched: unmatched };
}

module.exports = { applySkipList: applySkipList, parse: parse, format: format, normalise: normalise };
