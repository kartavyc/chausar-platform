# The app: Ink

Chausar's app is Ink, a React app in `app/ui`, built with Vite to `app/ui/dist`. The same build runs in the desktop window and on the web. It is built around one idea: the owner approves, the team works. Its places are Today (the approval queue), Team, Work, Clients, Money and Connections, with the business menu and onboarding beside them. What each place shows, the engine methods behind it and the known limits are in [venture/ink.md](venture/ink.md); the spec is `docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md`; how to work on it is in `app/ui/README.md`.

Ink replaced the old renderer (`app/renderer`, plain HTML and JavaScript with twelve views) on 22 October 2026. The old renderer and its tests are gone; the dated pages under `docs/` that name it are records of that time.

## How it is served

| Where | How the page loads | How it reaches the engine |
|---|---|---|
| Desktop (`npm run desktop`) | Electron loads `chausar://app/index.html`; the protocol handler serves only the files listed from `app/ui/dist` at startup | `window.chausar.request(method, payload)` from the sandboxed preload, checked by `app/desktop/ipc-contract.cjs` (method allowlist, size limits, trusted sender) |
| Local web (`npm start`) | `http://127.0.0.1:4317/`, loopback only, from the same allowlist | `POST /api/rpc` with the bearer from the pairing link `/#token=<code>`; run events on `GET /api/events` |
| Hosted web (`npm run start:hosted`) | `/app/`, from the same allowlist, told by one meta tag that it runs hosted; the sign-in page stays at `/` | The session cookie plus the page's bearer from `/api/hosted/session` |

Each of the three start commands runs `npm run build:ui` first. Started without a build, every host refuses and says to run `npm run build:ui` (the servers with the code `UI_NOT_BUILT`). Packaging builds Ink itself before electron-builder runs, and the package carries `app/ui/dist` only, never the app's sources, tests or tooling.

## Rules the app keeps

- Text nodes only: no `innerHTML` and no `dangerouslySetInnerHTML`. Engine values, model replies and source records are always text.
- A strict content security policy everywhere: scripts and styles from the app's own files only, no inline script or style at runtime, no plugins or object embeds. On the desktop the page may not fetch anything; requests go through the preload.
- No money arithmetic in the app. Figures arrive from the engine already formatted, each with its receipt.
- Approvals send the digest of what was shown; a stale digest is refused by the engine and the row shows the new version.
- No secrets in browser storage. The pairing token lives in memory and leaves the address bar at once.
- Honest labels come from engine data only. Engine errors stay visible; the app cannot make an unavailable capability look like it works.

## Commands

| Command | What it does |
|---|---|
| `npm run build:ui` | Builds `app/ui/dist` |
| `npm run dev:ui` | Vite dev server with the fake engine (sample businesses, said so on screen) |
| `npm run test:ui` | The app's tests: vitest, jsdom and Testing Library, axe checks and text catalogue parity |
| `npm run typecheck:ui` | Strict TypeScript for the app |

The engine-facing acceptance tests drive the engine through the real desktop preload and its strict IPC contract (`platform/tests/fixtures/preload-bridge.ts`), the path Ink takes on the desktop. `platform/tests/ui-ink-hosting.test.ts` and `hosted-ui-ink.test.ts` check how each host serves the build.
