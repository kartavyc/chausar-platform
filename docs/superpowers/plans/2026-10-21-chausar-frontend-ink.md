# Plan: Chausar frontend "Ink" and its engine pieces

## Goal
Build the spec `docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md`: a React frontend for desktop and web in the Ink look, plus the engine contracts and mechanisms it needs, on branch `b2c/frontend-ink`.

## How the work runs
- Many subagents in ONE checkout (`D:\claude\chausar-platform`), one integrator (the main session) who commits after each phase.
- Agents: never `git commit`, `git stash`, `git checkout -- <path>`, `git reset`, `git switch`, or delete files they did not create. Edit shared files with the Edit tool only (never rewrite a shared file whole), re-reading if an edit fails because the file changed.
- Agents run only their own tests. Never the full suite (`npm test`), which must run serially with nothing else running.
- Commit identity (integrator only): `git -c user.name=kartavyc -c user.email=263844514+kartavyc@users.noreply.github.com commit`.
- Windows: Python edit scripts open files as UTF-8; the Write/Edit tools can turn backslash-u escapes into raw characters, so write non-ASCII directly.
- TDD inside each package: failing test first, then code, then the test passing.

## Tech stack
Engine: Node 24 TypeScript with type stripping, `node --test`. UI: React 19.3, Vite 8.3, CSS Modules, vitest 5 + jsdom 30 + @testing-library/react 16 (installed, exact pins). No react-intl or react-aria: a small `t()` with plural by exact digits.

## Shared contract (both sides build to exactly this)

```ts
// added to platform/runtime/venture/contracts.ts and mirrored in app/ui/src/engine/types.ts
export type Display = string; // engine-formatted text; the UI never computes it
export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again';
export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }
export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean }
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector';
export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
}
export interface QueueList { rows: QueueRow[]; summary: Display; needsYou: number; businesses: number }
export interface QueueDecision { outcome: 'done' | 'stale' | 'refused'; line: Display; receiptId?: string; latest?: QueueRow; reason?: string }
export type RunState = 'active' | 'waiting' | 'done' | 'failed';
export interface RunStep {
  id: string; purpose: string; state: 'done' | 'current' | 'pending' | 'waiting' | 'failed'; elapsed?: Display;
  tools?: { name: string; line: string }[]; evidence?: { kind: string; id: string; label: string }[]; error?: string; audited?: boolean;
}
export interface RunSummary {
  runId: string; businessId: string; agent: string; purpose: string; state: RunState; startedAt: string; elapsed: Display;
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
}
export interface RunDetail extends RunSummary { steps: RunStep[]; question?: { id: string; text: string; choices?: string[] }; error?: string }
export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';
export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
}
export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed';
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string }
// phase 2 views
export interface SpendRow { id: string; agent?: string; connector?: string; label: string; reserved: Display; settled?: Display; kind: 'estimate' | 'billed' | 'refused'; receiptId?: string }
export interface JournalEntry { id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string }
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean }
```

| Method | Params | Result |
|---|---|---|
| `venture.queue.list` | `{ scope?: 'current' \| 'all' }` | `QueueList` |
| `venture.queue.decide` | `{ id, digest, action: QueueActionId, answer?: string, viewed?: boolean }` | `QueueDecision` |
| `venture.runs.list` | `{ state?: 'active' \| 'done' \| 'all' }` | `{ runs: RunSummary[] }` |
| `venture.runs.get` | `{ runId }` | `RunDetail` |
| `venture.team.list` | `{}` | `{ agents: AgentView[] }` |
| `venture.team.gate` | `{ agentId, stepId, gate }` | `{ agent: AgentView }`; error `GATE_FLOOR` when loosening a floor step |
| `venture.spend.list` (phase 2) | `{}` | `{ rows: SpendRow[]; total: Display }` |
| `venture.journal.list` (phase 2) | `{ limit?: number }` | `{ entries: JournalEntry[] }` |
| `venture.evidence.list` (phase 2) | `{ subject?: string }` | `{ items: EvidenceItem[] }` |
| `venture.evidence.apply` (phase 2) | `{ id }` | `{ item: EvidenceItem }` |

Events `VentureRunEvent` join `VENTURE_EVENTS`; desktop gets them pushed over IPC (`chausar.onEvent`), web over SSE `GET /api/events`.

## Phase 1 (parallel)

### P1-A Engine contract and views (agent "contracts")
**Files owned:** `platform/runtime/venture/views/queue.ts`, `views/runs.ts`, `views/team.ts`, `views/events.ts`, tests `platform/tests/venture-views-*.test.ts`. **Shared, Edit only:** `venture/contracts.ts`, `runtime/engine.ts`, `venture/host.ts`, `app/desktop/ipc-contract.cjs`, `app/desktop/preload.cjs`, `app/desktop/main.cjs`, `platform/runtime/server.ts` (SSE), hosted contract if not derived.
**Steps:** failing tests for each method on a test store (reuse `venture-test-store.ts`), then views built from existing records (delivery runs, blueprint, compose decisions, price quotes, invoices, models status, custody), digest = sha256 of the row's canonical JSON, decide-once, stale refusal, cross-business via `workspace.list` reading only businesses openable without a passphrase (others `locked`). Run `node --test platform/tests/venture-views-*.test.ts platform/tests/venture-contracts.test.ts` green.

### P1-B UI foundation (agent "foundation")
**Files owned:** `app/ui/**` (scaffold, tokens, fonts copied from `git show origin/claude/clever-goldberg-49qobq:app/ui/assets/fonts/*`, text system, engine client + fake engine with fixtures for Lumen Studio and Ledgerline, shell, parts, test setup), `scripts/build-ui.mjs`. **Shared, Edit only:** `package.json` scripts (`build:ui`, `dev:ui`, `test:ui`, `typecheck:ui`), Electron and local-server serving of `app/ui/dist` behind `--ink` / `CHAUSAR_UI=ink`.
**Parts:** Row, ApprovalRow, Change, Receipt, ModelEstimate, Button, Sheet, RunSheet, Steps, JobList, EmptyState, Field, Gate, Provenance, ConnectorLabel, StatusLine. **Shell:** App, Rail, BusinessMenu, routes (hash), keys (J/K/Enter/A/D), theme before paint. Tests per part. `npm run test:ui` and `npm run build:ui` green.

## Phase 2 (parallel, after phase 1 is committed)

UI places, each owning `app/ui/src/places/<place>/**`, `app/ui/src/text/en/<place>.json`, `app/ui/src/text/hi/<place>.json`, `app/ui/tests/places/<place>*.test.tsx`:
- P2-today: queue rows, decide flows (view-before-approve, second ask, stale), Working now, empty state, keys.
- P2-team: agent list, agent sheet with gates (calls `venture.team.gate`, shows GATE_FLOOR refusal), posture, spend.
- P2-work: active/previous runs and jobs (JobList), orders with state sentences, URL filter, run sheet.
- P2-clients: client list and sheet, orders, drafts, provenance underlines (uses `venture.evidence.list`).
- P2-money: invoices, payments, quotes, books summary, spend (`venture.spend.list`), journal (`venture.journal.list`), receipts.
- P2-connections-business: connectors with labels and modes, your AI, business menu (switch, plan, prices, build, new).
- P2-onboarding: one box, plan as first row, setup rows.

Engine mechanisms, each owning a new folder under `platform/runtime/venture/` plus `platform/tests/venture-<name>*.test.ts`, shared files Edit only:
- P2-journal: `venture/journal/` action journal (7.2) + bound single-use tokens (7.3), `venture.journal.list`; wire into delivery approve and invoice issue paths.
- P2-posture: `venture/policy/` ladder, always-ask floor, allow/deny/ask fail-closed, gates start denied; enforce in harness tool calls and `venture.team.gate`.
- P2-spend: `venture/money/spend.ts` reserve-then-settle, unknown price refused, charge-before-call, quote binding; `venture.spend.list`.
- P2-judge: `venture/delivery/judge/` per-rule yes/no with cited evidence checked by code, per-check floors, pairwise, claim checks against source files, baselines; plus the auditor role (7.7) in the harness loop.
- P2-evidence: `venture/evidence/` ledger, claim labels, `venture.evidence.list/apply`; number guard changed from refuse to label (`estimate: true`), updating the tests that pinned refusal.
- P2-connectors: posting modes (api / owner-browser-session / handoff) with risk lines, bank read-only connector shape (planned), staged website edits, lead rules (source URL, MX check, blocklist, drafts only, unsubscribe and postal address).

## Phase 3 (parallel, after phase 2 is committed)
- P3-youtube, P3-ca-firm, P3-social: playbooks as data plus deterministic checks (7.8), each in `venture/playbooks/<name>/`, registered via Edit in the playbook registry, with a dated platform-rules register.
- P3-wire: the UI uses the real engine end to end (desktop IPC, web SSE), event-driven refresh, `ui.renderer` setting, axe checks, en/hi parity test.

## Phase 4 (integrator)
- `npm run typecheck`, `npm run typecheck:ui`, `npm run test:ui`, `npm run build:ui`, full serial `npm test`.
- Launch the local server with Ink and capture every place in light and dark at 1280 and 390 px; self-critique against the founder's taste; fix.
- Code review pass on the diff; fix findings.
- Commit per phase with conventional messages; docs in `docs/venture/frontend-ink.md`.

## Pre-execution checklist
- [x] Every spec section maps to a package (4: P1-B, P2 places; 5: P1-B; 6: P1-B, P3-wire; 7.1: P1-A; 7.2-7.3: P2-journal, P2-posture; 7.4: P2-spend; 7.5, 7.7: P2-judge; 7.6: P2-evidence; 7.8: P3 playbooks; 7.9: P2-connectors; 8: P2 places; 9: every package + phase 4)
- [x] One shared contract block, used by both sides
- [x] Exact folders per agent, shared files Edit only
