# platform/runtime: a map of the engine

The engine is TypeScript run by Node's type stripping (no build step in development; `npm run build:engine` bundles it for the packaged app, D7). Every amount is a code-computed figure with a receipt; nothing that spends, sends or posts happens without the owner's approval. This page says where things are. A test (`platform/tests/runtime-map-d11.test.ts`) fails when a new top-level folder here or under `venture/` has no line below.

## Entry points

- `worker.ts`: the desktop app's engine. Electron main (`app/desktop/main.cjs`) forks it as a Node process and talks to it over IPC through `app/desktop/engine-harness.cjs`.
- `server.ts`: the local web server (`npm start` runs the demo). It builds one `Engine` and forwards `/api/rpc` to it.
- `hosted/server.ts`: the experimental hosted server (`npm run start:hosted`). Off unless `CHAUSAR_HOSTED=1` or `--hosted`.
- `analytics-worker.ts` and `wasm-worker.mjs`: helper processes the engine starts itself.

`engine.ts` holds the `Engine` class: opening a business (the vault), custody, and the method switch that answers every request. Venture methods (`venture.*`) go to `venture/host.ts`, which loads each package's handler table on first use.

## The top-level folders

- `adapters/`: accounting adapters (Tally, Zoho Books, QuickBooks, Xero) that read a file or response into records with receipts.
- `config/`: `config/env.ts`, the one list of every `CHAUSAR_*` environment variable (see Flags).
- `connector-framework/`: the older connector framework: read dispatch, import bridge and source profiles.
- `gateway/`: the model gateway's parts (D11 split): types, the plan, request checks, one module per provider route, and the review checks. `gateway.ts` beside it keeps the `ModelGateway` class.
- `hosted/`: the hosted server: accounts, sign-in, config read from the environment, its app routes.
- `migrations/`: the data ladder (D12): `CURRENT_SCHEMA`, one numbered step per data version in `migrations/steps/`, and `migrate()`, which every business is opened through.
- `phone/`: the phone companion's host side: pairing, sessions, channels, approvals.
- `providers/`: the reviewed Codex command-line interface (`providers/codex-cli.ts`).
- `venture/`: the venture launcher, the product the Ink app shows (below).

The files at this level are the older engine surface (calculations, forecasts, investigations, sync, jobs, trust, workspace backup and interchange) and the shared pieces: `contracts.ts` (State and the engine's core types), `vault.ts` (the encrypted store), `portable.ts` (helpers with no Node import), `data-home.ts` and `run-root.mjs` (where data and run outputs live, never in the checkout), `engine-paths.ts` (finding the engine's own files, from source or bundle), `process-tree.ts` (starting and ending child processes), `updater.ts`.

## venture/

- `venture/agent-runtime/`: drives the owner's Codex or Claude Code as the agent, with Chausar's engine as MCP tools (the broker and the stdio bridge).
- `venture/agents/`: what an agent does with the owner's day: routines, talk, standing work.
- `venture/apps/`: mini apps the owner asks for.
- `venture/build/`: building the business: the website brief, browser sign-ins, posting, share links, site edits.
- `venture/chief/`: the chief's answer: what needs the owner now.
- `venture/clients/`: clients and their consent.
- `venture/core/`: About you, the plan, countries, onboarding.
- `venture/crm/`: CRM shapes, request checks and views.
- `venture/customers/`: the customer engine's lead rules.
- `venture/delivery/`: doing the work: the delivery harness, runs, rehearsals, quality checks, Away.
- `venture/draft/`: the draft desk: AI and plan state before any vault exists.
- `venture/evidence/`: the evidence ledger behind each client and business field.
- `venture/flows/`: recorded flows (recipes).
- `venture/journal/`: the hash-chained journal of owner actions.
- `venture/media/`: media handling for posts.
- `venture/memory/`: dated memory.
- `venture/models/`: AI connections: presets, the port every model call goes through, costs, replay.
- `venture/money/`: invoices, payments, receipts, spend and goals.
- `venture/network/`: outreach and connection notes, within the platforms' rules.
- `venture/notify/`: notifications to the owner's browsers and phone.
- `venture/packs/`: playbook packs.
- `venture/people/`: people search data.
- `venture/playbooks/`: the ways to earn and their steps (the biggest folder).
- `venture/policy/`: approval policy ("allow for this session" and the like).
- `venture/replay/`: capturing a run on a sample business and replaying it against later code (developer-only; the engine and driver hooks come after the D11e rebase).
- `venture/views/`: views across businesses (runs, money).
- `venture/web/`: the web methods.

`venture/contracts.ts` holds the venture records and method types; `venture/host.ts` routes `venture.*` methods; `venture/records.ts` keeps records in State.

## Boundaries

`scripts/check-boundaries.mjs` holds the rule: `platform/shared` and `platform/contract` (when they exist) import no `node:` module and nothing from here, and the Ink app (`app/ui/src`) value-imports from `platform/` only through them; `import type` from here is allowed. CI runs it in report mode until D11a task 2 moves the helpers the UI imports.

## Flags

Every `CHAUSAR_*` variable is listed in `config/env.ts` with its meaning, default and readers. `node scripts/env-docs.mjs --write` makes `.env.example` and `docs/configuration.md` from it; `--check` (in CI) fails when source reads a name the list lacks.

## Adding a method

Today a method needs four places: its arm in `engine.ts` (or a handler in a `venture/` package's table, routed by `venture/host.ts`), its payload and result types in `venture/contracts.ts` (or `contracts.ts`), its name in the desktop allowlist `app/desktop/ipc-contract.cjs`, and its UI types in `app/ui/src/engine/types.ts`, with the fake engine answering the same way. D8 replaces the hand lists with a generated method registry; the older methods no Ink screen calls move to `legacy/` in D10. Both come after the rebase.
