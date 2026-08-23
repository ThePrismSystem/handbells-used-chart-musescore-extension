/*
 * How far a source part's stored pitches sit below the bells they name.
 *
 * A bell's name is its written pitch plus one octave; MuseScore stores the
 * sounding pitch. MuseScore 4's hand-bells and hand-chimes instruments
 * transpose up an octave, so their stored pitch is already the bell's name.
 * Nothing else does, so a score written on a Piano part — which is how
 * handbell music was written before MuseScore had the instrument, and how many
 * arrangers still write it — stores every note an octave below its bell name.
 *
 * This is a guess from the instrument id, the same guess the reference
 * get-handbells-used.qml makes. It is wrong for a part the user made
 * transposing by hand, and there is no property that would settle it: a Part
 * exposes instrumentId and nothing about its transposition.
 *
 * It lives in lib/ because both readers need the identical answer. Guarding
 * one front end and not the other is exactly the divergence lib/ exists to
 * prevent.
 */

var TRANSPOSING = { "hand-bells": true, "hand-chimes": true };

var OCTAVE = 12;

function offsetFor(instrumentId) {
    return TRANSPOSING[instrumentId] ? 0 : OCTAVE;
}

module.exports = { offsetFor: offsetFor, OCTAVE: OCTAVE };
