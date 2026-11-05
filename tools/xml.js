"use strict";

// Comments, processing instructions and the DOCTYPE are read in the same
// left-to-right pass as the tags, and skipped where they start. A `<!--`
// inside a processing instruction then stays part of it.
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w.:-]+)\s*=\s*"([^"]*)"/g;

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

function decode(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/g, (m) => {
    if (ENTITIES[m]) return ENTITIES[m];
    const body = m.slice(2, -1);
    const code = body[0] === "x" || body[0] === "X"
      ? parseInt(body.slice(1), 16)
      : parseInt(body, 10);
    return Number.isNaN(code) ? m : String.fromCodePoint(code);
  });
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(raw)) !== null) attrs[m[1]] = decode(m[2]);
  return attrs;
}

function parse(text) {
  const doc = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [doc];
  let cursor = 0;
  // Text either side of a skipped comment counts as one run, so the space
  // between two words survives.
  let between = "";
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    between += text.slice(cursor, m.index);
    cursor = TOKEN.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (name === undefined) continue;

    const top = stack[stack.length - 1];
    if (between.trim()) top.text += decode(between);
    between = "";

    if (closing) {
      // Check if closing tag matches the top of stack
      if (stack.length > 1 && stack[stack.length - 1].name === name) {
        stack.pop();
      } else if (stack.length > 1) {
        // Search for matching element further down the stack
        let found = -1;
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === name) {
            found = i;
            break;
          }
        }
        // If found, unwind to and including that element
        if (found > 0) {
          stack.length = found;
        }
        // If not found, ignore the stray closing tag
      }
      continue;
    }
    const node = { name, attrs: parseAttrs(rawAttrs), children: [], text: "" };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return doc;
}

function findAll(node, name, out) {
  const acc = out || [];
  for (const child of node.children) {
    if (child.name === name) acc.push(child);
    findAll(child, name, acc);
  }
  return acc;
}

function find(node, name) {
  for (const child of node.children) {
    if (child.name === name) return child;
    const deeper = find(child, name);
    if (deeper) return deeper;
  }
  return null;
}

function childText(node, name) {
  for (const child of node.children) {
    if (child.name === name) return child.text;
  }
  return null;
}

module.exports = { parse, find, findAll, childText, decode };
