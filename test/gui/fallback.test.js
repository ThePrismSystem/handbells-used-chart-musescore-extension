const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { guiAvailable, withMuseScore, buttons, until } = require("./harness.js");
const { makeScore, mainScore, fixture } = require("../extension/harness.js");

function tag(text, name) {
  const m = new RegExp(`<metaTag name="${name}">([^<]*)</metaTag>`).exec(text);
  return m ? m[1] : null;
}

// CheckBox is one of the controls that fails to load from MuseApi.Controls in
// MuseScore 4.7, so a dialog body using it stands in for a MuseScore whose
// controls break the real one.
const BROKEN_BODY = `import QtQuick
import MuseApi.Controls

CheckBox {}
`;

test("a dialog body that cannot load falls back to Project Properties", async (t) => {
  if (!guiAvailable()) return t.skip("MuseScore desktop app not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbgui-fallback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const score = makeScore(dir, fixture("two-staff-handbells.mscx"));

  await withMuseScore({
    score,
    extension: (target) => fs.writeFileSync(path.join(target, "OptionsBody.qml"), BROKEN_BODY),
  }, async (handle) => {
    handle.openDialog();
    const at = await buttons(handle, "Handbells Used Chart options fallback");
    handle.click(at.build.x, at.build.y);
    await handle.waitForLog(/Handbells Used Chart \[info\] Handbells Used: 3/);
    handle.save();
    await until("the score to be saved", () => {
      try {
        return tag(mainScore(score), "handbellChartReport");
      } catch {
        return null;
      }
    }, 30000);
  });

  assert.strictEqual(tag(mainScore(score), "handbellChartReport"), "Handbells Used: 3\nHandchimes Used: 1");
});
