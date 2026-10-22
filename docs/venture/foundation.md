# Venture launcher: foundation (P0)

This is the shared base every venture package builds on. It was made first, alone in the checkout, so the seven Phase B packages can start from the same contracts and the same wiring.

## What P0 made

| Path | What it is | Owner after this commit |
| --- | --- | --- |
| `platform/runtime/venture/contracts.ts` | Every venture type, record kind, method name, payload, result, error code and partner origin | P0 (changes go through the integrator) |
| `platform/runtime/venture/records.ts` | `ventureAction` (the one write path), record lookups, payload checks, amount and rate parsing, dates, the number guard, house-style and done-claim finders, model cost display | P0 (same) |
| `platform/runtime/venture/host-env.ts` | Reads replay settings from the environment, only in demo mode with the replay switch | P0 |
| `platform/runtime/venture/host.ts` | Stub host: every method answers `NOT_BUILT_YET` | P6 |
| `platform/runtime/venture/{core,models,money,build,delivery}/index.ts` | Stub packages with the exports the host will load | P1 to P5 |
| `app/renderer/launch.js` | Empty classic script, so the app behaves as before | P7 |
| `platform/tests/venture-test-store.ts` | `VentureTestStore`: a test store that refuses nested writes and queues updates like the vault | P0 |
| `platform/tests/venture-contracts.test.ts` | The P0 contract tests (17 tests) | P0 |
| `platform/tests/fixtures/venture/README.md` | Says every fixture here is a synthetic recording | P0 |

The contracts, helpers, host-env reader, host stub, package stubs, renderer stub and test store are copied exactly from section 3 of the build spec. (The renderer stub, `app/renderer/launch.js`, went with the old renderer on 22 October 2026, when Ink became the app.)

## Wiring (frozen until Phase C)

These seven files now know about the venture methods. Nobody edits them in Phase B.

- `platform/runtime/engine.ts`: `EngineOptions.venture`; a memoized, lazily imported venture host that is reset on lock and on open; `venture.countries` and `venture.preview` answered before any vault; the other 46 methods routed to the host after the vault check. The engine reaches `host.ts` only through a dynamic import at request time.
- `platform/runtime/server.ts` and `platform/runtime/worker.ts`: import only `host-env.ts`, pass the venture options (and the Codex profile and its process port when present), and the web server serves `/launch.js`.
- `app/desktop/ipc-contract.cjs` and `ipc-contract.d.cts`: the 48 method names appended in order; `OPEN_EXTERNAL_CHANNEL`, `EXTERNAL_ORIGINS` (a copy of the contracts list) and `validateExternalUrl` (https only, no user or password, listed origins only, at most 30,000 characters).
- `app/desktop/preload.cjs`: `chausar.openExternal(url)`.
- `app/desktop/main.cjs`: serves `/launch.js`, handles the open-external channel through `shell.openExternal` after the trusted-sender check, and gives the engine harness a 15 minute request timeout.

## How it was checked

- `node --check` on every new and edited file.
- Typecheck with `typescript@5.9.3` (scratch install outside the repo) of `platform/runtime/venture/**`, the test store, the contract test, `engine.ts`, `server.ts`, `worker.ts` and `app/desktop/**`, unfiltered: no errors.
- `node --test platform/tests/venture-contracts.test.ts`: 17 of 17 pass.
- `node --test` on `desktop-harness`, `desktop-ipc-methods`, `desktop-renderer`, `desktop-main`, `server` and `desktop-packaging`: 57 of 57 pass.
- `node scripts/desktop-smoke.mjs`: the worker starts and shuts down cleanly.
- A probe on a temp vault: before a vault opens, `venture.countries` and `venture.preview` reach the stub (`NOT_BUILT_YET`); after `workspace.create`, all 48 methods reach it.
- `node scripts/check.mjs`: passes.

## Hand-off note

Done: everything in section 3 of the spec. Phase B can start.

For the other packages:

- The parity tests are green now. If `desktop-harness` or `desktop-ipc-methods` turns red in Phase B, someone touched a frozen file.
- Write through `ventureAction` only, and never call `store.update`, the calculator, `memory.append`, `ontology.publish`, `trust.updatePolicy` or a `ModelPort` method inside its work callback. `VentureTestStore` makes that mistake fail in your own tests.
- `singleLine` trims before it looks for line breaks, so a trailing new line is dropped rather than refused. Breaks inside the text are refused.
- `validateExternalUrl` returns the parsed `href`, so the browser opens the normalized form of the link.

Not finished: nothing in P0's scope. No contract change is needed.
