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

function installExtension() {
  const target = path.join(dataDir(), "extensions", NAME);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(SOURCE, target, { recursive: true });

  const config = path.join(dataDir(), "plugins");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, "plugins.json"),
    JSON.stringify([{ uri: URI, enabled: true }]));
  return target;
}

// MuseScore runs an extension over a conversion job: one entry per file, and
// the job handles saving. Anything the extension logs goes to MuseScore's log,
// not to stdout.
function runExtension(inputPath, outputPath) {
  const job = path.join(path.dirname(outputPath), "job.json");
  fs.writeFileSync(job, JSON.stringify([{ in: inputPath, out: outputPath }]));
  execFileSync(MSCORE, ["-j", job, "--extension", URI],
    { stdio: "ignore", timeout: 300000 });
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
