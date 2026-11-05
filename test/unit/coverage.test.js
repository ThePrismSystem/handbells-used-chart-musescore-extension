const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { wrapEntry, takeCoverage, instrumentExtension } = require("../extension/coverage.js");
const { buildMap, writeLcov } = require("../extension/coverage-report.js");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A score that records what is called on it, in order.
function recordingScore() {
  const calls = [];
  return {
    calls,
    startCmd: () => calls.push(["startCmd"]),
    endCmd: () => calls.push(["endCmd"]),
    setMetaTag: (name, value) => calls.push(["setMetaTag", name, value]),
  };
}

function runWrapped(source) {
  const score = recordingScore();
  const counts = {
    "handbells-used-chart/main.js": { path: "x", statementMap: { 0: {} }, fnMap: {}, branchMap: {}, s: { 0: 3 }, f: { 0: 1 }, b: { 0: [1, 0] } },
  };
  const context = vm.createContext({ api: { engraving: { curScore: score } }, __hbucCoverage__: counts });
  vm.runInContext(wrapEntry(source), context);
  let error = null;
  try {
    vm.runInContext("main()", context);
  } catch (err) {
    error = err;
  }
  return { score, error };
}

test("a wrapped main still throws, and its counts are written into the score first", () => {
  const { score, error } = runWrapped("function main() {\n    throw new Error(\"boom\");\n}\n");
  assert.ok(error && /boom/.test(error.message), "main's own error reaches the caller");
  assert.deepStrictEqual(score.calls.map((call) => call[0]), ["startCmd", "setMetaTag", "endCmd"]);
  assert.strictEqual(score.calls[1][1], "handbellChartCoverage");
  // Only the counts travel. The maps are rebuilt from the skeleton.
  assert.deepStrictEqual(JSON.parse(score.calls[1][2]), {
    "handbells-used-chart/main.js": { s: { 0: 3 }, f: { 0: 1 }, b: { 0: [1, 0] } },
  });
});

test("a wrapped main that returns normally writes its counts too", () => {
  const { score, error } = runWrapped("function main() {\n    return 1;\n}\n");
  assert.strictEqual(error, null);
  assert.strictEqual(score.calls.filter((call) => call[0] === "setMetaTag").length, 1);
});

test("an entry point without main() is refused", () => {
  assert.throws(() => wrapEntry("var x = 1;\n"), /function main\(\)/);
});

test("takeCoverage removes the coverage metaTag and returns its counts", () => {
  const hits = { "handbells-used-chart/run.js": { s: { 0: 1 }, f: {}, b: {} } };
  const escaped = JSON.stringify(hits).replace(/"/g, "&quot;");
  const text = "<Score>\n    <metaTag name=\"handbellChartRan\">3</metaTag>\n"
    + `    <metaTag name="handbellChartCoverage">${escaped}</metaTag>\n</Score>\n`;
  const taken = takeCoverage(text);
  assert.deepStrictEqual(taken.hits, hits);
  assert.match(taken.text, /<metaTag name="handbellChartRan">3<\/metaTag>/);
  assert.doesNotMatch(taken.text, /handbellChartCoverage/);
});

test("takeCoverage leaves a score without the metaTag alone", () => {
  const text = "<Score>\n    <metaTag name=\"handbellChartRan\">3</metaTag>\n</Score>\n";
  assert.deepStrictEqual(takeCoverage(text), { text, hits: null });
});

test("instrumentExtension counts the scripts MuseScore loads and copies the rest", (t) => {
  const root = tempDir(t, "hbinst-");
  const source = path.join(root, "handbells-used-chart");
  fs.mkdirSync(path.join(source, "lib"), { recursive: true });
  fs.writeFileSync(path.join(source, "main.js"), "var lib = require(\"./lib/x.js\");\nfunction main() {\n    lib.go();\n}\n");
  fs.writeFileSync(path.join(source, "lib", "x.js"), "function go() {\n    return 1;\n}\nmodule.exports = { go: go };\n");
  fs.writeFileSync(path.join(source, "form.js"), "var form = 1;\n");
  fs.writeFileSync(path.join(source, "bundle.js"), "var bundle = 1;\n");
  fs.writeFileSync(path.join(source, "manifest.json"), "{}\n");
  const target = path.join(root, "installed");
  const coverageDir = path.join(root, "coverage");

  instrumentExtension(source, target, coverageDir);

  for (const plain of ["form.js", "bundle.js", "manifest.json"]) {
    assert.strictEqual(fs.readFileSync(path.join(target, plain), "utf8"),
      fs.readFileSync(path.join(source, plain), "utf8"), `${plain} is copied as it is`);
  }
  const main = fs.readFileSync(path.join(target, "main.js"), "utf8");
  assert.match(main, /__hbucCoverage__/);
  assert.match(main, /function hbucMeasuredMain\(\)/);
  assert.match(fs.readFileSync(path.join(target, "lib", "x.js"), "utf8"), /__hbucCoverage__/);
  const skeleton = JSON.parse(fs.readFileSync(path.join(coverageDir, "skeleton.json"), "utf8"));
  assert.deepStrictEqual(Object.keys(skeleton).sort(),
    ["handbells-used-chart/lib/x.js", "handbells-used-chart/main.js"]);
});

// A skeleton for one file with two statements, one function and one branch.
function skeletonFor(file) {
  const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } };
  const loc2 = { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } };
  return {
    [file]: {
      path: file,
      statementMap: { 0: loc, 1: loc2 },
      fnMap: { 0: { name: "f", decl: loc, loc, line: 1 } },
      branchMap: { 0: { type: "if", loc, locations: [loc, loc], line: 1 } },
      s: { 0: 0, 1: 0 }, f: { 0: 0 }, b: { 0: [0, 0] },
    },
  };
}

test("buildMap adds the counts of every run onto the skeleton", () => {
  const file = "handbells-used-chart/run.js";
  const map = buildMap(skeletonFor(file), [
    { [file]: { s: { 0: 1, 1: 0 }, f: { 0: 1 }, b: { 0: [1, 0] } } },
    { [file]: { s: { 0: 2, 1: 0 }, f: { 0: 0 }, b: { 0: [0, 0] } } },
  ]);
  const data = map.fileCoverageFor(file).data;
  assert.deepStrictEqual(data.s, { 0: 3, 1: 0 });
  assert.deepStrictEqual(data.f, { 0: 1 });
});

test("a file no run reached still appears, uncovered", () => {
  const map = buildMap(skeletonFor("handbells-used-chart/remove.js"), []);
  assert.deepStrictEqual(map.files(), ["handbells-used-chart/remove.js"]);
});

test("the lcov names files by repo-relative POSIX paths, whatever the counts were keyed by", (t) => {
  const out = tempDir(t, "hbreport-");
  const map = buildMap(skeletonFor("handbells-used-chart\\main.js"),
    [{ "handbells-used-chart\\main.js": { s: { 0: 1, 1: 1 }, f: { 0: 1 }, b: { 0: [1, 1] } } }]);
  writeLcov(map, out);
  const lcov = fs.readFileSync(path.join(out, "lcov.info"), "utf8");
  assert.match(lcov, /^SF:handbells-used-chart\/main\.js$/m);
  assert.doesNotMatch(lcov, /\\/);
});

// The instrumented copy lives in the developer's real MuseScore, where its
// main() would write the coverage tag into their own scores. An interrupted
// run puts the plain extension back too.
for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`the plain extension is put back when the run is stopped with ${signal}`,
    { skip: process.platform === "win32" && "Windows cannot send a process a signal it can catch" }, (t) => {
      const dir = tempDir(t, "hbcov-signal-");
      const source = path.join(dir, "source");
      const target = path.join(dir, "target");
      fs.mkdirSync(source);
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(source, "main.js"), "plain");
      fs.writeFileSync(path.join(target, "main.js"), "instrumented");
      const coverage = path.join(__dirname, "..", "extension", "coverage.js");
      const out = spawnSync(process.execPath, ["-e", `
        require(${JSON.stringify(coverage)}).restoreOnExit(${JSON.stringify(source)}, ${JSON.stringify(target)});
        setTimeout(() => {}, 10000);
        process.kill(process.pid, ${JSON.stringify(signal)});
      `], { encoding: "utf8", timeout: 20000 });
      assert.strictEqual(fs.readFileSync(path.join(target, "main.js"), "utf8"), "plain", out.stderr);
      assert.notStrictEqual(out.status, 0, "the run still ends as stopped");
    });
}

test("the plain extension is put back when the run ends normally", (t) => {
  const dir = tempDir(t, "hbcov-exit-");
  const source = path.join(dir, "source");
  const target = path.join(dir, "target");
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, "main.js"), "plain");
  fs.writeFileSync(path.join(target, "main.js"), "instrumented");
  const coverage = path.join(__dirname, "..", "extension", "coverage.js");
  const out = spawnSync(process.execPath, ["-e",
    `require(${JSON.stringify(coverage)}).restoreOnExit(${JSON.stringify(source)}, ${JSON.stringify(target)});`],
  { encoding: "utf8" });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.strictEqual(fs.readFileSync(path.join(target, "main.js"), "utf8"), "plain");
});
