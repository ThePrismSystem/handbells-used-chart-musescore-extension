"use strict";

// Linux: MuseScore runs on a virtual display of its own, kept apart from the
// developer's settings by the XDG variables, and xdotool presses its keys and
// buttons.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const defaultApp = path.join(os.homedir(), "Applications", "MuseScore-Studio-4.7.4-x86_64.AppImage");

function onPath(tool) {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function available(app) {
  for (const tool of ["Xvfb", "xdotool"]) {
    if (!onPath(tool)) {
      throw new Error(`${app} is installed but ${tool} is not on the path. `
        + "Install it to run the GUI tests, or move the app away to skip them.");
    }
  }
}

// Where MuseScore will look for its data and settings, and the environment
// that sends it there.
function locations(dir) {
  const data = path.join(dir, "data");
  const config = path.join(dir, "config");
  return {
    env: { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config },
    appData: path.join(data, "MuseScore", "MuseScore4"),
    ini: path.join(config, "MuseScore", "MuseScore4.ini"),
  };
}

function freeDisplay() {
  for (let n = 90; n < 200; n++) {
    if (!fs.existsSync(`/tmp/.X11-unix/X${n}`) && !fs.existsSync(`/tmp/.X${n}-lock`)) return `:${n}`;
  }
  throw new Error("No free X display between :90 and :199");
}

async function start(env, until) {
  const display = freeDisplay();
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1920x1080x24"], { stdio: "ignore" });
  try {
    await until("the virtual display", () => fs.existsSync(`/tmp/.X11-unix/X${display.slice(1)}`), 10000);
  } catch (err) {
    xvfb.kill("SIGKILL");
    throw err;
  }
  return { env: { ...env, DISPLAY: display }, stop: () => xvfb.kill("SIGKILL") };
}

const xdotool = (ctx, ...args) => execFileSync("xdotool", args, { env: ctx.env, encoding: "utf8" });

function findWindow(name, ctx) {
  try {
    return xdotool(ctx, "search", "--name", name).trim();
  } catch {
    return null;
  }
}

function key(sequence, ctx) {
  xdotool(ctx, "key", "--clearmodifiers", sequence);
}

function click(x, y, ctx) {
  xdotool(ctx, "mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1");
}

function screenshot(file, ctx) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab",
    "-video_size", "1920x1080", "-i", ctx.env.DISPLAY, "-frames:v", "1", file], { env: ctx.env });
}

module.exports = { defaultApp, available, locations, start, findWindow, key, click, screenshot };
