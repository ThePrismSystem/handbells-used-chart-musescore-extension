const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, runExtensionToSvg, renderSvg,
  makeScore, mainScore,
} = require("./harness.js");
const { readMscz, writeMscz, replaceMain } = require("../../tools/mscz.js");

function fixture(name) {
  return path.join(__dirname, "..", "fixtures", name);
}

// Both, because they take different routes through dressStaves. The first
// switches hide-empty-staves on; the second is a score that already had it on,
// where the chart's own setValue changes nothing at all.
const FIXTURES = ["two-staff-handbells.mscx", "empty-staves-already-hidden.mscx"];

// Changing a score from a plugin does not lay it out. Every other test in this
// directory reads the file the run saved, and loading a file always lays it out
// from scratch, so all of them pass over a run that left the open score drawn
// as it was before the chart existed, which is what the user is looking at.
// Rendering from inside the run itself is the only way to see that.
function workspace(t) {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(made, { recursive: true, force: true }));
  installExtension();
  return made;
}

// One SVG unit is about a fiftieth of a millimetre here, and laying a score out
// twice moves a glyph outline by a hundredth of one: 4692.51 against 4692.5 on
// the same letter of the same title. So the comparison allows that and nothing
// else: a stale layout puts staff lines hundreds of units apart, four thousand
// times this.
const TOLERANCE = 0.05;
const NUMBER = /-?\d+(?:\.\d+)?/g;

// MuseScore writes the ledger lines of one chord out in a different order the
// second time it lays a score out, the same lines in the same places, listed
// differently. So what is compared is the set of things drawn, not the order
// they were written in. Sorted by shape first, then by coordinate, which pairs
// each element with the one that draws the same thing.
function drawnElements(svg) {
  return svg.split("\n").map((line) => ({
    line: line,
    shape: line.replace(NUMBER, "#"),
    numbers: (line.match(NUMBER) || []).map(Number),
  })).sort((a, b) => {
    if (a.shape !== b.shape) return a.shape < b.shape ? -1 : 1;
    for (let i = 0; i < a.numbers.length; i++) {
      if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
    }
    return 0;
  });
}

function staffLines(svg) {
  return (svg.match(/class="StaffLines"/g) || []).length;
}

// Two whole SVG pages handed to deepStrictEqual print both of them, which is
// 70KB of coordinates either way and says nothing. The first element that
// differs is the part worth reading.
function assertSameDrawing(live, reopened, what) {
  const mine = drawnElements(live);
  const theirs = drawnElements(reopened);
  assert.strictEqual(mine.length, theirs.length,
    `${what}\n  the live drawing has ${mine.length} elements, the reopened one ${theirs.length}`);

  for (let i = 0; i < mine.length; i++) {
    let reason = null;
    if (mine[i].shape !== theirs[i].shape) {
      reason = "a different element is drawn";
    } else {
      for (let n = 0; n < mine[i].numbers.length; n++) {
        if (Math.abs(mine[i].numbers[n] - theirs[i].numbers[n]) > TOLERANCE) {
          reason = `number ${n + 1} is ${mine[i].numbers[n]}, `
            + `but ${theirs[i].numbers[n]} when reopened`;
          break;
        }
      }
    }
    if (reason) {
      assert.fail(`${what}\n`
        + `  element ${i + 1} of ${mine.length}: ${reason}\n`
        + `  live:     ${mine[i].line.slice(0, 150)}\n`
        + `  reopened: ${theirs[i].line.slice(0, 150)}`);
    }
  }
}

for (const name of FIXTURES) {
  test(`${name}: the run leaves the score laid out the way reopening it would`, (t) => {
    if (!museScoreAvailable()) return t.skip("MuseScore not installed");
    const work = workspace(t);
    const input = makeScore(work, fixture(name));

    const charted = path.join(work, "charted.mscz");
    runExtension(input, charted);
    // The precondition. Over a run that charted nothing, both renders below
    // would be the plain score and would match each other perfectly.
    assert.match(mainScore(charted), /Handbells Used:/, "the reference run drew a chart");

    const reopened = renderSvg(charted, path.join(work, "reopened.svg"));
    const live = runExtensionToSvg(input, path.join(work, "live.svg"));
    assertSameDrawing(live, reopened,
      "the score MuseScore held when the run finished is drawn differently from "
      + "the same score reopened, so the run left the layout stale");
  });
}

// Removal is its own path through mutate.js. Most of it goes through cmd(),
// which lays the score out on its own, but the last thing it does is hand back
// the hide-empty-staves setting the score had before the chart went in. That
// is a style write, and it lays out nothing.
//
// So the fixture has to be one where that setting decides what is drawn: its
// second staff rests from beginning to end, hidden while the chart is there and
// drawn again once it is gone. two-staff-handbells has notes on both staves,
// and against it this test passes with the relayout deleted.
test("removing a chart leaves the open score laid out too", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const work = workspace(t);
  
  const charted = path.join(work, "charted.mscz");
  runExtension(makeScore(work, fixture("silent-staff.mscx")), charted);
  assert.match(mainScore(charted), /Handbells Used:/, "there is a chart to remove");

  // Moving every bell out of C2-C9 makes the next run remove the chart and find
  // nothing to build, which is the only way to observe a removal by itself.
  // Into the octave below C2 rather than down to pitch 0, which is out of range
  // just as surely but hangs the notes off so many ledger lines that the score
  // runs to a dozen pages and the comparison stops being about the chart.
  const archive = readMscz(fs.readFileSync(charted));
  const emptied = path.join(work, "emptied.mscz");
  fs.writeFileSync(emptied, writeMscz(replaceMain(archive,
    archive.entries.get(archive.mainName).toString("utf8")
      .replace(/<pitch>(\d+)<\/pitch>/g, (_, pitch) => `<pitch>${24 + Number(pitch) % 12}</pitch>`))));

  const removed = path.join(work, "removed.mscz");
  runExtension(emptied, removed);
  assert.doesNotMatch(mainScore(removed), /Handbells Used:/, "the chart was removed");

  const reopened = renderSvg(removed, path.join(work, "reopened.svg"));
  // The precondition, and the whole reason for this fixture: two systems, both
  // staves drawn in each, twenty staff lines. The second staff rests through
  // the second system, so had the setting not been handed back it would still
  // be hidden there and this would be fifteen, and a stale layout would be
  // indistinguishable from a fresh one.
  assert.strictEqual(staffLines(reopened), 20,
    "both of the piece's staves are drawn in both systems once the chart is gone");

  const live = runExtensionToSvg(emptied, path.join(work, "live.svg"));
  assertSameDrawing(live, reopened,
    "the score is drawn differently from the same score reopened, so removing "
    + "the chart left the layout stale");
});
