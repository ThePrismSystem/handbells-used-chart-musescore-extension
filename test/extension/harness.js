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

// Only "MuseScore is not installed" is a reason to skip. A MuseScore that is
// present but broken, or one that hangs past the timeout, used to land here
// too and skip the entire extension suite — the whole of this PR's coverage —
// while the run stayed green and said nothing. That failure is now loud.
function museScoreAvailable() {
  try {
    execFileSync(MSCORE, ["--version"], { stdio: "ignore", timeout: 120000 });
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw new Error(
      `MuseScore is on the path at ${MSCORE} but "--version" failed `
      + `(${err.code || `exit ${err.status}`}). Refusing to skip the extension `
      + `tests silently — fix the install, or unset it from the path to skip.`,
      { cause: err });
  }
}

// plugins.json is MuseScore's registry of every enabled plugin and extension,
// not just ours — read whatever is there and update only our own entry, so a
// developer's other registrations survive running this suite.
// An absent file is the only thing that means "no registrations yet". Anything
// else — unreadable, unparseable, or holding something that is not an array —
// is a file with content this function cannot understand, and returning [] for
// it makes installExtension write a registry containing only our own entry,
// unregistering every other plugin in the developer's live MuseScore data
// directory. That is the wholesale-overwrite bug this function was fixed for
// once already; it does not get a second route in through a bad parse.
function readPluginRegistry(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} does not hold a JSON array of plugin registrations. `
      + `Refusing to replace it, because that would unregister every plugin it lists.`);
  }
  return parsed;
}

function installExtension() {
  const target = path.join(dataDir(), "extensions", NAME);
  // The extension tests run one file at a time (see test:extension in
  // package.json), so the race this guards against should not arise — but the
  // guard stays, because nothing stops these files being run directly with a
  // plain `node --test`, which does run them in parallel. Copying in place —
  // never deleting first — means two racing copies of the same content are
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
  // Whether the run worked is decided below by reading outputPath, so a file
  // already sitting there — an earlier call's output, reused as this one's
  // path — would be mistaken for this run's work.
  fs.rmSync(outputPath, { force: true });
  let failure = null;
  try {
    execFileSync(MSCORE, ["-j", job, "--extension", URI],
      { stdio: "ignore", timeout: 300000 });
  } catch (err) {
    // MuseScore aborts during post-save teardown under xvfb on Linux, after its
    // own shutdown log already reads "Goodbye!! code: 0" — the conversion has
    // completed and the file is written by that point, so the exit status
    // describes the teardown, not the work. So the exit status cannot decide
    // this either way; the output file below does.
    failure = err;
  }

  // A readable file is not enough on its own. MuseScore's job runner saves the
  // score whether the extension did anything or not, so a run in which main()
  // threw on its first line still leaves a perfectly readable .mscz behind —
  // and every assertion about what the chart does not contain would pass
  // against it. main() records handbellChartRan once it has read the score,
  // and handbellChartError when it refuses; every fixture here is quiet, so
  // one of the two is always written by a run that got as far as a decision.
  let text;
  try {
    const archive = readMscz(fs.readFileSync(outputPath));
    text = archive.entries.get(archive.mainName).toString("utf8");
  } catch (unreadable) {
    const err = failure || new Error("MuseScore exited cleanly");
    err.message += ` (no readable output was produced at ${outputPath}`
      + `${failure ? `; exit status ${failure.status}` : ""})`;
    throw err;
  }

  if (!/<metaTag name="handbellChartRan">[^<]/.test(text)
      && !/<metaTag name="handbellChartError">[^<]/.test(text)) {
    throw new Error(`The extension did not run to a decision on ${inputPath}: `
      + `the saved score records neither handbellChartRan nor handbellChartError`
      + `${failure ? ` (exit status ${failure.status})` : ""}.`);
  }
}

// MuseScore exits 40 on a score it cannot load, and prints nothing at all, so
// the exit code is the whole signal. This is the assertion that catches a
// structurally broken score.
// Returns 0 when the score rendered. The same xvfb teardown abort that
// runExtension tolerates lands here too, so the exit status alone would fail a
// render that actually worked; a PDF on disk is the evidence, and MuseScore
// writes none for a score it could not load. Without the file, a real status
// is reported as it stands and a killed or signalled run becomes -1.
function renderPdf(mscz) {
  const pdf = mscz.replace(/\.mscz$/, ".pdf");
  fs.rmSync(pdf, { force: true });
  try {
    execFileSync(MSCORE, ["-o", pdf, mscz], { stdio: "ignore", timeout: 300000 });
  } catch (err) {
    if (!fs.existsSync(pdf)) return err.status === undefined ? -1 : err.status;
  }
  return fs.existsSync(pdf) && fs.statSync(pdf).size > 0 ? 0 : -1;
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

// Score-level style overrides are not written into the main score file at
// all: MuseScore 4.7 saves them to a sibling archive member holding the whole
// resolved style, defaults included.
function scoreStyle(mscz) {
  const archive = readMscz(fs.readFileSync(mscz));
  const entry = archive.entries.get("score_style.mss");
  return entry ? entry.toString("utf8") : "";
}

module.exports = {
  museScoreAvailable, installExtension, runExtension, renderPdf,
  makeScore, mainScore, scoreStyle, URI, NAME,
};
