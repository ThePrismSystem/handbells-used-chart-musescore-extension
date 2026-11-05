// Drives MuseScore for the dialog tests on macOS (test/gui/drivers/mac.js). osascript runs it as JavaScript for
// Automation, with System Events for the keyboard and windows and Core Graphics for the mouse.
//   osascript -l JavaScript mac-drive.js find <pid> <title>    prints "yes" when that process has a window whose name holds the text
//   osascript -l JavaScript mac-drive.js key <pid> <json>      brings MuseScore forward, then presses {key|keyCode, using}
//   osascript -l JavaScript mac-drive.js click <x> <y>         a left click at that point on the screen

function processWith(pid) {
  const found = Application("System Events").processes.whose({ unixId: Number(pid) });
  return found.length > 0 ? found[0] : null;
}

function find(pid, title) {
  const process = processWith(pid);
  if (!process) return "no";
  return process.windows.name().some((name) => name && name.includes(title)) ? "yes" : "no";
}

function key(pid, spec) {
  const events = Application("System Events");
  const press = JSON.parse(spec);
  const process = processWith(pid);
  if (!process) throw new Error("No process " + pid);
  if (!process.frontmost()) {
    process.frontmost = true;
    delay(0.3);
  }
  const options = press.using.length > 0 ? { using: press.using } : {};
  if (press.keyCode !== undefined) events.keyCode(press.keyCode, options);
  else events.keystroke(press.key, options);
  return "ok";
}

function click(x, y) {
  ObjC.import("CoreGraphics");
  const point = $.CGPointMake(Number(x), Number(y));
  for (const type of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, point, $.kCGMouseButtonLeft));
    delay(0.05);
  }
  return "ok";
}

// osascript calls run() with the command line's arguments.
function run(argv) {
  const [action, ...args] = argv;
  if (action === "find") return find(args[0], args[1]);
  if (action === "key") return key(args[0], args[1]);
  if (action === "click") return click(args[0], args[1]);
  throw new Error("Unknown action " + action);
}
