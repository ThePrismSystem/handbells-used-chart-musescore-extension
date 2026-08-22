/*
 * Handbells Used Chart — MuseScore extension entry point.
 *
 * The planning is done by lib/, which is shared verbatim with the
 * command-line tool. This file only reads the score, asks lib/ what to draw,
 * and hands the answer to mutate.js.
 */

function main() {
    var score = api.engraving.curScore;
    api.log.info("Handbells Used Chart: " + score.nmeasures + " measures");
}
