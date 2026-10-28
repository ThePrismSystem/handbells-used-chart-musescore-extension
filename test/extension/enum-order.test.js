const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installProbe, runJob, makeScore, fixture,
} = require("./harness.js");
const { ELEMENT_TYPES } = require("../../handbells-used-chart/engraving.js");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1] : null;
}

// The extension runs at apiversion 2, which cannot read these numbers, so it
// carries them. Checked here against the MuseScore the suite runs, through a
// probe at apiversion 1, which can.
test("the extension's element numbers are the running MuseScore's", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-enum-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const probe = installProbe("enum-order");
  t.after(probe.remove);

  const pairs = Object.entries(ELEMENT_TYPES).map(([name, value]) => `${name}=${value}`);
  assert.ok(pairs.length >= 5, "the precondition: the table holds several types");

  const input = makeScore(dir, fixture("two-staff-handbells.mscx"), { probeNames: pairs.join(",") });
  const { text } = runJob(probe.uri, input, path.join(dir, "out.mscz"));
  assert.strictEqual(tag(text, "probeChecked"), String(pairs.length), "the probe ran");
  assert.strictEqual(tag(text, "probeResult"), "ok");
});
