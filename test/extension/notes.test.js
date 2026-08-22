const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  museScoreAvailable, installExtension, runExtension, makeScore, mainScore,
} = require("./harness.js");
const { extractNotes } = require("../../tools/extract-notes.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { bellName } = require("../../handbells-used-chart/lib/bellname.js");

const FIXTURE = path.join(__dirname, "..", "fixtures", "two-staff-handbells.mscx");

function chartText(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hbext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  installExtension();
  const output = path.join(dir, "out.mscz");
  runExtension(makeScore(dir, FIXTURE), output);
  return mainScore(output);
}

function planned() {
  return buildPlan(extractNotes(fs.readFileSync(FIXTURE, "utf8")).records, {});
}

// The chart staves are the ones appended after the piece's own.
function chartBody(text) {
  const originals = (fs.readFileSync(FIXTURE, "utf8").match(/<Staff id="\d+">/g) || []).length;
  return text.slice(text.indexOf(`<Staff id="${originals + 1}">`));
}

test("every bell the plan calls for is drawn, with its own spelling", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const text = chartText(t);

  const wanted = [];
  for (const section of planned().sections) {
    for (const side of [section.treble, section.bass]) {
      for (const column of side) {
        for (const note of column.notes) wanted.push(bellName(note.pitch, note.tpc).name);
      }
    }
  }

  const drawn = [];
  const re = /<pitch>(\d+)<\/pitch>\s*<tpc>(-?\d+)<\/tpc>/g;
  let m;
  while ((m = re.exec(chartBody(text))) !== null) {
    drawn.push(bellName(Number(m[1]), Number(m[2])).name);
  }
  assert.deepStrictEqual(drawn.slice().sort(), wanted.slice().sort());
});

test("stacked octaves share one chord", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const stacked = planned().sections
    .flatMap((section) => section.treble.concat(section.bass))
    .filter((column) => column.notes.length > 1).length;

  const body = chartBody(chartText(t));
  const multi = (body.match(/<Chord>(?:(?!<\/Chord>)[\s\S])*?<Note>[\s\S]*?<Note>/g) || []).length;
  assert.ok(multi >= stacked, `expected at least ${stacked} multi-note chords, got ${multi}`);
});

test("chart noteheads carry no stems", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const body = chartBody(chartText(t));
  const chords = (body.match(/<Chord>/g) || []).length;
  assert.ok(chords > 0, "the chart has chords");
  assert.strictEqual((body.match(/<noStem>1<\/noStem>/g) || []).length, chords);
});

test("chimes are diamonds and bells are not", (t) => {
  if (!museScoreAvailable()) return t.skip("MuseScore not installed");
  const chimeNotes = planned().sections
    .filter((section) => section.kind === "chimes")
    .flatMap((section) => section.treble.concat(section.bass))
    .flatMap((column) => column.notes).length;
  assert.strictEqual((chartBody(chartText(t)).match(/<head>diamond<\/head>/g) || []).length, chimeNotes);
});
