# Venture launcher: shell (P6)

One engine serves the venture methods to both the desktop window and the local web page. P6 built the host that sits between the engine and the five venture packages, taught the desktop types every venture method, and wrote the shell and end-to-end tests.

## What P6 made

| Path | What it is |
| --- | --- |
| `platform/runtime/venture/host.ts` | The venture host: loads each package on first use, builds one model port and one GitHub transport per open vault, keeps keys in memory only |
| `app/desktop/types.ts` | `DesktopPayload` and `DesktopResult` for every venture method; `DesktopBridge.openExternal` |
| `platform/tests/venture-host.test.ts` | The host on its own, with fake package loaders (15 tests) |
| `platform/tests/venture-engine.test.ts` | The host behind the real engine (6 tests) |
| `platform/tests/venture-shell.test.ts` | P0's wiring: link opener, main process, preload, `/launch.js`, replay switch (6 tests) |
| `platform/tests/venture-exports.test.ts` | Every package exports what the host loads; the handler tables cover every method (2 tests) |
| `platform/tests/venture-docs.test.ts` | The architecture copy, its Connectors table against the catalogue, house style in these docs (3 tests) |
| `platform/tests/venture-e2e.test.ts` | The whole journey in India with recordings, and the template path in the United States (2 tests) |
| `platform/tests/fixtures/venture/e2e/` | The model and GitHub recordings for the end-to-end test, copied from the build spec |
| `platform/tests/fixtures/venture/demo/` | The model recording for the offline demo |
| `README.md` | A short "Start a business" section |
| `docs/venture/README.md`, `architecture.md`, `shell.md` | The venture overview, the architecture copy, this page |

## How a venture request travels

```
renderer --IPC or /api/rpc--> Engine.request
   venture.countries, venture.preview: answered before the vault check, from core (no state, no write)
   every other venture method: vault check, then the memoized host for this vault
      VentureHost.request(ctx, method, payload)
        1. the name must be a venture method and not a pre-vault one     else INVALID_VENTURE_REQUEST
        2. app-only methods need the desktop channel and no taint         else APP_APPROVAL_REQUIRED
        3. load the owner package (once; a failed load is tried again)    else NOT_BUILT_YET
        4. the handler must be the owner's own                             else NOT_BUILT_YET
        5. make sure the model port exists (a failure only affects model calls)
        6. handler(deps, ctx, payload or {})
```

- **One package can't take down another.** Each package loads on the first use of a method it owns, through a literal dynamic `import()`. A package that fails to load answers `NOT_BUILT_YET` for its own methods only. On Node 24.13.1 a failed dynamic import is tried again on the next call, so a fixed file loads without a restart (checked with a scratch probe).
- **A handler in the wrong table is never reached.** The host looks only in the owner's table, with `Object.hasOwn`.
- **The constructor does nothing risky.** It stores references and builds two small proxies. It loads no package, calls no transport factory and reads no file.
- **Models.** Before each handler call the host makes sure the model port exists: the transport is the injected one, or the replay recording when a replay path is set, or the real transport. Two requests that arrive together share one port. If the models package or the recording can't be loaded, `deps.models` answers `NOT_BUILT_YET` for every method, so only calls that use a model fail. A missing recording says "The model recording could not be read, so model calls are off."
- **GitHub.** `deps.github.read` picks its transport on first use: the injected transport (a factory gets the store), or the recording through the build package (its `{{briefId}}` filled from the newest stored brief), or the real reader. A missing recording refuses `GITHUB_READ_FAILED`. `deps.github.kind` is the chosen transport's kind. Before the first read it is `fixture` for a replay path and `github-api` otherwise; an injected transport reports its own kind, and an injected factory is called the first time `kind` is read (never in the constructor), so a fixture never claims to be the real API.
- **Secrets.** Keys and tokens sit on a memory-only shelf. `close()` empties it, drops the port and the GitHub transport, and refuses later requests with `VAULT_LOCKED`. The engine closes the host on lock and on attach.

## Desktop types

`DesktopPayload<M>` and `DesktopResult<M>` map each venture method to `VenturePayloads[M]` and `VentureResults[M]`. A venture method whose payload has a required field needs that payload in `request`; the others can be called without one. `DesktopBridge.openExternal(url)` matches the preload. `venture-shell.test.ts` checks this at compile time, including two `@ts-expect-error` lines that must fail.

## How it was checked

All commands from the repo root on Windows, Node 24.13.1, with the other packages' work in the checkout as it stood on 16 October 2026 (in flight, not yet all committed).

- `node --check` on every file above.
- Scoped typecheck with the scratch compiler (`typescript@5.9.3`) of `host.ts`, `types.ts` and the six test files, filtered to them: no errors.
- `node --test platform/tests/venture-host.test.ts platform/tests/venture-engine.test.ts platform/tests/venture-shell.test.ts`: 27 of 27 pass. Before the other packages landed, `venture-engine` passed 2 and skipped 4, as designed.
- `node --test platform/tests/venture-exports.test.ts platform/tests/venture-docs.test.ts`: 5 of 5 pass.
- `node --test platform/tests/venture-e2e.test.ts`: 2 of 2 pass (the India journey with recordings, and the United States template path).
- `node --test` on `desktop-harness`, `desktop-ipc-methods`, `desktop-renderer`, `desktop-main`, `desktop-packaging`, `server` and `decision-journal-renderer`: 71 of 71 pass.
- A scratch script outside the repo started `EngineHarness` on `platform/runtime/worker.ts` with `CHAUSAR_DEMO=1` and called `venture.countries` (15 rows) and `venture.preview` (bookkeeping) through the forked worker.
- The fixture words were checked with `assertNoNumbers`, `houseStyleFindings` and `doneClaimFindings` from `records.ts`: no findings.

`scripts/check.mjs`, the full typecheck and the full suite were not run, as section 2 of the build spec says for Phase B.

## Hand-off note

**Done.** Everything in sections 9 and 11 of the build spec: the host, the desktop types, the six test files, the e2e and demo fixtures, the README section and these docs.

**Contract change needed (for the integrator).** In `contracts.ts`, `ModelConnectionRecord` and `ModelCallRecord` each declare `kind: ModelRouteKind`, which clashes with `RecordBase`'s `kind` (the record kind). TypeScript reduces both types to `never`, and with them `ModelConnectionView`, `ModelStatusView['connections']`, `VentureResults['venture.models.calls']` and `RecordOf<'venture-model-connection' | 'venture-model-call'>`. P2 already stores the route as `routeKind` and works around the type. Proposed fix: rename the field to `routeKind: ModelRouteKind` in both types. Until then, `venture-engine.test.ts` and `venture-e2e.test.ts` read connections and calls through small local shapes; after the fix they can use the contract types.

**Wiring.** No bug found in the frozen files (`engine.ts`, `server.ts`, `worker.ts`, `ipc-contract.cjs`, `ipc-contract.d.cts`, `preload.cjs`, `main.cjs`). `venture-shell.test.ts` covers the link opener, the 15 minute request limit, `/launch.js` and the replay switch.

**Phase C.** Run the e2e test again once every package is committed: it passed here against work still in flight. The docs test needs every `docs/venture/*.md` page to be free of em dashes and the banned words, so it checks the other packages' pages too.

**Not finished.** Nothing in P6's scope.
