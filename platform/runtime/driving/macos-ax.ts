/**
 * The macOS desktop driver (WK-14, experimental): Quartz window lists, the Accessibility API
 * through System Events, screencapture for pictures and NSEvent global monitors for the person's
 * input. WRITTEN BUT NOT RUN on macOS here; the TypeScript side is tested against a fake helper.
 *
 * The helper is `/usr/bin/osascript -l JavaScript` running the JXA script below from a private
 * temp file (stdin carries the requests). It reads JSON lines through the ObjC bridge while a run
 * loop keeps the event monitors alive. It types nothing but a name matching the Chausar
 * export-file pattern, which it checks again itself, and presses only keys from `parseChord`'s list.
 *
 * Stop key: macOS keyboards have no Pause key, so on macOS the stop key is Control Option F15
 * (F15 sits where Pause is on Apple extended keyboards), plus the Stop button on the strip and in
 * the tray. A global monitor sees the chord but cannot hold it the way RegisterHotKey or an X grab
 * can, and it cannot tell injected input from the person's: Chausar's own keys are muted by
 * `OwnInput` on the TypeScript side. Window titles need Screen Recording permission (without it
 * Quartz leaves them empty); keys, focus and password detection need Accessibility permission.
 */
import { HelperDriver, type HelperDriverOptions } from './helper-client.ts';

export const MACOS_HELPER_SCRIPT = String.raw`
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');
ObjC.bindFunction('AXIsProcessTrusted', ['bool', []]);

var FILE_NAME = /^chausar-export-[a-z0-9]{6,32}\.(csv|xml|xlsx|xls|txt|pdf|json|html)$/;
var WINDOW_ID = /^0x[0-9a-f]{1,16}$/;
var KEY_CODES = { a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '9': 25, '7': 26, '8': 28, '0': 29, o: 31, u: 32, i: 34, p: 35,
  l: 37, j: 38, k: 40, n: 45, m: 46, enter: 36, tab: 48, space: 49, escape: 53,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  home: 115, pageup: 116, end: 119, pagedown: 121, left: 123, right: 124, down: 125, up: 126 };
var MODIFIERS = { ctrl: 'control down', alt: 'option down', shift: 'shift down' };
var REFUSED = ['alt+d', 'ctrl+d', 'ctrl+a', 'ctrl+x', 'ctrl+v', 'ctrl+z', 'ctrl+y', 'ctrl+s', 'ctrl+q', 'ctrl+w', 'alt+f4', 'ctrl+f4',
  'alt+c', 'alt+x', 'alt+i', 'alt+a', 'ctrl+n', 'alt+r', 'ctrl+r', 'shift+enter', 'ctrl+enter'];
var F15 = 113, CONTROL = 262144, OPTION = 524288;
var ON_SCREEN = 1, INCLUDING_WINDOW = 8, EXCLUDE_DESKTOP = 16;
var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
var monitor = null, lastPointer = 0, running = true;

function fail(code) { var error = new Error(code); error.chausar = code; throw error; }
function send(message) { stdout.writeData($(JSON.stringify(message) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
function clip(text) { text = typeof text === 'string' ? text : ''; return text.length > 400 ? text.slice(0, 400) : text; }
function idOf(number) { return '0x' + number.toString(16); }
function numberOf(args) {
  if (!args || typeof args.id !== 'string' || !WINDOW_ID.test(args.id)) fail('DRIVER_WINDOW_GONE');
  var number = parseInt(args.id.slice(2), 16);
  if (!(number > 0 && number <= 4294967295)) fail('DRIVER_WINDOW_GONE');
  return number;
}
function quartz(options, number) {
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(options, number))) || [];
  return list.filter(function (w) { return w.kCGWindowLayer === 0 && typeof w.kCGWindowNumber === 'number'; }).map(function (w) {
    var pid = w.kCGWindowOwnerPID;
    return { id: idOf(w.kCGWindowNumber), title: clip(w.kCGWindowName), app: clip(w.kCGWindowOwnerName), pid: pid > 0 ? pid : null };
  });
}
function list() { return quartz(ON_SCREEN | EXCLUDE_DESKTOP, 0); }
function info(number) { var found = quartz(INCLUDING_WINDOW, number); return found.length ? found[0] : null; }
function related(number) {
  var window = info(number);
  if (!window) fail('DRIVER_WINDOW_GONE');
  return list().filter(function (w) { return w.id !== window.id && w.pid !== null && w.pid === window.pid; });
}
function frontWindowId() {
  var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app || app.isNil()) return null;
  var pid = app.processIdentifier;
  var windows = list().filter(function (w) { return w.pid === pid; });
  return windows.length ? windows[0].id : null;
}
function processFor(pid) {
  var found = Application('System Events').processes.whose({ unixId: pid });
  if (!found.length) fail('DRIVER_WINDOW_GONE');
  return found[0];
}
function focus(number) {
  var window = info(number);
  if (!window || window.pid === null) fail('DRIVER_WINDOW_GONE');
  var process = processFor(window.pid);
  process.frontmost = true;
  var windows = process.windows();
  var named = windows.filter(function (w) { try { return w.name() === window.title; } catch (e) { return false; } });
  var target = named.length === 1 ? named[0] : windows.length === 1 ? windows[0] : null;
  if (!target) fail('DRIVER_FOCUS_REFUSED');
  target.actions.byName('AXRaise').perform();
  delay(0.15);
  if (frontWindowId() !== window.id) fail('DRIVER_FOCUS_REFUSED');
}
function focused() {
  var secret = null;
  try {
    var process = Application('System Events').processes.whose({ frontmost: true })[0];
    var element = process.attributes.byName('AXFocusedUIElement').value();
    secret = element.attributes.byName('AXSubrole').value() === 'AXSecureTextField';
  } catch (e) { secret = null; }
  return { windowId: frontWindowId(), secret: secret };
}
function press(args) {
  var key = args && args.key, modifiers = args && args.modifiers;
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(KEY_CODES, key) || !Array.isArray(modifiers) || modifiers.length > 3) fail('DRIVING_KEY_REFUSED');
  var using = [], ordered = [];
  ['ctrl', 'alt', 'shift'].forEach(function (name) { if (modifiers.indexOf(name) >= 0) { using.push(MODIFIERS[name]); ordered.push(name); } });
  if (ordered.length !== modifiers.length) fail('DRIVING_KEY_REFUSED');
  if (/^[a-z0-9]$/.test(key) && ordered.indexOf('ctrl') < 0 && ordered.indexOf('alt') < 0) fail('DRIVING_KEY_REFUSED');
  if (REFUSED.indexOf(ordered.concat([key]).join('+')) >= 0) fail('DRIVING_KEY_REFUSED');
  var events = Application('System Events');
  if (using.length) events.keyCode(KEY_CODES[key], { using: using }); else events.keyCode(KEY_CODES[key]);
}
function typeName(args) {
  var name = args && args.name;
  if (typeof name !== 'string' || !FILE_NAME.test(name)) fail('DRIVING_TEXT_REFUSED');
  Application('System Events').keystroke(name);
}
function snapshot(number) {
  if (!info(number)) fail('DRIVER_WINDOW_GONE');
  var path = $.NSTemporaryDirectory().js + 'chausar-snapshot-' + $.NSUUID.UUID.UUIDString.js + '.png';
  var manager = $.NSFileManager.defaultManager;
  try {
    var task = $.NSTask.alloc.init;
    task.launchPath = '/usr/sbin/screencapture';
    task.arguments = ['-x', '-o', '-l' + number, path];
    task.launch; task.waitUntilExit;
    if (task.terminationStatus !== 0) fail('DRIVER_SNAPSHOT_FAILED');
    var data = $.NSData.dataWithContentsOfFile(path);
    if (!data || data.isNil() || data.length > 6 * 1024 * 1024) fail('DRIVER_SNAPSHOT_FAILED');
    var image = $.NSBitmapImageRep.imageRepWithData(data);
    if (!image || image.isNil()) fail('DRIVER_SNAPSHOT_FAILED');
    return { width: image.pixelsWide, height: image.pixelsHigh, png: data.base64EncodedStringWithOptions(0).js };
  } finally { manager.removeItemAtPathError(path, null); }
}
function watch() {
  if (monitor) return;
  // Left, right and other mouse down (1, 3, 25), mouse moved (5), key down (10).
  var mask = (1 << 1) | (1 << 3) | (1 << 25) | (1 << 5) | (1 << 10);
  monitor = $.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler(mask, function (event) {
    var type = event.type;
    if (type === 10) {
      var flags = event.modifierFlags;
      if (event.keyCode === F15 && (flags & CONTROL) && (flags & OPTION)) send({ event: 'stop-key' }); else send({ event: 'key' });
    } else if (type === 5) {
      var now = Date.now();
      if (now - lastPointer >= 100) { lastPointer = now; send({ event: 'pointer' }); }
    } else send({ event: 'button' });
  });
  if (!monitor || monitor.isNil()) { monitor = null; fail('DRIVER_PERMISSION_REQUIRED'); }
}
function unwatch() { if (monitor) { $.NSEvent.removeMonitor(monitor); monitor = null; } }
function available() { if (!$.AXIsProcessTrusted()) fail('DRIVER_PERMISSION_REQUIRED'); return true; }

function dispatch(op, args) {
  switch (op) {
    case 'available': return available();
    case 'list': return list();
    case 'info': return info(numberOf(args));
    case 'related': return related(numberOf(args));
    case 'focus': focus(numberOf(args)); return true;
    case 'focused': return focused();
    case 'press': press(args); return true;
    case 'type': typeName(args); return true;
    case 'snapshot': return snapshot(numberOf(args));
    case 'watch': watch(); return true;
    case 'unwatch': unwatch(); return true;
  }
  fail('DRIVER_FAILED');
}
function handle(line) {
  if (!line || line.length > 65536) return;
  var request;
  try { request = JSON.parse(line); } catch (e) { return; }
  if (!request || typeof request.id !== 'number') return;
  try { send({ id: request.id, ok: true, result: dispatch(request.op, request.args || {}) }); }
  catch (e) {
    var code = e && e.chausar;
    if (code === 'DRIVER_PERMISSION_REQUIRED') send({ id: request.id, ok: false, code: code, reason: 'Allow Chausar in System Settings, Privacy and Security, Accessibility.' });
    else send({ id: request.id, ok: false, code: code || 'DRIVER_FAILED' });
  }
}

function run() {
  $.NSApplication.sharedApplication;
  var input = $.NSFileHandle.fileHandleWithStandardInput;
  var pending = '';
  $.NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock($.NSFileHandleDataAvailableNotification, input, $.NSOperationQueue.mainQueue, function () {
    var data = input.availableData;
    if (!data || data.length === 0) { running = false; return; }
    pending += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    var at;
    while ((at = pending.indexOf('\n')) >= 0) { var line = pending.slice(0, at); pending = pending.slice(at + 1); handle(line); }
    if (pending.length > 65536) pending = '';
    input.waitForDataInBackgroundAndNotify;
  });
  input.waitForDataInBackgroundAndNotify;
  while (running) $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.25));
  unwatch();
}
`;

/** Accessibility on macOS through one osascript (JXA) helper. */
export class MacAxDriver extends HelperDriver {
  readonly platform = 'macos-ax' as const;
  readonly stopKey = 'Control Option F15';
  constructor(options: HelperDriverOptions = {}) {
    super(options, { command: '/usr/bin/osascript', args: path => ['-l', 'JavaScript', path], scriptName: 'chausar-helper.js', script: MACOS_HELPER_SCRIPT });
  }
}
