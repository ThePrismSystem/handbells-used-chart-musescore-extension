"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readMscz, writeMscz } = require("../../tools/mscz.js");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "handbells-used-chart");
const NAME = "handbells-used-chart";
const URI = "musescore://extensions/" + NAME;

// MuseScore is driven through a wrapper on this machine; MSCORE overrides it.
const MSCORE = process.env.MSCORE || "mscore";

// MuseScore keeps user extensions and its extension config in a per-platform
// data directory. Both matter: without plugins/plugins.json the extension
// config never loads and no manifest resolves, whatever else is right.
function dataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MuseScore", "MuseScore4");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), "MuseScore", "MuseScore4");
  }
  return path.join(os.homedir(), ".local", "share", "MuseScore", "MuseScore4");
}

function museScoreAvailable() {
  try {
    execFileSync(MSCORE, ["--version"], { stdio: "ignore", timeout: 120000 });
    return true;
  } catch (err) {
    return false;
  }
}

// plugins.json is MuseScore's registry of every enabled plugin and extension,
// not just ours — read whatever is there and update only our own entry, so a
// developer's other registrations survive running this suite.
function readPluginRegistry(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function installExtension() {
  const target = path.join(dataDir(), "extensions", NAME);
  // node --test runs test files in parallel processes, and every extension
  // test file calls installExtension. Copying in place — never deleting
  // first — means two racing copies of the same byte-identical content are
  // harmless, instead of one process's delete racing another's copy. This
  // trades away cleanup of files removed from the source; a file that lingers
  // after being deleted from handbells-used-chart/ would surface as a test
  // failure anyway.
  fs.cpSync(SOURCE, target, { recursive: true, force: true });

  const config = path.join(dataDir(), "plugins");
  fs.mkdirSync(config, { recursive: true });
  const file = path.join(config, "plugins.json");
  const registry = readPluginRegistry(file);
  const ours = registry.find((entry) => entry && entry.uri === URI);
  if (ours) ours.enabled = true;
  else registry.push({ uri: URI, enabled: true });
  // Write-then-rename rather than writing plugins.json in place: a concurrent
  // reader could otherwise see a partial write and, since readPluginRegistry
  // treats unparseable input as empty, go on to overwrite every other
  // registration — the wholesale-overwrite bug this function was already
  // fixed for, resurfacing through a race. Renaming within a directory is
  // atomic, so a reader always sees either the old complete file or the new
  // one. A lost update (two processes both add our entry, one write wins) is
  // harmless: every writer adds the same entry, so none can destroy an entry
  // it never saw.
  const tmp = path.join(config, `.plugins.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(registry));
  fs.renameSync(tmp, file);
  return target;
}

// MuseScore runs an extension over a conversion job: one entry per file, and
// the job handles saving. Anything the extension logs goes to MuseScore's log,
// not to stdout.
function runExtension(inputPath, outputPath) {
  const job = path.join(path.dirname(outputPath), "job.json");
  fs.writeFileSync(job, JSON.stringify([{ in: inputPath, out: outputPath }]));
  try {
    execFileSync(MSCORE, ["-j", job, "--extension", URI],
      { stdio: "ignore", timeout: 300000 });
  } catch (err) {
    // MuseScore aborts during post-save teardown under xvfb on Linux, after its
    // own shutdown log already reads "Goodbye!! code: 0" — the conversion has
    // completed and the file is written by that point, so the exit status
    // describes the teardown, not the work. A readable output file means the
    // job actually succeeded despite it; anything else is a real failure.
    try {
      readMscz(fs.readFileSync(outputPath));
      return;
    } catch (unreadable) {
      err.message += ` (no readable output was produced; exit status ${err.status})`;
      throw err;
    }
  }
}

// MuseScore exits 40 on a score it cannot load, and prints nothing at all, so
// the exit code is the whole signal. This is the assertion that catches a
// structurally broken score.
function renderPdf(mscz) {
  const pdf = mscz.replace(/\.mscz$/, ".pdf");
  try {
    execFileSync(MSCORE, ["-o", pdf, mscz], { stdio: "ignore", timeout: 300000 });
    return 0;
  } catch (err) {
    return err.status === undefined ? -1 : err.status;
  }
}

// Every fixture is marked quiet. A prompt in a headless run blocks until the
// process is killed, and because MuseScore saves at the end of a job, the
// output file is never written — the failure looks like a missing file, not an
// error. A caller that wants to test the prompting path overrides the tag.
function makeScore(dir, mscxPath, metaTags) {
  const tags = Object.assign({ handbellChartQuiet: "yes" }, metaTags || {});
  const injected = Object.keys(tags)
    .filter((name) => tags[name] !== null)
    .map((name) => `    <metaTag name="${name}">${tags[name]}</metaTag>`)
    .join("\n");

  let mscx = fs.readFileSync(mscxPath, "utf8");
  mscx = mscx.replace("<Score>", "<Score>\n" + injected);

  const file = path.join(dir, path.basename(mscxPath, ".mscx") + ".mscz");
  fs.writeFileSync(file, writeMscz({
    entries: new Map([["score.mscx", Buffer.from(mscx, "utf8")]]),
    mainName: "score.mscx",
  }));
  return file;
}

function mainScore(mscz) {
  const archive = readMscz(fs.readFileSync(mscz));
  return archive.entries.get(archive.mainName).toString("utf8");
}

module.exports = {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore, URI, NAME,
};
