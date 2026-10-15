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

It builds the preview, serves it on 127.0.0.1, runs a self-test (a planted page must trip every rule), then walks every place and sub-place address from `app/places.ts` (so other lanes' place modules are picked up through the registry), Today with a receipt sheet open, first run, the lock screen, the empty workspace and a viewer seat, in both themes x three views x two languages at 1366 x 768; then it resizes the window through `viewports.widths` (1315, 1200, 1024, 1023, 800, 600, 480, 360) and audits every place at rest, Today with its receipt open, first run, the lock screen, the empty workspace and the viewer seat at each, again in both themes x three views x two languages. Layout rules at every width: no sideways scroll of the window or the page, nothing past the window unless a box of its own scrolls or clips it, the rail a 216 (176 from 1024 to 1315) column from 1024 and a bar across the top under it, the sheet beside the page from 1316, over the list from 1024 and the whole window under 1024, no two charts side by side under 1024, and a table wider than the page scrolling in its own box (`--widths=1366,1023,360`, `--no-widths`, `--widths-only`). Rules: reading size and type-token sizes per view, text and mark contrast against the effective background, 24 x 24 targets (WCAG 2.2 2.5.8 with its inline and spacing exceptions; the Simple 44 px design target is a warning), figures contained in their boxes, the design's word limits (Guided 120, wide 150, Simple 90, Books 170, sheet 110), button labels of at most 22 characters, no em dash or `!`, no remote image or request, no repeating animation, and no transition under reduced motion. The report is `frontend-validation/dist/policy-report.json` (counts by rule, by place and by width, distinct findings, word counts, every over-limit page with the words counted, and the places that showed "not built yet"). The exit code is 1 on any violation, and on any "not built yet" place unless `--allow-not-built` is given. Playwright is imported locally if present, otherwise from the provisioned global copy; Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`). Nothing is installed.

### axe-core in the checker

`axe-core` is an exact-pinned devDependency (4.10.3). `policy/axe.mjs` evaluates its source text into each audited page (no request leaves 127.0.0.1) and runs it with the WCAG 2.0, 2.1 and 2.2 A and AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`) on every state the checker walks at 1366 x 768: every place and sub-place, Today with a receipt open, first run, the lock screen, the empty workspace and the viewer seat, in both themes x three views x two languages. axe skips text that a scrolling box has scrolled out of view, and the frame keeps the page in one scrolling column, so for each run the window is made tall enough to show every scrolling box's content (same width, same columns) and then put back. The report's `axe` section has the violations by rule (impact, WCAG tags, count per place), by impact, and the distinct rule, place and target with axe's failure summary; `needsReview` counts what axe could not decide (for example chart text in SVG, whose contrast the policy's own rule checks). The run fails on any violation at or above `--axe-fail` (default `serious`, so serious and critical; `none` reports only). The self-test plants a nameless button, an unlabelled field and faint text and requires axe to report `button-name`, `label` and `color-contrast`.

```sh
node frontend-validation/policy/check.mjs --allow-not-built                    # policy rules and axe
node frontend-validation/policy/check.mjs --allow-not-built --axe-fail=critical
node frontend-validation/policy/check.mjs --quick --no-axe                     # policy rules only
```

### Reference pictures and the side-by-side page

The design's nineteen key screens are embedded in `docs/specs/Chausar-App-Design.html` as base64 PNGs, light and dark.

```sh
node frontend-validation/visual/extract.mjs    # -> dist/visual/reference/<S..>-{light,dark}.png and manifest.json
node frontend-validation/visual/capture.mjs    # -> dist/visual/capture/<S..>-{light,dark}.png and manifest.json
#   --no-build  reuse dist/preview   --only=<regex on the picture name>   --themes=light
node frontend-validation/visual/diff.mjs       # -> dist/visual/diff/<S..>-{light,dark}.png and manifest.json; exit 1 over a threshold
node frontend-validation/visual/page.mjs       # -> docs/lanes/frame-today-visual.html (committed)
#   --width=1200 --quality=72  downscaled JPEG data URIs, encoded by Chromium
```

`extract.mjs` writes each picture once with every caption and design entry it appears under (for example `TD-01`, `FR-08`). `capture.mjs` maps each picture to a preview state (`PICTURES` in the file): Today Guided S01 (`#/today/today`, English), Today Simple S14 (`#/today`, Hindi), Today Books S15 (`#/today`, English), first-run Meanings S09 (scenario `first-run`, a scripted walk: a business, the model skipped, a file held until the meanings are agreed, a starter pack, two meanings accepted and the third open), and the other lanes' screens at their addresses (marked `other lane`, or `other lane, not built yet` when the preview shows the not-built state). The phone, enterprise and CA console pictures are `not drawable` in the desktop preview. Captures are 1366 x 768 at device scale 1 in the picture's theme. `page.mjs` writes one self-contained HTML file (inline CSS, every image a JPEG data URI, no external request) with each pair side by side in both themes, its caption, address and the notes in `visual/notes.json` (the differences seen, and what this round fixed). Everything under `dist/` stays uncommitted.

### Pixel comparison

`visual/png.mjs` reads and writes PNG with `node:zlib` only (8-bit grey, grey and alpha, RGB, RGBA and palette, no interlace). `visual/diff.mjs` compares each capture with its reference picture: a pixel differs when a colour channel moves by more than 32 of 255 (anti-aliasing and font hinting stay under it); a 16 px block differs when its mean lightness moves by more than 6 percent (a coarse layout measure). It writes a diff image (the reference washed out, differing pixels red) and the ratios, and fails when a picture's pixel ratio is over its `maxRatio` in `visual/thresholds.json`, which also records why it is not zero (synthetic data, banners, other lanes' not-built pages). `page.mjs` puts the ratios table and the diff images in the review page.

### The printed recovery kit

```sh
node frontend-validation/print/kit-pdf.mjs     # -> dist/print/recovery-kit-{A4,Letter}.pdf and recovery-kit.json; exit 1 on failure
```

It builds the preview into `dist/preview-print`, walks from the lock screen's recovery link through a new vault to the kit, presses Print with `?print=hold` (a desktop-like shell whose print waits until the page calls `__chausarPreview.releasePrint()`), and saves the print view with `page.pdf()`, Chromium's own PDF writer and the one Electron's `printToPDF` uses. It requires one page on A4 and on Letter; the code in groups of four, the kit's title, label and three lines in English and Hindi, and no other text in the print-media DOM; and in the PDF's own text (`print/pdf.mjs`, a minimal reader of Skia's output through each font's ToUnicode map) the code, the English lines, only Devanagari letters from the kit's Hindi and no other word. A control print with the screen's styles must read back the screen's words, so an empty reader cannot pass. `app/ui/tests/frame-today-kit-pdf.test.ts` runs it, and skips where Chromium, Playwright or Vite are missing.
