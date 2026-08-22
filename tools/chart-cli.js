#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { readMscz, writeMscz, replaceMain } = require("./mscz.js");
const { extractNotes, readMetaTag } = require("./extract-notes.js");
const { buildPlan } = require("../handbells-used-chart/lib/plan.js");
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
  --hide-empty-staves  also let the piece's own staves hide, so they do not
                       appear as empty measures beneath the chart
  --remove             strip an existing chart instead of generating one
`;

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--bell-label": options.bellLabel = argv[++i]; break;
      case "--chime-label": options.chimeLabel = argv[++i]; break;
      case "--chime-color": options.chimeColor = argv[++i]; break;
      case "--hide-empty-staves": options.hideExistingStaves = true; break;
      case "--remove": options.remove = true; break;
      default: positional.push(argv[i]);
    }
  }
  return { options, positional };
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  if (positional.length !== 2) fail(USAGE);
  const [input, output] = positional;

  // The writer ignores a colour it cannot parse, which is right for a value
  // read out of the score, but a typed flag deserves to be told about. This
  // runs before any I/O so the message does not depend on the input existing.
  if (options.chimeColor && !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(options.chimeColor)) {
    fail(`Not a hex colour: ${options.chimeColor}`);
  }

  if (!fs.existsSync(input)) fail(`Input file not found: ${input}`);

  let archive;
  try {
    archive = readMscz(fs.readFileSync(input));
  } catch (err) {
    fail(`Could not read ${input}: ${err.message}`);
  }

  const original = archive.entries.get(archive.mainName).toString("utf8");
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
    if (!options.chimeColor) {
      options.chimeColor = readMetaTag(original, "handchimesColor") || "#000000";
    }
    const { records, skipped } = extractNotes(removeChart(original));
    const plan = buildPlan(records, options);
    sections = plan.sections;
    if (!plan.sections.length) fail("No handbells or handchimes found in the score.");
    result = insertChart(original, plan, options);
    for (const section of plan.sections) process.stdout.write(section.label + "\n");
    // Notes dropped for a missing or unparseable pitch or spelling are the one
    // failure that would otherwise leave a bell off the chart in silence.
    if (skipped) {
      process.stdout.write(`Warning: ${skipped} note(s) with no readable pitch were skipped.\n`);
    }
    // One branch per type. A two-way test would read warning.names on any
    // warning that is not the notehead one, and lib/ is shared with the
    // extension — a type added there for its sake must not crash this.
    for (const warning of plan.warnings) {
      if (warning.type === "unknown-notehead") {
        process.stdout.write(`Warning: ${warning.count} note(s) with an unrecognised notehead were skipped.\n`);
      } else if (warning.type === "unreadable-pitch") {
        process.stdout.write(`Warning: ${warning.count} note(s) with an unreadable pitch were skipped.\n`);
      } else if (warning.type === "out-of-range") {
        process.stdout.write(`Warning: bells outside C2-C9 were skipped: ${warning.names.join(", ")}\n`);
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
