# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional-range brackets in both front ends. Mark the first and last required
  bell, and separately the first and last required chime; anything outside the
  range prints with a bracket and the italic word "optional" beneath it, the
  way published charts mark it. Command-line flags `--required-bell-first`,
  `--required-bell-last`, `--required-chime-first`, `--required-chime-last`;
  extension fields `handbellChartRequiredBellFirst`,
  `handbellChartRequiredBellLast`, `handbellChartRequiredChimeFirst`,
  `handbellChartRequiredChimeLast`. Leave a setting unset and nothing about the
  chart changes.

### Fixed

- A score written on a Piano part now charts an octave higher than the
  previous version drew it, matching the bells it looks like it has instead of
  the octave below.
- The extension no longer charts a note whose notehead it does not recognise
  as though it were a handbell. It counts the note as unreadable and warns,
  which is what the command-line tool already did — until now the same score
  could produce two different charts depending on which one drew it.

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

[Unreleased]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ThePrismSystem/handbells-used-chart-musescore-extension/releases/tag/v1.0.0
