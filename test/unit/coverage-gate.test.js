const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseLcov, matches, measure } = require("../../tools/coverage-gate.js");

const GATE = path.join(__dirname, "..", "..", "tools", "coverage-gate.js");

// One lcov record per file, each line given as [number, hits].
function lcov(files) {
  return Object.entries(files)
    .map(([file, lines]) => [`SF:${file}`, ...lines.map(([n, hits]) => `DA:${n},${hits}`), "end_of_record"].join("\n"))
    .join("\n") + "\n";
}

// The real path, because the gate measures from its working directory and
// macOS's temporary directory is reached through a symlink.
function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hbgate-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gate(cwd, ...args) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8" });
}

test("parseLcov keys each line by its file relative to the root, in POSIX form", () => {
  const root = path.join(os.tmpdir(), "repo");
  const text = lcov({ [path.join(root, "tools", "a.js")]: [[1, 2], [2, 0]] });
  assert.deepStrictEqual([...parseLcov(text, root)], [["tools/a.js:1", true], ["tools/a.js:2", false]]);
});

test("parseLcov turns a Windows path into a POSIX one", () => {
  const text = lcov({ "handbells-used-chart\\main.js": [[3, 1]] });
  assert.deepStrictEqual([...parseLcov(text, process.cwd())], [["handbells-used-chart/main.js:3", true]]);
});

test("a line hit in either of two reports counts as covered", () => {
  const dir = path.join(os.tmpdir(), "repo");
  const first = lcov({ [path.join(dir, "a.js")]: [[1, 0], [2, 0]] });
  const second = lcov({ [path.join(dir, "a.js")]: [[1, 4], [2, 0]] });
  assert.deepStrictEqual(measure([first, second], dir, [], []), { covered: 1, found: 2 });
});

test("a single star stays within one directory", () => {
  assert.strictEqual(matches("handbells-used-chart/main.js", ["handbells-used-chart/*.js"], []), true);
  assert.strictEqual(matches("handbells-used-chart/lib/plan.js", ["handbells-used-chart/*.js"], []), false);
});

test("a double star crosses directories", () => {
  assert.strictEqual(matches("handbells-used-chart/lib/plan.js", ["handbells-used-chart/**"], []), true);
  assert.strictEqual(matches("tools/a.js", ["handbells-used-chart/**"], []), false);
});

test("an exclude wins over an include", () => {
  assert.strictEqual(matches("handbells-used-chart/bundle.js", ["handbells-used-chart/*.js"],
    ["handbells-used-chart/bundle.js"]), false);
});

test("with no include every file counts", () => {
  assert.strictEqual(matches("anything/at/all.js", [], []), true);
});

test("the gate passes at the floor", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "r.info"), lcov({ [path.join(dir, "a.js")]: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 0]] }));
  const run = gate(dir, "fast", "r.info");
  assert.strictEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /fast: 4\/5 lines, 80(\.0+)?%/);
});

test("the gate fails under the floor", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "r.info"), lcov({ [path.join(dir, "a.js")]: [[1, 1], [2, 1], [3, 1], [4, 0], [5, 0]] }));
  const run = gate(dir, "fast", "r.info");
  assert.strictEqual(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /fast: 3\/5 lines, 60(\.0+)?%/);
});

// An include that matches nothing is a broken setup, not perfect coverage.
test("the gate refuses when nothing matches", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "r.info"), lcov({ [path.join(dir, "a.js")]: [[1, 1]] }));
  const run = gate(dir, "extension", "r.info", "--include", "handbells-used-chart/*.js");
  assert.strictEqual(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout + run.stderr, /extension: no lines to measure/);
});

test("the gate refuses when a report is missing, and names it", (t) => {
  const dir = tempDir(t);
  const run = gate(dir, "fast", "nowhere.info");
  assert.strictEqual(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout + run.stderr, /nowhere\.info/);
});

test("the gate applies --include and --exclude", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "r.info"), lcov({
    [path.join(dir, "handbells-used-chart", "main.js")]: [[1, 1]],
    [path.join(dir, "handbells-used-chart", "bundle.js")]: [[1, 0], [2, 0], [3, 0]],
    [path.join(dir, "tools", "x.js")]: [[1, 0]],
  }));
  const run = gate(dir, "extension", "r.info", "--include", "handbells-used-chart/*.js",
    "--exclude", "handbells-used-chart/bundle.js");
  assert.strictEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /extension: 1\/1 lines, 100/);
});
