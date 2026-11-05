"use strict";

// MuseScore 4.7.4 on Windows and macOS crashes the first time a form uses one
// of the MuseApi objects it imports as a QML singleton, such as `Log` from
// `import MuseApi.Log`. The same objects reached through `api` (api.log,
// api.interactive) work everywhere. Linux survives the import by luck, so only
// the Windows and macOS dialog jobs would notice it coming back.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "..", "handbells-used-chart");
const QML = fs.readdirSync(DIR).filter((name) => name.endsWith(".qml")).sort();

test("the dialog has QML files to check", () => {
  assert.deepStrictEqual(QML, ["Options.qml", "OptionsBody.qml"]);
});

for (const name of QML) {
  test(`${name} imports no MuseApi object as a QML singleton`, () => {
    const text = fs.readFileSync(path.join(DIR, name), "utf8");
    const imports = text.split("\n").map((line) => line.trim())
      .filter((line) => /^import\s+MuseApi\./.test(line));
    assert.deepStrictEqual(imports, ["import MuseApi.Controls"]);
    assert.doesNotMatch(text, /\b(?<!api\.)(Log|Interactive)\.\w+\(/,
      "Log and Interactive are reached through api.log and api.interactive");
  });
}
