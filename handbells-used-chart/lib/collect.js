/*
 * Groups raw note records into the distinct bells and chimes a score uses.
 *
 * Every spelling that actually occurs is kept. If a score only ever writes
 * Ab5, the chart shows only Ab5; if it writes both G#5 and Ab5, both appear.
 * This is not cosmetic: ringers read the chart to work out position splits,
 * and a bell shown under one spelling tells the neighbouring position it does
 * not have to share that bell.
 *
 * Three kinds, told apart by notehead alone: a plain head is a handbell, a
 * diamond a handchime, and the filled square MuseScore calls the shape-note
 * head "La" a silver melody bell. The notehead is the only evidence there is,
 * since all three are commonly written on one part.
 */

var bellname = require("./bellname.js");

// A tpc outside this range decodes to no letter at all, and the bell reaches
// the chart named "Bundefined4".
//
// The check lives here, in the shared layer, because this is the only place
// both front ends pass through. tools/extract-notes.js has its own stage that
// drops these while parsing XML, where an absent <tpc> element is the likelier
// cause and the count belongs in the CLI's own "no readable pitch" warning;
// read.js has no such stage at all. It takes MuseScore's numbers straight off
// the note and, until this, handed them on unchecked. Guarding one front end
// and not the other is exactly the divergence lib/ exists to prevent.
function readable(record) {
    return typeof record.pitch === "number" && typeof record.tpc === "number"
        && isFinite(record.pitch) && isFinite(record.tpc)
        && record.tpc >= -1 && record.tpc <= 33;
}

// What each notehead a reader can report turns into. The rows a kind can
// occupy come with it, because the kinds do not share a compass: handbells and
// handchimes are made from C2 to C9, silver melody bells only from C5 to C7.
// So B4 is an ordinary handbell and a silver melody bell that does not exist,
// and the two cannot be reported through one out-of-range list.
var KINDS = [
    { head: "normal", bucket: "bells", outOfRange: "outOfRange" },
    { head: "diamond", bucket: "chimes", outOfRange: "outOfRange" },
    // Every silver melody bell goes on the treble staff, so it needs no region
    // table: the compass is the whole of the check, and what passes it is
    // always in the same place. Two octaves written an octave down under the
    // chart's 8va clef sit a ledger line below the staff to two above.
    { head: "la", bucket: "smbs", region: "trebleStaff",
      compass: bellname.SMB_COMPASS, outOfRange: "smbOutOfRange" }
];

function kindOf(head) {
    for (var i = 0; i < KINDS.length; i++) {
        if (KINDS[i].head === head) return KINDS[i];
    }
    return null;
}

// Which row of the chart the bell belongs on, or null for a pitch this kind is
// not made in.
function regionFor(kind, bell) {
    if (!kind.compass) return bellname.regionOf(bell);
    if (bell.pitch < kind.compass.min || bell.pitch > kind.compass.max) return null;
    return kind.region;
}

function collect(records) {
    var buckets = { bells: {}, chimes: {}, smbs: {} };
    var unknown = 0;
    var unreadable = 0;
    var named = { outOfRange: [], smbOutOfRange: [] };
    var seen = { outOfRange: {}, smbOutOfRange: {} };

    for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (!readable(record)) {
            unreadable++;
            continue;
        }
        var kind = kindOf(record.head);
        if (kind === null) {
            unknown++;
            continue;
        }

        var bell = bellname.bellName(record.pitch, record.tpc);
        bell.region = regionFor(kind, bell);
        if (bell.region === null) {
            if (!seen[kind.outOfRange][bell.name]) {
                seen[kind.outOfRange][bell.name] = true;
                named[kind.outOfRange].push(bell.name);
            }
            continue;
        }

        var key = record.pitch + ":" + record.tpc;
        if (!buckets[kind.bucket][key]) {
            bell.count = 0;
            buckets[kind.bucket][key] = bell;
        }
        buckets[kind.bucket][key].count++;
    }

    return {
        bells: sorted(buckets.bells),
        chimes: sorted(buckets.chimes),
        smbs: sorted(buckets.smbs),
        unknown: unknown,
        unreadable: unreadable,
        outOfRange: named.outOfRange,
        smbOutOfRange: named.smbOutOfRange
    };
}

function sorted(bucket) {
    var list = [];
    for (var key in bucket) {
        if (bucket.hasOwnProperty(key)) list.push(bucket[key]);
    }
    // Ascending by pitch, then double-sharp through double-flat, matching the
    // order published charts print enharmonic pairs in.
    list.sort(function (a, b) {
        return (a.pitch - b.pitch) || (b.alter - a.alter);
    });
    return list;
}

module.exports = { collect: collect };
