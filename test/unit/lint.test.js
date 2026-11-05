const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { tracked, main, TOOLS } = require("../../tools/lint.js");

function quietly(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { status: fn(), output: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

const absent = { name: "absent", exe: ["hbuc-no-such-tool-anywhere"], install: "Install it.", run: () => true };
const failing = { name: "failing", exe: [path.basename(process.execPath, ".exe")], install: "", run: () => false };
const passing = { name: "passing", exe: [path.basename(process.execPath, ".exe")], install: "", run: () => true };

test("tracked lists only the files git tracks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hblint-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "kept.js"), "");
  fs.writeFileSync(path.join(dir, "new.js"), "");
  execFileSync("git", ["add", "kept.js"], { cwd: dir });
  assert.deepStrictEqual(tracked(["*.js"], dir), ["kept.js"]);
});

test("the project's linters are eslint, zizmor, gitleaks and pssa", () => {
  assert.deepStrictEqual(TOOLS.map((tool) => tool.name), ["eslint", "zizmor", "gitleaks", "pssa"]);
});

test("an unknown tool name is refused by name", () => {
  const { status, output } = quietly(() => main(["--only", "nosuch"], [passing]));
  assert.strictEqual(status, 2);
  assert.match(output, /unknown tool: nosuch/);
});

test("a tool that is not installed is skipped", () => {
  const { status, output } = quietly(() => main([], [absent, passing]));
  assert.strictEqual(status, 0);
  assert.match(output, /SKIP {2}absent: hbuc-no-such-tool-anywhere not found\. Install it\./);
  assert.match(output, /ALL PASS \(1 skipped\)/);
});

test("under --strict a tool that is not installed fails the run", () => {
  const { status, output } = quietly(() => main(["--strict"], [absent, passing]));
  assert.strictEqual(status, 1);
  assert.match(output, /FAIL {2}absent/);
});

test("a tool that finds something fails the run", () => {
  const { status, output } = quietly(() => main([], [failing, passing]));
  assert.strictEqual(status, 1);
  assert.match(output, /FAIL {2}failing/);
  assert.match(output, /PASS {2}passing/);
});

test("--only runs just the tools it names", () => {
  const { status, output } = quietly(() => main(["--only", "passing"], [failing, passing]));
  assert.strictEqual(status, 0);
  assert.doesNotMatch(output, /failing/);
});
