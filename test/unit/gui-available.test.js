"use strict";

// When the dialog tests may skip. A missing MuseScore is the only reason, and
// only off CI: in CI, or with MUSESCORE_APP naming a file that is not there,
// a skip would let a broken install report green.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HARNESS = path.join(__dirname, "..", "gui", "harness.js");

// guiAvailable() in a fresh process, whose environment decides APP at load.
function guiAvailable(t, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const clean = { ...process.env, HOME: home, USERPROFILE: home };
  delete clean.CI;
  delete clean.MUSESCORE_APP;
  const out = spawnSync(process.execPath, ["-e",
    `process.stdout.write(String(require(${JSON.stringify(HARNESS)}).guiAvailable()))`],
  { env: { ...clean, ...env }, encoding: "utf8" });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

test("off CI, a missing MuseScore skips the dialog tests", (t) => {
  const result = guiAvailable(t, {});
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, "false");
});

test("in CI, a missing MuseScore fails the dialog tests", (t) => {
  const result = guiAvailable(t, { CI: "true" });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /MuseScore desktop app not found/);
});

test("MUSESCORE_APP naming a file that is not there fails, in CI or not", (t) => {
  const missing = path.join(os.tmpdir(), "hbuc-no-such-musescore");
  const result = guiAvailable(t, { MUSESCORE_APP: missing });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /MUSESCORE_APP/);
  assert.ok(result.stderr.includes(missing), "the message names the path");
});
