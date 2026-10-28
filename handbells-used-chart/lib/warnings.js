/*
 * The plan's warnings as lines of text, worded the same by both front ends.
 */

// One branch per warning type, rather than a two-way test that treats anything
// unrecognised as the out-of-range case: that shape reads warning.names on a
// warning that does not carry any, and a type added later would take the whole
// run down inside the code meant to explain a problem.
function linesOf(plan) {
    var lines = [];
    for (var i = 0; i < plan.warnings.length; i++) {
        var warning = plan.warnings[i];
        if (warning.type === "unknown-notehead") {
            lines.push(warning.count + " note(s) with an unrecognised notehead were skipped: "
                + warning.names.join(", "));
        } else if (warning.type === "unreadable-pitch") {
            lines.push(warning.count + " note(s) with an unreadable pitch were skipped");
        } else if (warning.type === "out-of-range") {
            lines.push("Bells outside C2-C9 were skipped: " + warning.names.join(", "));
        } else if (warning.type === "smb-out-of-range") {
            lines.push("Silver melody bells outside C5-C7 were skipped: "
                + warning.names.join(", "));
        } else if (warning.type === "skipped-part-not-found") {
            lines.push("No part is named: " + warning.names.join(", "));
        } else if (warning.type === "empty-instrument") {
            lines.push("These instruments have nothing to chart: " + warning.names.join(", "));
        }
    }
    return lines;
}

module.exports = { linesOf: linesOf };
