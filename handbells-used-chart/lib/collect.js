/*
 * Groups raw note records into the distinct bells and chimes a score uses.
 *
 * Every spelling that actually occurs is kept. If a score only ever writes
 * Ab5, the chart shows only Ab5; if it writes both G#5 and Ab5, both appear.
 * This is not cosmetic: ringers read the chart to work out position splits,
 * and a bell shown under one spelling tells the neighbouring position it does
 * not have to share that bell.
 */

var bellname = require("./bellname.js");

// A tpc outside this range decodes to no letter at all, and the bell reaches
// the chart named "Bundefined4".
//
// The check lives here, in the shared layer, because this is the only place
// both front ends pass through. tools/extract-notes.js has its own stage that
// drops these while parsing XML, where an absent <tpc> element is the likelier
// cause and the count belongs in the CLI's own "no readable pitch" warning;
// read.js has no such stage at all — it takes MuseScore's numbers straight off
// the note and, until this, handed them on unchecked. Guarding one front end
// and not the other is exactly the divergence lib/ exists to prevent.
function readable(record) {
    return typeof record.pitch === "number" && typeof record.tpc === "number"
        && isFinite(record.pitch) && isFinite(record.tpc)
        && record.tpc >= -1 && record.tpc <= 33;
}

function collect(records) {
    var buckets = { bells: {}, chimes: {} };
    var unknown = 0;
    var unreadable = 0;
    var outOfRange = [];
    var seenOutOfRange = {};

    for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (!readable(record)) {
            unreadable++;
            continue;
        }
        var kind = record.head === "normal" ? "bells"
                 : record.head === "diamond" ? "chimes"
                 : null;
        if (kind === null) {
            unknown++;
            continue;
        }

        var bell = bellname.bellName(record.pitch, record.tpc);
        bell.region = bellname.regionOf(bell);
        if (bell.region === null) {
            if (!seenOutOfRange[bell.name]) {
                seenOutOfRange[bell.name] = true;
                outOfRange.push(bell.name);
            }
            continue;
        }

        var key = record.pitch + ":" + record.tpc;
        if (!buckets[kind][key]) {
            bell.count = 0;
            buckets[kind][key] = bell;
        }
        buckets[kind][key].count++;
    }

    return {
        bells: sorted(buckets.bells),
        chimes: sorted(buckets.chimes),
        unknown: unknown,
        unreadable: unreadable,
        outOfRange: outOfRange
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
