const test = require("node:test");
const assert = require("node:assert");
const windows = require("../gui/drivers/windows.js");
const mac = require("../gui/drivers/mac.js");
const { ini } = require("../gui/drivers/settings.js");

const SETTINGS = {
  "application/hasCompletedFirstLaunchSetup": true,
  "application/checkForUpdate": false,
};

// MuseScore keeps its settings in an INI file everywhere but macOS.
test("settings become INI groups", () => {
  assert.strictEqual(ini(SETTINGS),
    "[application]\nhasCompletedFirstLaunchSetup=true\ncheckForUpdate=false\n");
});

// On macOS Qt keeps them in the app's preferences domain, named from the
// organisation domain musescore.org, with each group's slash read as a dot.
test("macOS writes each setting into MuseScore's preferences domain", () => {
  assert.deepStrictEqual(mac.defaultsWrites(SETTINGS), [
    ["write", "org.musescore.MuseScore4", "application.hasCompletedFirstLaunchSetup", "-bool", "true"],
    ["write", "org.musescore.MuseScore4", "application.checkForUpdate", "-bool", "false"],
  ]);
});

test("macOS writes a setting that is text as a string", () => {
  assert.deepStrictEqual(mac.defaultsWrites({ "application/welcomeDialogLastShownVersion": "99.0.0" }), [
    ["write", "org.musescore.MuseScore4", "application.welcomeDialogLastShownVersion", "-string", "99.0.0"],
  ]);
});

// The GUI tests name keys the way xdotool does, and each driver turns that
// into what its platform's input API wants.

test("Windows sends a chord as virtual keys, modifiers first", () => {
  assert.deepStrictEqual(windows.translateKey("ctrl+alt+shift+h"), [0x11, 0x12, 0x10, 0x48]);
  assert.deepStrictEqual(windows.translateKey("ctrl+s"), [0x11, 0x53]);
});

test("Windows sends Escape as its own virtual key", () => {
  assert.deepStrictEqual(windows.translateKey("Escape"), [0x1b]);
});

test("Windows refuses a key it has no code for", () => {
  assert.throws(() => windows.translateKey("ctrl+F13"), /F13/);
});

// Qt on macOS reads a shortcut's Ctrl as Command, so the shortcut file's
// Ctrl+Alt+Shift+H is pressed as Command-Option-Shift-H.
test("macOS presses Ctrl as Command and Alt as Option", () => {
  assert.deepStrictEqual(mac.translateKey("ctrl+alt+shift+h"),
    { key: "h", using: ["command down", "option down", "shift down"] });
  assert.deepStrictEqual(mac.translateKey("ctrl+s"), { key: "s", using: ["command down"] });
});

test("macOS presses Escape by its key code", () => {
  assert.deepStrictEqual(mac.translateKey("Escape"), { keyCode: 53, using: [] });
});

test("macOS refuses a key it has no code for", () => {
  assert.throws(() => mac.translateKey("F13"), /F13/);
});
