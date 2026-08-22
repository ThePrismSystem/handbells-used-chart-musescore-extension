# Handbells Used Chart

Generates a "Handbells Used" / "Handchimes Used" chart for MuseScore 4.7
handbell scores — the grand-staff block of noteheads publishers print between
the title and the first system, listing every bell and chime the piece requires.

## Status

Under development. The command-line tool comes first; the MuseScore plugin
follows.

## Usage

    npm run chart -- input.mscz output.mscz

## The MuseScore extension

Requires MuseScore Studio 4.7.

Copy the `handbells-used-chart` folder into MuseScore's extensions directory:

| Platform | Directory |
|---|---|
| macOS | `~/Library/Application Support/MuseScore/MuseScore4/extensions/` |
| Linux | `~/.local/share/MuseScore/MuseScore4/extensions/` |
| Windows | `%LOCALAPPDATA%\MuseScore\MuseScore4\extensions\` |

This is not the same place as the older Plugins folder.

Restart MuseScore, open a score, and choose **Handbells Used Chart** from the
Plugins menu. Running it again replaces the chart it made last time without asking
for confirmation, so a chart can be regenerated after the music changes.

If you add, remove, or move instruments after running the plugin, it refuses to replace
the chart and tells you instead. The plugin will not touch any instruments it did not create.

### Settings

Set these in **Project Properties**, as custom fields:

| Field | Effect |
|---|---|
| `handbellChartBellLabel` | replaces "Handbells Used: 58" |
| `handbellChartChimeLabel` | replaces "Handchimes Used: 31" |
| `handchimesColor` | notehead colour for chimes, e.g. `#c00000` |
| `handbellChartQuiet` | set to `yes` to report to the log instead of showing dialogs |

Set `handbellChartQuiet` on any score you process with `mscore -j`. A dialog in a
batch run has nobody to dismiss it, and blocks until the process is killed.

### Known limitations

- Bells above C7 are drawn in MuseScore's out-of-range colour on screen. An
  instrument's pitch range cannot be set from a plugin. It does not affect print.
- Adding a chart turns on the score-wide **hide empty staves** style, because
  that is the only mechanism the plugin API offers for keeping the handchime
  staves from sitting blank under the handbell chart — `hideWhenEmpty` is not a
  property a plugin can set on a staff. One consequence reaches the rest of your
  music: any staff that rests for a whole system will now hide there too. Turn it
  back off in Format > Style > Score if you would rather keep those staves.
- The chart's instrument name appears at the left of the chart system.
  `part.longName` and `part.partName` are read-only from a plugin.
- Ledger lines run continuously from the staff to each stacked bell. Published
  charts use detached ledger lines, which MuseScore cannot draw.

## Testing

    npm test

## License

GPL-3.0-only. The note-reading logic is adapted from the
[handbell-notation](https://github.com/andylyttle/handbell-notation) plugins,
copyright 2025 Andy Lyttle, used under the GPL-3.0.
