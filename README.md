# Handbells Used Chart

Generates a "Handbells Used" / "Handchimes Used" chart for MuseScore 4.7
handbell scores — the grand-staff block of noteheads publishers print between
the title and the first system, listing every bell and chime the piece requires.

## Status

Both front ends work. The command-line tool edits the score file directly; the
MuseScore extension does the same job from inside MuseScore, through the
plugin API. They share the code that decides what the chart contains, but not
the chart itself — see the limitations below.

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
Plugins menu. Running it again replaces the chart it made last time without
asking for confirmation, so a chart can be regenerated after the music changes.

If you add, remove or move instruments after running the plugin, or insert a
measure ahead of the chart, it refuses to replace the chart and tells you
instead. It will not delete an instrument or a measure it cannot identify as
its own.

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
- The plugin and the command-line tool cannot replace each other's charts. Each
  identifies its own work in a way the other cannot write or read: the tool
  names its parts, which a plugin cannot do, and the plugin records counts the
  tool does not look for. The plugin refuses to run on a score carrying a chart
  the tool made — strip it with `npm run chart -- in.mscz out.mscz --remove`
  first. The tool does not recognise a chart the plugin made and will add a
  second one beside it, so delete the plugin's chart in MuseScore before
  running it.

## Testing

    npm test

The extension tests drive a real MuseScore, so they copy the extension into
your MuseScore 4.7 data directory and enable it there before running. Your own
plugin registrations are left alone, but the extension itself stays installed
afterwards. They skip if MuseScore is not on the path.

## License

GPL-3.0-only. The note-reading logic is adapted from the
[handbell-notation](https://github.com/andylyttle/handbell-notation) plugins,
copyright 2025 Andy Lyttle, used under the GPL-3.0.
