#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { readMscz, writeMscz, replaceMain } = require("./mscz.js");
const { extractNotes, readMetaTag } = require("./extract-notes.js");
const { buildPlan } = require("../handbells-used-chart/lib/plan.js");
const { insertChart, removeChart } = require("./insert.js");

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

  if (options.remove) {
    result = removeChart(original);
    process.stdout.write("Chart removed.\n");
  } else {
    if (!options.chimeColor) {
      options.chimeColor = readMetaTag(original, "handchimesColor") || "#000000";
    }
    const { records, skipped } = extractNotes(removeChart(original));
    const plan = buildPlan(records, options);
    if (!plan.sections.length) fail("No handbells or handchimes found in the score.");
    result = insertChart(original, plan, options);
    for (const section of plan.sections) process.stdout.write(section.label + "\n");
    // Notes dropped for a missing or unparseable pitch or spelling are the one
    // failure that would otherwise leave a bell off the chart in silence.
    if (skipped) {
      process.stdout.write(`Warning: ${skipped} note(s) with no readable pitch were skipped.\n`);
    }
    for (const warning of plan.warnings) {
      process.stdout.write(warning.type === "unknown-notehead"
        ? `Warning: ${warning.count} note(s) with an unrecognised notehead were skipped.\n`
        : `Warning: bells outside C2-C9 were skipped: ${warning.names.join(", ")}\n`);
    }
  }

  fs.writeFileSync(output, writeMscz(replaceMain(archive, result)));
  process.stdout.write(`Wrote ${output}\n`);
}

main();
