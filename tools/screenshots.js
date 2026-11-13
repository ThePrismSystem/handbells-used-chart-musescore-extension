#!/usr/bin/env node
"use strict";

// Regenerates the two README screenshots from test/fixtures/readme-example.mscx:
// the score as it opens, and the same score after the extension has run.
//
// It installs the extension into MuseScore's data directory the way the
// extension tests do, and needs MuseScore on the path (or MSCORE).
//
//   npm run screenshots

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore, fixture, tag,
} = require("../test/extension/harness.js");

const MSCORE = process.env.MSCORE || "mscore";
const OUT = path.join(__dirname, "..", "screenshots");
const DPI = 225;
const MARGIN_PX = 40;

// MuseScore reads the trim margin at its own 1200 DPI whatever -r says, so
// "-T 100" at 150 DPI leaves 12 pixels of white.
const TRIM = String(Math.round(MARGIN_PX * 1200 / DPI));

// The fixture ends its first page after the first system, so page one is
// the title, any chart and the opening bars, trimmed to the ink.
function renderFirstPage(mscz, png) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbuc-render-"));
  const first = path.join(dir, "page-1.png");
  try {
    execFileSync(MSCORE, ["-o", path.join(dir, "page.png"), "-r", String(DPI), "-T", TRIM, mscz],
      { stdio: "ignore", timeout: 300000 });
  } catch (err) {
    // MuseScore can abort in teardown under xvfb after writing its output.
    if (!fs.existsSync(first)) throw err;
  }
  fs.copyFileSync(first, png);
  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  if (!museScoreAvailable()) {
    throw new Error(`MuseScore is not on the path. Install it or point MSCORE at it.`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbuc-screenshots-"));
  try {
    const before = makeScore(dir, fixture("readme-example.mscx"));
    renderFirstPage(before, path.join(OUT, "before.png"));

    installExtension();
    const after = path.join(dir, "after.mscz");
    runExtension(before, after);
    const text = mainScore(after);
    const error = tag(text, "handbellChartError");
    if (error) throw new Error(`The extension refused the fixture: ${error}`);
    renderFirstPage(after, path.join(OUT, "after.png"));

    console.log(tag(text, "handbellChartReport"));
    console.log(`Wrote ${path.join(OUT, "before.png")} and ${path.join(OUT, "after.png")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
