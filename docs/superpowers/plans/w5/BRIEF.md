# Wave 5 implementer brief (Chausar Ink v2, playbooks)

You implement ONE package of wave 5. Wave 5 turns each business in the catalogue into a playbook an owner picks from the Start gallery and runs with an AI team. Waves 1 to 4 are committed (PRs #5 to #8). Read, in order:
1. `D:\claude\chausar-platform\docs\superpowers\designs\2026-10-23-chausar-ink-v2.md` (the approved spec; sections 1 to 3 and 5.8).
2. `D:\claude\chausar-platform\docs\superpowers\plans\2026-10-23-chausar-ink-v2.md`: "How every wave runs".
3. `D:\claude\chausar-platform\docs\superpowers\plans\2026-10-23-chausar-ink-v2-w5.md`, fully: "Founder decisions added 23 Oct", "What every playbook ships", "Shared files and sequencing", package 5-0, the 5A packages (what the kit gives you), and YOUR package.
4. `docs\superpowers\plans\w5\NOTES-5-0.md`: what 5-0 and earlier packages actually built (names, shapes, codes). It wins over the plan where they differ.
5. The catalogue rows and cards your package names (`D:\claude\chausar-platform\docs\research\harvest\cards2\CATALOGUE.md` and the card files beside it). Read the code they cite before changing it: waves 2 to 4 changed many files.
6. For screens: `docs\venture\ink.md`, the boards in `docs\superpowers\designs\ink-v2-direction-d\` (D-STYLE.md, D-Start and the place your desk lives in) and wave 4's parts in `app\ui\src\parts`.

## Who the app is for

Retail and self-employed owners in India who want to earn more with AI. Easy, convenient and calm, with the depth and polish of a production-grade app. Visual cues (tiles, cards, rings, bars, avatars, previews), "simple first": plain words and one clear next step by default; detail one step away; nothing a business does not need.

## Rules (the checkout is shared with other agents)

- Repo `D:\claude\chausar-platform`, branch `b2c/ink-v2-w5`. Never commit, stash, reset, checkout, switch branches or run git commands that change state. Read-only git is fine. The integrator commits.
- Own your package's files: your playbook folder, your stub files from 5-0 (registration, definition, desk, tools-<id>, catalogue/<id>, <Id>Desk.tsx, fake-<id>.ts), your `pb-<id>.json` / `kit-*.json` text files, your tests. Shared files (the plan's table) get small, targeted Edit calls only, in your own function or line. Re-read the region right before each Edit; never rewrite a shared file whole; never reformat code you do not change. If 5-0 missed a name you need, add it with one small edit and say so.
- Test first, for every behaviour: failing test, see it fail for the right reason, implement, see it pass. Engine: `node --test platform/tests/<file>.test.ts` (expect `fail 0`). UI: `npx vitest run --config app/ui/vitest.config.ts <path>`. Run the existing tests nearest to what you changed, plus `app/ui/tests/source-rules.test.ts`, `text.test.ts`, `a11y.test.tsx` and `budgets.test.tsx` when you touch screens. Do NOT run the whole suite or `scripts/bench.mjs` (the integrator does).
- Typecheck at the end: `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p app/ui/tsconfig.json`. Errors in files you did not touch may be another agent's work in progress: note them, do not fix them.
- Test fixtures never contain strings shaped like real provider keys, tokens or webhooks (GitHub push protection blocks the push): build them at runtime, e.g. `'sk_' + 'live_...'`. A fixture that must be byte for byte (CRLF files, binary samples) needs a line in `.gitattributes` (`-text`): this machine converts line endings on commit and Linux CI then reads a different file.
- The fake engine answers exactly like the engine: same codes, shapes, order, refusals, and field-exact checks (a fake that accepts what the engine refuses hid a real blocker in wave 4). A row's `businessId` is the workspace id; `venture.get().venture.id` is a `venture_...` record id: never compare them.
- Match the surrounding code: a short header comment per file naming what it learned from and that source's licence (learn-only sources give ideas, never code), doc comments on exported functions, `ChausarError` with an UPPER_SNAKE code and plain words, BigInt money, records in the vault, journalled outside effects, receipts on figures, model-written figures labelled "model estimate".
- Founder rules that never bend: nothing that spends, sends, posts, deletes or changes a price happens without the owner's approval of that exact thing; never fake a capability (honest labels: write, read, handoff, planned with who it waits on and the manual path meanwhile); no detection evasion, proxy rotation, CAPTCHA solving, scraping against a platform's terms or automated LinkedIn messaging; AI voices and presenters disclosed, rights recorded at intake; DPDP: minimum data, Forget really deletes, opt-out; prices are always owner-set; share prices are an advanced option one step away, fixed price by default; GST and tax fields only for businesses that need them.
- Screens: Ink rules (held by tests): no inline styles; tokens only; type never below 12 px; motion once, 400 ms or less, nothing loops; one filled primary per card; every amount through `Figure` with a receipt (shown as the small receipt mark) or "model estimate"; quotes in `[data-content]`; contrast 4.5:1 light and dark; no emoji; locked primaries `aria-disabled`; phone at 390 with no sideways scroll. Every new string in `app/ui/src/text/en/<file>.json`, the same key in `hi/<file>.json` and in `hi-review.json`. Engine codes are worded by the UI in both languages.
- Words: plain English, Hindi where the package says so, no em dashes anywhere.
- If something is genuinely ambiguous, choose the option safest and most consistent with the spec and the founder's decisions, and say so in your report. If a row turns out already done, prove it with a test and say so.

## Look at your own work (screens)

Start `npx vite --config app/ui/vite.config.ts --mode fake --port <yours> --strictPort` in the background, screenshot with `node scripts\ui-shots\shoot.mjs "http://localhost:<port>/#/<place>" <out.png> [--dark] [--phone] --cdp=<yours> [--click=<button text>]`, Read the PNG, fix what is off, check 390 and dark, and stop your server and Chrome when done (leftover servers pile up). Port 5432 is Postgres: never use it. Save shots under `D:\claude\tmp-agents\shots\<package>\`.

## Report (at most 25 lines)

Files changed or added; each test file with its pass count; the exact commands you ran last and their result lines; screenshots (paths) if any; decisions on ambiguities; anything not done and why; names 5-0 missed that you added; typecheck errors you saw outside your files.

## Disk and temp folders

Engine tests need the default temp folder on C: (many assert C-drive scratch), so run `node --test` with TMP unchanged. Point everything else that writes much (Vite, Chrome profiles, screenshots, scratch builds) at `D:\claude\tmp-agents\<your package>` and delete that folder when you finish.

## Editing gotcha

In this shell a double backslash inside a heredoc can collapse to one, and editors can turn unicode escapes into literal invisible characters. Prefer the Edit tool for code, keep escapes like \u200B as escapes, and scan your files for control or invisible characters before you hand back.
