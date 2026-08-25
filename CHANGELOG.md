# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Charts came out an octave wrong on some scores. Which octave a score is
  charted at was guessed from the part's instrument id — the two handbell
  instruments were taken to transpose up an octave and everything else not to.
  It is now read from the part's own transposition, which is what that was
  standing in for.

  The guess was wrong both ways round. A part transposed up an octave by hand,
  which is how a Piano-part handbell score is made to play back at bell pitch,
  charted an octave high; so did bells written on a celesta, a xylophone or a
  piccolo, and glockenspiel bells charted two octaves high. Handbell scores
  imported from MusicXML charted an octave low, because MuseScore's importer
  keeps the handbell instrument id and drops the transposition. The
  command-line tool also charted an octave high on any file whose
  `<Instrument>` carries no `id` attribute, where the extension charted the
  same score correctly.

  An ottava is still not read: an 8va or 8vb line is a playback and reading
  instruction MuseScore leaves out of a note's pitch, so bells written under
  one are charted at the octave they are drawn.

## [1.2.0] - 2026-08-23

### Added

- Silver melody bells, charted alongside the handbells and the handchimes.
  Write them with a square notehead — MuseScore's palette calls the filled
  square **La** — and they get a chart of their own headed "SMBs Used: *n*",
  drawn with the same square heads. Which notehead a note carries is all that
  decides which chart it goes on, so all three kinds can be written on one
  part.

  A set is C5 to C7 and nothing else is made, so a square notehead outside that
  is reported and left off, the way a bell outside C2-C9 already was. The chart
  is a single treble staff rather than a grand staff, unbraced and taking a
  staff's worth of height rather than a grand staff's: two octaves fit on one
  under its 8va clef, and each bell keeps a column of its own instead of
  stacking an octave into its neighbour's the way a five-octave handbell set
  has to.

  Set the notehead colour with `handbellChartSmbColor` (or `--smb-color`), the
  wording with `handbellChartSmbLabel` (or `--smb-label`), and mark the whole
  set optional with `handbellChartSmbsOptional` (or `--smbs-optional`), which
  adds "(optional)" to the label rather than bracketing columns — a set is
  normally optional as a whole rather than bell by bell.

## [1.1.0] - 2026-08-23

### Added

- Optional-range brackets in both front ends. Mark the first and last required
  bell, and separately the first and last required chime; anything outside the
  range prints with a bracket and the italic word "optional" beside it, the
  way published charts mark it. Command-line flags `--required-bell-first`,
  `--required-bell-last`, `--required-chime-first`, `--required-chime-last`;
  extension fields `handbellChartRequiredBellFirst`,
  `handbellChartRequiredBellLast`, `handbellChartRequiredChimeFirst`,
  `handbellChartRequiredChimeLast`. Leave a setting unset and nothing about the
  chart changes. A name that cannot be read is refused before the score is
  touched, naming the value and saying whether it was a bell or a chime, so a
  mistyped name never costs you the chart you already had.

### Fixed

- An optional-range bracket over a single bell now goes round that bell. The
  extension drew it beside the bell instead, a little to its left, touching
  neither end of it. The command-line tool already placed it correctly, except
  where the bell is the first column of the chart: there MuseScore draws no
  line at all and the word alone marks the bell optional.
- A clef set by hand on one of the piece's own staves no longer reverts to the
  instrument's default when the extension is run a second time. Adding the
  chart moved the clef into the chart's own measure, and the next run deleted
  that measure and the clef with it, so a bass staff quietly became a treble
  one. The command-line tool was never affected.
- Optional-range brackets now enclose the bells they cover. They were anchored
  notehead to notehead, so the right-hand end stopped a whole notehead inside
  the last bell and the left-hand end sat hard against the first. Both ends now
  clear their bells by the same margin, in both front ends.
- A score written on a Piano part now charts the bells it looks like it has.
  The previous version drew them an octave below.
- The extension no longer charts a note whose notehead it does not recognise
  as though it were a handbell. It skips the note and warns about an
  unrecognised notehead, which is what the command-line tool already did —
  until now the same score could produce two different charts depending on
  which one drew it.

## [1.0.0] - 2026-08-22

First release.

### Added

- A MuseScore 4.7 extension that reads the open score and draws the chart above
  the first system: a grand staff for the bells, another for the chimes.
- A command-line tool that does the same job to a `.mscz` file on a machine with
  no MuseScore on it: `npm run chart -- in.mscz out.mscz`. Both front ends load
  the same planning core, so they produce the same chart from the same score.
- Bells in pitch order, spelled the way the score spells them. A bell written as
  both G#5 and Ab5 appears under both spellings, because ringers read the chart
  to work out position splits.
- Handchimes on a chart of their own, with diamond noteheads and a colour taken
  from the score's `handchimesColor` field.
- Stacked columns. A bell an octave or two above its counterpart shares that
  bell's column rather than taking one of its own.
- Naturals are never drawn. A plain E four columns along from an E flat would
  otherwise pick up a natural sign and read as a second, separate bell.
- Replacement instead of duplication when the score already carries a chart, and
  `--remove` on the command-line tool. Removing a chart also hands back the
  hide-empty-staves setting the score had before it.
- A refusal that says why, when a chart can no longer be identified. Neither
  front end will guess which instruments and measures are its own work.
- Labels, chime colour and quiet mode, set through custom fields in Project
  Properties or through command-line options.

[Unreleased]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/releases/tag/v1.0.0
