/**
 * The Windows desktop driver (WK-14, experimental): UI Automation for windows and password
 * fields, SendInput for keys, PrintWindow for pictures and low-level hooks for the person's input.
 * WRITTEN BUT NOT RUN on Windows here; the TypeScript side is tested against a fake helper.
 *
 * The helper is Windows PowerShell 5.1 (System32 path, so PATH cannot swap it) running the script
 * below from a private temp file (`-File`, not `-Command -`, because stdin carries the requests).
 * The script compiles one C# class with Add-Type (C# 5: Windows PowerShell's compiler) and hands
 * it stdin and stdout. It types nothing but a name matching the Chausar export-file pattern, which
 * it checks again itself, and presses only keys from the same list as `parseChord`.
 *
 * The stop key is Ctrl Alt Pause, held with RegisterHotKey for the life of a watch. Ctrl turns
 * Pause into Break (VK_CANCEL, 0x03) on many keyboards, so both 0x13 and 0x03 are registered.
 */
import { win32 } from 'node:path';
import { HelperDriver, type HelperDriverOptions } from './helper-client.ts';

export const WINDOWS_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$names = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Drawing', 'System.Web.Extensions')
foreach ($name in $names) { Add-Type -AssemblyName $name | Out-Null }
$refs = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $names -contains $_.GetName().Name } | ForEach-Object { $_.Location }
$source = @'
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public class ChausarHelperError : Exception { public string Code; public ChausarHelperError(string code) : base(code) { Code = code; } }

public static class ChausarHelper {
  // ---- Win32 -------------------------------------------------------------------------------
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hwnd, int id);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  const uint GW_OWNER = 4; const int SW_RESTORE = 9; const uint PW_RENDERFULLCONTENT = 2;
  const uint INPUT_KEYBOARD = 1; const uint KEYEVENTF_EXTENDEDKEY = 0x1; const uint KEYEVENTF_KEYUP = 0x2; const uint KEYEVENTF_UNICODE = 0x4;
  const int WH_KEYBOARD_LL = 13; const int WH_MOUSE_LL = 14;
  const uint LLKHF_INJECTED = 0x10; const uint LLMHF_INJECTED = 0x01;
  const uint MOD_ALT = 0x1; const uint MOD_CONTROL = 0x2; const uint MOD_NOREPEAT = 0x4000;
  const uint VK_PAUSE = 0x13; const uint VK_CANCEL = 0x03;
  const uint WM_HOTKEY = 0x0312; const uint WM_QUIT = 0x0012;

  // ---- protocol ------------------------------------------------------------------------------
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
  static readonly BlockingCollection<string> Outbox = new BlockingCollection<string>(4096);
  static readonly Regex WindowId = new Regex("^0x[0-9a-f]{1,16}$");
  // The same pattern as FILE_NAME in driver.ts: Chausar types nothing else.
  static readonly Regex FileName = new Regex("^chausar-export-[a-z0-9]{6,32}\\.(csv|xml|xlsx|xls|txt|pdf|json|html)$");

  public static void Run() {
    var utf8 = new UTF8Encoding(false);
    var output = new StreamWriter(Console.OpenStandardOutput(), utf8); output.AutoFlush = true;
    var writer = new Thread(delegate() { foreach (var line in Outbox.GetConsumingEnumerable()) output.WriteLine(line); });
    writer.IsBackground = true; writer.Start();
    var input = new StreamReader(Console.OpenStandardInput(), utf8);
    string text;
    while ((text = input.ReadLine()) != null) {
      if (text.Length == 0 || text.Length > 65536) continue;
      object id = null;
      var reply = new Dictionary<string, object>();
      try {
        var request = (Dictionary<string, object>)Json.DeserializeObject(text);
        id = request["id"];
        var args = request.ContainsKey("args") ? request["args"] as Dictionary<string, object> : null;
        reply["id"] = id; reply["ok"] = true; reply["result"] = Dispatch((string)request["op"], args ?? new Dictionary<string, object>());
      } catch (ChausarHelperError error) {
        reply.Clear(); reply["id"] = id; reply["ok"] = false; reply["code"] = error.Code;
      } catch (Exception) {
        reply.Clear(); reply["id"] = id; reply["ok"] = false; reply["code"] = "DRIVER_FAILED";
      }
      if (id != null) Outbox.Add(Json.Serialize(reply));
    }
    StopWatch();
    Outbox.CompleteAdding(); writer.Join(2000);
  }
  static void Emit(string kind) { Outbox.TryAdd("{\"event\":\"" + kind + "\"}"); }

  static object Dispatch(string op, Dictionary<string, object> args) {
    switch (op) {
      case "available": return AutomationElement.RootElement != null;
      case "list": return List();
      case "info": return Info(Handle(args));
      case "related": return Related(Handle(args));
      case "focus": Focus(Handle(args)); return true;
      case "focused": return Focused();
      case "press": Press(args); return true;
      case "type": TypeName(args); return true;
      case "snapshot": return Snapshot(Handle(args));
      case "watch": StartWatch(); return true;
      case "unwatch": StopWatch(); return true;
    }
    throw new ChausarHelperError("DRIVER_FAILED");
  }

  // ---- windows -------------------------------------------------------------------------------
  static IntPtr Handle(Dictionary<string, object> args) {
    var id = args.ContainsKey("id") ? args["id"] as string : null;
    if (id == null || !WindowId.IsMatch(id)) throw new ChausarHelperError("DRIVER_WINDOW_GONE");
    var hwnd = new IntPtr(Convert.ToInt64(id.Substring(2), 16));
    if (!IsWindow(hwnd)) throw new ChausarHelperError("DRIVER_WINDOW_GONE");
    return hwnd;
  }
  static string Id(IntPtr hwnd) { return "0x" + hwnd.ToInt64().ToString("x"); }
  static string Clip(string text) { if (text == null) return ""; return text.Length > 400 ? text.Substring(0, 400) : text; }
  static string ProcessName(int pid) { try { return Clip(Process.GetProcessById(pid).ProcessName); } catch (Exception) { return ""; } }
  static Dictionary<string, object> Describe(IntPtr hwnd, AutomationElement element) {
    var window = new Dictionary<string, object>();
    string name = ""; int pid = 0;
    try { name = element.Current.Name; pid = element.Current.ProcessId; } catch (Exception) { uint raw; GetWindowThreadProcessId(hwnd, out raw); pid = (int)raw; }
    window["id"] = Id(hwnd); window["title"] = Clip(name); window["app"] = pid > 0 ? ProcessName(pid) : "";
    window["pid"] = pid > 0 ? (object)pid : null;
    return window;
  }
  static ArrayList List() {
    var windows = new ArrayList();
    var condition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window);
    foreach (AutomationElement element in AutomationElement.RootElement.FindAll(TreeScope.Children, condition)) {
      try {
        var hwnd = new IntPtr(element.Current.NativeWindowHandle);
        if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) continue;
        windows.Add(Describe(hwnd, element));
      } catch (ElementNotAvailableException) { }
    }
    return windows;
  }
  static object Info(IntPtr hwnd) {
    try { return Describe(hwnd, AutomationElement.FromHandle(hwnd)); } catch (ElementNotAvailableException) { return null; }
  }
  static ArrayList Related(IntPtr hwnd) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr other, IntPtr unused) {
      if (other == hwnd || !IsWindowVisible(other)) return true;
      uint otherPid; GetWindowThreadProcessId(other, out otherPid);
      if (GetWindow(other, GW_OWNER) == hwnd || otherPid == pid) found.Add(other);
      return true;
    }, IntPtr.Zero);
    var windows = new ArrayList();
    foreach (var other in found) { var info = Info(other); if (info != null) windows.Add(info); }
    return windows;
  }
  static void Focus(IntPtr hwnd) {
    AutomationElement element = null;
    try { element = AutomationElement.FromHandle(hwnd); } catch (ElementNotAvailableException) { throw new ChausarHelperError("DRIVER_WINDOW_GONE"); }
    object pattern;
    if (element.TryGetCurrentPattern(WindowPattern.Pattern, out pattern)) {
      var window = (WindowPattern)pattern;
      if (window.Current.WindowVisualState == WindowVisualState.Minimized) window.SetWindowVisualState(WindowVisualState.Normal);
    } else if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd);
    if (GetForegroundWindow() != hwnd) { try { element.SetFocus(); } catch (Exception) { } }
    Thread.Sleep(50);
    if (GetForegroundWindow() != hwnd) throw new ChausarHelperError("DRIVER_FOCUS_REFUSED");
  }
  static Dictionary<string, object> Focused() {
    var result = new Dictionary<string, object>();
    var hwnd = GetForegroundWindow();
    result["windowId"] = hwnd == IntPtr.Zero ? null : Id(hwnd);
    object secret = null;
    try { var element = AutomationElement.FocusedElement; if (element != null) secret = element.Current.IsPassword; } catch (Exception) { secret = null; }
    result["secret"] = secret;
    return result;
  }

  // ---- input ---------------------------------------------------------------------------------
  static readonly string[] Refused = { "alt+d", "ctrl+d", "ctrl+a", "ctrl+x", "ctrl+v", "ctrl+z", "ctrl+y", "ctrl+s", "ctrl+q", "ctrl+w", "alt+f4", "ctrl+f4",
    "alt+c", "alt+x", "alt+i", "alt+a", "ctrl+n", "alt+r", "ctrl+r", "shift+enter", "ctrl+enter" };
  static ushort KeyCode(string key, out bool extended) {
    extended = false;
    switch (key) {
      case "enter": return 0x0D; case "escape": return 0x1B; case "tab": return 0x09; case "space": return 0x20;
      case "pageup": extended = true; return 0x21; case "pagedown": extended = true; return 0x22;
      case "end": extended = true; return 0x23; case "home": extended = true; return 0x24;
      case "left": extended = true; return 0x25; case "up": extended = true; return 0x26;
      case "right": extended = true; return 0x27; case "down": extended = true; return 0x28;
    }
    if (Regex.IsMatch(key, "^f([1-9]|1[0-2])$")) return (ushort)(0x70 + int.Parse(key.Substring(1)) - 1);
    if (Regex.IsMatch(key, "^[a-z0-9]$")) return (ushort)char.ToUpperInvariant(key[0]);
    throw new ChausarHelperError("DRIVING_KEY_REFUSED");
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var input = new INPUT(); input.type = INPUT_KEYBOARD;
    input.u.ki.wVk = vk; input.u.ki.wScan = scan; input.u.ki.dwFlags = flags;
    return input;
  }
  static void Send(List<INPUT> inputs) {
    var array = inputs.ToArray();
    if (SendInput((uint)array.Length, array, Marshal.SizeOf(typeof(INPUT))) != array.Length) throw new ChausarHelperError("DRIVER_FAILED");
  }
  static void Press(Dictionary<string, object> args) {
    var key = args.ContainsKey("key") ? args["key"] as string : null;
    var list = args.ContainsKey("modifiers") ? args["modifiers"] as object[] : null;
    if (key == null || list == null || list.Length > 3) throw new ChausarHelperError("DRIVING_KEY_REFUSED");
    var modifiers = new List<string>();
    foreach (var item in list) {
      var name = item as string;
      if (name != "ctrl" && name != "alt" && name != "shift" || modifiers.Contains(name)) throw new ChausarHelperError("DRIVING_KEY_REFUSED");
      modifiers.Add(name);
    }
    bool extended;
    var vk = KeyCode(key, out extended);
    if (Regex.IsMatch(key, "^[a-z0-9]$") && !modifiers.Contains("ctrl") && !modifiers.Contains("alt")) throw new ChausarHelperError("DRIVING_KEY_REFUSED");
    var ordered = new List<string>();
    foreach (var name in new[] { "ctrl", "alt", "shift" }) if (modifiers.Contains(name)) ordered.Add(name);
    ordered.Add(key);
    if (Array.IndexOf(Refused, string.Join("+", ordered.ToArray())) >= 0) throw new ChausarHelperError("DRIVING_KEY_REFUSED");
    var codes = new List<ushort>();
    foreach (var name in ordered) if (name != key) codes.Add(name == "ctrl" ? (ushort)0x11 : name == "alt" ? (ushort)0x12 : (ushort)0x10);
    var inputs = new List<INPUT>();
    foreach (var code in codes) inputs.Add(Key(code, 0, 0));
    uint flags = extended ? KEYEVENTF_EXTENDEDKEY : 0;
    inputs.Add(Key(vk, 0, flags)); inputs.Add(Key(vk, 0, flags | KEYEVENTF_KEYUP));
    for (int i = codes.Count - 1; i >= 0; i--) inputs.Add(Key(codes[i], 0, KEYEVENTF_KEYUP));
    Send(inputs);
  }
  static void TypeName(Dictionary<string, object> args) {
    var name = args.ContainsKey("name") ? args["name"] as string : null;
    if (name == null || !FileName.IsMatch(name)) throw new ChausarHelperError("DRIVING_TEXT_REFUSED");
    var inputs = new List<INPUT>();
    foreach (var c in name) { inputs.Add(Key(0, c, KEYEVENTF_UNICODE)); inputs.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)); }
    Send(inputs);
  }

  // ---- picture -------------------------------------------------------------------------------
  static Dictionary<string, object> Snapshot(IntPtr hwnd) {
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) throw new ChausarHelperError("DRIVER_WINDOW_GONE");
    int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
    if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new ChausarHelperError("DRIVER_SNAPSHOT_FAILED");
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        var hdc = graphics.GetHdc();
        bool done;
        try { done = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT); } finally { graphics.ReleaseHdc(hdc); }
        if (!done) throw new ChausarHelperError("DRIVER_SNAPSHOT_FAILED");
      }
      using (var stream = new MemoryStream()) {
        bitmap.Save(stream, ImageFormat.Png);
        if (stream.Length > 6 * 1024 * 1024) throw new ChausarHelperError("DRIVER_SNAPSHOT_FAILED");
        var result = new Dictionary<string, object>();
        result["width"] = width; result["height"] = height; result["png"] = Convert.ToBase64String(stream.ToArray());
        return result;
      }
    }
  }

  // ---- watching ------------------------------------------------------------------------------
  static Thread watcher; static uint watcherId; static IntPtr keyHook, mouseHook;
  static HookProc keyProc = KeyHook, mouseProc = MouseHook; // kept in fields so the collector never frees them
  static long lastPointer;
  static void StartWatch() {
    if (watcher != null) return;
    var ready = new ManualResetEvent(false); string failure = null;
    watcher = new Thread(delegate() {
      watcherId = GetCurrentThreadId();
      var module = GetModuleHandle(null);
      keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, module, 0);
      mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
      bool pause = RegisterHotKey(IntPtr.Zero, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_PAUSE);
      bool brk = RegisterHotKey(IntPtr.Zero, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_CANCEL);
      if (keyHook == IntPtr.Zero || mouseHook == IntPtr.Zero || !pause) failure = "DRIVER_FAILED";
      ready.Set();
      MSG msg;
      if (failure == null) while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { if (msg.message == WM_HOTKEY) Emit("stop-key"); }
      if (keyHook != IntPtr.Zero) UnhookWindowsHookEx(keyHook);
      if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
      if (pause) UnregisterHotKey(IntPtr.Zero, 1);
      if (brk) UnregisterHotKey(IntPtr.Zero, 2);
      keyHook = IntPtr.Zero; mouseHook = IntPtr.Zero;
    });
    watcher.IsBackground = true; watcher.Start();
    ready.WaitOne(5000);
    if (failure != null) { watcher.Join(2000); watcher = null; throw new ChausarHelperError(failure); }
  }
  static void StopWatch() {
    if (watcher == null) return;
    PostThreadMessage(watcherId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    watcher.Join(2000); watcher = null;
  }
  static IntPtr KeyHook(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      uint vk = (uint)Marshal.ReadInt32(lParam, 0), flags = (uint)Marshal.ReadInt32(lParam, 8);
      int message = wParam.ToInt32();
      // Input Chausar (or any program) injected is not the person's; the stop key arrives as WM_HOTKEY.
      if ((flags & LLKHF_INJECTED) == 0 && (message == 0x0100 || message == 0x0104) && vk != VK_PAUSE && vk != VK_CANCEL) Emit("key");
    }
    return CallNextHookEx(keyHook, code, wParam, lParam);
  }
  static IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      uint flags = (uint)Marshal.ReadInt32(lParam, 12);
      int message = wParam.ToInt32();
      if ((flags & LLMHF_INJECTED) == 0) {
        if (message == 0x0201 || message == 0x0204 || message == 0x0207 || message == 0x020B) Emit("button");
        else if (message == 0x0200 || message == 0x020A || message == 0x020E) {
          long now = Environment.TickCount;
          if (now - lastPointer >= 100) { lastPointer = now; Emit("pointer"); }
        }
      }
    }
    return CallNextHookEx(mouseHook, code, wParam, lParam);
  }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies $refs | Out-Null
[ChausarHelper]::Run()
`;

/** UI Automation on Windows through one PowerShell helper. */
export class WindowsUiaDriver extends HelperDriver {
  readonly platform = 'windows-uia' as const;
  constructor(options: HelperDriverOptions = {}) {
    super(options, {
      command: win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: path => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path],
      scriptName: 'chausar-helper.ps1', script: WINDOWS_HELPER_SCRIPT,
    });
  }
}
