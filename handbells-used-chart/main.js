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

    // handbellChartRan is a durable marker, not scaffolding: it records that
    // this file executed inside MuseScore, with a value a stub could not
    // invent. Later tasks rewrite this file but must keep writing it, since
    // the headless tests verify the extension actually ran by reading it back.
    score.startCmd();
    score.setMetaTag("handbellChartRan", String(score.nmeasures));
    score.endCmd();
}
