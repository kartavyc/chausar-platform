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
