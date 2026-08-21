const test = require("node:test");
const assert = require("node:assert");
const xml = require("../../tools/xml.js");

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <Score>
    <Staff id="1">
      <Measure>
        <voice>
          <Chord>
            <Note>
              <pitch>76</pitch>
              <tpc>18</tpc>
              <head>diamond</head>
              </Note>
            </Chord>
          </voice>
        </Measure>
      </Staff>
    </Score>
  </museScore>`;

test("parses attributes on the root element", () => {
  const doc = xml.parse(SAMPLE);
  const root = xml.find(doc, "museScore");
  assert.strictEqual(root.attrs.version, "4.70");
});

test("find returns the first matching descendant", () => {
  const doc = xml.parse(SAMPLE);
  assert.strictEqual(xml.find(doc, "Staff").attrs.id, "1");
});

test("childText reads direct child text", () => {
  const doc = xml.parse(SAMPLE);
  const note = xml.find(doc, "Note");
  assert.strictEqual(xml.childText(note, "pitch"), "76");
  assert.strictEqual(xml.childText(note, "head"), "diamond");
});

test("childText returns null for a missing child", () => {
  const doc = xml.parse(SAMPLE);
  assert.strictEqual(xml.childText(xml.find(doc, "Note"), "tuning"), null);
});

test("findAll returns every match in document order", () => {
  const doc = xml.parse("<a><b>1</b><c><b>2</b></c><b>3</b></a>");
  assert.deepStrictEqual(xml.findAll(doc, "b").map((n) => n.text), ["1", "2", "3"]);
});

test("handles self-closing elements", () => {
  const doc = xml.parse('<a><font size="13"/><b>x</b></a>');
  assert.strictEqual(xml.find(doc, "font").attrs.size, "13");
  assert.strictEqual(xml.find(doc, "b").text, "x");
});

test("decodes entities in text", () => {
  const doc = xml.parse("<a>Bells &amp; Chimes &lt;3</a>");
  assert.strictEqual(xml.find(doc, "a").text, "Bells & Chimes <3");
});

test("skips comments and the XML declaration", () => {
  const doc = xml.parse('<?xml version="1.0"?><!-- hi --><a>x</a>');
  assert.strictEqual(xml.find(doc, "a").text, "x");
});
