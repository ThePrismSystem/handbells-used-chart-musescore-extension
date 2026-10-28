"use strict";

// Runs the MuseScore desktop app on a virtual display of its own, with data
// and config directories of its own, so the options dialog can be opened and
// pressed the way a user would. Nothing here touches the developer's real
// MuseScore settings.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "handbells-used-chart");
const URI = "musescore://extensions/handbells-used-chart";
const APPIMAGE = process.env.MUSESCORE_APPIMAGE
  || path.join(os.homedir(), "Applications", "MuseScore-Studio-4.7.4-x86_64.AppImage");

// Bound in the temporary shortcuts file. MuseScore names an extension action
// by its URI with the scheme swapped for "action".
const OPEN_DIALOG = "ctrl+alt+shift+h";
const OPEN_DIALOG_SEQUENCE = "Ctrl+Alt+Shift+H";

const STARTUP_MS = 90000;

function onPath(tool) {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Only a missing MuseScore is a reason to skip. With the AppImage present, a
// missing display server or input tool would otherwise take every GUI test
// out of a green run without a word.
function guiAvailable() {
  if (!fs.existsSync(APPIMAGE)) return false;
  for (const tool of ["Xvfb", "xdotool"]) {
    if (!onPath(tool)) {
      throw new Error(`${APPIMAGE} is installed but ${tool} is not on the path. `
        + `Install it to run the GUI tests, or move the AppImage to skip them.`);
    }
  }
  return true;
}

function freeDisplay() {
  for (let n = 90; n < 200; n++) {
    if (!fs.existsSync(`/tmp/.X11-unix/X${n}`) && !fs.existsSync(`/tmp/.X${n}-lock`)) return `:${n}`;
  }
  throw new Error("No free X display between :90 and :199");
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
// launch: the setup wizard, the welcome dialog and the update check.
const SETTINGS = `[application]
hasCompletedFirstLaunchSetup=true
checkForUpdate=false
welcomeDialogShowOnStartup=false
`;

function prepare(dir, extension) {
  const data = path.join(dir, "data");
  const config = path.join(dir, "config");
  const app = path.join(data, "MuseScore", "MuseScore4");
  const target = path.join(app, "extensions", "handbells-used-chart");
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(SOURCE, target, { recursive: true });
  if (extension) extension(target);

  // The desktop app enables an extension's actions from this file, not from
  // plugins/plugins.json, which only the command-line job runner reads.
  const manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(app, "extensions", "config.json"), JSON.stringify([{
    uri: URI,
    actions: manifest.actions.map((a) => ({ code: a.code, exec_point: "manually" })),
  }]));

  fs.writeFileSync(path.join(app, "shortcuts.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<Shortcuts>
  <SC>
    <key>action://extensions/handbells-used-chart?action=options</key>
    <seq>${OPEN_DIALOG_SEQUENCE}</seq>
  </SC>
</Shortcuts>
`);

  fs.mkdirSync(path.join(config, "MuseScore"), { recursive: true });
  fs.writeFileSync(path.join(config, "MuseScore", "MuseScore4.ini"), SETTINGS);
  return { data, config };
}

// Starts MuseScore on `score`, hands fn a handle for driving it, and tears
// everything down afterwards whatever fn did. `extension` may edit the copy
// of the extension before MuseScore loads it.
async function withMuseScore({ score, extension }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-"));
  const display = freeDisplay();
  const { data, config } = prepare(dir, extension);
  const logFile = path.join(dir, "mscore.log");
  const out = fs.openSync(logFile, "w");

  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1920x1080x24"], { stdio: "ignore" });
  let mscore = null;
  try {
    await until("the virtual display", () => fs.existsSync(`/tmp/.X11-unix/X${display.slice(1)}`), 10000);
    const env = { ...process.env, DISPLAY: display, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config };
    mscore = spawn(APPIMAGE, [score], { env, stdio: ["ignore", out, out] });

    const xdotool = (...args) => execFileSync("xdotool", args, { env, encoding: "utf8" });
    const log = () => fs.readFileSync(logFile, "utf8");
    const handle = {
      log,
      key: (sequence) => xdotool("key", "--clearmodifiers", sequence),
      click: (x, y) => xdotool("mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1"),
      waitForLog: (pattern, timeout = 30000) => until(`${pattern} in MuseScore's log`,
        () => pattern.exec(log()), timeout),
      openDialog: () => handle.key(OPEN_DIALOG),
      save: () => handle.key("ctrl+s"),
      screenshot: (file) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab",
        "-video_size", "1920x1080", "-i", display, "-frames:v", "1", file], { env }),
    };

    const name = path.basename(score, path.extname(score));
    await until("MuseScore's window", () => {
      try {
        return xdotool("search", "--name", name).trim();
      } catch {
        return null;
      }
    }, STARTUP_MS);
    // The window appears before the score inside it is ready for input. The
    // welcome dialog then opens over it whatever the settings say, and
    // Escape is the one thing that reliably dismisses it.
    await sleep(5000);
    handle.key("Escape");
    await sleep(1000);
    await fn(handle);
  } finally {
    if (mscore) mscore.kill("SIGKILL");
    xvfb.kill("SIGKILL");
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
