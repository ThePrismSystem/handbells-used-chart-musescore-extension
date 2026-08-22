# Handbells Used Chart

Handbell music usually opens with a chart between the title and the first
system: a grand staff showing every bell and chime the piece needs. This
generates that chart for MuseScore 4.7 scores.

Bells appear in pitch order, spelled the way the score spells them. If the score
writes the same bell as both G#5 and Ab5, it appears under both spellings. That
is on purpose. Ringers use the chart to work out position splits, and the
spelling tells the next position over whether it has to share a bell.
Handchimes get a chart of their own, with diamond noteheads.

## Two ways to run it

Both front ends load the same planning core, so either one produces the same
chart from the same score. Where they differ is what they need and what they
can do:

| | Command-line tool | MuseScore extension |
|---|---|---|
| Needs MuseScore installed | no, it edits the `.mscz` directly | yes, 4.7 |
| Where you run it | a terminal, a script, CI | inside MuseScore, from the Plugins menu |
| Input | `.mscz` file in, `.mscz` file out | the score you have open |
| Hides the piece's own empty staves | only if you ask (`--hide-empty-staves`) | always; the API offers nothing narrower |
| Removes a chart | `--remove` | re-running replaces it, but there is no remove command |

Neither can replace the other's chart. See [Known limitations](#known-limitations).

## Requirements

Node 22 or newer, with no runtime dependencies. The extension also needs
MuseScore Studio 4.7.

## Command-line tool

    npm run chart -- input.mscz output.mscz

Both paths are required and both are `.mscz` archives. The input is never
modified in place.

| Option | Effect |
|---|---|
| `--bell-label TEXT` | replaces the generated "Handbells Used: *n*" |
| `--chime-label TEXT` | replaces the generated "Handchimes Used: *n*" |
| `--chime-color HEX` | notehead colour for chimes, e.g. `#c00000`. Defaults to the score's own `handchimesColor` property |
| `--hide-empty-staves` | also let the piece's own staves hide, so they do not sit blank beneath the chart |
| `--remove` | strip an existing chart instead of generating one |

Run it on a score that already has one of its charts and it replaces that chart
rather than adding a second, so you can regenerate after the music changes.
`--remove` also puts back the hide-empty-staves setting the score had before the
chart went in.

It prints the labels it drew. Anything left off the chart gets a warning: notes
with an unreadable pitch or spelling, notes whose notehead it did not recognise,
and bells outside C2-C9.

## MuseScore extension

Requires MuseScore Studio 4.7.

Copy the `handbells-used-chart` folder into MuseScore's extensions directory:

| Platform | Directory |
|---|---|
| macOS | `~/Library/Application Support/MuseScore/MuseScore4/extensions/` |
| Linux | `~/.local/share/MuseScore/MuseScore4/extensions/` |
| Windows | `%LOCALAPPDATA%\MuseScore\MuseScore4\extensions\` |

This is not the same place as the older Plugins folder.

Restart MuseScore, open a score, and choose Handbells Used Chart from the
Plugins menu. Running it again replaces the chart it made last time, without
asking for confirmation.

It refuses to touch a chart it cannot recognise as its own, and tells you why
instead. That covers adding, removing or moving instruments after a run,
inserting a measure ahead of the chart, and editing any of the fields below that
it uses to identify its work. The remedy is always the same: delete the chart by
hand in MuseScore, then run it again.

### Settings

Set these in Project Properties, as custom fields:

| Field | Effect |
|---|---|
| `handbellChartBellLabel` | replaces the generated "Handbells Used: *n*" |
| `handbellChartChimeLabel` | replaces the generated "Handchimes Used: *n*" |
| `handchimesColor` | notehead colour for chimes, e.g. `#c00000` |
| `handbellChartQuiet` | set to `yes` to report to the log instead of showing dialogs |

Set `handbellChartQuiet` on any score you process with `mscore -j`. A dialog in
a batch run has nobody to dismiss it and blocks until the process is killed.
Worse, MuseScore saves at the end of a job, so the output file never gets
written at all.

The plugin writes fields of its own back to Project Properties. You do not need
to set or keep them, but you will see them:

| Field | Meaning |
|---|---|
| `handbellChartReport` | what the last run drew, or that it removed a chart |
| `handbellChartError` | why the last run refused; empty when it succeeded |
| `handbellChartParts`, `handbellChartTotal`, `handbellChartColumns` | how the plugin recognises its own chart so it can replace it. Edit these and the chart becomes unidentifiable, so the plugin will refuse to touch it |
| `handbellChartStyle_*` | the style settings the chart changed, so removing it can put them back |

With `handbellChartQuiet` set it also writes `handbellChartRan` and
`handbellChartFound`, which record what the run read. Those two exist so the
automated tests can observe a headless run.

## Known limitations

- Bells above C7 are drawn in MuseScore's out-of-range colour on screen. A
  plugin cannot set an instrument's pitch range. Print is unaffected.
- Ledger lines run continuously from the staff to each stacked bell. Published
  charts use detached ledger lines, which MuseScore cannot draw.

Extension only:

- Adding a chart turns on the score-wide hide empty staves style. It is the only
  mechanism the plugin API offers for keeping the handchime staves from sitting
  blank under the handbell chart, because `hideWhenEmpty` is not a property a
  plugin can set on a staff. One consequence reaches the rest of your music while
  the chart is there: any staff that rests for a whole system now hides there
  too. Removing the chart puts the setting back to whatever it was before.
- The chart's instrument name appears at the left of the chart system.
  `part.longName` and `part.partName` are read-only from a plugin.

Both:

- The plugin and the command-line tool cannot replace each other's charts. Each
  identifies its own work in a way the other can neither write nor read: the
  tool names its parts, which a plugin cannot do, and the plugin records counts
  the tool never looks for. On a score carrying a chart the tool made, the
  plugin refuses to run, so strip it first with
  `npm run chart -- in.mscz out.mscz --remove`. The tool does not recognise a
  chart the plugin made and will add a second one beside it, so delete the
  plugin's chart in MuseScore before running it.

## Layout

    handbells-used-chart/lib/    planning core: note records in, chart plan out
    handbells-used-chart/        the MuseScore extension
    tools/                       the command-line tool
    test/unit/                   pure JavaScript, runs anywhere
    test/e2e/                    the command-line tool, end to end
    test/extension/              drives a real MuseScore headlessly
    test/fixtures/               synthetic .mscx scores authored for this project

`lib/` is the shared contract. Both front ends load it, so a change there lands
in both, and the two should produce the same chart from the same score.

## Testing

    npm test

| Command | Runs |
|---|---|
| `npm test` | everything |
| `npm run test:fast` | unit and end-to-end tests, no MuseScore needed |
| `npm run test:extension` | the tests that drive a real MuseScore |

The extension tests copy the extension into your MuseScore 4.7 data directory
and enable it there before running. Your own plugin registrations survive, but
the extension itself stays installed afterwards.

They skip if MuseScore is not on the path. If it is on the path but broken, they
fail rather than skip, because a silent skip once took the whole extension suite
out of a run that still reported green.

They also run one file at a time. Several MuseScore instances at once under
`xvfb` intermittently abort before writing their output.

## License

GPL-3.0-only. The note-reading logic is adapted from the
[handbell-notation](https://github.com/andylyttle/handbell-notation) plugins,
copyright 2025 Andy Lyttle, used under the GPL-3.0.
