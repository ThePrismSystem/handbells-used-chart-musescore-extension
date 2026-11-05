#!/usr/bin/env node
"use strict";

// Runs the project's linters and security scanners over the files git tracks.
//
//   node tools/lint.js                     every tool that is installed; a missing one is skipped
//   node tools/lint.js --only eslint,pssa  just those
//   node tools/lint.js --strict            a missing tool fails the run (CI uses this)
//   node tools/lint.js --sarif DIR         the security tools also write SARIF files to DIR
//
// Only files in git's index are checked, so a new file is left out until it
// is added, and ignored files are always left out.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function tracked(patterns, cwd = ROOT) {
  const out = spawnSync("git", ["ls-files", "-z", "--", ...patterns], { cwd, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split("\0").filter(Boolean).sort();
}

// The project's node_modules/.bin first, where npm puts ESLint, then the PATH.
function findExe(name) {
  const dirs = [path.join(ROOT, "node_modules", ".bin"), ...(process.env.PATH || "").split(path.delimiter)];
  const suffixes = process.platform === "win32" ? ["", ...(process.env.PATHEXT || ".EXE;.CMD").split(";")] : [""];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

function run(exe, args, options = {}) {
  // A .cmd shim (ESLint on Windows) only runs through a shell.
  return spawnSync(exe, args, { cwd: ROOT, stdio: "inherit", shell: /\.cmd$/i.test(exe), ...options });
}

function eslint(exe) {
  const files = tracked(["*.js", "*.mjs"]);
  return run(exe, ["--max-warnings", "0", "--no-warn-ignored", ...files]).status === 0;
}

function zizmor(exe, sarifDir) {
  const files = tracked([".github/workflows/*.yml", ".github/actions/*/action.yml"]);
  const clean = run(exe, files).status === 0;
  if (sarifDir) {
    const sarif = run(exe, ["--format", "sarif", ...files], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    fs.writeFileSync(path.join(sarifDir, "zizmor.sarif"), sarif.stdout);
  }
  return clean;
}

function gitleaks(exe, sarifDir) {
  const args = ["git", "--redact", "--no-banner", "--exit-code", "1"];
  if (sarifDir) args.push("--report-format", "sarif", "--report-path", path.join(sarifDir, "gitleaks.sarif"));
  return run(exe, [...args, ROOT]).status === 0;
}

const PSSA_LEVELS = { 0: "note", 1: "warning", 2: "error", 3: "error" };

function pssaToSarif(records) {
  const results = records.map((r) => ({
    ruleId: r.RuleName,
    level: PSSA_LEVELS[r.Severity] || "warning",
    message: { text: r.Message || r.RuleName },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: path.relative(ROOT, r.ScriptPath).split(path.sep).join("/") },
      region: { startLine: r.Line || 1, startColumn: r.Column || 1 },
    } }],
  }));
  const rules = [...new Set(records.map((r) => r.RuleName))].sort().map((id) => ({ id }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{ tool: { driver: { name: "PSScriptAnalyzer", informationUri: "https://github.com/PowerShell/PSScriptAnalyzer", rules } }, results }],
  };
}

// PSScriptAnalyzer's findings over the tracked PowerShell, as JSON. With
// nothing to check there is nothing to run.
function pssa(exe, sarifDir) {
  const files = tracked(["*.ps1"]);
  let records = [];
  if (files.length > 0) {
    const list = files.map((file) => `'${path.join(ROOT, file).replace(/'/g, "''")}'`).join(",");
    const script = `$ErrorActionPreference = 'Stop'; @(${list} | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ }) `
      + "| Select-Object RuleName, Severity, Message, ScriptPath, Line, Column | ConvertTo-Json -AsArray -Depth 3";
    const out = run(exe, ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    if (out.status !== 0) return false;
    records = out.stdout.trim() ? JSON.parse(out.stdout) : [];
    for (const r of records) {
      console.log(`${path.relative(ROOT, r.ScriptPath)}:${r.Line}:${r.Column} ${r.RuleName} ${r.Message}`);
    }
  }
  if (sarifDir) fs.writeFileSync(path.join(sarifDir, "pssa.sarif"), JSON.stringify(pssaToSarif(records), null, 1));
  return records.length === 0;
}

const TOOLS = [
  { name: "eslint", exe: ["eslint"], install: "Run npm ci.", run: eslint },
  { name: "zizmor", exe: ["zizmor"], install: "pipx install zizmor (lint.yml has the version).", run: zizmor },
  { name: "gitleaks", exe: ["gitleaks"], install: "Get it from https://github.com/gitleaks/gitleaks/releases (lint.yml has the version).", run: gitleaks },
  { name: "pssa", exe: ["pwsh", "powershell"], install: "Install PowerShell, then Install-Module PSScriptAnalyzer (lint.yml has the version).", run: pssa },
];

function runTool(tool, strict, sarifDir) {
  const exe = tool.exe.map(findExe).find(Boolean);
  if (!exe) {
    const status = strict ? "FAIL" : "SKIP";
    console.log(`${status}  ${tool.name}: ${tool.exe.join(" or ")} not found. ${tool.install}`);
    return status;
  }
  const status = tool.run(exe, sarifDir) ? "PASS" : "FAIL";
  console.log(`${status}  ${tool.name}`);
  return status;
}

function main(argv, tools = TOOLS) {
  let strict = false;
  let sarifDir = null;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--strict") strict = true;
    else if (argv[i] === "--sarif") sarifDir = path.resolve(argv[++i]);
    else if (argv[i] === "--only") only = argv[++i].split(",");
    else {
      console.log(`unknown argument: ${argv[i]}`);
      return 2;
    }
  }
  if (only) {
    const unknown = only.filter((name) => !tools.some((tool) => tool.name === name));
    if (unknown.length > 0) {
      console.log(`unknown tool: ${unknown.join(", ")}`);
      return 2;
    }
  }
  if (sarifDir) fs.mkdirSync(sarifDir, { recursive: true });
  const chosen = only ? tools.filter((tool) => only.includes(tool.name)) : tools;
  const results = chosen.map((tool) => runTool(tool, strict, sarifDir));
  if (results.includes("FAIL")) {
    console.log("SOME FAILED");
    return 1;
  }
  const skipped = results.filter((result) => result === "SKIP").length;
  console.log(`ALL PASS${skipped ? ` (${skipped} skipped)` : ""}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { tracked, main, TOOLS };
