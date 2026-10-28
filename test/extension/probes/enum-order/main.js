/*
 * Test-only probe. The extension runs at apiversion 2, where Element values
 * read as names, so engraving.js carries MuseScore's numbers for the element
 * types the build creates. This probe runs at apiversion 1, which reads the
 * numbers directly, and compares each one the test passes in, as NAME=number
 * in the probeNames field, against the running MuseScore.
 */

function main() {
    var score = api.engraving.curScore;
    var pairs = score.metaTag("probeNames").split(",");
    var result = "ok";
    for (var i = 0; i < pairs.length; i++) {
        var name = pairs[i].split("=")[0];
        var expected = Number(pairs[i].split("=")[1]);
        if (api.engraving.Element[name] !== expected) {
            result = name + " is " + api.engraving.Element[name] + ", not " + expected;
            break;
        }
    }
    score.startCmd();
    score.setMetaTag("probeResult", result);
    score.setMetaTag("probeChecked", String(pairs.length));
    score.endCmd();
}
