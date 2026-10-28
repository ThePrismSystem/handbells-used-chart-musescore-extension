const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generate } = require("../../tools/bundle.js");

const BUNDLE = path.join(__dirname, "..", "..", "handbells-used-chart", "bundle.js");

// The dialog loads the committed bundle, not the files it is made from, so a
// change to lib/ that was never bundled would ship to the dialog stale.
test("the committed bundle is up to date", () => {
  assert.ok(generate() === fs.readFileSync(BUNDLE, "utf8"),
    "handbells-used-chart/bundle.js is stale. Run: npm run bundle");
});

// QML imports the bundle as a plain script, with no require of its own. Run
// it the same way, in a context holding nothing but what QML would give it.
test("the bundle runs with no module system and finds its own modules", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(BUNDLE, "utf8"), context);
  const lists = vm.runInContext("lists()", context);
  assert.strictEqual(lists.naturalNotes[49], "C9");
  for (const name of ["setup", "settings", "facts", "build", "remove", "lists"]) {
    assert.strictEqual(vm.runInContext(`typeof ${name}`, context), "function", name);
  }
});
