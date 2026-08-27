const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { insertChart, removeChart } = require("../../tools/insert.js");
const { buildPlan } = require("../../handbells-used-chart/lib/plan.js");
const { extractNotes } = require("../../tools/extract-notes.js");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");

const PLAIN = fixture("two-staff-handbells.mscx");
const planFor = (text) => buildPlan(extractNotes(text).records);

// Slice out one score-level <Staff id="N"> block. Chart staves are appended at
// the end of the file, so document order is not visual order and only
// per-staff structure can be asserted on.
function staffBody(text, id) {
  const start = text.indexOf(`<Staff id="${id}">`);
  assert.notStrictEqual(start, -1, `staff ${id} exists`);
  return text.slice(start, text.indexOf("</Staff>", start));
}

function measuresOf(staffText) {
  const out = [];
  const open = /<Measure(?:\s[^>]*)?>/g;
  let m;
  while ((m = open.exec(staffText)) !== null) {
    const end = staffText.indexOf("</Measure>", m.index);
    out.push(staffText.slice(m.index, end));
  }
  return out;
}

test("appends one chart part per section", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  assert.match(out, /<Instrument id="hand-bells">/);
  assert.match(out, /<Instrument id="hand-chimes">/);
  // Two <trackName> per chart part: one on the Part, one on the Instrument.
  // Each chart part carries its own instrument's wording rather than a shared
  // marker.
  assert.strictEqual((out.match(/<trackName>Handbells Used<\/trackName>/g) || []).length, 2);
  assert.strictEqual((out.match(/<trackName>Handchimes Used<\/trackName>/g) || []).length, 2);
});

test("every staff in the score gains one leading measure per chart", () => {
  const plan = planFor(PLAIN);
  const out = insertChart(PLAIN, plan, {});
  const sections = plan.sections.length;

  for (const id of [1, 2]) {
    const measures = measuresOf(staffBody(out, id));
    assert.ok(measures.length > sections, `staff ${id} kept its original measures`);
    for (let i = 0; i < sections; i++) {
      assert.doesNotMatch(measures[i], /<Note>/,
        `leading measure ${i + 1} of staff ${id} should be empty`);
    }
  }
});

test("the same chart measure declares the same length in every staff", () => {
  const plan = planFor(PLAIN);
  const out = insertChart(PLAIN, plan, {});
  const staffCount = (out.match(/<Staff id="\d+">/g) || []).length;

  plan.sections.forEach((section, i) => {
    for (let id = 1; id <= staffCount; id++) {
      assert.match(measuresOf(staffBody(out, id))[i],
        new RegExp(`^<Measure len="${section.columns}/4">`),
        `staff ${id} measure ${i + 1}`);
    }
  });
});

test("irregular, the section break and the label ride on staff 1 alone", () => {
  const plan = planFor(PLAIN);
  const out = insertChart(PLAIN, plan, {});
  const first = measuresOf(staffBody(out, 1)).slice(0, plan.sections.length);

  first.forEach((measure, i) => {
    assert.match(measure, /<irregular>1<\/irregular>/);
    assert.match(measure, /<subtype>section<\/subtype>/);
    assert.ok(measure.includes(plan.sections[i].label), `carries ${plan.sections[i].label}`);
  });

  const second = measuresOf(staffBody(out, 2))[0];
  assert.doesNotMatch(second, /<irregular>/);
  assert.doesNotMatch(second, /<LayoutBreak>/);
  assert.doesNotMatch(second, /<SystemText>/);
});

test("each chart staff carries notes in its own chart measure and rests in the other", () => {
  const plan = planFor(PLAIN);
  const out = insertChart(PLAIN, plan, {});
  const original = (PLAIN.match(/<Staff id="\d+">/g) || []).length;
  // Chart staves follow the originals, two per section, treble then bass.
  const bellsTreble = measuresOf(staffBody(out, original + 1));

  assert.match(bellsTreble[0], /<stemless>1<\/stemless>/);
  assert.match(bellsTreble[0], /<Chord>/);
  assert.doesNotMatch(bellsTreble[1], /<Chord>/);
});

test("chart staves are padded out to the length of the score", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  const original = (PLAIN.match(/<Staff id="\d+">/g) || []).length;
  assert.strictEqual(
    measuresOf(staffBody(out, original + 1)).length,
    measuresOf(staffBody(out, 1)).length);
});

test("each chart staff declares the score's time signature once, in measure 1", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  const original = (PLAIN.match(/<Staff id="\d+">/g) || []).length;
  const measures = measuresOf(staffBody(out, original + 1));
  assert.match(measures[0], /<sigN>4<\/sigN>\s*<sigD>4<\/sigD>/);
  assert.strictEqual(measures.slice(1).filter((m) => /<TimeSig>/.test(m)).length, 0);
});

test("chart staves mirror the piece's metre changes and irregular measures", () => {
  const ODD = fixture("pickup-and-metre-change.mscx");
  const plan = planFor(ODD);
  const out = insertChart(ODD, plan, {});
  const chart = measuresOf(staffBody(out, 2)).slice(plan.sections.length);

  assert.strictEqual(chart.length, 3);
  // Pickup: same len, its own duration, and no repeat of the opening metre.
  assert.match(chart[0], /^<Measure len="1\/4">/);
  assert.match(chart[0], /<duration>1\/4<\/duration>/);
  assert.doesNotMatch(chart[0], /<TimeSig>/);
  // Ordinary 4/4 measure.
  assert.strictEqual(chart[1].startsWith("<Measure>"), true);
  assert.match(chart[1], /<duration>4\/4<\/duration>/);
  // The metre change carries across, and the rest shortens with it.
  assert.match(chart[2], /<sigN>3<\/sigN>\s*<sigD>4<\/sigD>/);
  assert.match(chart[2], /<duration>3\/4<\/duration>/);
});


test("does not disturb the music that was already there", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  for (const pitch of [72, 80, 86, 48]) {
    assert.ok(out.includes(`<pitch>${pitch}</pitch>`), `pitch ${pitch} still present`);
  }
});

test("running twice produces the same score as running once", () => {
  const once = insertChart(PLAIN, planFor(PLAIN), {});
  const twice = insertChart(once, planFor(PLAIN), {});
  assert.strictEqual(twice, once);
});

test("removeChart returns a score with no chart parts left", () => {
  const withChart = insertChart(PLAIN, planFor(PLAIN), {});
  const stripped = removeChart(withChart);
  assert.doesNotMatch(stripped, /Handbells Used|Handchimes Used/);
  assert.strictEqual(extractNotes(stripped).chartPartIds.length, 0);
});

test("removeChart restores the score byte for byte", () => {
  assert.strictEqual(removeChart(insertChart(PLAIN, planFor(PLAIN), {})), PLAIN);
});

test("a stale measure count cannot delete the score's own music", () => {
  // The tag survives while the chart itself is edited away by hand. Trusting
  // it would strip every measure from every staff.
  const stale = PLAIN.replace("<Score>",
    '<Score>\n    <metaTag name="handbellChartMeasures">2</metaTag>');
  const out = removeChart(stale);
  for (const pitch of [72, 80, 86, 48]) {
    assert.ok(out.includes(`<pitch>${pitch}</pitch>`), `pitch ${pitch} survived`);
  }
  assert.doesNotMatch(out, /handbellChartMeasures/);
});

// The test above survives a stale count because its measures carry no len=,
// and dropLeadingMeasures stops at anything that is not a measure. A pickup is
// a measure and does carry len=, so it is the thing a stale count can actually
// reach. The state is reachable: the refusal message tells a user to delete the
// chart's instruments by hand, and doing that leaves the tag behind.
test("a stale measure count cannot delete a pickup either", () => {
  const pickup = '      <Measure len="1/4"><voice><Rest>'
    + "<durationType>quarter</durationType></Rest></voice></Measure>\n";
  const stale = PLAIN
    .replace("<Score>",
      '<Score>\n    <metaTag name="handbellChartMeasures">2</metaTag>')
    .replace(/(<Staff id="\d+">\n)/g, `$1${pickup}`);

  // The precondition. Without pickups actually seeded this is the test above
  // again, and it would pass on a removal that deletes leading measures.
  const pickups = (text) => (text.match(/<Measure len="1\/4">/g) || []).length;
  assert.strictEqual(pickups(stale), 2, "a pickup was seeded on both staves");

  assert.strictEqual(pickups(removeChart(stale)), 2,
    "no chart part vouches for the count, so no measure is taken");
});

// The recorded lengths are what tells a chart measure from one of the user's,
// so a stale count cannot reach a pickup even when the chart parts are gone.
test("recorded lengths keep a stale count off a pickup", () => {
  const pickup = '      <Measure len="1/4"><voice><Rest>'
    + "<durationType>quarter</durationType></Rest></voice></Measure>\n";
  const stale = PLAIN
    .replace("<Score>", '<Score>\n    <metaTag name="handbellChartMeasures">2</metaTag>'
      + '\n    <metaTag name="handbellChartColumns">3|2</metaTag>')
    .replace(/(<Staff id="\d+">\n)/g, `$1${pickup}`);

  // The precondition: the lengths recorded really do disagree with what is at
  // the front, so the check below has something to refuse.
  assert.match(stale, /<metaTag name="handbellChartColumns">3\|2</);
  const pickups = (text) => (text.match(/<Measure len="1\/4">/g) || []).length;
  assert.strictEqual(pickups(stale), 2, "a pickup was seeded on both staves");

  assert.strictEqual(pickups(removeChart(stale)), 2,
    "a 1/4 measure is not the 3/4 the chart recorded, so none are taken");
});

// The state the refusal message sends a user to: they delete the chart's
// instruments in MuseScore, which leaves the measures on their own staves. The
// next run has to clear those, or the chart it builds stacks on top of them.
test("a chart whose instruments were deleted by hand is still cleared", () => {
  const charted = insertChart(PLAIN, planFor(PLAIN), {});
  const leading = (text) =>
    measuresOf(staffBody(text, 1)).filter((m) => /^<Measure len="/.test(m)).length;

  // Cut every generated part and the score-level staves that went with them.
  let handEdited = charted;
  for (;;) {
    const found = [...handEdited.matchAll(/<Part id="\d+">/g)].find((m) =>
      handEdited.slice(m.index, handEdited.indexOf("</Part>", m.index))
        .includes("<barlines>0</barlines>"));
    if (!found) break;
    const end = handEdited.indexOf("</Part>", found.index) + "</Part>".length;
    handEdited = handEdited.slice(0, found.index) + handEdited.slice(end);
  }
  const own = (PLAIN.match(/<Staff id="\d+">/g) || []).length;
  for (let id = own + 1; id <= (charted.match(/<Staff id="\d+">/g) || []).length; id++) {
    const start = handEdited.indexOf(`<Staff id="${id}">`);
    if (start === -1) continue;
    handEdited = handEdited.slice(0, start)
      + handEdited.slice(handEdited.indexOf("</Staff>", start) + "</Staff>".length);
  }

  // The preconditions: no chart part is left to vouch for the measures, and the
  // measures really are still there.
  assert.doesNotMatch(handEdited, /<barlines>0<\/barlines>/, "no chart part survives");
  assert.strictEqual(leading(handEdited), planFor(PLAIN).sections.length,
    "the chart measures are still on the piece's own staff");

  assert.strictEqual(leading(removeChart(handEdited)), 0, "removal clears them");
  assert.strictEqual(leading(insertChart(handEdited, planFor(PLAIN), {})),
    planFor(PLAIN).sections.length,
    "and a rebuild replaces them rather than stacking on them");
});

test("a user's own part named like the chart is left alone", () => {
  // The name alone is not proof. A part this tool built also has its barlines
  // suppressed and hides when empty; a real instrument does not.
  const impostor = PLAIN.replace("<trackName>Handbells</trackName>",
    "<trackName>Handbells Used Chart</trackName>");
  assert.strictEqual(removeChart(impostor), impostor);
});

test("refuses a chart it can no longer identify rather than duplicating it", () => {
  // Adding an instrument in MuseScore appends it after the chart parts, which
  // stops them being trailing. Carrying on would stack a second chart on the
  // first and report success while removing nothing.
  const plan = planFor(PLAIN);
  const out = insertChart(PLAIN, plan, {});
  const afterParts = out.indexOf('<Staff id="1">');
  const orphaned = out.slice(0, afterParts)
    + '<Part id="9"><Staff><StaffType group="pitched"><name>stdNormal</name>'
    + "</StaffType></Staff><trackName>Later</trackName></Part>\n    "
    + out.slice(afterParts);

  assert.throws(() => removeChart(orphaned), /can no longer be identified/);
  assert.throws(() => insertChart(orphaned, plan, {}), /can no longer be identified/);
});

// A part of the user's carrying every signal ours does (same track name,
// barlines suppressed, hides when empty) sitting immediately before the chart.
// Score-level staves are numbered in part order, so it needs its own.
function withLookAlike(text) {
  const part = '    <Part id="2"><Staff><StaffType group="pitched">'
    + "<name>stdNormal</name><barlines>0</barlines></StaffType></Staff>"
    + "<trackName>Handbells Used Chart</trackName>"
    + '<hideWhenEmpty>on</hideWhenEmpty><Instrument id="hand-bells"/></Part>\n';
  const staff = '    <Staff id="3">\n'
    + "      <Measure><voice><Rest><durationType>measure</durationType>"
    + "<duration>4/4</duration></Rest></voice></Measure>\n"
    + "      <Measure><voice><Rest><durationType>measure</durationType>"
    + "<duration>4/4</duration></Rest></voice></Measure>\n"
    + "      </Staff>\n";
  return text
    .replace("</Part>\n", "</Part>\n" + part)
    .replace("  </Score>", staff + "  </Score>");
}

test("a look-alike part of the user's right beside the chart survives", () => {
  // The recorded measure count is what stops the trailing run reaching it.
  const seeded = withLookAlike(PLAIN);
  const out = insertChart(seeded, planFor(seeded), {});
  const back = removeChart(out);

  assert.match(back, /<trackName>Handbells Used Chart<\/trackName>/);
  assert.strictEqual(back, seeded);
});

// The same score charted by a run that recorded no part count. Those charts put
// one part on every measure, so the measure count caps the trailing run in its
// place. Without that fallback the sweep reaches past the chart and takes the
// user's part with it.
test("a look-alike survives beside a chart that recorded no part count", () => {
  const seeded = withLookAlike(PLAIN);
  const out = insertChart(seeded, planFor(seeded), {});
  const older = out.replace(
    /\s*<metaTag name="handbellChartPartCount">[^<]*<\/metaTag>/, "");

  // The precondition. Without the tag actually gone this is the test above
  // wearing a different name, and it would pass on the new reading alone.
  assert.notStrictEqual(older, out, "the part count tag was there to strip");
  assert.doesNotMatch(older, /handbellChartPartCount/);

  const back = removeChart(older);
  assert.match(back, /<trackName>Handbells Used Chart<\/trackName>/);
  assert.strictEqual(back, seeded);
});

test("the chart measures land after a title frame and before the music", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  const body = staffBody(out, 1);
  assert.ok(body.indexOf("</VBox>") < body.indexOf('<Measure len='),
    "chart follows the title frame");
});

test("a frame elsewhere in the staff does not move the chart", () => {
  // The anchor is the staff's first measure, not the first frame. A score whose
  // only frame is a trailing credits block would otherwise get its chart
  // spliced into the end of staff 1 and the head of every other staff.
  const credits = PLAIN
    .replace(/<VBox>.*?<\/VBox>\n/, "")
    .replace("</Staff>", "<VBox><height>5</height></VBox>\n    </Staff>");
  const out = insertChart(credits, planFor(credits), {});
  for (const id of [1, 2]) {
    assert.match(measuresOf(staffBody(out, id))[0], /^<Measure len="2\/4">/,
      `staff ${id} starts with the chart`);
  }
  assert.strictEqual(removeChart(out), credits);
});

test("hideExistingStaves is undone again, byte for byte", () => {
  const withHiding = insertChart(PLAIN, planFor(PLAIN), { hideExistingStaves: true });
  assert.match(withHiding, /handbellChartHidStaves/);
  assert.strictEqual(removeChart(withHiding), PLAIN);
});

test("hiding a user already asked for is not undone", () => {
  // Only what this tool added comes back off. A score that already hid its own
  // staves keeps doing so, and this has to run WITH the flag, or the branch
  // that could delete the user's setting never executes.
  const prehidden = PLAIN.replace("<Instrument",
    "<hideWhenEmpty>on</hideWhenEmpty>\n      <Instrument");
  const out = insertChart(prehidden, planFor(prehidden), { hideExistingStaves: true });
  assert.strictEqual(removeChart(out), prehidden);
});

test("records which parts it hid, so a later run undoes only those", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), { hideExistingStaves: true });
  assert.match(out, /<metaTag name="handbellChartHidStaves">0<\/metaTag>/);

  // A score whose part already hides gets no marker at all, because nothing
  // was added to undo.
  const prehidden = PLAIN.replace("<Instrument",
    "<hideWhenEmpty>on</hideWhenEmpty>\n      <Instrument");
  assert.doesNotMatch(
    insertChart(prehidden, planFor(prehidden), { hideExistingStaves: true }),
    /handbellChartHidStaves/);
});

test("round trips a score that already has metaTags of its own", () => {
  // The fixture has none, so nothing else here exercises the branch that
  // threads our metaTag in among existing ones.
  const tagged = PLAIN.replace("<Score>",
    '<Score>\n    <metaTag name="composer">Someone</metaTag>');
  assert.strictEqual(removeChart(insertChart(tagged, planFor(tagged), {})), tagged);
});

test("removeChart on a score with no chart changes nothing", () => {
  assert.strictEqual(removeChart(PLAIN), PLAIN);
});

test("the chart's own notes are never counted as bells used", () => {
  const withChart = insertChart(PLAIN, planFor(PLAIN), {});
  assert.deepStrictEqual(planFor(withChart), planFor(PLAIN));
});

test("hideExistingStaves adds one part-level hideWhenEmpty to each existing part", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), { hideExistingStaves: true });
  const firstPart = out.slice(out.indexOf("<Part"), out.indexOf("</Part>"));
  assert.strictEqual((firstPart.match(/<hideWhenEmpty>on<\/hideWhenEmpty>/g) || []).length, 1);
});

test("the piece's own parts are left alone by default", () => {
  const out = insertChart(PLAIN, planFor(PLAIN), {});
  const firstPart = out.slice(out.indexOf("<Part"), out.indexOf("</Part>"));
  assert.doesNotMatch(firstPart, /<hideWhenEmpty>/);
});

test("omits the chime chart when the score has no chimes", () => {
  const bellsOnly = PLAIN.replace("<head>diamond</head>", "");
  const out = insertChart(bellsOnly, planFor(bellsOnly), {});
  assert.doesNotMatch(out, /<Instrument id="hand-chimes">/);
});
