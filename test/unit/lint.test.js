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

// A stand-in for a linter: it records the arguments it was run with, prints
// HBUC_FAKE_STDOUT, writes "{}" to any --report-path, and exits with
// HBUC_FAKE_STATUS. Windows runs it through a .cmd, as npm's shims are.
function fakeTool(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbfake-"));
  const record = path.join(dir, "calls.jsonl");
  fs.writeFileSync(path.join(dir, "fake.js"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + "\\n");
const report = args.indexOf("--report-path");
if (report >= 0) fs.writeFileSync(args[report + 1], "{}");
process.stdout.write(process.env.HBUC_FAKE_STDOUT || "");
process.exitCode = Number(process.env.HBUC_FAKE_STATUS || 0);
`);
  let exe;
  if (process.platform === "win32") {
    exe = path.join(dir, "fake.cmd");
    fs.writeFileSync(exe, `@"${process.execPath}" "%~dp0fake.js" %*\r\n`);
  } else {
    exe = path.join(dir, "fake");
    fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, "fake.js")}" "$@"\n`);
    fs.chmodSync(exe, 0o755);
  }
  const saved = { stdout: process.env.HBUC_FAKE_STDOUT, status: process.env.HBUC_FAKE_STATUS };
  t.after(() => {
    for (const [key, value] of [["HBUC_FAKE_STDOUT", saved.stdout], ["HBUC_FAKE_STATUS", saved.status]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const calls = () => fs.existsSync(record)
    ? fs.readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { exe, dir, calls };
}

const tool = (name) => TOOLS.find((each) => each.name === name).run;

test("eslint checks every tracked script and allows no warnings", (t) => {
  const fake = fakeTool(t);
  assert.strictEqual(tool("eslint")(fake.exe), true);
  const [args] = fake.calls();
  assert.deepStrictEqual(args.slice(0, 3), ["--max-warnings", "0", "--no-warn-ignored"]);
  assert.ok(args.includes("tools/lint.js"), "a tracked script is checked");
  assert.ok(args.includes("eslint.config.mjs"), "the .mjs config is checked");
});

test("eslint fails when it finds something", (t) => {
  const fake = fakeTool(t);
  process.env.HBUC_FAKE_STATUS = "1";
  assert.strictEqual(tool("eslint")(fake.exe), false);
});

test("zizmor checks the workflows and the install action, and writes its SARIF", (t) => {
  const fake = fakeTool(t);
  process.env.HBUC_FAKE_STDOUT = "{\"runs\":[]}";
  assert.strictEqual(tool("zizmor")(fake.exe, fake.dir), true);
  const [plain, sarif] = fake.calls();
  assert.ok(plain.includes(".github/workflows/test.yml"));
  assert.ok(plain.includes(".github/actions/install-musescore/action.yml"));
  assert.deepStrictEqual(sarif.slice(0, 2), ["--format", "sarif"]);
  assert.strictEqual(fs.readFileSync(path.join(fake.dir, "zizmor.sarif"), "utf8"), "{\"runs\":[]}");
});

test("gitleaks scans the history and reports into the SARIF folder", (t) => {
  const fake = fakeTool(t);
  assert.strictEqual(tool("gitleaks")(fake.exe, fake.dir), true);
  const [args] = fake.calls();
  assert.deepStrictEqual(args.slice(0, 5), ["git", "--redact", "--no-banner", "--exit-code", "1"]);
  assert.ok(fs.existsSync(path.join(fake.dir, "gitleaks.sarif")));
});

test("PSScriptAnalyzer's findings fail the run and become SARIF", (t) => {
  const fake = fakeTool(t);
  const script = path.join(__dirname, "..", "gui", "drivers", "windows.ps1");
  process.env.HBUC_FAKE_STDOUT = JSON.stringify([
    { RuleName: "PSAvoidUsingWriteHost", Severity: 1, Message: "Avoid Write-Host", ScriptPath: script, Line: 4, Column: 2 },
  ]);
  const { status } = quietly(() => tool("pssa")(fake.exe, fake.dir));
  assert.strictEqual(status, false);
  const [args] = fake.calls();
  assert.match(args.at(-1), /Invoke-ScriptAnalyzer/);
  const sarif = JSON.parse(fs.readFileSync(path.join(fake.dir, "pssa.sarif"), "utf8"));
  const [result] = sarif.runs[0].results;
  assert.strictEqual(result.ruleId, "PSAvoidUsingWriteHost");
  assert.strictEqual(result.level, "warning");
  assert.strictEqual(result.locations[0].physicalLocation.artifactLocation.uri, "test/gui/drivers/windows.ps1");
  assert.deepStrictEqual(result.locations[0].physicalLocation.region, { startLine: 4, startColumn: 2 });
});

test("PSScriptAnalyzer with no findings passes and still writes SARIF", (t) => {
  const fake = fakeTool(t);
  assert.strictEqual(tool("pssa")(fake.exe, fake.dir), true);
  const sarif = JSON.parse(fs.readFileSync(path.join(fake.dir, "pssa.sarif"), "utf8"));
  assert.deepStrictEqual(sarif.runs[0].results, []);
});

test("PSScriptAnalyzer failing to run fails the run", (t) => {
  const fake = fakeTool(t);
  process.env.HBUC_FAKE_STATUS = "1";
  assert.strictEqual(tool("pssa")(fake.exe, null), false);
});

test("--sarif creates its folder, and an unknown argument is refused", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbsarif-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sarif = path.join(dir, "nested", "sarif");
  assert.strictEqual(quietly(() => main(["--sarif", sarif], [passing])).status, 0);
  assert.ok(fs.statSync(sarif).isDirectory());
  const refused = quietly(() => main(["--bogus"], [passing]));
  assert.strictEqual(refused.status, 2);
  assert.match(refused.output, /unknown argument: --bogus/);
});

test("--only runs just the tools it names", () => {
  const { status, output } = quietly(() => main(["--only", "passing"], [failing, passing]));
  assert.strictEqual(status, 0);
  assert.doesNotMatch(output, /failing/);
});
