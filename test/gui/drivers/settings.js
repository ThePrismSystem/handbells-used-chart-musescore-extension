"use strict";

// MuseScore settings keyed "group/key", as the INI file MuseScore reads on
// Linux and Windows.
function ini(settings) {
  const groups = new Map();
  for (const [name, value] of Object.entries(settings)) {
    const [group, key] = name.split("/");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(`${key}=${value}`);
  }
  return [...groups].map(([group, lines]) => `[${group}]\n${lines.join("\n")}\n`).join("");
}

module.exports = { ini };
