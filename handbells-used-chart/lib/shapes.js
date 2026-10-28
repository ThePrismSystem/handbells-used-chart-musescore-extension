/*
 * The shapes a chart can be drawn in, and the MuseScore notehead behind each.
 *
 * "match" draws a chart in the notehead its kind is read from, so the default
 * charts look exactly as they did before shapes existed, and so does a chart
 * with no shape set at all. The other shapes name one notehead whatever the
 * music uses.
 */

var SHAPES = ["match", "round", "diamond", "square", "triangle",
              "inverted-triangle", "half-circle", "cone"];

var HEADS = {
    round: "normal",
    diamond: "diamond",
    square: "la",
    triangle: "do",
    "inverted-triangle": "triangle-down",
    "half-circle": "re",
    cone: "ti"
};

function chartHead(shape, musicHead) {
    return !shape || shape === "match" ? musicHead : HEADS[shape];
}

module.exports = { SHAPES: SHAPES, chartHead: chartHead };
