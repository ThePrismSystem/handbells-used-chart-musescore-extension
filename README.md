# Handbells Used Chart

Generates a "Handbells Used" / "Handchimes Used" chart for MuseScore 4.7
handbell scores — the grand-staff block of noteheads publishers print between
the title and the first system, listing every bell and chime the piece requires.

Bells are listed in pitch order, spelled the way the score spells them — and a
bell the score writes both ways, as G#5 and as Ab5, is listed under both. That
is deliberate, not a duplicate: ringers read the chart to work out position
splits, and a spelling tells the neighbouring position it does not have to share
that bell. Handchimes are drawn as diamond noteheads in a chart of their own.

## Two ways to run it

The same chart, from two front ends over one shared planning core. Pick whichever
suits where you work:

| | Command-line tool | MuseScore extension |
|---|---|---|
| Needs MuseScore installed | no — it edits the `.mscz` directly | yes, 4.7 |
| Where you run it | a terminal, a script, CI | inside MuseScore, from the Plugins menu |
| Input | `.mscz` file in, `.mscz` file out | the score you have open |
| Hides the piece's own empty staves | only if you ask (`--hide-empty-staves`) | always — the API offers no narrower option |
| Removes a chart | `--remove` | re-running replaces it; there is no remove command |

They cannot replace each other's charts — see [Known limitations](#known-limitations).

## Requirements

Node 22 or newer. No runtime dependencies. MuseScore Studio 4.7 as well, if you
want the extension.

## Command-line tool

    npm run chart -- input.mscz output.mscz

Input and output are both `.mscz` archives, and both are required. The input is
never modified in place.

| Option | Effect |
|---|---|
| `--bell-label TEXT` | replaces the generated "Handbells Used: *n*" |
| `--chime-label TEXT` | replaces the generated "Handchimes Used: *n*" |
| `--chime-color HEX` | notehead colour for chimes, e.g. `#c00000`. Defaults to the score's own `handchimesColor` property |
| `--hide-empty-staves` | also let the piece's own staves hide, so they do not sit blank beneath the chart |
| `--remove` | strip an existing chart instead of generating one |

Running it on a score that already has one of its charts replaces that chart
rather than adding a second, so a chart can be regenerated after the music
changes. `--remove` puts back the hide-empty-staves setting the score had before
the chart was added.

It prints the labels it drew, and warns about anything it left off the chart —
notes with an unreadable pitch or spelling, an unrecognised notehead, or bells
outside C2–C9.

## MuseScore extension

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
asking for confirmation.

If you add, remove or move instruments after running the plugin, or insert a
measure ahead of the chart, or change one of the fields it uses to recognise its
own work, it refuses to replace the chart and tells you why. It will not delete
an instrument or a measure it cannot identify as its own — the remedy is always
to delete the chart by hand in MuseScore and run it again.

### Settings

Set these in **Project Properties**, as custom fields:

| Field | Effect |
|---|---|
| `handbellChartBellLabel` | replaces the generated "Handbells Used: *n*" |
| `handbellChartChimeLabel` | replaces the generated "Handchimes Used: *n*" |
| `handchimesColor` | notehead colour for chimes, e.g. `#c00000` |
| `handbellChartQuiet` | set to `yes` to report to the log instead of showing dialogs |

Set `handbellChartQuiet` on any score you process with `mscore -j`. A dialog in a
batch run has nobody to dismiss it, and blocks until the process is killed —
and because MuseScore saves at the end of a job, the output file is never
written at all.

The plugin writes some fields of its own back to Project Properties. You do not
need to set or keep them, but you will see them:

| Field | Meaning |
|---|---|
| `handbellChartReport` | what the last run drew, or that it removed a chart |
| `handbellChartError` | why the last run refused; empty when it succeeded |
| `handbellChartParts`, `handbellChartTotal`, `handbellChartColumns` | how the plugin recognises its own chart so it can replace it. Editing them makes the chart unidentifiable, and the plugin will refuse to touch it |
| `handbellChartStyle_*` | the style settings the chart changed, so removing it can put them back |

With `handbellChartQuiet` set, it also writes `handbellChartRan` and
`handbellChartFound`, which record what the run read. They exist so the
automated tests can observe a headless run.

## Known limitations

- Bells above C7 are drawn in MuseScore's out-of-range colour on screen. An
  instrument's pitch range cannot be set from a plugin. It does not affect print.
- Ledger lines run continuously from the staff to each stacked bell. Published
  charts use detached ledger lines, which MuseScore cannot draw.

Extension only:

- Adding a chart turns on the score-wide **hide empty staves** style, because
  that is the only mechanism the plugin API offers for keeping the handchime
  staves from sitting blank under the handbell chart — `hideWhenEmpty` is not a
  property a plugin can set on a staff. One consequence reaches the rest of your
  music while the chart is there: any staff that rests for a whole system will
  now hide there too. Removing the chart puts the setting back to whatever it
  was before, so it does not outlive the chart that needed it.
- The chart's instrument name appears at the left of the chart system.
  `part.longName` and `part.partName` are read-only from a plugin.

Both:

- The plugin and the command-line tool cannot replace each other's charts. Each
  identifies its own work in a way the other cannot write or read: the tool
  names its parts, which a plugin cannot do, and the plugin records counts the
  tool does not look for. The plugin refuses to run on a score carrying a chart
  the tool made — strip it with `npm run chart -- in.mscz out.mscz --remove`
  first. The tool does not recognise a chart the plugin made and will add a
  second one beside it, so delete the plugin's chart in MuseScore before
  running it.

## Layout

    handbells-used-chart/lib/    planning core: note records in, chart plan out
    handbells-used-chart/        the MuseScore extension
    tools/                       the command-line tool
    test/unit/                   pure JavaScript, runs anywhere
    test/e2e/                    the command-line tool, end to end
    test/extension/              drives a real MuseScore headlessly
    test/fixtures/               synthetic .mscx scores authored for this project

`lib/` is the shared contract. Both front ends load it, so a change there lands
in both, and the two are expected to produce the same chart from the same score.

## Testing

    npm test

| Command | Runs |
|---|---|
| `npm test` | everything |
| `npm run test:fast` | unit and end-to-end tests; no MuseScore needed |
| `npm run test:extension` | the tests that drive a real MuseScore |

The extension tests copy the extension into your MuseScore 4.7 data directory
and enable it there before running. Your own plugin registrations are left
alone, but the extension itself stays installed afterwards. They skip if
MuseScore is not on the path — but not if it is there and broken, which is
reported rather than skipped over.

They run one file at a time, because several MuseScore instances at once under
`xvfb` intermittently abort before writing their output.

## License

GPL-3.0-only. The note-reading logic is adapted from the
[handbell-notation](https://github.com/andylyttle/handbell-notation) plugins,
copyright 2025 Andy Lyttle, used under the GPL-3.0.
