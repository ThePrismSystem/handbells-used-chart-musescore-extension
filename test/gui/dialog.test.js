const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { guiAvailable, withMuseScore, buttons, until } = require("./harness.js");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore, fixture,
} = require("../extension/harness.js");

const FIXTURE = fixture("two-staff-handbells.mscx");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1] : null;
}

function partCount(text) {
  return (text.match(/<Part id="\d+">/g) || []).length;
}

// Ctrl+S writes the file in place. Done when the file on disk carries the
// chart's report.
async function saved(handle, file) {
  handle.save();
  return until("the score to be saved", () => {
    try {
      const text = mainScore(file);
      return tag(text, "handbellChartReport") ? text : null;
    } catch {
      return null;
    }
  }, 30000);
}

test("the dialog opens, builds the chart and saves its settings into the score", async (t) => {
  if (!guiAvailable()) return t.skip("MuseScore desktop app not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-dialog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // C#5 is a range the dropdowns do not offer, since they list naturals only.
  // The chime label and the P&F notehead are read back out of the dialog's
  // rows. A row showing another row's label, or the first notehead on its
  // list, would save that over the stored field.
  const score = makeScore(dir, FIXTURE, {
    handbellChartRequiredBellFirst: "C#5",
    handbellChartChimeLabel: "Chimes here",
    handbellChartPfHead: "cross",
  });
  const own = partCount(fs.readFileSync(FIXTURE, "utf8"));

  let log = "";
  await withMuseScore({ score }, async (handle) => {
    handle.openDialog();
    const at = await buttons(handle, "Handbells Used Chart options ready");
    // Shared staff, so the saved score shows the dialog's own setting at work
    // rather than the default.
    handle.click(at.sharedStaff.x, at.sharedStaff.y);
    handle.click(at.build.x, at.build.y);
    await handle.waitForLog(/Handbells Used Chart \[info\] Handbells Used: 3/);
    await saved(handle, score);
    log = handle.log();
  });

  assert.doesNotMatch(log, /Handbells Used Chart options fallback/, "the dialog body loaded");
  assert.doesNotMatch(log, /Failed to load QML|is not a type|is not installed/);

  const text = mainScore(score);
  assert.strictEqual(tag(text, "handbellChartSharedStaff"), "yes", "the dialog saved its setting");
  assert.strictEqual(tag(text, "handbellChartRequiredBellFirst"), "C#5",
    "a value the dialog cannot offer is kept, not replaced");
  assert.strictEqual(tag(text, "handbellChartPfHead"), "cross", "a row kept its notehead");
  assert.strictEqual(tag(text, "handbellChartReport"), "Handbells Used: 3\nChimes here");
  assert.strictEqual(partCount(text), own + 1, "every chart shares one appended staff");
  assert.match(text, /<SystemText>/, "the labels are system text");

  // Run from Project Properties on what the dialog saved: the dialog's chart
  // is found and replaced by the same chart.
  if (!museScoreAvailable()) return;
  installExtension();
  const again = path.join(dir, "again.mscz");
  runExtension(score, again, "run");
  const rerun = mainScore(again);
  assert.strictEqual(tag(rerun, "handbellChartReport"),
    "Handbells Used: 3\nChimes here\n\nAn existing chart was replaced.");
  assert.strictEqual(partCount(rerun), own + 1);
});

// The Charts dropdown offers two modes. A stored mode it cannot show has to
// reach the build as stored, so the build refuses it by name, rather than
// being swapped for the first entry and saved over.
test("a stored mode the dialog cannot show is refused by name, not replaced", async (t) => {
  if (!guiAvailable()) return t.skip("MuseScore desktop app not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-mode-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const score = makeScore(dir, FIXTURE, { handbellChartMode: "separat" });

  let outcome = null;
  await withMuseScore({ score }, async (handle) => {
    handle.openDialog();
    const at = await buttons(handle, "Handbells Used Chart options ready");
    handle.click(at.build.x, at.build.y);
    // MuseScore's log escapes the quotes inside a message.
    outcome = await handle.waitForLog(
      /Handbells Used Chart \[(error|info)\] (handbellChartMode is \\"separat|Handbells Used: \d+)/);
  });
  assert.strictEqual(outcome[1], "error", `the build ran instead: ${outcome[0]}`);
});

// The dialog closes its own window. Closed that way, it has to open again.
test("Close closes the dialog, and it opens again", async (t) => {
  if (!guiAvailable()) return t.skip("MuseScore desktop app not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-close-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const score = makeScore(dir, FIXTURE);

  await withMuseScore({ score }, async (handle) => {
    handle.openDialog();
    const at = await buttons(handle, "Handbells Used Chart options ready");
    handle.click(at.close.x, at.close.y);
    await handle.waitForLog(/Handbells Used Chart options closed/);
    handle.openDialog();
    await until("the dialog to open a second time", () =>
      (handle.log().match(/Handbells Used Chart options ready/g) || []).length === 2, 30000);
  });
});
