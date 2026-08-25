/*
 * How far a source part's stored pitches sit below the bells they name.
 *
 * A bell's name is its written pitch plus one octave. MuseScore stores the
 * sounding pitch, which is the written pitch plus the part's transposition, so
 * the correction is one subtraction. Every case falls out of it. A part
 * transposing up an octave stores each bell at its own name and needs nothing
 * added. A part that does not transpose stores every note an octave below its
 * bell name. A glockenspiel, two octaves up, needs an octave taken off.
 *
 * This used to be guessed from the instrument id: hand-bells and hand-chimes
 * got nothing added, everything else got an octave. MuseScore 4's templates
 * make that a good correlation but not a rule, and both ways of breaking it
 * turn up in real scores. Transposing a Piano part up an octave is how a
 * piano-part handbell score is made to play back at bell pitch, and it charted
 * an octave high. So did bells written on a celesta or a xylophone.
 * MuseScore's MusicXML importer keeps the handbell instrument id and its 8va
 * clefs but drops the transposition, so handbell scores arriving from Finale
 * or Sibelius charted an octave low.
 *
 * An ottava does not fall out of it, because an ottava is not a property of
 * the part at all. It applies to a stretch of one staff, and MuseScore keeps
 * it out of a note's own pitch, so each front end adds it before the record
 * gets here. The extension takes it from staff.pitchOffset; the command-line
 * tool takes it from tools/ottava.js, which resolves the span out of the XML.
 * A pitch arriving here is already at the octave the bell sounds at, and what
 * follows is only the part-wide correction on top.
 *
 * It lives in lib/ because both readers need the identical answer. Guarding
 * one front end and not the other is the divergence lib/ exists to prevent.
 * They reach the number by different routes, the extension from
 * Staff.transpose and the command-line tool from <transposeChromatic> in the
 * XML, but it is the same number and this is the one place it is applied.
 */

var OCTAVE = 12;

// Anything that is not a number reads as no transposition. MuseScore writes no
// <transposeChromatic> for a part that does not transpose, so an absent one is
// the ordinary case and not a fault. Left to arithmetic it would make the
// offset NaN, which reaches lib/collect.js as an unreadable record and drops
// the bell from the chart silently.
function offsetForTransposition(chromatic) {
    var semitones = Number(chromatic);
    return OCTAVE - (isFinite(semitones) ? semitones : 0);
}

module.exports = { offsetForTransposition: offsetForTransposition };
