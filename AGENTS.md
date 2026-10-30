# Working on Chausar (for coding agents)

Chausar is a desktop and phone-ready web app for retail and self-employed owners in India who want to earn more with AI. An owner picks a way to earn (a playbook), and an AI team runs it; the owner approves every outside effect. The engine is TypeScript under `platform/`, the app is React (Ink) under `app/ui/`, the desktop shell is Electron under `app/desktop/`.

## Where the plan lives

- Spec: `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md`.
- Master plan and "How every wave runs": `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md`.
- Wave plans: `docs/superpowers/plans/2026-10-23-chausar-ink-v2-w{2,3,4,5}.md`.
- Wave 5 working notes (briefs, review brief, what was actually built): `docs/superpowers/plans/w5/`.
- What the app does and its known limits: `docs/venture/ink.md`, `docs/venture/*.md`.
- Catalogue of research rows: `docs/research/harvest/cards2/CATALOGUE.md`.

## Rules that never bend (the founder's)

- Nothing that spends, sends, posts, deletes or changes a price happens without the owner approving that exact thing. Standing configuration (webhooks, routines, monitors) also asks.
- Never fake a capability. Connector labels are honest: `write`, `read`, `handoff`, or `planned` with who it waits on and the manual path meanwhile.
- No detection evasion, proxy rotation, CAPTCHA solving, scraping against a platform's terms, or automated LinkedIn messaging. LinkedIn is copy-and-open only.
- Every amount is a code-computed figure with a receipt (shown as a small receipt mark), or labelled "model estimate". Money is BigInt minor units. The UI never computes money.
- Prices are always owner-set. Share prices are an advanced option one step away; a fixed price is the default. GST and tax fields only for businesses that need them.
- AI voices and presenters are disclosed; rights are recorded at intake.
- DPDP: minimum data, Forget really deletes, an opt-out is honoured at once.
- India first; rupees; Hindi for every new string (machine-drafted, listed in `app/ui/src/text/hi-review.json` for a native reviewer).
- Plain English, no em dashes anywhere (tests check).
- Out of scope: GST e-invoicing, Account Aggregator feeds, AIS/26AS/Form 16/2B readers.

## How work is done

- Test first: write the failing test, see it fail for the right reason, then implement.
- Engine tests: `node --test platform/tests/<file>.test.ts`. UI tests: `npx vitest run --config app/ui/vitest.config.ts <path>`.
- Before a commit: `npm run typecheck`, `npm run typecheck:ui`, `node scripts/check.mjs`, the tests near your change. Before a PR: `npm run test:ui`, `npm run build:ui`, the six engine shards (`node scripts/bench.mjs --shard=N/6 --output results/<name>.json`, one at a time) and the screenshot walk (`node scripts/ui-shots/walk.mjs --cdp=9481 --workers=4`).
- Ink UI rules (held by tests): tokens only, no inline styles, type never below 12 px, motion once and at most 400 ms, one filled primary per card, quotes in `[data-content]`, contrast 4.5:1 in both themes, locked buttons `aria-disabled`, no sideways scroll at 390 px, word budgets per place in `app/ui/tests/baselines/words.json` (they only shrink; raises go to the founder in the PR).
- The fake engine (`app/ui/src/engine/fake*.ts`) must answer exactly like the engine: same codes, shapes, order and field-exact checks.
- Commits: conventional (`feat(w5): ...`), identity `kartavyc <263844514+kartavyc@users.noreply.github.com>`. One PR per wave, stacked on the previous wave's branch; the founder merges.

## Traps already hit (read before you lose an hour)

- Engine tests need the default temp folder on C:. Many assert C-drive scratch, so never point TMP at another drive for `node --test` or the bench.
- `scripts/bench.mjs` writes its output only inside the repo (use `results/`, which git ignores).
- A shard that times out at the same test number every run is a hang, not slowness: run that file alone with a time limit.
- `node --check` (scripts/check.mjs) only strips TypeScript from a file whose first statement is an import or export. A file that opens with a bare `type` alias or a typed `const` fails.
- This machine converts line endings on commit. A fixture that must be byte for byte (CRLF shims, binary samples) needs a `-text` line in `.gitattributes`, or Linux CI reads a different file.
- A row's `businessId` is the workspace id; `venture.get().venture.id` is a `venture_...` record id. Never compare them.
- Test fixtures must never contain strings shaped like real provider keys or tokens (GitHub push protection blocks the push). Build them at runtime.
- Port 5432 is Postgres on the founder's machine. Stop dev servers and headless Chrome you start; leftovers pile up.
- `docs/venture/architecture.md` "copied as is" fails only on the founder's machine (it compares a local working file); CI skips it.
- Never commit the root `package-lock.json` (a stray leftover).
