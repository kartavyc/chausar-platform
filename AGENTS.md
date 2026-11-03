# Working on Chausar (for coding agents)

Chausar is a desktop app for ordinary professionals (India first, global too) who want to earn more with an AI-run service business built around their skills. An owner picks a way to earn (a playbook), and an AI team runs it; the owner approves every outside effect. The engine is TypeScript under `platform/`, the app is React (Ink) under `app/ui/`, the desktop shell is Electron under `app/desktop/`. The beta is a free download for Windows and Linux; there is no Chausar-hosted server.

## Where the plan lives

Plans, specs, research and requirements are private. They live in the private repository `kartavyc/chausar-private`, checked out next to this one (`../chausar-private`), not in this public repository. Paths below are inside that checkout; older comments in the code that say `docs/superpowers/...` mean the same path there.

- Wave 6 (current): decisions `docs/superpowers/plans/w6/DECISIONS.md`, work packages `docs/superpowers/plans/w6/PACKAGES.md`, review checklist `docs/superpowers/plans/w6/REVIEW.md`, notes `docs/superpowers/plans/w6/NOTES-6.md`, new screens `docs/superpowers/plans/w6/reference-ui/`. Where wave 6 decisions differ from older docs, wave 6 wins.
- Spec: `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md`.
- Master plan and "How every wave runs": `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md`.
- Wave plans: `docs/superpowers/plans/2026-10-23-chausar-ink-v2-w{2,3,4,5}.md`.
- Wave 5 working notes (briefs, review brief, what was actually built): `docs/superpowers/plans/w5/`.
- Catalogue of research rows: `docs/research/harvest/cards2/CATALOGUE.md`.
- The enterprise engine (formerly `enterprise/` here) is in that repository too.

What the app does and its known limits stays public, in this repository: `docs/venture/ink.md`, `docs/venture/*.md`.

## Rules that never bend (the founder's)

- Nothing that spends, sends, posts, deletes or changes a price happens without the owner approving that exact thing. Standing configuration (webhooks, routines, monitors) also asks. Steps inside a job are reviewed by the AI tool's own reviewer (Codex auto review, Claude Code auto mode); client data reaches the AI only after one recorded consent per client.
- The AI tool is the agent. Chausar drives the owner's Codex or Claude Code (or a key) and gives it Chausar's engine as MCP tools; Chausar keeps receipts, approvals, consent, the quality check and the audit log.
- Limits are owner settings with sensible defaults (posting pace, outreach caps, spend caps). Show the platform's own risk in plain words; never hard-code a ceiling the owner cannot change.
- Hard stops no owner attestation can unlock: stock tips, target prices or promised returns without a SEBI registration; advocates advertising or soliciting; AI diagnosis or prescription; children's data without verified parental consent; CAPTCHA bypass, detection evasion, LinkedIn automation, fake reviews; undisclosed AI voices or presenters.
- Never fake a capability. Connector labels are honest: `write`, `read`, `handoff`, or `planned` with who it waits on and the manual path meanwhile.
- No detection evasion, proxy rotation, CAPTCHA solving, scraping against a platform's terms, or automated LinkedIn messaging. LinkedIn is copy-and-open only.
- Every amount is a code-computed figure with a receipt (shown as a small receipt mark), or labelled "model estimate". Money is BigInt minor units. The UI never computes money.
- Prices are always owner-set. Share prices are an advanced option one step away; a fixed price is the default. GST and tax fields only for businesses that need them.
- AI voices and presenters are disclosed; rights are recorded at intake.
- DPDP: minimum data, Forget really deletes, an opt-out is honoured at once.
- India first; rupees by default from the owner's time zone and words, never from the computer's language setting. English only for now (Hindi was removed in wave 6; keep the translation plumbing so it can return).
- Plain English, no em dashes anywhere (tests check).
- Out of scope: GST e-invoicing, Account Aggregator feeds, AIS/26AS/Form 16/2B readers.

## How work is done

- Test first: write the failing test, see it fail for the right reason, then implement.
- Engine tests: `node --test platform/tests/<file>.test.ts`. UI tests: `npx vitest run --config app/ui/vitest.config.ts <path>`.
- Before a commit: `npm run typecheck`, `npm run typecheck:ui`, `node scripts/check.mjs`, the tests near your change. Before a PR: `npm run test:ui`, `npm run build:ui`, the six engine shards (`node scripts/bench.mjs --shard=N/6 --output results/<name>.json`, one at a time) and the screenshot walk (`node scripts/ui-shots/walk.mjs --cdp=9481 --workers=4`).
- Ink UI rules (held by tests): tokens only, no inline styles, type never below 12 px, motion once and at most 400 ms, one filled primary per card, quotes in `[data-content]`, contrast 4.5:1 in both themes, locked buttons `aria-disabled`, no sideways scroll at 390 px, word budgets per place in `app/ui/tests/baselines/words.json` (they only shrink; raises go to the founder in the PR).
- The fake engine (`app/ui/src/engine/fake*.ts`) must answer exactly like the engine: same codes, shapes, order and field-exact checks.
- Live checks: a package that talks to an installed tool or an outside service is not done until it has run once for real on harmless sample data (the founder's own Codex on this machine, test-mode accounts), with the result written in the notes. Fixture tests alone hid a Windows bug for weeks.
- Commits: conventional (`feat(w6): ...`), identity `kartavyc <263844514+kartavyc@users.noreply.github.com>`. One PR per wave, stacked on the previous wave's branch; the founder merges.

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
