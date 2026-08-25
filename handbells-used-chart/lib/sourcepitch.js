/*
 * How far a source part's stored pitches sit below the bells they name.
 *
 * A bell's name is its written pitch plus one octave; MuseScore stores the
 * sounding pitch, which is the written pitch plus the part's transposition. So
 * the correction is one subtraction, and every case falls out of it: a part
 * transposing up an octave stores each bell at its own name and needs nothing
 * added, a part that does not transpose stores every note an octave below its
 * bell name, and a glockenspiel at two octaves up needs an octave taken off.
 *
 * This used to be guessed from the instrument id — hand-bells and hand-chimes
 * got nothing added, everything else got an octave. MuseScore 4's templates
 * make that a good correlation and not a rule, and both ways of breaking it
 * turn up in real scores. A Piano part the arranger transposed up an octave by
 * hand, which is how a piano-part handbell score is made to play back at bell
 * pitch, charted an octave high; so did bells written on a celesta, a
 * xylophone or a piccolo, and glockenspiel bells charted two octaves high.
 * MuseScore's MusicXML importer keeps the handbell instrument id and its 8va
 * clefs while dropping the transposition, so handbell scores arriving from
 * Finale or Sibelius charted an octave low.
 *
 * What does not fall out of it is an ottava, because an ottava is not a
 * property of the part: it applies to a stretch of one staff. MuseScore keeps
 * it out of a note's own pitch, so each front end adds it separately before
 * the record reaches lib/ — the extension from staff.pitchOffset, the
 * command-line tool from tools/ottava.js, which resolves the spanner's span
 * out of the XML. By the time a pitch arrives here it is the octave the bell
 * sounds at, and this is only the part-wide correction on top.
 *
 * It lives in lib/ because both readers need the identical answer. Guarding
 * one front end and not the other is exactly the divergence lib/ exists to
 * prevent. They reach the number by different routes — the extension asks
 * Staff.transpose, the command-line tool reads <transposeChromatic> out of the
 * XML — but it is the same number, and this is the one place it is applied.
 */

var OCTAVE = 12;

// Anything that is not a number reads as no transposition. MuseScore writes no
// <transposeChromatic> for a part that does not transpose, so an absent one is
// the ordinary case and not a fault — and left to arithmetic it would make the
// offset NaN, which reaches lib/collect.js as an unreadable record and drops
// the bell from the chart silently.
function offsetForTransposition(chromatic) {
    var semitones = Number(chromatic);
    return OCTAVE - (isFinite(semitones) ? semitones : 0);
}

module.exports = { offsetForTransposition: offsetForTransposition };
