#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { readMscz, writeMscz, replaceMain } = require("./mscz.js");
const { extractNotes, readMetaTag } = require("./extract-notes.js");
const { buildPlan, readHeads } = require("../handbells-used-chart/lib/plan.js");
const { SETTINGS, readOptions, validateOptions } = require("../handbells-used-chart/lib/options.js");
const { linesOf } = require("../handbells-used-chart/lib/warnings.js");
const { isColor } = require("../handbells-used-chart/lib/colors.js");
const { decode } = require("./xml.js");
const { META_STYLE } = require("./constants.js");
const {
  insertChart, removeChart,
  insertChartMeasures, removeChartMeasures, chartMeasureCount,
  readStyleFlags, writeStyleFlags,
} = require("./insert.js");

const USAGE = `Usage: chart-cli <input.mscz> <output.mscz> [options]

  --bell-label TEXT    label above the handbell chart
  --chime-label TEXT   label above the handchime chart
  --chime-color HEX    notehead color for handchimes, e.g. #c00000
                       (defaults to the score's handchimesColor property)
  --smb-label TEXT     label above the silver melody bell chart
  --smb-color HEX      notehead color for silver melody bells
                       (defaults to the score's handbellChartSmbColor property)
  --smbs-optional      mark the whole silver melody bell chart optional, which
                       adds "(optional)" to its label
  --skip-parts NAMES   comma-separated part names to leave out of the chart,
                       e.g. "Piano, Organ". Write a comma inside a name as \\,
  --shared-staff       put every chart on one staff, a measure each, instead of
                       a staff each
  --separate           chart each instrument on its own, with its name before
                       every label, when two or more are left to chart
  --combined           chart every instrument together (the default)
  --show-instrument-names
                       print the chart's instrument name beside its staff
  --hide-empty-staves  also let the piece's own staves hide, so they do not
                       appear as empty measures beneath the chart
  --remove             strip an existing chart instead of generating one
  --required-bell-first NAME   first bell that is NOT optional, e.g. C5
  --required-bell-last NAME    last bell that is NOT optional, e.g. C8
  --required-chime-first NAME  first chime that is NOT optional
  --required-chime-last NAME   last chime that is NOT optional
                       Bells outside the range are bracketed and labelled
                       "optional". Leave an end unset for no limit there.
  --bell-head NAME     the notehead handbells are written with (default normal)
  --chime-head NAME    the notehead handchimes are written with (default diamond)
  --smb-head NAME      the notehead silver melody bells are written with
                       (default la)
  --pf-head NAME       the notehead P&F handbells are written with (default none)
  --whitechapel-head NAME
                       the notehead Whitechapel handbells are written with
                       (default none). Every NAME is MuseScore's notehead name,
                       such as cross or triangle-up, or none.
  --pf-label TEXT      label above the P&F handbell chart
  --pf-color HEX       notehead colour for P&F handbells
  --whitechapel-label TEXT
                       label above the Whitechapel handbell chart
  --whitechapel-color HEX
                       notehead colour for Whitechapel handbells
  --bell-shape SHAPE   the shape the handbell chart is drawn in
  --chime-shape SHAPE  the shape the handchime chart is drawn in
  --smb-shape SHAPE    the shape the silver melody bell chart is drawn in
  --pf-shape SHAPE     the shape the P&F handbell chart is drawn in
  --whitechapel-shape SHAPE
                       the shape the Whitechapel handbell chart is drawn in.
                       Every SHAPE is match (the notehead the music uses, the
                       default), round, diamond, square, triangle,
                       inverted-triangle, half-circle or cone.

Every setting the score holds in Project Properties is read first, and a flag
takes over from its field. --no-smbs-optional, --no-shared-staff and
--no-show-instrument-names turn off a field that is on.
`;

// The argument after a flag that takes one. A flag written last, or followed
// by another flag, otherwise takes `undefined` and is silently ignored: the
// chart comes out with no bracket and the run says nothing about why.
function valueFor(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

// A setting's flag is its key in kebab case, so bellLabel is --bell-label. A
// yes-or-no setting has a --no- flag as well, so a field the score holds can be
// turned off. Quiet has no flag, since nothing here ever shows a message box.
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const FLAGS = new Map();
for (const { key, kind } of SETTINGS) {
  if (key === "quiet" || key === "mode") continue;
  if (kind === "yesno") {
    FLAGS.set(`--${kebab(key)}`, { key, value: true });
    FLAGS.set(`--no-${kebab(key)}`, { key, value: false });
  } else {
    FLAGS.set(`--${kebab(key)}`, { key });
  }
}
FLAGS.set("--separate", { key: "mode", value: "separate" });
FLAGS.set("--combined", { key: "mode", value: "combined" });
FLAGS.set("--hide-empty-staves", { key: "hideExistingStaves", value: true });
FLAGS.set("--remove", { key: "remove", value: true });

// An argument that looks like a flag and is not one is refused. Taken as a
// file name, a mistyped --separate wrote a score called "--seperate".
function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = FLAGS.get(arg);
    if (flag) {
      options[flag.key] = "value" in flag ? flag.value : valueFor(argv, ++i, arg);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function main() {
  // parseArgs is outside the run() try below, so its refusals need catching
  // here or a mistyped flag prints a stack trace instead of a message.
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err.message);
  }
  const { options: flags, positional } = parsed;
  if (positional.length !== 2) fail(USAGE);
  const [input, output] = positional;

  // validateOptions refuses a colour it cannot read as well, but only once the
  // score has been read. A typed flag is checked here, before any I/O, so the
  // message does not depend on the input existing.
  for (const flag of ["chimeColor", "smbColor", "pfColor", "whitechapelColor"]) {
    if (flags[flag] && !isColor(flags[flag])) fail(`Not a hex colour: ${flags[flag]}`);
  }

  if (!fs.existsSync(input)) fail(`Input file not found: ${input}`);

  let archive;
  try {
    archive = readMscz(fs.readFileSync(input));
  } catch (err) {
    fail(`Could not read ${input}: ${err.message}`);
  }

  const original = archive.entries.get(archive.mainName).toString("utf8");
  // The score's own fields first, the way the extension reads them, with any
  // flag given on the command line taking over from its field.
  const options = Object.assign(readOptions((tag) => {
    const text = readMetaTag(original, tag);
    return text === null ? null : decode(text);
  }), flags);
  let result;
  let sections = [];

  try {
    run();
  } catch (err) {
    fail(err.message);
  }

  function run() {
  if (options.remove) {
    result = removeChart(original);
    process.stdout.write(result === original
      ? "No chart found; the score is unchanged.\n"
      : "Chart removed.\n");
  } else {
    // Before anything is removed, the way the extension refuses a bad field.
    validateOptions(options);
    readHeads(options);
    const { records, skipped } = extractNotes(removeChart(original));
    const plan = buildPlan(records, options);
    sections = plan.sections;
    // Notes dropped for a missing or unparseable pitch or spelling are the one
    // failure that would otherwise leave a bell off the chart in silence.
    if (skipped) {
      process.stdout.write(`Warning: ${skipped} note(s) with no readable pitch were skipped.\n`);
    }
    // Before the refusal below, because on a score where nothing could be
    // charted the warnings are the reason why.
    for (const line of linesOf(plan)) process.stdout.write(`Warning: ${line}\n`);
    if (!plan.sections.length) {
      fail("No handbells, handchimes or silver melody bells found in the score.");
    }
    result = insertChart(original, plan, options);
    for (const section of plan.sections) process.stdout.write(section.label + "\n");
  }

  // Hiding the piece's own staves takes a style change as well as the staff
  // flag, because MuseScore keeps empty staves on the first system by default
  // and the chart is the first system. The score's own values come back on
  // removal.
  const styleName = "score_style.mss";
  const style = archive.entries.get(styleName);
  if (style) {
    const text = style.toString("utf8");
    const saved = readMetaTag(original, META_STYLE);
    if (options.remove) {
      if (saved) archive.entries.set(styleName, Buffer.from(writeStyleFlags(text, saved), "utf8"));
    } else if (options.hideExistingStaves) {
      const previous = saved || readStyleFlags(text);
      archive.entries.set(styleName, Buffer.from(writeStyleFlags(text, "1,0"), "utf8"));
      result = result.replace(/(\s*)<metaTag name="handbellChart/,
        `$1<metaTag name="${META_STYLE}">${previous}</metaTag>$1<metaTag name="handbellChart`);
    } else if (saved) {
      archive.entries.set(styleName, Buffer.from(writeStyleFlags(text, saved), "utf8"));
    }
  }

  // Linked parts share the archive and line up with the main score measure for
  // measure. Left untouched they would put MuseScore one measure out of step
  // and the file would not open at all.
  const staleMeasures = chartMeasureCount(original);
  for (const [name, buffer] of archive.entries) {
    if (!/^Excerpts\/.+\.mscx$/.test(name)) continue;
    const stripped = removeChartMeasures(buffer.toString("utf8"), staleMeasures);
    archive.entries.set(name, Buffer.from(insertChartMeasures(stripped, sections), "utf8"));
  }

  fs.writeFileSync(output, writeMscz(replaceMain(archive, result)));
  process.stdout.write(`Wrote ${output}\n`);
  }
}

main();
