#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { readMscz, writeMscz, replaceMain } = require("./mscz.js");
const { extractNotes, readMetaTag } = require("./extract-notes.js");
const { buildPlan, readHeads } = require("../handbells-used-chart/lib/plan.js");
const { readOptions, validateOptions } = require("../handbells-used-chart/lib/options.js");
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
                       e.g. "Piano, Organ"
  --shared-staff       put every chart on one staff, a measure each, instead of
                       a staff each
  --separate           chart each instrument on its own, with its name before
                       every label, when two or more are left to chart
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
takes over from its field.
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

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--bell-label": options.bellLabel = valueFor(argv, ++i, flag); break;
      case "--chime-label": options.chimeLabel = valueFor(argv, ++i, flag); break;
      case "--chime-color": options.chimeColor = valueFor(argv, ++i, flag); break;
      case "--smb-label": options.smbLabel = valueFor(argv, ++i, flag); break;
      case "--smb-color": options.smbColor = valueFor(argv, ++i, flag); break;
      case "--smbs-optional": options.smbsOptional = true; break;
      case "--skip-parts": options.skipParts = valueFor(argv, ++i, flag); break;
      case "--shared-staff": options.sharedStaff = true; break;
      case "--separate": options.mode = "separate"; break;
      case "--show-instrument-names": options.showInstrumentNames = true; break;
      case "--hide-empty-staves": options.hideExistingStaves = true; break;
      case "--remove": options.remove = true; break;
      case "--required-bell-first": options.requiredBellFirst = valueFor(argv, ++i, flag); break;
      case "--required-bell-last": options.requiredBellLast = valueFor(argv, ++i, flag); break;
      case "--required-chime-first": options.requiredChimeFirst = valueFor(argv, ++i, flag); break;
      case "--required-chime-last": options.requiredChimeLast = valueFor(argv, ++i, flag); break;
      case "--bell-head": options.bellHead = valueFor(argv, ++i, flag); break;
      case "--chime-head": options.chimeHead = valueFor(argv, ++i, flag); break;
      case "--smb-head": options.smbHead = valueFor(argv, ++i, flag); break;
      case "--pf-head": options.pfHead = valueFor(argv, ++i, flag); break;
      case "--whitechapel-head": options.whitechapelHead = valueFor(argv, ++i, flag); break;
      case "--pf-label": options.pfLabel = valueFor(argv, ++i, flag); break;
      case "--pf-color": options.pfColor = valueFor(argv, ++i, flag); break;
      case "--whitechapel-label": options.whitechapelLabel = valueFor(argv, ++i, flag); break;
      case "--whitechapel-color": options.whitechapelColor = valueFor(argv, ++i, flag); break;
      case "--bell-shape": options.bellShape = valueFor(argv, ++i, flag); break;
      case "--chime-shape": options.chimeShape = valueFor(argv, ++i, flag); break;
      case "--smb-shape": options.smbShape = valueFor(argv, ++i, flag); break;
      case "--pf-shape": options.pfShape = valueFor(argv, ++i, flag); break;
      case "--whitechapel-shape": options.whitechapelShape = valueFor(argv, ++i, flag); break;
      default: positional.push(flag);
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
    if (!plan.sections.length) {
      fail("No handbells, handchimes or silver melody bells found in the score.");
    }
    result = insertChart(original, plan, options);
    for (const section of plan.sections) process.stdout.write(section.label + "\n");
    // Notes dropped for a missing or unparseable pitch or spelling are the one
    // failure that would otherwise leave a bell off the chart in silence.
    if (skipped) {
      process.stdout.write(`Warning: ${skipped} note(s) with no readable pitch were skipped.\n`);
    }
    // One branch per type. A two-way test would read warning.names on any
    // warning that is not the notehead one, and lib/ is shared with the
    // extension, so a type added there for its sake must not crash this.
    for (const warning of plan.warnings) {
      if (warning.type === "unknown-notehead") {
        process.stdout.write(`Warning: ${warning.count} note(s) with an unrecognised notehead were skipped: ${warning.names.join(", ")}\n`);
      } else if (warning.type === "unreadable-pitch") {
        process.stdout.write(`Warning: ${warning.count} note(s) with an unreadable pitch were skipped.\n`);
      } else if (warning.type === "out-of-range") {
        process.stdout.write(`Warning: bells outside C2-C9 were skipped: ${warning.names.join(", ")}\n`);
      } else if (warning.type === "smb-out-of-range") {
        process.stdout.write(`Warning: silver melody bells outside C5-C7 were skipped: ${warning.names.join(", ")}\n`);
      } else if (warning.type === "skipped-part-not-found") {
        process.stdout.write(`Warning: no part is named: ${warning.names.join(", ")}\n`);
      } else if (warning.type === "empty-instrument") {
        process.stdout.write(`Warning: these instruments have nothing to chart: ${warning.names.join(", ")}\n`);
      }
    }
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
