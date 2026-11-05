"use strict";

// Windows: keys and clicks go through user32 from windows.ps1, on the desktop
// session GitHub's Windows runners have. Qt reads its data and settings
// folders from Windows' known-folder API, which no environment variable
// redirects, so these tests use MuseScore's real folders. They only run in
// CI for that reason, where the runner is thrown away afterwards.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { ini } = require("./settings.js");

const SCRIPT = path.join(__dirname, "windows.ps1");

const defaultApp = null;

const NAMED = { ctrl: 0x11, alt: 0x12, shift: 0x10, escape: 0x1b, return: 0x0d, enter: 0x0d, tab: 0x09 };

// "ctrl+alt+shift+h" as virtual-key codes, in the order they go down.
function translateKey(sequence) {
  return sequence.split("+").map((part) => {
    const name = part.toLowerCase();
    if (name in NAMED) return NAMED[name];
    if (/^[a-z0-9]$/.test(name)) return name.toUpperCase().charCodeAt(0);
    throw new Error(`No virtual key for "${part}" in ${sequence}`);
  });
}

function available() {
  if (process.env.CI !== "true") {
    throw new Error("The dialog tests on Windows use MuseScore's real settings and data folders, "
      + "so they only run in CI. Unset MUSESCORE_APP to skip them.");
  }
}

function locations() {
  return {
    env: {},
    appData: path.join(process.env.LOCALAPPDATA, "MuseScore", "MuseScore4"),
    ini: path.join(process.env.APPDATA, "MuseScore", "MuseScore4.ini"),
    shared: true,
  };
}

function writeSettings(where, settings) {
  fs.mkdirSync(path.dirname(where.ini), { recursive: true });
  fs.writeFileSync(where.ini, ini(settings));
}

// A GUI executable on Windows writes nothing to standard output, so the
// harness reads MuseScore's own log file.
const logsFromStdout = false;

async function start(env) {
  return { env, stop: () => {} };
}

function powershell(args) {
  return spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args],
    { encoding: "utf8", timeout: 60000 });
}

function check(result) {
  if (result.status !== 0) {
    throw new Error(`windows.ps1 failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

function findWindow(name, ctx) {
  return powershell(["-Action", "find", "-ProcessId", String(ctx.pid), "-Title", name]).status === 0;
}

function key(sequence, ctx) {
  check(powershell(["-Action", "key", "-ProcessId", String(ctx.pid), "-Keys", translateKey(sequence).join(",")]));
}

function click(x, y) {
  check(powershell(["-Action", "click", "-X", String(Math.round(x)), "-Y", String(Math.round(y))]));
}

function screenshot(file) {
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
    "-Action", "shot", "-File", file]);
}

module.exports = { defaultApp, translateKey, available, locations, writeSettings, logsFromStdout, start, findWindow, key, click, screenshot };
