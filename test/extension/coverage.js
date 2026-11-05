"use strict";

// Counts what the extension runs inside MuseScore. Node's coverage cannot see
// those scripts there, so when HBUC_COVERAGE_DIR is set the harness installs a
// copy instrumented by istanbul instead of the plain one. Each entry point's
// main() is wrapped so that, however it ends, its counts are written into the
// score as a metaTag. The harness takes the tag back out of the saved file,
// so no test sees it, and coverage-report.js merges the counts into lcov.
//
// None of this is in handbells-used-chart/ itself. The instrumented copy
// exists only in MuseScore's data directory, and only for the length of a run.

const fs = require("node:fs");
const path = require("node:path");
const { createInstrumenter } = require("istanbul-lib-instrument");
const { decode } = require("../../tools/xml.js");

const COVERAGE_DIR = process.env.HBUC_COVERAGE_DIR || null;
const VARIABLE = "__hbucCoverage__";
const TAG = "handbellChartCoverage";
const MAIN = /function main\(\)/;

// The dialog loads bundle.js, never form.js, and the macro actions load
// neither, so the unit tests are what count form.js.
const NOT_INSTRUMENTED = new Set(["bundle.js", "form.js"]);

// A main() that runs the real one and then, whether it returned or threw,
// writes only the counts into the score. The maps describing what each count
// stands for are rebuilt from skeleton.json, which keeps the tag small.
// This runs inside MuseScore, so it is written the way the extension is.
function wrapEntry(code) {
  if (!MAIN.test(code)) throw new Error("No function main() to wrap");
  return code.replace(MAIN, "function hbucMeasuredMain()") + `
function main() {
    try {
        return hbucMeasuredMain();
    } finally {
        var all = (new Function("return this"))().${VARIABLE} || {};
        var hits = {};
        for (var file in all) hits[file] = { s: all[file].s, f: all[file].f, b: all[file].b };
        var score = api.engraving.curScore;
        score.startCmd();
        score.setMetaTag("${TAG}", JSON.stringify(hits));
        score.endCmd();
    }
}
`;
}

const TAKEN = new RegExp(`\\n?[ \\t]*<metaTag name="${TAG}">([^<]*)</metaTag>`);

// The score's text without the coverage metaTag, and the counts it held.
function takeCoverage(text) {
  const match = TAKEN.exec(text);
  if (!match) return { text, hits: null };
  return { text: text.replace(TAKEN, ""), hits: JSON.parse(decode(match[1])) };
}

function scripts(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scripts(full, base);
    return entry.name.endsWith(".js") ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });
}

// Copies source to target with every script MuseScore loads instrumented,
// named as the repository names it, and writes each one's empty counts to
// coverageDir/skeleton.json.
function instrumentExtension(source, target, coverageDir) {
  fs.cpSync(source, target, { recursive: true, force: true });
  const prefix = path.basename(source);
  const skeleton = {};
  for (const relative of scripts(source)) {
    if (NOT_INSTRUMENTED.has(relative)) continue;
    const name = `${prefix}/${relative}`;
    const instrumenter = createInstrumenter({
      esModules: false,
      coverageVariable: VARIABLE,
      coverageGlobalScope: "this",
      coverageGlobalScopeFunc: true,
    });
    let code = instrumenter.instrumentSync(fs.readFileSync(path.join(source, relative), "utf8"), name);
    skeleton[name] = instrumenter.lastFileCoverage();
    if (!relative.includes("/") && MAIN.test(code)) code = wrapEntry(code);
    fs.writeFileSync(path.join(target, relative), code);
  }
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(path.join(coverageDir, "skeleton.json"), JSON.stringify(skeleton));
}

module.exports = { COVERAGE_DIR, wrapEntry, takeCoverage, instrumentExtension };
