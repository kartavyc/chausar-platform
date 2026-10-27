# Wave 5 handoff (Claude Code to Codex, 27 October 2026)

Read `AGENTS.md` at the repo root first: the founder's rules, how work is done, and the traps already hit.

## Where things stand

| Wave | Branch | PR | State |
|---|---|---|---|
| 1 safety | `b2c/ink-v2-w1` | #5 | green, waits for the founder to merge |
| 2 wiring | `b2c/ink-v2-w2` | #6 (base w1) | green, waits |
| 3 the look | `b2c/ink-v2-w3` | #7 (base w2) | green, waits |
| 4 new features | `b2c/ink-v2-w4` | #8 (base w3) | green 28/28, waits; the founder confirms the word baselines and three questions in its description |
| 5 playbooks | `b2c/ink-v2-w5` (base w4) | not opened | in progress, below |

The founder merges #5, #6, #7, #8 in that order himself. Never merge them.

## Wave 5 progress

The plan is `docs/superpowers/plans/2026-10-23-chausar-ink-v2-w5.md` (39 packages in five steps). Working notes in this folder:

- `BRIEF.md`: the implementer brief every package follows (engine and screens together).
- `REVIEW.md`: the reviewer brief (stage 1 spec, stage 2 quality).
- `NOTES-5-0.md`: what package 5-0 actually named and built, the pinned counts, the wave 4 pieces and where they live. It wins over the plan where they differ.

| Package | Built | Review | Fix round | What the next agent must do |
|---|---|---|---|---|
| 5-0 shared names, stubs, seams | yes | (mechanical) | n/a | nothing |
| 5A1 playbook kit | yes | passed after one fix round | done | two nits in NOTES ("5A1 DONE") |
| 5A2 pilot, proposal, exit, GO card, share prices | yes | 1 blocker, 5 should-fix | done, not re-reviewed | re-review against the "Batch 1 review findings" list in NOTES |
| 5A3 dated rules, manual paths, recipes, boundaries, ideas | yes | 4 should-fix | done, not re-reviewed | re-review; note `DatedRule.needs` is now required on every rule |
| 5A4 brand kits, assets, media hygiene, voice consent, captions | yes | 2 blockers, 6 should-fix | done, not re-reviewed | re-review; check each new test fails without its fix (most were written after the fix) |
| 5A5 reports, PDF, DOCX, XLSX, JSON-LD | yes | 1 blocker, 4 should-fix | done, not re-reviewed | re-review |
| 5A6 local apps, monitors, webhooks, mail in, speech out, fetch policy | yes | 6 should-fix | done, not re-reviewed | re-review; the nits listed under "5A6 review" in NOTES stay open |
| Batches 2 to 4 (32 packages) | no | | | build, in the plan's order |

Batch 1 is committed together on `b2c/ink-v2-w5` (one commit after 5-0), since the six packages share several files. The full UI suite and the six engine shards were started at the hand-off; their results are in the section below if they finished.

### Checks at hand-off

CHECKS_AT_HANDOFF

## How each package was run (keep doing this)

1. One implementer per package, test first, following `BRIEF.md`; packages in the same batch run side by side in one checkout and touch shared files only with small edits in their own function or line.
2. A two-stage review per package following `REVIEW.md` (spec, then quality), by a separate reviewer with no stake in the code. Every blocker and should-fix goes back to the implementer; then a re-review, until both stages pass.
3. The integrator (you) commits each package after it passes, with a conventional message (`feat(w5): <package>: ...`), runs both typechecks and `node scripts/check.mjs`, and records anything the next packages need in `NOTES-5-0.md` (append numbered items).
4. After each batch: `npm run test:ui`, the six engine shards one at a time, both typechecks. After the last batch: the walk (`node scripts/ui-shots/walk.mjs --cdp=9481 --workers=4`, then `--publish-only` to refresh `docs/superpowers/designs/ink-v2-direction-d/side-by-side.html` and `WALK.md`), settle `app/ui/tests/baselines/words.json` from measured counts (list every rise for the founder), update `docs/venture/ink.md`, then push and open "Ink v2 wave 5: playbooks" on base `b2c/ink-v2-w4`, and get CI green on Ubuntu and Windows.
5. Before the PR, a cold review: someone with no context looks at the screenshots of every new place and reports what is confusing, wordy, broken or untrustworthy; fix what is real. In wave 4 this caught a forecast that contradicted the bank balance, a sidebar that said "No business open" while loading, and English inside Hindi screens.

## Order of the remaining work

From the plan's "Order of work":

- Batch 2 (after all of 5A): 5M lead generation, 5E1 SEO, 5K1 bookkeeping, 5F1 online seller, 5G support desk, 5B1 YouTube, 5C1 CA firm, 5D1 social.
- Batch 3: 5B2, 5C2, 5D2, 5E2, 5F2, 5K2, 5H recruiting, 5J1 translation, 5L podcast to article, 5N newsletter, 5O tender, 5P website, 5Q narration (each when its predecessor is in).
- Batch 4: 5B3, 5D3, 5F3, 5I job search, 5J2 dubbing, 5R1 to 5R6 (virtual assistant, data entry, app testing, dev agency, monitored data and IT triage, phone receptionist).

## Founder decisions that bind wave 5

- Share prices are in; the price editor shows a fixed price by default and "a share of an amount" is one step away. A pilot is never free.
- The phone receptionist (5R6) is built; live calls stay labelled planned until a calling provider is verified.
- Gallery tiles say "Hours and prices are model estimates for a typical start".
- Anything that turns out to need an outside review (marketplace, Shopify app, Zoho, social OAuth) stays labelled planned, with the manual path meanwhile.
- From wave 4, still binding: amounts show a small receipt mark (the code inside the receipt sheet); AI spend leads in the currency of the owner's location (rupees in India once a rate is set), changeable in Limits and rates; Today shows five cards and folds the rest; departments are fixed (sales, marketing, production, money, operations); agent chat proposes, the owner approves; LinkedIn is find, draft, the owner sends; WhatsApp is a wa.me handoff; the unsubscribe line only on cold outreach; auto mode is built but locked; push alerts are count-only; the judge runs automatically on drafts to clients or the public.

## Open questions for the founder (raise in the wave 5 PR)

- Should Forget also remove files a client uploaded to an order (they stay with the order today)?
- The TDS certificate wording on the payment sheet.
- `CHAUSAR_CLAUDE_CODE_TERMS` stays off until he confirms.
- The wave 4 word-baseline rises (listed in PR #8).

## Also not done

- Research on Nexscope (one of the 129 harvested products, closed source) with the REA reverse-engineering tools: not run. If REA is available to you, inspect its shipped app, record what it does that Chausar lacks, and add rows to the catalogue; otherwise list it in the PR as not researched.
- Engine-written English still shows inside Hindi screens where the engine sends free text rather than codes; all Hindi waits for a native reviewer.
