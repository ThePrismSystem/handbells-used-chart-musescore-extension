const test = require("node:test");
const assert = require("node:assert");
const {
  SETTINGS, NATURAL_NOTES, readOptions, validateOptions, changedTags,
} = require("../../handbells-used-chart/lib/options.js");

function reader(fields) {
  return (tag) => (Object.prototype.hasOwnProperty.call(fields, tag) ? fields[tag] : "");
}

// What main.js built before the settings had a module of their own, plus the
// settings added since. A score that never had a field must read exactly this.
const DEFAULTS = {
  bellLabel: null, chimeLabel: null, chimeColor: null,
  smbLabel: null, smbColor: null, smbsOptional: false,
  requiredBellFirst: null, requiredBellLast: null,
  requiredChimeFirst: null, requiredChimeLast: null,
  skipParts: null, sharedStaff: false, showInstrumentNames: false, quiet: false,
  mode: "combined",
  bellHead: "normal", chimeHead: "diamond", smbHead: "la", pfHead: "none", whitechapelHead: "none",
  bellShape: "match", chimeShape: "match", smbShape: "match", pfShape: "match",
  whitechapelShape: "match",
  pfLabel: null, whitechapelLabel: null, pfColor: null, whitechapelColor: null,
};

test("a score with no fields reads every default", () => {
  assert.deepStrictEqual(readOptions(reader({})), DEFAULTS);
});

// MuseScore's metaTag returns "" for a field that was never set, and the XML
// reader returns null. Both mean the same thing.
test("an absent field and a blank one read the same", () => {
  assert.deepStrictEqual(readOptions(() => null), DEFAULTS);
});

test("reads each field under its existing name", () => {
  const options = readOptions(reader({
    handbellChartBellLabel: "Bells",
    handchimesColor: "#c00000",
    handbellChartRequiredBellFirst: "C5",
    handbellChartSkipParts: "Piano, Organ",
    handbellChartSharedStaff: "yes",
    handbellChartMode: "separate",
    handbellChartPfHead: "cross",
  }));
  assert.strictEqual(options.bellLabel, "Bells");
  assert.strictEqual(options.chimeColor, "#c00000");
  assert.strictEqual(options.requiredBellFirst, "C5");
  assert.strictEqual(options.skipParts, "Piano, Organ");
  assert.strictEqual(options.sharedStaff, true);
  assert.strictEqual(options.mode, "separate");
  assert.strictEqual(options.pfHead, "cross");
});

// Typed by hand into Project Properties, so the case and the spaces around
// it are the user's own.
test("a yes-or-no field reads yes and no in any case", () => {
  for (const text of ["yes", "Yes", " YES "]) {
    assert.strictEqual(readOptions(reader({ handbellChartSmbsOptional: text })).smbsOptional, true, text);
  }
  for (const text of ["no", "No", ""]) {
    assert.strictEqual(readOptions(reader({ handbellChartSmbsOptional: text })).smbsOptional, false, text);
  }
});

// Read as off, "true" would turn quiet off and leave a headless run waiting
// on a message box that nobody can close.
test("refuses a yes-or-no field that says anything else, naming it", () => {
  for (const text of ["true", "1", "on"]) {
    const options = readOptions(reader({ handbellChartQuiet: text }));
    assert.throws(() => validateOptions(options),
      { message: `handbellChartQuiet is "${text}", which is not yes or no.` });
  }
});

test("refuses a colour it cannot read, naming the field", () => {
  for (const [tag, text] of [["handchimesColor", "red"], ["handbellChartPfColor", "#c0000"],
    ["handbellChartWhitechapelColor", "c00000x"], ["handbellChartSmbColor", "#12"]]) {
    const options = readOptions(reader({ [tag]: text }));
    assert.throws(() => validateOptions(options),
      { message: `${tag} is "${text}", which is not a colour. Use a hex colour such as #c00000, or leave it blank.` });
  }
});

// The forms usableColor accepts. Black is a colour too, and means none.
test("accepts a colour however it is typed", () => {
  for (const text of ["#c00000", " c00000 ", "#C00", "#000000"]) {
    assert.doesNotThrow(() => validateOptions(readOptions(reader({ handchimesColor: text }))), text);
  }
});

test("refuses a choice that is not on the list, naming the field", () => {
  const options = readOptions(reader({ handbellChartMode: "separat" }));
  assert.throws(() => validateOptions(options),
    { message: 'handbellChartMode is "separat", which is not one of: combined, separate.' });
});

test("refuses a shape that is not on the list, naming the field", () => {
  const options = readOptions(reader({ handbellChartChimeShape: "oval" }));
  assert.throws(() => validateOptions(options), /^Error: handbellChartChimeShape is "oval"/);
});

test("accepts every default", () => {
  assert.doesNotThrow(() => validateOptions(readOptions(reader({}))));
});

// Saving what was read must write nothing, whatever the score held, including
// values the settings model does not accept or does not treat as "yes".
test("writes nothing back when nothing changed", () => {
  const fields = [
    {},
    { handbellChartSmbsOptional: "no", handbellChartSharedStaff: "yes" },
    { handbellChartMode: "separat", handbellChartRequiredBellFirst: "C#5" },
    { handbellChartBellLabel: "Bells", handchimesColor: "#c00000" },
    { handbellChartBellHead: "normal" },
    { handbellChartSmbsOptional: "Yes", handbellChartQuiet: "true", handchimesColor: "red" },
  ];
  for (const f of fields) {
    assert.deepStrictEqual(changedTags(readOptions(reader(f)), reader(f)), [], JSON.stringify(f));
  }
});

test("writes only the field that changed", () => {
  const read = reader({});
  const options = Object.assign(readOptions(read), { sharedStaff: true });
  assert.deepStrictEqual(changedTags(options, read),
    [{ tag: "handbellChartSharedStaff", value: "yes" }]);
});

// A value equal to the default is stored as a blank field, so a score that
// had one set back to the default reads the same as one that never had it.
test("clears a field set back to its default", () => {
  const read = reader({ handbellChartMode: "separate", handbellChartBellLabel: "Bells" });
  const options = Object.assign(readOptions(read), { mode: "combined", bellLabel: "" });
  assert.deepStrictEqual(changedTags(options, read), [
    { tag: "handbellChartBellLabel", value: "" },
    { tag: "handbellChartMode", value: "" },
  ]);
});

test("names every setting's field once", () => {
  const tags = SETTINGS.map((s) => s.tag);
  assert.strictEqual(new Set(tags).size, tags.length);
  assert.strictEqual(SETTINGS.length, Object.keys(DEFAULTS).length);
});

test("lists the natural notes from C2 to C9", () => {
  assert.strictEqual(NATURAL_NOTES.length, 50);
  assert.strictEqual(NATURAL_NOTES[0], "C2");
  assert.strictEqual(NATURAL_NOTES[1], "D2");
  assert.strictEqual(NATURAL_NOTES[6], "B2");
  assert.strictEqual(NATURAL_NOTES[49], "C9");
  assert.ok(NATURAL_NOTES.every((n) => /^[A-G][2-9]$/.test(n)));
});
