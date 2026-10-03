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

Eight local WOFF2 assets and four license notices remain outstanding. Missing URLs are preserved and reported by Vite. Passing jsdom tests and building with those unresolved URLs does not qualify fonts, browser pixels, zoom, desktop/phone hosts, accessibility scans or reference-image fidelity. Hindi still needs a native reader.
