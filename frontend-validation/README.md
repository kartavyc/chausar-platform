# Isolated library and React behavior validation

These portable configs build the opt-in `app/ui` library and run synthetic React/jsdom behavior checks. They do not mount an application, alter the shared renderer or use a real vault. Dependency acquisition remains a separately coordinated user-operated step; these commands only consume already verified ordinary local packages.

From a checkout containing the scoped dependencies:

```powershell
$env:NODE_DISABLE_COMPILE_CACHE = '1'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
node ./node_modules/typescript/bin/tsc --project ./app/ui/tsconfig.json --noEmit --incremental false
node ./node_modules/typescript/bin/tsc --project ./frontend-validation/tsconfig.render-tests.json
node ./node_modules/vitest/vitest.mjs run --config ./frontend-validation/vitest.config.mjs
node ./node_modules/vite/bin/vite.js build --config ./frontend-validation/vite.config.mjs --configLoader native --mode production
```

The full UI config retains strict, exact optional and unchecked indexed-access contracts. The render-test config also disables library skipping. Vitest collects only this directory's TSX suite; the separate Node contract suite remains in `app/ui/tests`.

The Vite library entry exports explicit mount/update functions; nothing mounts automatically. Its C-local cache/output paths avoid writes to the installed source tree. The validation bundle includes React and React Aria, and is not a final host packaging or bundle-size decision.

The served host entry has a separate source-owned configuration, `host.vite.config.mjs`. With the same already verified frontend packages present, `npm run build:ui-host` builds `src/host/bootstrap.tsx`, validates all eight emitted fonts against their source bytes, then updates only `app/ui/public/host.js` and `host.css`. Its fresh output and source maps remain under ignored `frontend-validation/dist`; packaged assets do not serve maps. Both library configurations explicitly replace `process.env.NODE_ENV` with the production constant, because Vite library mode otherwise leaves that Node expression in browser code. No runtime Node shim is installed.

`node --test platform/tests/ui-browser-bundle.test.ts` evaluates the complete shipped module in a fresh VM realm with `process`, `require`, and `module` absent. This built-in regression is also discovered by the existing repository test/benchmark glob, without acquiring frontend packages. It checks module startup and exported host functions; separately bounded synthetic HTTP/DOM checks must verify configuration, RPC, and mounting from the exact served bytes. Neither check establishes browser pixels or native provider qualification.

Eight local WOFF2 assets and four complete license notices are now in `app/ui/assets/fonts`. Their 300,672-byte payload retains the full source glyph sets and passes offline weight/cmap/source-shaping checks. The production build must resolve every font URL into a local asset compatible with the host's `font-src 'self'` policy. Passing these checks and jsdom tests does not qualify browser pixels, zoom, desktop/phone hosts, accessibility scans or reference-image fidelity. Hindi still needs a native reader and rendered wrapping/clipping checks.

## Fake-engine preview and the UI policy checker (frame-today)

`app/ui/src/bridge/fake.ts` is a `HostRpcPort`-compatible fake engine that serves the host controller, Today, first run and every `todayx.*` method from synthetic data only (an invented "Demo shop", invented customers, money as whole paise strings, a fixed demo clock of 2026-09-30). Unknown methods reject with code `UNKNOWN_METHOD`, so a place whose engine methods are not built yet shows "not built yet". Other lanes add fixture handlers for their own families with `registerFakeMethods('<family>', { method: (payload, context) => reply })`. Only previews and tests import it; `app/ui/tests/frame-today-fake.test.ts` fails if any other file under `app/ui/src` does.

The preview mounts the real host (`mountHost`) on the fake engine:

```sh
# development server on http://127.0.0.1:5199/
node ./node_modules/vite/bin/vite.js --config ./frontend-validation/preview.vite.config.mjs
# static build to frontend-validation/dist/preview
node ./node_modules/vite/bin/vite.js build --config ./frontend-validation/preview.vite.config.mjs
```

Options are query parameters and the address is the hash, as in the app: `?scenario=populated|empty|first-run|locked|read-only&lang=en|hi&view=guided|simple|books&theme=light|dark&clock=2026-09-30&tiles=0`, for example `index.html?scenario=populated&lang=hi&view=books&theme=dark#/today/today`. `theme` sets the picture-only `data-theme`; without it the page follows the computer. The preview prepares the three Today figures once (as the Prepare button does) unless `tiles=0`.

`app/ui/ui-policy.json` is derived from `tokens/tokens.css`, `tokens/type.css` and `views/*.css` by `node frontend-validation/policy/derive.mjs --write`; `app/ui/tests/frame-today-ui-policy.test.ts` fails when it drifts and checks every declared colour pair against WCAG 2.2 AA. The checker applies it in Chromium:

```sh
node frontend-validation/policy/check.mjs --allow-not-built   # full matrix, about two minutes
node frontend-validation/policy/check.mjs --quick              # Guided, English, both themes
#   --no-build  reuse dist/preview   --views=guided,books  --langs=hi  --themes=dark  --only=<address regex>
```

It builds the preview, serves it on 127.0.0.1, runs a self-test (a planted page must trip every rule), then walks every place and sub-place address from `app/places.ts` (so other lanes' place modules are picked up through the registry), Today with a receipt sheet open, first run, the lock screen, the empty workspace and a viewer seat, in both themes x three views x two languages at 1366 x 768, and every place at rest at 1024 x 768. Rules: reading size and type-token sizes per view, text and mark contrast against the effective background, 24 x 24 targets (WCAG 2.2 2.5.8 with its inline and spacing exceptions; the Simple 44 px design target is a warning), figures contained in their boxes, the design's word limits (Guided 120, wide 150, Simple 90, Books 170, sheet 110), button labels of at most 22 characters, no em dash or `!`, no remote image or request, no repeating animation, and no transition under reduced motion. The report is `frontend-validation/dist/policy-report.json` (counts by rule and place, distinct findings, word counts, and the places that showed "not built yet"). The exit code is 1 on any violation, and on any "not built yet" place unless `--allow-not-built` is given. Playwright is imported locally if present, otherwise from the provisioned global copy; Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`). Nothing is installed.
