# The desktop shell and its engine process

The desktop app is three parts: the Electron main process (`app/desktop/main.cjs`), a sandboxed window that shows Ink ([frontend.md](frontend.md)), and the engine, a separate Node process (`platform/runtime/worker.ts`). The window never touches a file, a key or the engine directly.

## The window's bridge

The sandboxed preload (`app/desktop/preload.cjs`) gives the page one object, `window.chausar`. It holds `request(method, payload)` for engine methods and a short list of named actions the shell does itself with a system dialog, such as picking a file or saving an export. It exposes no Electron object, no raw IPC, no file API and no process option.

Main checks every request in `app/desktop/ipc-contract.cjs`:

- the method is on the allowlist (`METHODS`); a name that merely looks like a method is refused;
- the sender is the app's own window and its main frame, at `chausar://app/index.html`;
- the payload is plain JSON of at most 2,000,000 bytes, with no cycles, accessors or prototype keys.

The engine still does its own checks of what is asked, who asks, consent and approvals. Adding an engine method means adding it to the allowlist too. The types for the bridge are in `app/desktop/ipc-contract.d.cts` and `app/desktop/types.ts`.

The page loads from `chausar://app/`, served from the built `app/ui/dist` only. Any other request from the page is cancelled. Context isolation, the sandbox, navigation limits and a strict content security policy stay on. See [Electron's guidance on validating IPC senders](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).

## The engine process

Main starts the engine through `EngineHarness` (`app/desktop/engine-harness.cjs`) and hands it its settings as environment variables: the app version, the vault folder inside the app's user data folder, demo mode, the Codex trust folder and the built Ink folder ([configuration.md](configuration.md)). The engine always opens file storage; the desktop starts no database.

- `EngineHarness` owns startup, pending requests, error replies and shutdown. Startup fails at once when the worker exits, and fails when the worker is not ready in time. A request that passes its time limit answers `REQUEST_TIMEOUT`.
- A request that was lost is never sent again by itself, so an approval can never run twice.
- When the worker dies, main starts a fresh one after 1, 5 and then 30 seconds (`app/desktop/worker-restart.cjs`). After three failed restarts it shows one error box and quits. Ten minutes of steady running earns the three tries back.
- On quit, main lets the worker finish and waits for it to exit. A worker that does not stop in time is ended.

## Running in the background

Work runs only while Chausar runs. The installed beta can start when the owner signs in to the computer, hidden in the tray, and can keep running in the tray after its window closes. Both are the owner's settings: asked in onboarding and changeable in Settings and the tray menu (`app/desktop/background.cjs`).

- Only the installed beta registers a login item. A preview build and a run from source never do.
- Windows and macOS use Electron's login items. Linux uses an XDG autostart file.
- A run from source keeps running in the tray only when started with `--background`.
- Chausar installs no system service, scheduled task or daemon. A computer that is asleep or off runs nothing.

## Commands

| Command | What it does |
|---|---|
| `npm run desktop` | Builds Ink, then opens the window in demo mode (`node scripts/desktop-launch.mjs --demo`). |
| `npm run desktop:production` | The same without demo mode. |
| `npm run desktop:check` | Checks the installed Electron (its exact version and this computer's chip) and opens nothing. |
| `npm run desktop:smoke` | Starts the real worker without a window, asks its status and stops it (`scripts/desktop-smoke.mjs`). |
| `node scripts/desktop-electron-smoke.mjs` | The same worker check under Electron's own Node. |

The launcher starts the installed Electron program directly, without a shell. It takes only `--demo` or `--production`, with `--background` and `--check`; any other switch is refused. It downloads and installs nothing. A packaged preview build always runs in demo mode and refuses `--production`.

## What has been run

- The worker, the harness, the IPC contract and the packaging scripts have tests (`platform/tests/desktop-*.test.ts`). CI runs them on Windows and Linux.
- The Windows and Linux beta are built by the tag workflow (`.github/workflows/release.yml`).
- One unsigned Mac beta build was made and run on an Apple silicon Mac on 14 November 2026 ([desktop-releases.md](desktop-releases.md), "The Mac beta build").
- Start at login and the tray have not been checked by a person on macOS.
