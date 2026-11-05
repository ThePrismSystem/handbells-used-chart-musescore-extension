#!/usr/bin/env node
"use strict";

// Merges the counts the instrumented extension wrote, one hits-*.json per
// MuseScore run, onto the skeleton coverage.js saved, and writes lcov.
//
//   node test/extension/coverage-report.js <HBUC_COVERAGE_DIR> <out dir>
//
// Files are named by repository-relative POSIX paths, because Codecov matches
// them against the repository's files. Exits 1 when no run left any counts.

const fs = require("node:fs");
const path = require("node:path");
const libCoverage = require("istanbul-lib-coverage");
const libReport = require("istanbul-lib-report");
const reports = require("istanbul-reports");

const posix = (file) => file.replace(/\\/g, "/");

function buildMap(skeleton, runs) {
  const empty = {};
  for (const [file, data] of Object.entries(skeleton)) empty[posix(file)] = data;
  const map = libCoverage.createCoverageMap({});
  for (const [file, data] of Object.entries(empty)) map.merge({ [file]: { ...data, path: file } });
  for (const hits of runs) {
    for (const [key, counts] of Object.entries(hits)) {
      const file = posix(key);
      if (!empty[file]) throw new Error(`Counts for ${file}, which the skeleton does not describe`);
      map.merge({ [file]: { ...empty[file], path: file, s: counts.s, f: counts.f, b: counts.b } });
    }
  }
  return map;
}

// istanbul writes each SF: line in the platform's own separators, so on
// Windows they are turned back into the forward slashes Codecov matches.
function writeLcov(map, outDir) {
  reports.create("lcovonly", { file: "lcov.info" })
    .execute(libReport.createContext({ dir: outDir, coverageMap: map }));
  const file = path.join(outDir, "lcov.info");
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/^SF:.*$/gm, (line) => posix(line)));
}

function main(dir, outDir) {
  const runs = fs.readdirSync(dir)
    .filter((name) => /^hits-.*\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
  if (runs.length === 0) {
    console.error(`No MuseScore run left coverage counts in ${dir}`);
    return 1;
  }
  const skeleton = JSON.parse(fs.readFileSync(path.join(dir, "skeleton.json"), "utf8"));
  const map = buildMap(skeleton, runs);
  writeLcov(map, outDir);
  console.log(`extension inside MuseScore: ${runs.length} runs, ${map.getCoverageSummary().lines.pct}% of lines`);
  return 0;
}

if (require.main === module) process.exitCode = main(...process.argv.slice(2));

module.exports = { buildMap, writeLcov };
