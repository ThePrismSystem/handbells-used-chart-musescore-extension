#!/usr/bin/env node
"use strict";

// Fails when the line coverage of a set of files, merged over lcov reports,
// is under the floor.
//
//   node tools/coverage-gate.js <name> <report.info>... [--include <glob>]... [--exclude <glob>]...
//
// A line counts as covered when any report hit it. Globs are matched against
// paths relative to the working directory, in POSIX form: * stays within one
// directory and ** crosses them. With no --include every file counts. Codecov
// holds only the lines a pull request changes, because its per-component
// checks need a paid plan, so each CI job holds what it measured to the floor
// with this. Exits 0 at or over the floor, 1 under it, and 2 when there is
// nothing to measure.

const fs = require("node:fs");
const path = require("node:path");

const FLOOR = 80; // percent of lines

function relative(file, root) {
  const local = path.isAbsolute(file) ? path.relative(root, file) : file;
  return local.replace(/\\/g, "/");
}

// "file:line" -> whether this report hit it.
function parseLcov(text, root) {
  const lines = new Map();
  let file = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = relative(line.slice(3), root);
    } else if (line.startsWith("DA:")) {
      const [number, hits] = line.slice(3).split(",");
      lines.set(`${file}:${number}`, Number(hits) > 0);
    }
  }
  return lines;
}

function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      source += ".*";
      i++;
    } else if (c === "*") {
      source += "[^/]*";
    } else {
      source += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function matches(file, includes, excludes) {
  const hit = (globs) => globs.some((glob) => globToRegExp(glob).test(file));
  return (includes.length === 0 || hit(includes)) && !hit(excludes);
}

// Covered and found lines over every report, for the files the globs select.
function measure(reports, root, includes, excludes) {
  const covered = new Map();
  for (const text of reports) {
    for (const [key, hit] of parseLcov(text, root)) {
      const file = key.slice(0, key.lastIndexOf(":"));
      if (!matches(file, includes, excludes)) continue;
      covered.set(key, covered.get(key) || hit);
    }
  }
  let count = 0;
  for (const hit of covered.values()) if (hit) count++;
  return { covered: count, found: covered.size };
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const reports = [];
  const includes = [];
  const excludes = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--include") includes.push(rest[++i]);
    else if (rest[i] === "--exclude") excludes.push(rest[++i]);
    else reports.push(rest[i]);
  }
  return { name, reports, includes, excludes };
}

function main(argv) {
  const { name, reports, includes, excludes } = parseArgs(argv);
  if (!name || reports.length === 0) {
    console.error("usage: coverage-gate.js <name> <report.info>... [--include <glob>]... [--exclude <glob>]...");
    return 2;
  }
  const missing = reports.filter((report) => !fs.existsSync(report));
  if (missing.length > 0) {
    console.error(`${name}: report not found: ${missing.join(", ")}`);
    return 2;
  }
  const texts = reports.map((report) => fs.readFileSync(report, "utf8"));
  const { covered, found } = measure(texts, process.cwd(), includes, excludes);
  if (found === 0) {
    console.error(`${name}: no lines to measure in ${reports.join(", ")}`);
    return 2;
  }
  const pct = (100 * covered) / found;
  console.log(`${name}: ${covered}/${found} lines, ${pct.toFixed(1)}% (floor ${FLOOR}%)`);
  return pct >= FLOOR ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parseLcov, matches, measure };
