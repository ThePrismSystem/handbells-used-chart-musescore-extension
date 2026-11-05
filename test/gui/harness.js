"use strict";

// Runs the MuseScore desktop app so the options dialog can be opened and
// pressed the way a user would. Everything that differs by platform, from the
// display to how a key is pressed, is in drivers/. On Linux MuseScore gets a
// virtual display and data and config directories of its own, so nothing here
// touches the developer's real MuseScore settings. On Windows and macOS it
// uses the real folders, which is why those drivers only run in CI.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DRIVERS = { linux: "./drivers/linux.js", win32: "./drivers/windows.js", darwin: "./drivers/mac.js" };
const driver = require(DRIVERS[process.platform]);

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "handbells-used-chart");
const URI = "musescore://extensions/handbells-used-chart";
const APP = process.env.MUSESCORE_APP || driver.defaultApp;

// Bound in the temporary shortcuts file. MuseScore names an extension action
// by its URI with the scheme swapped for "action".
const OPEN_DIALOG = "ctrl+alt+shift+h";
const OPEN_DIALOG_SEQUENCE = "Ctrl+Alt+Shift+H";

const STARTUP_MS = 90000;

// Only a missing MuseScore is a reason to skip. With the app present, a
// missing display server or input tool would otherwise take every GUI test
// out of a green run without a word, so the driver throws instead.
function guiAvailable() {
  if (!APP || !fs.existsSync(APP)) return false;
  driver.available(APP);
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(what, check, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}

// Everything a fresh MuseScore would otherwise stop to ask about on its first
// launch: the setup wizard, the welcome dialog and the update check. Windows
// and macOS also advertise MuseSounds over the score a second after it opens.
const SETTINGS = {
  "application/hasCompletedFirstLaunchSetup": true,
  "application/checkForUpdate": false,
  "application/welcomeDialogShowOnStartup": false,
  "musesounds/checkForUpdate": false,
};

// Folders MuseScore shares with every other run start from nothing, so each
// test sees the first launch the Linux one sees in its fresh directory. The
// logs stay: MuseScore's crash handler can still hold a file in there open.
function prepare(where, extension) {
  if (where.shared && fs.existsSync(where.appData)) {
    for (const entry of fs.readdirSync(where.appData)) {
      if (entry !== "logs") fs.rmSync(path.join(where.appData, entry), { recursive: true, force: true });
    }
  }
  const target = path.join(where.appData, "extensions", "handbells-used-chart");
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(SOURCE, target, { recursive: true });
  if (extension) extension(target);

  // The desktop app enables an extension's actions from this file, not from
  // plugins/plugins.json, which only the command-line job runner reads.
  const manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(where.appData, "extensions", "config.json"), JSON.stringify([{
    uri: URI,
    actions: manifest.actions.map((a) => ({ code: a.code, exec_point: "manually" })),
  }]));

  fs.writeFileSync(path.join(where.appData, "shortcuts.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<Shortcuts>
  <SC>
    <key>action://extensions/handbells-used-chart?action=options</key>
    <seq>${OPEN_DIALOG_SEQUENCE}</seq>
  </SC>
</Shortcuts>
`);

  driver.writeSettings(where, SETTINGS);
}

function logFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".log")).sort() : [];
}

// MuseScore's log as this run has written it: its standard output where the
// driver says that carries it, and otherwise the log files it starts in its
// data folder, leaving out any an earlier run left there.
function reader(stdoutFile, logsDir) {
  if (driver.logsFromStdout) return () => fs.readFileSync(stdoutFile, "utf8");
  const earlier = new Set(logFiles(logsDir));
  return () => logFiles(logsDir).filter((name) => !earlier.has(name))
    .map((name) => fs.readFileSync(path.join(logsDir, name), "utf8")).join("");
}

// Starts MuseScore on `score`, hands fn a handle for driving it, and tears
// everything down afterwards whatever fn did. `extension` may edit the copy
// of the extension before MuseScore loads it.
async function withMuseScore({ score, extension }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-"));
  const where = driver.locations(dir);
  prepare(where, extension);
  const logFile = path.join(dir, "mscore.log");
  const out = fs.openSync(logFile, "w");

  const display = await driver.start({ ...process.env, ...where.env }, until);
  let mscore = null;
  try {
    const log = reader(logFile, path.join(where.appData, "logs"));
    mscore = spawn(APP, [score], { env: display.env, stdio: ["ignore", out, out] });
    const ctx = { env: display.env, pid: mscore.pid };
    const handle = {
      log,
      key: (sequence) => driver.key(sequence, ctx),
      click: (x, y) => driver.click(x, y, ctx),
      waitForLog: (pattern, timeout = 30000) => until(`${pattern} in MuseScore's log`,
        () => pattern.exec(log()), timeout),
      openDialog: () => handle.key(OPEN_DIALOG),
      save: () => handle.key("ctrl+s"),
      screenshot: (file) => driver.screenshot(file, ctx),
    };

    const name = path.basename(score, path.extname(score));
    await until("MuseScore's window", () => driver.findWindow(name, ctx), STARTUP_MS);
    // The window appears before the score inside it is ready for input. The
    // welcome dialog then opens over it whatever the settings say, and
    // Escape is the one thing that reliably dismisses it.
    await sleep(5000);
    handle.key("Escape");
    await sleep(1000);
    try {
      await fn(handle);
    } catch (err) {
      // CI keeps these when a test fails, since the screen is the only record
      // of what the dialog was showing.
      if (process.env.HBUC_SCREENSHOTS) {
        handle.screenshot(path.join(process.env.HBUC_SCREENSHOTS, `${name}-${Date.now()}.png`));
      }
      throw err;
    }
  } finally {
    if (mscore) mscore.kill("SIGKILL");
    display.stop();
    fs.closeSync(out);
    if (process.env.KEEP_GUI_DIR) process.stdout.write(`# GUI run kept at ${dir}\n`);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The dialog logs where its buttons are once it has laid itself out, as
// "<tag> {json}", so a test can press them without knowing the layout.
// MuseScore's log quotes the message and escapes the quotes inside it.
async function buttons(handle, tag) {
  const pattern = new RegExp(`${tag} (\\{.*\\})"`);
  const match = await handle.waitForLog(pattern);
  return JSON.parse(match[1].replace(/\\"/g, '"'));
}

module.exports = { guiAvailable, withMuseScore, buttons, sleep, until };
