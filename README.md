# Chausar

A local business workspace where every financial answer carries its rows, definitions, period, exclusions and calculation receipt.

This repository implements the desktop architecture in the supplied Chausar plans: a sandboxed renderer, a separate TypeScript engine, encrypted workspace authority, data-only dictionaries and mappings, deterministic calculations, explicit action approvals, durable jobs and isolated WASM extensions. It includes the recovered enterprise reference engine in `enterprise/` for a separate, opt-in deployment path.

**Release: 0.1.0-preview.1.** The complete local verification run passed **206 tests with zero failures or skipped tests**. This is a runnable engineering preview. It is not a production-qualified release of every contract in the plans. [Supported features](docs/supported-features.md) distinguishes implemented behavior, experimental adapters and outstanding requirements; [build status](docs/build-status.md) records the actual evidence.

## Run the local preview

Install Node.js **24.13.1 or later**, then from this directory:

```sh
node platform/runtime/server.ts --demo
```

Open the owner pairing link printed by the server. Its URL fragment is an owner credential: the interface transfers it to memory and removes it from history. A bare visit to [http://127.0.0.1:4317](http://127.0.0.1:4317), or a refresh, shows the pairing form. Create a workspace with a strong passphrase and save its recovery kit. Select the synthetic demo option to import the sample business. The preview runs without installing npm dependencies. It uses the explicitly experimental encrypted file adapter; PostgreSQL remains the production authority adapter.

The interface contains Conversation, Daily Brief, Sources, Dictionary, Memory, Decisions, Actions, Jobs, Trust, Models, Plugins and Activity. CSV, native XLSX, typed JSON, bank CSV, Tally XML, Zoho and Shopify exports and GST JSON enter the same reconciliation path. Supply independently obtained control totals rather than treating the importer's own sum as independent evidence.

The synthetic September business bills INR 3,000, receives INR 2,600, earns INR 2,500, refunds INR 100 and has INR 1,100 of imported contribution costs. September net sales are INR 2,400 and contribution is INR 1,300. Billed, received and earned are separate measures. Asking without a period also includes the August comparison record.

## Start a business

The venture launcher takes one sentence about a service business and turns it into a plan, a build brief for Lovable or Replit, practice runs for delivery agents, and a back office where every price, invoice and payment has a receipt. Run it in local web mode and open the printed pairing link:

```sh
npm start
```

Or in the desktop window, once the pinned Electron is installed:

```sh
npm install
npm run desktop
```

For the offline demo, model and GitHub answers come from hand-written recordings. They need demo mode plus their own switch, `CHAUSAR_VENTURE_REPLAY=1`:

```sh
CHAUSAR_VENTURE_REPLAY=1 CHAUSAR_VENTURE_MODEL_REPLAY=platform/tests/fixtures/venture/demo/model-replay.json CHAUSAR_VENTURE_GITHUB_REPLAY=platform/tests/fixtures/venture/e2e/github-sync.json npm start
```

Without any AI connected, built-in templates do the work and say so. This build keeps businesses in experimental file storage, so practise there and don't issue real invoices yet. See [docs/venture/README.md](docs/venture/README.md) for the flow, the honest labels, what is not built and the demo script.

## Desktop and production setup

```sh
npm install
npm run desktop -- --demo
```

The Electron renderer has no Node access. A narrow IPC bridge calls a separate engine process. The desktop process can initialize the vendored loopback PostgreSQL cluster; genuine platform-specific PostgreSQL and Python distributions must first be staged as described in [runtime-binaries/README.md](runtime-binaries/README.md). They are not downloaded or fabricated by this source checkout.

For a separately provisioned local PostgreSQL instance, supply `CHAUSAR_POSTGRES_URL` using the example configuration and run:

```sh
node platform/runtime/server.ts
```

Production calculations additionally verify the authorized projection using registered SQL in an isolated in-memory DuckDB subprocess before persisting a receipt. Missing PostgreSQL or DuckDB refuses production operation. The database adapter stores authenticated encrypted workspace snapshots with locking and revision checks; the desktop schema is distinct from the relational enterprise schema.

Set `CHAUSAR_PYTHON` to an absolute trusted Python executable for registered PDF extraction, forecast and allocation helpers. Model credentials remain engine-owned, and API keys supplied through the interface are memory-only. Official CLI routes invoke installed official tools; they do not read subscription token files. All external routes require operator qualification. See [model routes](docs/model-routes.md) and [analytics](docs/analytics.md).

## Verify and build

```sh
node scripts/check.mjs
node --test platform/tests/*.test.ts
node scripts/bench.mjs
npm run typecheck
node scripts/build.mjs
```

The factory benchmark emits a machine-readable report and fails on failed, cancelled or missing test results. Real Python cases run when the test environment supplies `CHAUSAR_PYTHON`; otherwise the report must identify those cases as unavailable. Typecheck requires the pinned development dependencies. Node syntax validation and execution do not substitute for TypeScript checking.

`npm run package` checks runtime integrity, the generated dependency lock and publisher signing configuration before native packaging. No signed installer or publisher key is included. The portable build is source, not a standalone signed desktop installer. CI validates Windows and Linux and uploads its own evidence; it does not publish releases.

## Boundaries that matter

- Local actions currently create durable reminder drafts with exact approval and readback. They do not deliver messages or move money. Unknown external outcomes require reconciliation before retry.
- The installed scheduled runner produces owner briefs with leases, budgets, stop rules and human acceptance. Autonomy starts disabled. The engine must remain running; no operating-system background service is installed.
- The 50-system catalogue reports capability per operation. Tally and Zoho reads have fixture-tested bounded adapters; a catalogue entry does not mean a live integration exists.
- WASM plugins run in bounded child processes with declared host capabilities. Miniapps are read-only data descriptors. The MCP surface exposes registered verified calculations and no writes or arbitrary SQL.
- Member tokens are hashed, scoped and checked against current epochs. Loopback HTTP is a local device interface; there is no public phone relay or hosted multi-user service.
- Encrypted one-writer sync requires an explicitly configured transport and remains experimental. Learning sharing defaults off and requires consent to exact structure-only bytes; no collection service is bundled.
- Reports identify missing periods and source coverage. They are drafts and do not constitute filed tax returns, certified financial statements or qualified lending packages.

## Source map

| Path | Purpose |
|---|---|
| `app/desktop/` | Electron host, sandboxed preload and packaging configuration |
| `app/renderer/` | Twelve-view product interface |
| `platform/runtime/` | Authority, business memory, calculators, connectors, approvals and integrations |
| `platform/helpers/` | Registered Python analytical helpers |
| `platform/tests/` | Numerical, security, transport and acceptance cases |
| `fixtures/plugins/` | Synthetic WASM fixtures |
| `enterprise/` | Separately recovered enterprise product engine and Python contracts |
| `docs/specs/` | Supplied architecture, build plan and quest log |
| `docs/evidence/` | Actual current verification records |

Read [security boundaries](SECURITY.md), [acceptance](docs/acceptance.md), [enterprise setup](docs/enterprise.md), [release qualification](docs/releases.md) and [GitHub handoff](docs/github-handoff.md) before expanding deployment scope.
