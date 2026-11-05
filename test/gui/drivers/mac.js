"use strict";

// macOS: keys go through System Events and clicks through Core Graphics, from
// mac-drive.js under osascript, on the desktop session GitHub's macOS runners
// have. MuseScore reads its settings and data from the real user folders, so
// these tests only run in CI, where the runner is thrown away afterwards.

const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "mac-drive.js");

const defaultApp = null;

// Qt on macOS reads a shortcut's Ctrl as Command and Alt as Option.
const MODIFIERS = { ctrl: "command down", alt: "option down", shift: "shift down" };
const KEY_CODES = { escape: 53, return: 36, enter: 36, tab: 48 };

// "ctrl+s" as what System Events presses: a character or a key code, and the
// modifiers held down with it.
function translateKey(sequence) {
  const parts = sequence.split("+");
  const last = parts.pop().toLowerCase();
  const using = parts.map((part) => {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new Error(`No modifier "${part}" in ${sequence}`);
    return modifier;
  });
  if (last in KEY_CODES) return { keyCode: KEY_CODES[last], using };
  if (/^[a-z0-9]$/.test(last)) return { key: last, using };
  throw new Error(`No key for "${last}" in ${sequence}`);
}

function available() {
  if (process.env.CI !== "true") {
    throw new Error("The dialog tests on macOS use MuseScore's real settings and data folders, "
      + "so they only run in CI. Unset MUSESCORE_APP to skip them.");
  }
}

function locations() {
  const library = path.join(os.homedir(), "Library");
  return {
    env: {},
    appData: path.join(library, "Application Support", "MuseScore", "MuseScore4"),
    ini: path.join(library, "Preferences", "MuseScore", "MuseScore4.ini"),
    shared: true,
  };
}

async function start(env) {
  return { env, stop: () => {} };
}

function drive(...args) {
  const result = spawnSync("osascript", ["-l", "JavaScript", SCRIPT, ...args], { encoding: "utf8", timeout: 60000 });
  if (result.status !== 0) throw new Error(`mac-drive.js ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function findWindow(name, ctx) {
  return drive("find", String(ctx.pid), name) === "yes";
}

function key(sequence, ctx) {
  drive("key", String(ctx.pid), JSON.stringify(translateKey(sequence)));
}

function click(x, y) {
  drive("click", String(Math.round(x)), String(Math.round(y)));
}

function screenshot(file) {
  execFileSync("screencapture", ["-x", file]);
}

module.exports = { defaultApp, translateKey, available, locations, start, findWindow, key, click, screenshot };
