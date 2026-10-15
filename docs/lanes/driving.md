# Lane: driving (round 4)

WK-14 "Chausar is driving" and screen export. **Experimental** as a whole: the spec labels WK-14 experimental, and real programs (Tally on Windows, anything on macOS) have not been driven.

## What a person sees

1. Work, Chausar is driving (WK-14, work-books' screen): choose one window from the list, press Start.
2. A thin strip stays on top of every window: "Chausar is driving. Ctrl Alt Pause to stop." with Stop. A tray icon appears for the session with "Stop Chausar driving".
3. The steps appear as they happen. If the person moves the mouse or types, the session pauses at once ("You moved the mouse or typed. Paused.") with Continue and Stop on the strip, the tray and the screen.
4. If the program asks for a sign-in, a one-time code or a captcha, Chausar hands over: "Sign in yourself. Chausar continues after."
5. A payment, edit or delete screen stops the session before any key.
6. The export (a picture of the window, or the file the program saved) is kept for a day for Books, Sources to read in.
7. Work, Screen driving (this lane's sub-place, `#/work/screen-driving`): whether this computer can be driven, the plans, the session running now with Stop, earlier sessions with their steps, and the exports waiting, with Discard.

## What was built

| Item | Where | Label |
|---|---|---|
| `session.*` engine family (11 methods) | `platform/runtime/modules/lane-driving.ts` | supported (synthetic, fake driver and Xvfb) |
| Session runner and every safety rule | `platform/runtime/driving/session.ts` | supported (synthetic) |
| Driver interface, checked chords, file names, sign-in and payment title rules, own-input muting | `platform/runtime/driving/driver.ts` | supported |
| Typed plans: `window.picture` (tested) and `tally.report-export` (written, refuses `DRIVING_PLAN_UNVERIFIED`) | `platform/runtime/driving/plans.ts` | picture: supported; Tally: experimental, blocked |
| Linux X11 driver: raw X11 protocol over the socket (no xdotool), XTEST input, XInput 2 raw events for the person, Ctrl Alt Pause grabbed natively, GetImage to PNG | `platform/runtime/driving/x11/` | supported on Xvfb (no window manager); experimental on a real desktop |
| Windows UI Automation driver (PowerShell + C# helper: UIA, SendInput, low-level hooks ignoring injected input, RegisterHotKey Ctrl Alt Pause, IsPassword) | `platform/runtime/driving/windows-uia.ts` | experimental: written, not run |
| macOS Accessibility driver (JXA helper: CGWindowList, System Events, AXSecureTextField, global event monitor; stop key Control Option F15) | `platform/runtime/driving/macos-ax.ts` | experimental: written, not run |
| Helper JSON-lines client and driver selection | `platform/runtime/driving/helper-client.ts`, `select.ts` | supported (fake helper) |
| Always-on-top strip with Stop / Continue, tray Stop, worker status messages | `app/desktop/driving-main.cjs` | supported (fake Electron; real Electron 44 under Xvfb) |
| Work, Screen driving sub-place | `app/ui/src/places/lane-driving.tsx`, `app/ui/src/screens/driving/` | supported (jsdom); routed by the base's lane-sub-place lookup |

### Rules and how they are enforced

- **One window only.** A session starts only on a window from the list (never the desktop, the whole screen or Chausar's own windows). Before every key the focused window must be that window or a dialog it owns (X11 `WM_TRANSIENT_FOR`, Windows `GW_OWNER`; another window of the same program is not enough); otherwise Chausar brings the window back once, then pauses ("Another window came to the front. Paused.").
- **Read and export only.** A plan is data: focus, a checked chord, wait for a title, type the Chausar-made export name, wait for that file, take a picture. No click step, no free-text step. `parseChord` allows navigation keys, F-keys and modified letters/digits only; bare letters (typing), Ctrl+Alt+letter or digit (AltGr types characters), Alt/Ctrl+Tab or Escape (switch programs) and a refused list (Alt+D, Ctrl+A, Ctrl+V, Ctrl+X, Ctrl+Z, Ctrl+S, Alt+F4, …, also with Shift added) never pass. Enter and Space (which press the focused control) are allowed only right after typing the export name or waiting for a named screen. The Windows and macOS helper scripts re-check keys and file names themselves. A title of the window or its dialogs that reads like payment, transfer, UPI, delete, alter, edit, create or posting stops the session.
- **Never a password, one-time code or captcha.** No method accepts text to type except `chausar-export-<random>.<ext>`. A sign-in, OTP or captcha title hands over to the person; a focused password box (Windows `IsPassword`, macOS `AXSecureTextField`) does the same. When the sign-in has gone, the session waits for Continue ("The sign-in has gone. Press Continue when you are ready."); it never carries on by itself. Where the driver cannot tell a password box (X11 without AT-SPI: `secret: null`), Chausar types the file name or presses Enter/Space only when the focused window shows the screen the plan waited for; otherwise the step fails and nothing is typed.
- **The person comes first.** Any pointer move, key or button the person makes pauses at once (XInput 2 raw events; low-level hooks on Windows; a global monitor on macOS). On X11 and macOS, input Chausar sends itself is muted while sending plus 200 ms (the person's input in that moment is muted too); the Windows helper drops injected input in its hooks, so nothing is muted there. Pointer moves in the first second after Start or Continue are ignored (the hand leaving the button), and no key is sent during that second. While signing in, typing is expected and does not pause.
- **Nothing after Stop.** The driver asks the session before every key event it sends (X11) or before handing a chord or name to its helper (Windows, macOS); after Stop or a pause nothing more goes out, held modifiers are released, and an interrupted key is pressed again only after Continue (an interrupted file name fails the step). A Stop pressed while a session is still starting cancels it.
- **Stop within a second.** Ctrl Alt Pause is grabbed by the driver for the whole session (Electron cannot register Pause as a global shortcut: verified "conversion failure"), and reported even while muted. The strip's Stop and the tray's Stop reach the session directly over the worker channel (`{ kind: 'driving-control', action: 'stop' | 'resume' }`), so a busy or closing engine cannot refuse them; screens call `session.stop`. The desktop going away stops the session. A dead X11 watch connection, or five failed polls, reports the stop key. If the stop key cannot be grabbed, the session does not start. A helper that dies mid-session reports the stop key.
- **Workspace.** A session belongs to the workspace it started in. A lock, close or switch stops it (checked before every step and on every `session.status`).
- **Who may start.** `approve` permission (owner or co-founder), desktop channel only, never a tainted context (`TAINTED_REQUEST`), never in demo (`DEMO_EXTERNAL_DISABLED`; the driver is also absent in demo, and the desktop never sets the driver switch in demo). Anyone may stop. A session ends after 15 minutes.
- **Exports.** The export name is found and copied without following links (`lstat`, `O_NOFOLLOW`), checked to be a regular file of at most 20 MB, and read back against its SHA-256.
- **Window titles** are listed only to owners and co-founders (`session.windows`).
- **Outside text.** Window titles appear only as `window.title`; reasons, steps, audit details and errors are fixed sentences.

## Engine methods — Round 4 contracts

All in module `driving`, listed in `app/desktop/module-methods/driving.json`.

| Method | Permission | Request | Reply |
|---|---|---|---|
| `session.driver` | read, preVault | `{}` | `{ platform: 'x11'\|'windows-uia'\|'macos-ax'\|'fake'\|null, available: boolean, code: string\|null, reason: string\|null, stopKey: 'Ctrl Alt Pause', rules: { windows: 1, mode: 'read-export', typesSecrets: false } }` |
| `session.windows` | read | `{}` | `{ windows: [{ id, title, app }], available: boolean, code: string\|null, reason: string\|null }` (empty list with the reason when no driver) |
| `session.status` | read, preVault | `{}` | `Status` (below). Stops a session whose workspace is locked or changed. |
| `session.start` | approve | `{ windowId: string, mode: 'read-export', typesSecrets: false, plan?: string }` (plan defaults to `window.picture`) | `Status` |
| `session.stop` | read, preVault | `{}` | `Status` (idempotent) |
| `session.resume` | approve | `{}` | `Status`; `SESSION_NOT_PAUSED` unless paused or signing in |
| `session.plans` | read | `{ group?: string }` | `{ plans: [{ id, title, app, groups: string[], produces, status: 'experimental'\|'tested-synthetic', verified: boolean, steps: string[] }] }` |
| `session.history` | read | `{}` | `{ sessions: [{ id, window: { title, app }, plan, startedAt, endedAt, state, reason, steps: Step[], exports: [{ id, name, bytes }] }] }` newest first, up to 50 |
| `session.exports` | read | `{ sessionId?: string }` | `{ exports: [{ id, sessionId, name, mediaType, bytes, sha256, at }] }` (kept 24 hours) |
| `session.readExport` | prepare | `{ exportId }` | `{ id, sessionId, name, mediaType, bytes, sha256, at, text }` for UTF-8 text formats, or `{ …, base64 }`; `EXPORT_CHANGED` if the file no longer matches its digest |
| `session.discardExport` | prepare | `{ exportId }` | `{ discarded: true }` |

`Status = { state: 'idle'|'driving'|'sign-in'|'paused-by-you'|'stopped-by-key'|'stopped'|'step-failed'|'done', window: { id, title } | null, steps: [{ at: ISO, text, state: 'done'|'running'|'failed' }], reason: string | null, sessionId, plan, startedAt, exports: [{ id, name, bytes }], stopKey }`. It is a superset of what work-books' `approvals.driving*` validates.

**Worker → desktop main:** on every state change the engine worker sends `{ kind: 'driving-status', state, active, stopKey }` (stopKey from a fixed list) over the worker IPC (only when `CHAUSAR_DESKTOP_DRIVER=1`). `app/desktop/driving-main.cjs` validates it strictly and draws the strip and tray. Main calls `session.stop` / `session.resume` through the harness.

**For frame-today (SH-03, SH-07):** the driving banner reads `session.status` (active when state is `driving`, `sign-in` or `paused-by-you`). `registerDriving(...)` returns `drivingMenuItems()`: the Electron menu-item templates (Stop, and Continue when paused) to add to your tray menu; until then this lane shows its own tray icon during a session.

**For connectors-ext (screen export, replacing `SCREEN_EXPORT_NOT_BUILT`):** list plans for a group with `session.plans { group }`; the person starts the session on WK-14 (or you call `session.start { windowId, mode: 'read-export', typesSecrets: false, plan }` from a person's desktop request); when `session.status.state === 'done'`, read `status.exports` or `session.exports { sessionId }`, then `session.readExport { exportId }` and pass `text` (or `base64`) to your import preview as outside data; `session.discardExport` after import.

## Refusal codes

`DRIVER_UNAVAILABLE`, `DRIVER_PERMISSION_REQUIRED`, `DRIVER_FAILED`, `DRIVER_TIMEOUT`, `DRIVER_REPLY_INVALID`, `DRIVER_FOCUS_REFUSED`, `DRIVER_SNAPSHOT_FAILED`, `DRIVER_WINDOW_GONE`, `DRIVING_KEY_REFUSED`, `DRIVING_TEXT_REFUSED`, `DRIVING_PLAN_INVALID`, `DRIVING_PLAN_NOT_FOUND`, `DRIVING_PLAN_UNVERIFIED`, `DRIVING_PLAN_MISMATCH`, `DRIVING_WORKSPACE_CHANGED`, `SESSION_ACTIVE`, `SESSION_NOT_PAUSED`, `WINDOW_NOT_FOUND`, `INVALID_SESSION_REQUEST`, `EXPORT_NOT_FOUND`, `EXPORT_CHANGED`, `EXPORT_TOO_LARGE`, `TAINTED_REQUEST`.

## Tests

- `platform/tests/driving-engine.test.ts`: the engine family against a scripted fake driver (every rule above, lock, work-books passthrough, plans).
- `platform/tests/driving-xvfb-session.test.ts`: the engine and session over the real X11 driver on a private Xvfb, against a synthetic program window the test draws: export by keys and file, a picture, pause on the person's pointer, Ctrl Alt Pause.
- `platform/tests/driving-x11.test.ts`: the X11 driver itself on Xvfb.
- `platform/tests/driving-os-drivers.test.ts`: Windows and macOS drivers against a fake helper, plus static checks of the helper scripts.
- `platform/tests/driving-desktop-main.test.ts`: the strip and tray with a fake Electron, and a real Electron 44 run under Xvfb.
- `app/ui/tests/driving-place.test.ts`, `frontend-validation/tests/driving-screen.test.tsx`: the sub-place.

## Core edits

- `app/desktop/main.cjs`: one fenced 3-line block after `let window; let engine; …` that registers `driving-main.cjs` (strip, tray Stop, driver switch).
- `app/desktop/preload.cjs`: the driving lane's own `laneRefusals` line (and the synced `app/ui/src/bridge/client.ts`).

## What still needs the founder or another lane

- **Real programs (NEEDS-FOUNDER):** a real Windows machine with TallyPrime to verify `tally.report-export` (it refuses with `DRIVING_PLAN_UNVERIFIED` until then) and to run the Windows helper; a Mac to run the macOS helper (Accessibility and Screen Recording permissions). Neither helper script has run.
- **Linux desktops with a window manager:** the `_NET_ACTIVE_WINDOW` and `_NET_CLIENT_LIST` paths are written but only Xvfb without a window manager was tested. Wayland-only sessions refuse (`DRIVER_UNAVAILABLE`).
- **Password boxes on Linux:** need AT-SPI; until then only titles detect a sign-in.
- **Remaining limits from the safety review:** focus is checked just before a key, not atomically with it (a pop-up taking focus in that gap receives the chord); exports wait as plain files in the app folder for up to a day (not encrypted with the vault); the macOS stop key is Control Option F15, which most Mac keyboards lack (the strip and tray Stop remain); a global monitor on macOS sees nothing while Secure Input is on.
- **The strip is English only:** the main process does not know the UI language.
- **Tray (frame-today):** the shared tray should include `drivingMenuItems()`; this lane's own tray icon covers the session until then.
