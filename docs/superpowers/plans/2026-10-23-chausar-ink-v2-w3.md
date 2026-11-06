# Plan: Chausar Ink v2, wave 3 (the look)

## Goal

Every place in the Ink app takes the direction D look the founder chose on 23 October: tokens with the Jade accent (#2FB67C) and dark pairs, the new parts (spec 4.2) with tests, Today, Team, Work, Clients, Money, Connections, Business and Start rebuilt from the D boards, the phone layout, Hindi for every new string, and a screenshot walk at 1280 and 390 in light and dark against the boards. The catalogue's 27 W3 rows are covered (table below).

Wave 3 changes the UI only. No engine file, no engine method and no field in `app/ui/src/engine/types.ts` is added. Where a D board shows data the engine does not send yet, the place renders what is real and leaves the rest out, and this plan names the W4 package that brings it ("placeholder until W4 4X"). Nothing is faked to make a screen match a board.

Inputs: the spec `docs/superpowers/designs/2026-10-23-chausar-ink-v2.md` (sections 3, 4, 8, 9), the master plan `docs/superpowers/plans/2026-10-23-chausar-ink-v2.md` ("How every wave runs"), the catalogue `docs/research/harvest/cards2/CATALOGUE.md` (rows tagged W3, section 2.8 most of all), and the direction D boards (copied into the repo by 3-0, below). Paths are relative to `app/ui/` unless they start with `docs/`, `scripts/`, `platform/` or the repo root.

## Founder rule added 23 Oct: simple first

Self-employed people and retail owners must not find business, share or tax detail daunting. Every place shows the simple path first (a fixed price, plain words, one clear next step) and keeps advanced detail (share prices, tax registration, GST fields, rate tables, receipts' inner workings) one step away, behind a "More" or "Details" control, shown only when the business needs it. A business not registered for GST never sees GST fields. Each place's tests assert the default view hides the advanced controls and that they open on request.

## Before the wave starts (package 3-0, the integrator, size S)

1. Branch `b2c/ink-v2-w3` from `b2c/ink-v2-w2` once the wave 2 integrator has committed every W2 package. W3 restyles what W1 and W2 left: W1 1H's business menu popover (`shell/BusinessMenu.tsx`), 1B's journal Resolve (`places/money/Journal.tsx`), 1C's spend settings (`places/money/SpendPolicy.tsx`), and W2's new screens (`places/work/{PostButtons,JudgeLine,TranscribeButton,CalendarFile}.tsx`, `places/connections/{Posting,StepsCheck,BankSheet}.tsx`, `places/business/{PracticeView,RulesSection}.tsx`). Re-read each before restyling it.
2. Copy the direction D boards into the repo, because the scratchpad they live in is temporary: `D-STYLE.md`, every `D-*.dc.html` and the PNGs in `shots\D-*.png` and `shots\greens-compare.png` from `C:\Users\karta\AppData\Local\Temp\claude\D--claude-chausar-2\9629065d-c889-4ae9-bf61-c82904c8e5ca\scratchpad\ink-v2-mockups\` into `docs/superpowers/designs/ink-v2-direction-d/` (boards at the top, PNGs in `shots/`). Every package below cites boards by these paths.
3. Add `lucide-react` (MIT) to the root `package.json` devDependencies beside `react`, pinned to the exact version current at wave start (the repo pins every version), and commit `package-lock.json`. Read its licence file; the PR says why it is the one new dependency.
4. Commit 1 to 3 as `docs(w3): direction D boards and the icon dependency`.

## The rules that hold, and the test that holds each

Everything in "How every wave runs" applies (test first, packages in one checkout, no worktrees, agents never commit, stash, switch branches or run the full suite, shared files by small Edit calls only, every new string in `src/text/en/*.json` and `hi/*.json` in the same change, no em dashes).

| Ink rule | How it is held in W3 |
|---|---|
| Receipts on figures | Every money figure renders through the `Figure` part (3B1a), which takes a receipt id or `estimate`, never both and never neither (a type union). `tests/helpers/ink-rules.ts` `assertFiguresProved(root)`: each `[data-ui-number]` sits in a `[data-figure]` that holds a `[data-receipt]` or a `[data-estimate]`. Every place test calls it. Counts (steps, people, runs) use `Count`, which carries no proof and no `data-ui-number` |
| Model estimates labelled | `Figure estimate` renders the "model estimate" chip and no receipt; the gallery's price ranges and any model-written number go through it |
| One filled primary per card | `assertOnePrimary(root)`: every `[data-card]` and every `li[data-row]` holds at most one `[data-variant="primary"]`. Every place test calls it |
| Second ask | ApprovalRow keeps its tested second ask; the card layout and the phone swipe both go through it (3B5a, 3H1) |
| View before approve | A primary with `requiresView` stays locked until the owner opens the thing with Watch, Read or Open. A preview drawn in a card at rest does not count as viewed (tested in 3B5a and 3C) |
| Motion once, 400 ms or less | `motion.css` keeps no `infinite`; a new source rule: every `animation` and `transition` in a CSS module uses a `var(--t-...)` duration, and `animation` appears only in `Sheet.module.css`, `ApprovalRow.module.css` and `Today.module.css` (the decided settle, as today) and `SwipeCard.module.css` (snap back). No spinner turns; the "current step" arc and the unknown-length bar are still shapes. The catalogue's "one slow pulse" (U6) and "examples cycle" (U3) are dropped for this rule |
| No emoji, no AI personality | New source rule: no `\p{Extended_Pictographic}` in `src/` or the text files. 3H2 adds a banned-words list for English copy |
| Contrast 4.5:1 in both themes | `tests/contrast.test.ts` checks every text and ground pair in the token table below, light and dark; non-text pairs at 3:1 |
| Dark theme for every new token | `tests/tokens.test.ts`: every colour token in `:root` has a value in both dark blocks, except the theme-invariant list (accent, accent ink, rings, preview art) |
| The accent is a token, never hard-coded | New source rule: `2fb67c` (any case) appears in `src/` only in `tokens.css`; `46f09b` nowhere. `public/icon.svg`, `public/manifest.webmanifest` and `index.html` may hold literals, and a test checks they equal the token values |
| No inline styles | Unchanged (`source-rules.test.ts` bans `style=` props). Lengths that vary (bars, rings, chart heights) are SVG attributes (`width`, `height`, `x`, `pathLength`, `stroke-dasharray`, `points`), states are `data-*` attributes styled in CSS modules |
| Colours from tokens | Unchanged for hex; new rule: no `rgb(`, `rgba(` or `hsl(` in CSS modules either (shadows and scrims are tokens) |
| No money arithmetic | Unchanged. Charts take engine-scaled integers (per mille) and engine-formatted labels; a ring of "3 of 5" uses `pathLength={5}` and a dash of `3 5`, so nothing is divided |
| Type never below 12 px | D's 11.5, 11, 10.5 and 9.5 px sizes become 12 px; half sizes snap to the Ink scale (13.5 to 14, 12.5 to 13, 14.5 to 15). New source rule: `font-size` in CSS modules is only `var(--text-...)` or `var(--fig-...)` |
| Spacing on tokens | New source rule with a per-file baseline that may only shrink (catalogue U13): padding, margin and gap in CSS modules are tokens, `0` or `calc()` of tokens; today's raw values are counted into `tests/baselines/spacing.json` once by 3A1 |
| No em dashes, nothing in browser storage, text nodes only | Unchanged. The swipe tip's dismissal is held in memory for the session |
| Text parity | Unchanged (`tests/text.test.ts`); 3H2 adds the machine-drafted Hindi list |
| axe on every place and sheet | `tests/a11y.test.tsx` gains each new address and opened state; 3I runs axe again in a real browser with colour contrast on |
| Word budgets | 3I replaces Money's single "45 words" test with a per-place baseline that may only shrink (`tests/baselines/words.json`), plus per-part limits (a card's own copy, a sub line of at most 20 words). D carries far more words than the Ink v1 desk; the founder should confirm the new baselines in the PR |

## How the D boards become code

- **Classes.** Each D class becomes a camelCase class in the CSS module of the part that owns it (`.qc-head` becomes `qcHead` in `ApprovalRow.module.css`). The D base block (`D-Today.dc.html` lines 13 to 296) is the reference for every part; each package below names the D classes it ports.
- **Holes.** `{{accent}}` is `var(--accent)`, `{{accentInk}}` is `var(--accent-ink)`, `{{accentSoft}}` is `var(--accent-soft)`. Green text on light is `var(--accent-text)` (#0B7A45 light, the accent itself in dark).
- **Inline styles in the boards** (`style="width:60%"`, `flex:45080`, box-shadow rings, logo fills) become SVG attributes or `data-*` states: a working ring is `data-state="working"` on the avatar and `box-shadow: 0 0 0 2px var(--ring-ground), 0 0 0 4px var(--accent)` in `Avatar.module.css`, where `--ring-ground` is set by the container (surface on tiles, inner on inner cards, the department tint on panels).
- **Literal values to tokens**: `#fbfbfa` `--bg`; `#ffffff` `--surface`; `#16181b`, `#3d4146`, `#5c6168`, `#6e737a` `--fg`, `--fg2`, `--mute`, `--dim`; `#e3e5e8` `--line`; `#eceef0` `--line-soft`; `#f3f4f5` and `#f1f2f3` `--wash`; `#f6f7f8` `--inner`; `#f3f4f2` `--desk`; `#d5d8dc` `--btn-line`; `#c9cdd2` `--edge`; `#b9bec4` `--dash`; `#2f5bd3` `--link`; `#1f45b0` `--link-hover`; `#dbe2f3` `--receipt-line`; `#B45309` `--wait` (on department tints `--wait-strong`); `#F2A93B` `--wait-ring`; `#FDF1E3` `--wait-soft`; `#B42318` `--fail`; `#F04438` `--fail-ring`; `#FEECEA` `--fail-soft`; `#F4C7C1` `--fail-line`; selected `#16181b` on `#ffffff` `--selected` and `--on-selected`; the goal card's colours `--goal-*`; department colours `--{sales,mkt,prod,money,ops}`, `-tint`, `-line`; shadows `--shadow-tile`, `--shadow-lift`, `--shadow-goal`, `--shadow-swipe`, `--shadow-paper`; preview art `--pv-*`.
- **What W3 changes from D on purpose**: the 12 px type floor; no loops (above); the failed quick card loses its red gradient wash and keeps the `--fail-line` border; the "How starting works" tile uses icons and words, not D's miniature cards with made-up counts; the header tools (Ask Chausar, the bell, the account button) wait for W4 4C and 4G, and there is no account feature for the "K" button, so it is not drawn.
- **Sample data** in the boards (Kavya Reddy, ₹1,18,400) never enters `src/`. Tests use the fake engine's fixtures or props written in the test file.

## Tokens (3A1 adds them; light and dark, with the contrast that was checked)

Ink v1 tokens stay as they are, with one value change: `--rail` goes from 220px to 232px. Contrast figures below were computed with the WCAG formula `tests/contrast.test.ts` uses.

### Colours

| Token | Light | Dark | Used for | Contrast checked (light / dark) |
|---|---|---|---|---|
| `--line-soft` | #eceef0 | #222427 | row dividers inside tiles | not text |
| `--wash` | #f3f4f5 | #232528 | kind, posture and idle chips; hover | fg2 9.33 / 9.13; mute 5.67 / 5.82 |
| `--inner` | #f6f7f8 | #1d1f21 | inner cards on white tiles | mute 5.82 / 6.26; link 5.50 / 7.98 |
| `--desk` | #f3f4f2 | #1d1f1e | ground under paper previews | mute 5.66 / 6.28 |
| `--btn-line` | #d5d8dc | #3a3e43 | secondary button border | not text |
| `--dash` | #b9bec4 | #5f646b | dashed: add agent, pending step, estimate chip | not text |
| `--receipt-line` | #dbe2f3 | #2c3a5c | receipt chip border | not text |
| `--link-hover` | #1f45b0 | #b5ccff | link hover | above link |
| `--selected` | #16181b | #eceef0 | selected rail item, filter chip, toggle, gate; the Chausar avatar square | on-selected 17.79 / 16.11 |
| `--on-selected` | #ffffff | #111214 | text on selected; the logo's first square inside the Chausar avatar | see above |
| `--count-on-selected` | #3b3d3f | #c9cbcd | Today's count chip on the selected rail item (D: white at 16 percent) | on-selected over 10:1 both |
| `--accent` | #2fb67c | #2fb67c | primary fill, goal bar, working ring, logo square, progress, selected tab line | accent-ink on accent 7.52 both |
| `--accent-ink` | #0b0d0e | #0b0d0e | text and icons on the accent | see above |
| `--accent-soft` | #e6f6ef | #1b312a | locked primary, Working chip, done ticks, next-step wash | accent-text 4.84 / 5.33 |
| `--accent-text` | #0b7a45 | #2fb67c | green words ("Ahead", "3 of 5") | on surface 5.41 / 6.86; on bg 5.22 / 7.23; on inner 5.04 / 6.38 |
| `--accent-line` | #cee4da | #1f4f3c | next-step eyebrow border | not text |
| `--wait-ring` | #f2a93b | #f2a93b | waiting ring and bar | not text (the words say the state) |
| `--wait-soft` | #fdf1e3 | #362c1f | waiting chip and count ground | wait 4.51 / 6.39 |
| `--wait-strong` | #a84d08 | #e5a54b | amber words on department tints (`--wait` is 4.29 to 4.49 there) | on the five tints 4.81 to 5.03 / 7.09 to 7.55 |
| `--fail-ring` | #f04438 | #f04438 | failed ring and bar, the bell dot | 3.76 / 4.73 (non-text 3:1) |
| `--fail-soft` | #feecea | #3a1f1f | failed chip ground, "what went wrong" box | fail 5.76 / 5.40 |
| `--fail-line` | #f4c7c1 | #6e2a26 | border of a stopped card | not text |
| `--goal-bg` | #111214 | #1f2124 | dark goal card (dark theme lifts it off the page and adds a `--line` border) | goal-fg 18.74 / 16.14 |
| `--goal-track` | #2a2d31 | #363a3f | goal bar track | accent on track 5.34 / 4.42 |
| `--goal-fg` | #ffffff | #ffffff | goal figures | above |
| `--goal-fg2` | #d6d9dc | #d6d9dc | goal secondary words | 13.22 / 11.39 |
| `--goal-mute` | #9aa0a6 | #a3a9af | goal labels | 7.10 / 6.80 |
| `--goal-chip` | #242527 | #313336 | "8 days left" pill, icon box | goal-fg2 10.82 / 8.94 |
| `--goal-line` | #292a2c | #35373a | divider in the goal card | not text |
| `--goal-link` | #8fb4ff | #8fb4ff | receipt links on the goal card | 9.05 / 7.79 |
| `--sales`, `--sales-tint`, `--sales-line` | #2f5bd3, #e8eefc, #d5e0fa | #8aa8f5, #1b2337, #2a3756 | Sales and clients | ink on tint 5.08 / 6.71; fg2 on tint 8.84 / 9.30 |
| `--mkt`, `-tint`, `-line` | #7c3aed, #f1eafe, #e4d6fc | #b99af7, #251c37, #3a2d57 | Marketing | 4.87 / 6.95; 8.78 / 9.60 |
| `--prod`, `-tint`, `-line` | #0f766e, #e3f4f2, #cbe8e4 | #5fcdbf, #14282a, #214043 | Production | 4.82 / 8.03; 9.05 / 9.13 |
| `--money`, `-tint`, `-line` | #0b7a45, #e6f6ec, #cdebd8 | #5fcf94, #152a20, #224232 | Money | 4.83 / 7.83; 9.18 / 9.02 |
| `--ops`, `-tint`, `-line` | #475467, #eef0f3, #dde1e7 | #a7b1c0, #1f2329, #30363f | Operations | 6.73 / 7.28; 9.00 / 9.38 |
| `--dept-on` | #ffffff | #111214 | icon on a solid department badge | 5.41 to 7.69 / 8.03 to 9.79 (non-text 3:1) |
| `--chart-ink` | #16181b | #eceef0 | single series, "In" bars, cash line, "not due" bucket | 17.79 / 15.27 |
| `--chart-rest` | #d5d8dc | #4a4f56 | the other bars of a single series, "Out" bars | not text (values are labelled) |
| `--chart-forecast` | #9aa0a6 | #7d838a | dashed forecast line | not text |
| `--pv-video-1`, `-2`, `-3` | #25433f, #132523, #0a1213 | same | video preview ground (theme-invariant) | white text on them, over 10:1 |
| `--pv-scrim`, `--pv-scrim-strong`, `--pv-play`, `--pv-text-2` | rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.72), rgb(255 255 255 / 0.95), rgb(255 255 255 / 0.6) | same | tags, duration, play button over previews | theme-invariant |
| `--shadow-tile` | 0 1px 2px rgb(16 24 40 / 0.06) | 0 1px 2px rgb(0 0 0 / 0.4) | tiles | |
| `--shadow-lift` | 0 1px 2px rgb(16 24 40 / 0.07), 0 0 0 1px rgb(16 24 40 / 0.04) | 0 0 0 1px #2a2d31 | white cards on a tint | |
| `--shadow-goal` | 0 1px 2px rgb(16 24 40 / 0.10), 0 12px 28px -12px rgb(16 24 40 / 0.45) | 0 0 0 1px #2a2d31 | the goal card | |
| `--shadow-swipe` | -12px 0 28px rgb(16 24 40 / 0.18) | -12px 0 28px rgb(0 0 0 / 0.5) | a card mid-swipe | |
| `--shadow-paper` | 0 1px 2px rgb(16 24 40 / 0.08), 0 10px 24px -8px rgb(16 24 40 / 0.22) | 0 0 0 1px #2a2d31 | paper preview | |

Two rules come with the table, both in `contrast.test.ts` as pairs that must not be used and in a source rule (a CSS module rule that sets `background: var(--inner)`, `var(--wash)` or `var(--desk)` may not set `color: var(--dim)`): `--dim` is used only on `--bg` and `--surface` (it reads 4.33 to 4.47 on the softer greys), and plain `--wait` is never used on a department tint. Rings stay below 3:1 against white (accent 2.59, wait 2.00); they are drawn `aria-hidden` and the state is always also in words, as the spec says.

### Type, shape and spacing

| Token | Value | D source |
|---|---|---|
| `--text-hello` | 24px | phone greeting `.hello` |
| `--text-section` | 19px | `.h2` |
| `--text-tile` | 16px | `.h3`, `.qc-title`, `.dp-name` |
| existing `--text-title` 28, `--text-row` 15, `--text-body` 14, `--text-read` 13, `--text-label` 12 | unchanged | `.h1`; `.a-name`, `.btn.lg`, `.btn.xl`; body and `.btn`; `.meta`; small, chips |
| `--fig-goal` / `--fig-goal-phone` | 40px / 30px | `.g-amt` |
| `--fig-pct` | 32px | `.g-pct` |
| `--fig-stat` | 30px | stat tiles `.s-val`, `.ow-v` |
| `--fig-hero` | 24px | hero stat |
| `--fig-tile` | 20px | `.n-val`, `.cs-v`, `.s-pct` |
| `--fig-dept` | 17px | `.dp-s b` |
| `--r-tile`, `--r-card`, `--r-chip` | 16px, 12px, 999px | spec 4.1 |
| `--r-button-sm`, `--r-button`, `--r-button-lg`, `--r-button-xl` | 9px, 10px, 12px, 14px | `.btn` sizes |
| `--av-24` to `--av-60` | 24, 28, 32, 36, 40, 52, 60px | avatar sizes; radius `calc(var(--av) * 0.3)` |
| `--control-sm`, `--control-xl` | 30px, 48px | `.btn.sm`, `.btn.xl` (`--control` 36 and `--target` 44 exist) |
| `--gap-grid`, `--gap-cards`, `--gap-section` | 16px, 12px, 32px | bento gap, inner cards, sections |
| `--pad-tile`, `--pad-tile-compact`, `--pad-panel`, `--pad-card` | 20px, 16px, 18px, 14px | tile, compact tile, department panel, inner card |
| `--gutter`, `--gutter-phone` | 32px, 16px | page gutters |
| `--page-max` | 984px | `.wrap` |
| `--panel` | 440px | agent panel beside Team |
| `--top-bar`, `--tabs` | 56px, 56px | phone top bar, bottom tabs |

The 4 px rule for `--sp-*` stays. Small inner gaps in D (6, 7, 9, 10, 11 px) snap to `--sp-1`, `--sp-2` or `--sp-3` by eye.

## Coverage: the 27 W3 catalogue rows

| Row | Package | What W3 builds | What waits for W4 |
|---|---|---|---|
| U1 Today above the fold | 3C | goal card (real invoiced figure), team at work, needs-you cards with filters, the rest folded, "N more" | goal progress and next best step (4I); ranking by money at stake (4I) |
| U2 Team as departments, avatars, rings | 3B1a, 3D | initials avatars drawn locally, rings from run state, count line, rows sorted by state, idle folded past eight | department of each agent and its tint (4A); helpers nested under parents (4A) |
| U3 Start gallery and one sentence | 3B3, 3G2 | Gallery part; the one-sentence tile; example prompts that prefill and never send | the list of ways to earn (4J), tiles per playbook (W5); the business picker and file drop (4J). No cycling (motion rule) |
| U4 Phone-ready | 3H1 | bottom tabs, sheets cover the screen, top bar, manifest with icon and theme colours | the business name in the manifest on hosted (4J) |
| U5 Charts | 3B2 | bar, line, aging, split and mini bars fed only by engine values; "View chart data"; no chart without data | the series themselves (4A, 4J money views) |
| U6 Progress that never fakes | 3B1b, 3C, 3E1 | rings and bars from measured counts, "Working, no step count yet", real failure text, Run again; setup progress from `venture.get` done and total | stage estimates after three runs (4F) |
| U7 Run sheet | 3B5a | tick rows, steps by purpose, shapes that differ beyond colour, current step arc | call event stream with per-call progress, filmstrip (4F) |
| U8 Review previews | 3B3, 3C | PreviewFrame variants; previews from the engine's own row data and `venture.queue.view` text | frames, durations, chapters and contact sheets (4J queue previews) |
| U9 Clients three sub-pages, URL state | 3E2 | tabs as links held in the URL, Pipeline board from the engine's lead stages, filters in the URL | Network (4D); pipeline stages Found to Not now, strength, paths (4E, 4D) |
| U10 Connections place | 3G1 | connector cards with honest labels; "What Chausar can do on this computer" from the engine's modes | "Your network" cards (4D) |
| U11 Money visuals and a read-only accountant invite | 3F | the visuals that have data now | aging, in and out, cash line (4J money views); the invite (4J) |
| U12 Empty states | every place | one sentence, then actions; no control that acts on nothing; nothing sold | |
| U13 Rules held by tests | 3A1, 3B1a | state words module with a drift test, `data-ui-number`, two filled things at most, still first paint, theme before paint, type and spacing lints with baselines | |
| U14 Real-browser checks | 3I | Electron capture at 390 and 1280, light and dark, axe with contrast on, word baselines beyond Money, storage notice beyond Keep (3A2) | |
| U17 Honesty lines | 3B5b | "model estimate" on model prose, "Shown as written" under quoted text, a disabled "link not ready yet" | "each draft names the engine that wrote it" where the engine says (4J) |
| U18 Onboarding sample business and resume | 3G2 | "Resume setup" from `venture.get` done and total; the existing sample label kept | the permission walkthrough (4J) |
| U20 Live without spinners | 3I (check) | every place refreshes on engine events; no spinner anywhere | sequenced stream with gap replay (4J) |
| O7 Approval card | 3B5a | verb on the primary (engine label), stale words, purpose first and detail one tap away, unlock after preview, decided shrinks, "Nothing changes until you approve" on proposals | "Sends to the client", attempt and last error, character counts, price beside Approve, change count line, saved-rule lines (4J approvals) |
| O8 Row meta line | 3B5a | business and time | client name, expiry, stale marking (4J approvals) |
| O15 Activity per business | 3C | Earlier list from the journal's own lines | the system-line grammar contract on engine lines (4J) |
| O16 Posture as plain cards | 3D | posture as two or three radio cards with their consequence, in the agent panel | the "set by" line (4B) |
| O22 Autosave | 3B4 (Composer only) | text is cleared only when the engine confirms it was stored | autosave and crash recovery for settings (4J; it needs engine-side drafts, since nothing may sit in browser storage) |
| O23 Tray | none | | tray count and the closed-app footer (4G) |
| M9 Who owes you, visual | 3B2, 3F | AgingBar, BarChart, CashLine parts; owed total with receipt and open invoices by due date | buckets, months, 13 weeks (4J money views) |
| K10 Connect your AI | 3G1 | Your AI restyled, one fix line per state from `availabilityReason` | CLI detection and status (4H) |
| K11 Connector guides | 3G1 | the engine's `requires` lists as numbered steps in the connector sheet | least-privilege guides, "Sends: nothing" lines (4J connectors) |
| Q24 Unprimed visual review | 3I | a fresh reviewer looks at the shots without being told the expected faults | |

## Shared files and sequencing

| File | Packages | How they share it |
|---|---|---|
| `src/tokens/tokens.css`, `base.css`, `motion.css` | 3A1 only | Any later package that needs a token asks the integrator, who adds it with a row in this plan's table |
| `tests/tokens.test.ts`, `tests/contrast.test.ts`, `tests/source-rules.test.ts`, `tests/baselines/spacing.json` | 3A1; 3H2 adds two source rules (Hindi wrapping, figures never truncated) | Small Edit calls, one `it` each |
| `tests/helpers/ink-rules.ts` | 3B1a writes it; everyone imports it | Read only after 3B1a |
| `src/text/en/common.json` and `hi/common.json` | 3A2 (`shell.`, `rail.`, `notice.`), 3B1a, 3B1b, 3B2, 3B3, 3B4, 3B5a, 3B5b, 3H1 | Each package adds keys under its own prefixes only (listed in each package); small Edit calls, re-read first |
| `src/text/{en,hi}/<place>.json` | the place's own package | Only its owner |
| `tests/a11y.test.tsx` | 3A2, 3C, 3D, 3E1, 3E2, 3F, 3G1, 3G2, 3H1 | Each adds its rows to `PLACES`, `SHEETS` or `OPENED`, one small Edit each |
| `src/shell/App.module.css`, `src/shell/App.tsx` | 3A2, then 3H1 | 3H1 starts after 3A2 is integrated |
| `src/shell/Rail.tsx`, `Rail.module.css`, `BusinessMenu.tsx`, `BusinessMenu.module.css` | 3A2, then 3H1 | Same |
| `src/shell/sheets.tsx` (`BASE_SHEETS`) | 3H1 (`more`) | Only 3H1 |
| `src/parts/ApprovalRow.tsx` and its CSS | 3B5a | Only 3B5a; 3C and 3H1 use its props |
| `src/places/today/*` | 3C, then 3H1 (phone pieces: SwipeCard wrap, tip) | 3H1 after 3C |
| `src/places/team/*` | 3D, then 3H1 | Same |
| `index.html`, `public/*` | 3A2 (`icon.svg`), 3H1 (`manifest.webmanifest`, theme-color metas) | Separate files |
| root `package.json`, `package-lock.json` | 3-0 only | |
| `.gitignore`, `scripts/ui-shots/*`, `docs/venture/ink.md`, `tests/baselines/words.json` | 3I only | |
| `src/engine/*` | nobody | W3 adds no engine data |

Order (each phase starts when the integrator has merged the previous one into the working tree and the UI suite is green):

1. 3-0 (integrator).
2. 3A1 and 3B1a in parallel. Parts use the token names fixed in the table above, so they need not wait for the CSS.
3. 3A2, 3B1b, 3B2, 3B3, 3B4, 3B5a, 3B5b in parallel.
4. 3C, 3D, 3E1, 3E2, 3F, 3G1, 3G2 in parallel.
5. 3H1 and 3H2 in parallel (3H2 touches only text files, `hi-review.json` and two source rules).
6. 3I.

Commits (integrator): `feat(w3): ink v2 tokens and theme`, `feat(w3): ink v2 parts`, `feat(w3): shell, rail and page header`, one `feat(w3): <place> in the direction D look` per place, `feat(w3): phone layout and swipe`, `feat(w3): hindi for the new screens`, `test(w3): screenshot walk and word baselines`.

## Packages

### 3A1: tokens and theme (size M)

**Boards:** `D-STYLE.md` sections 3 and 4; the D base block of `D-Today.dc.html`.

**Files:** `src/tokens/tokens.css`, `src/tokens/base.css`, `src/tokens/motion.css`; tests `tests/tokens.test.ts`, `tests/contrast.test.ts`, `tests/source-rules.test.ts`, new `tests/baselines/spacing.json`.

1. Failing tests:
   - `tokens.test.ts`: a `V2_LIGHT` and `V2_DARK` map with every colour in the token table holds exactly in `:root`, in `:root:not([data-theme="light"])` and in `:root[data-theme="dark"]`; every colour custom property in `:root` (a value starting with `#`, `rgb(` or a shadow) appears in both dark blocks unless it is in `THEME_INVARIANT` (`--accent`, `--accent-ink`, `--wait-ring`, `--fail-ring`, `--pv-*`); `--accent` is `#2fb67c`; every `--text-*` and `--fig-*` is at least 12px; `--radius` stays 6px and the new radius, avatar, control, gap, pad, gutter, page and panel tokens have the exact values in the table; `--rail` is 232px; `--sp-*` stay on the 4 px scale.
   - `contrast.test.ts`: `TEXT_PAIRS` lists every text and ground pair in the table's last column (accent ink on accent, accent text on surface, bg, inner and accent soft, wait on wait soft, wait strong on each tint, fail on fail soft, on-selected on selected, fg2 and mute on wash, inner and desk, link on inner, each department ink and fg2 on its tint, the goal card's five text tokens on goal bg and fg2 on goal chip) and each is at least 4.5:1 in both themes; `NON_TEXT_PAIRS` (`--dept-on` on each department solid, `--fail-ring` on surface) at least 3:1; `FORBIDDEN_PAIRS` (`--dim` on inner, wash and desk; `--wait` on a tint) are listed with their ratio below 4.5 so the rule is visible.
   - `source-rules.test.ts`, new `it`s: no `rgb(`, `rgba(` or `hsl(` in CSS modules; `2fb67c` only in `tokens.css` within `src/`, `46f09b` nowhere; no `\p{Extended_Pictographic}` in `src/` and the text files; every `animation` or `transition` in a CSS module uses a `var(--t-` duration and `animation` is only in the four files named in the rules table; `font-size` in CSS modules is only `var(--text-` or `var(--fig-`; padding, margin and gap raw values per file are no more than `tests/baselines/spacing.json` says (the file is written once from today's tree, then may only shrink); a rule that sets `background: var(--inner|--wash|--desk)` does not set `color: var(--dim)`.
2. Implement: add the tokens with the comment style of `tokens.css` (one line per group saying where in D it comes from); `base.css` gets `.mono { letter-spacing: -0.01em }` and `[data-ui-number] { font-variant-numeric: tabular-nums }`; `motion.css` gets `@keyframes ink-snap` (swipe returns) using `--t-settle` and nothing that loops.
3. Run `npx vitest run --config app/ui/vitest.config.ts tests/tokens.test.ts tests/contrast.test.ts tests/source-rules.test.ts`.

**Done when** the three test files pass and the existing UI suite still passes (no place uses a new token yet).

### 3A2: shell, rail, page header and storage notice (size M)

**Boards:** the rail and `header.phead` of every desktop D board (`D-STYLE.md` section 4, "Rail" and "Page header"); `D-Today.dc.html` `.rail`, `.brand`, `.biz*`, `.nav*`, `.main`, `.wrap`, `.phead`, `.eyebrow`, `.h1`, `.sub`.

**Files:** `src/shell/Rail.tsx`, `Rail.module.css`, `BusinessMenu.tsx`, `BusinessMenu.module.css` (look only; W1's popover behaviour stays), `App.module.css` (rail 232, main padding 28/32/48 via tokens, page max `--page-max`), new `src/shell/clock.tsx` (`ClockProvider`, `useClock()`, default `() => new Date()`), new `src/shell/StorageNotice.tsx`, `src/parts/PageTitle.tsx` and its CSS (eyebrow, h1, sub with bold count, `tools` slot), `public/icon.svg` (the two-square mark: dark square #16181b, accent square #2FB67C), `src/text/{en,hi}/common.json` (`shell.`, `rail.`, `notice.`); tests `tests/shell/rail.test.tsx` (new), `tests/shell/app.test.tsx`, `tests/shell/business-menu.test.tsx`, `tests/parts/page-title.test.tsx` (new).

1. Failing tests:
   - The rail's first link is the brand: accessible name "Chausar, Today", `href="#/today"`, an `aria-hidden` Logo and the lowercase wordmark "chausar".
   - The business button shows the business initials square (`aria-hidden`), the name and the kind line; W1's test that the menu renders outside the rail still passes.
   - The places are Today, Team, Work, Clients, Money, Connections, in that order, each with an `aria-hidden` svg icon (sun, users, briefcase, contact, wallet, plug) and its word; the current one has `aria-current="page"`; there is no Chats item (W4 4C adds it and flips this test).
   - Today's count: DM Mono, `aria-hidden`, followed by sr-only ", 12 need you"; `data-tone="wait"` when Today is not the current place and no tone when it is.
   - PageTitle: one `h1`; an optional eyebrow `p` before it; the sub line renders `<b>` around the count it is given; `tools` render in a group after the title block.
   - StorageNotice: when `workspace.custody.get` says `storage: 'experimental-file'`, Today, Work and Money show `business.experimental`'s sentence as a `role="note"` line under the header; it is absent with `postgres`; Keep is unchanged (catalogue U14, "storage notice back beyond Keep").
   - `useClock()` returns the injected time inside a `ClockProvider`.
   - `public/icon.svg` holds `#2FB67C` equal to `--accent` in `tokens.css`.
2. Implement. D mapping: `.rail` to `Rail.module.css` with `--surface` ground and `--line` border; `.nav a.on` to `--selected` and `--on-selected`; `.ct` to `--wait-soft` and `--wait` (on the selected item `--count-on-selected` with `--on-selected` text); `.biz-sq` to `--selected`; the hover to `--wash`.
3. Run `tests/shell/*.test.tsx tests/parts/page-title.test.tsx`.

**Engine data that waits for W4:** the Chats item and its "New" chip (4C); the Ask Chausar box and Ctrl K (4C); the bell (4G).

**Done when** the shell tests and all existing place tests pass, and `a11y.test.tsx` passes unchanged.

### 3B1a: icon, logo, avatar, state words, figures, receipts, buttons (size M)

**Boards:** `D-STYLE.md` section 2 (logo, primary and locked primary), section 4 ("Avatars and rings", "Chips" for `.rc`, `.est`, "Buttons"), section 5 (icons); D base `.av*`, `.ring-*`, `.btn*`, `.rc`, `.rc-d`, `.est`, `.chat`.

**Files (new):** `src/parts/Icon.tsx`, `icons.ts` (`ICONS`, the allowlist mapping names to lucide-react components), `Logo.tsx`, `Avatar.tsx` (+ `initialsOf`), `states.ts` (one module for every state word), `Figure.tsx` (`Figure`, `Count`), their CSS modules; **changed:** `Receipt.tsx`, `ModelEstimate.tsx`, `Button.tsx` and their CSS; `src/text/{en,hi}/common.json` (`state.`, `figure.`, `button.`, `logo.`); tests `tests/parts/icon-logo-avatar.test.tsx`, `tests/parts/states.test.ts`, `tests/parts/figure.test.tsx` (new), `tests/parts/basics.test.tsx`, `tests/parts/quiet.test.tsx`, new `tests/helpers/ink-rules.ts`.

1. Failing tests:
   - Icon: renders an svg with `aria-hidden="true"`, `focusable="false"` and `stroke-width="1.75"`; `size` 12, 14, 16, 18, 20, 22 sets `data-size`; with `label` it is `role="img"` with that `aria-label`; `Object.keys(ICONS)` equals the D-STYLE section 5 list plus shield-check, upload, search, sliders-horizontal and paperclip (the boards use them). A name lucide-react no longer ships (brand icons such as youtube) is mapped to a plain one (play-square) and the test says so. W4 packages add names with one line in this test.
   - Logo: two `rect`s; the first has the class whose rule is `fill: var(--fg)` and the second `fill: var(--accent)` (the test reads the CSS module text); `variant="in-avatar"` (the Chausar avatar: the mark inside a `--selected` square) uses `--on-selected` for the first square, so it inverts with the theme; `wordmark` renders "chausar".
   - `initialsOf`: "Editor" gives "ED", "Meera Joshi" "MJ", "Iyer & Co" "IC", "राहुल मेहता" "रामे" (the first grapheme cluster of each word, by `Intl.Segmenter`, so a vowel sign stays with its letter), "" gives "?". Avatar renders an `aria-hidden` span with the initials; `dept` sets `data-dept` (else `data-dept="none"`, the neutral `--wash` ground); `state` sets `data-state` to working, waiting or failed (idle sets none, so no ring); `badge` draws the department icon only when `dept` is set; `size` sets `data-size`. No image and no network request is ever made for an avatar.
   - `states.ts`: `stateWord(kind, value)` covers every value of `RunState`, `RunStep['state']`, `Posture`, `InvoiceLite['status']`, `LeadStage`, `DeliveryStatus`, `QueueKind` with a text key and a tone (working, wait, fail, idle, done, neutral); the maps are typed `Record<Union, ...>` so a new engine value fails the typecheck, and the test lists each union's literal values so a renamed one fails at run time too; an unknown value gives `state.unknown` ("Unknown") in the neutral tone.
   - Figure: `<Figure value="₹18,880" receiptId="R-0419" />` renders `[data-figure]` holding a DM Mono `[data-ui-number]` and a Receipt button "Receipt R-0419"; `<Figure value="18,000" estimate />` renders the "model estimate" chip and no receipt; giving both, or neither, is a type error (a `// @ts-expect-error` line in the test); `Count` renders mono text with no `data-ui-number`. `assertFiguresProved` passes on both Figures and fails on a bare `<span data-ui-number>` (the helper is tested too); `assertOnePrimary` fails on a card with two primaries.
   - Receipt: the existing names ("Receipt R-0412") and long-id behaviour hold; it carries `data-receipt` and a receipt-text icon; `tone="dark"` gives the goal card's underlined link look.
   - ModelEstimate: text "model estimate", `data-estimate`, the dashed chip class.
   - Button: existing tests pass; `size` sm, md, lg, xl sets `data-size`; `variant` primary, secondary, quiet, ink, chat; `locked` makes it `disabled`, adds the lock icon, `title` from `lockedReason`, and `aria-describedby` to the note id it is given; `variant="chat"` without an `aria-label` throws in development (a quiet button must say whose chat it opens).
2. Implement. D mapping: `.av` sizes to `--av-*` with `calc(var(--av) * 0.3)` radius; ring box-shadows to `--ring-ground` plus `--accent`, `--wait-ring`, `--fail-ring` by `data-state`; `.btn` heights to `--control-sm`, `--control`, `--target`, `--control-xl`; `.btn.pri` to `--accent` and `--accent-ink`, locked to `--accent-soft` with `--mute` text; `.rc` to `--receipt-line` and `--link`; `.est` to `--dash` and `--mute`.

**Done when** the new and existing part tests pass and `npm run typecheck:ui` is clean.

### 3B1b: tiles, cards, chips, stat tiles, toggles, rings and bars (size M)

**Boards:** `D-STYLE.md` section 4 ("Grid and surfaces", "Chips", "Segmented toggle", "Progress"); D base `.bento`, `.c3` to `.c12`, `.tile`, `.inner`, `.lift`, `.th`, `.shead`, `.count`, `.chip*`, `.dchip`, `.kchip`, `.pos`, `.fchips`, `.fchip`, `.fsep`, `.bsq`, `.seg`, `.sdot`, `.pbar`, `.pring`; the stat tiles of `D-Team.dc.html` (`.stat`, `.s-lab`, `.s-row`, `.s-val`, `.s-sub`).

**Files (new):** `src/parts/Tile.tsx` (`Bento`, `Tile`, `Panel`, `TileHead`, `SectionHead`), `Card.tsx` (`Inner`, `Lift`), `Chip.tsx` (`StateChip`, `DeptChip`, `KindChip`, `PostureChip`, `CountChip`), `FilterChips.tsx`, `StatTile.tsx`, `Segmented.tsx`, `ProgressRing.tsx`, `ProgressBar.tsx` and CSS modules; `src/text/{en,hi}/common.json` (`chip.`, `filter.`, `ring.`, `bar.`, `dept.`); tests `tests/parts/surfaces.test.tsx`, `tests/parts/progress.test.tsx` (new).

1. Failing tests:
   - `Tile` renders the element it is given (`as="section"`), `span` 3 to 12 sets `data-span`, `tone="fail"` sets `data-tone`, `labelledBy` passes through; `Panel dept="prod"` sets `data-dept` and `--ring-ground` to the tint; `Inner` and `Lift` set `--ring-ground` to their own ground; `TileHead` renders an `h2` at tile size with an optional meta and a "more" link with a chevron.
   - `StateChip` always renders its words (the dot is `aria-hidden`); tone comes from `states.ts`.
   - `DeptChip dept="prod"` says "Production" (`dept.prod`); the five department words are in common.json.
   - `PostureChip` says "Asks each time", "Shadowing", "Rehearsing" or "Auto with spot checks" with the shield-check, eye, history or check icon.
   - `FilterChips`: a `role="group"` with the given label; each option is a button with `aria-pressed`; counts render as `Count`; a business option shows its initials square `aria-hidden`; a lock option shows the lock icon; a separator is `aria-hidden`; clicking calls `onChange(id)`.
   - `Segmented mode="buttons"`: `role="group"`, `aria-pressed`, department dots `aria-hidden`. `mode="links"`: a `nav` with its label, links with `aria-current="page"` on the current one, counts as `Count`.
   - `StatTile`: label with icon, a `Figure` or `Count`, a sub line, an optional `side` slot; `tone="wait"` colours the figure; it is a `[data-card]`.
   - `ProgressRing`: `role="img"`; `{done: 3, total: 5}` is labelled "3 of 5 steps done" and shows "3/5" (`aria-hidden` inside); with `waiting` "2 of 3 steps done, waiting on you"; `'indeterminate'` is "Working, no step count yet" with three dots and no numbers; the arc `circle` has `pathLength="5"` and `stroke-dasharray="3 5"`; `data-tone` is working, waiting or failed.
   - `ProgressBar`: steps draw `total` segments with `done` of them `data-filled`; `'indeterminate'` draws one still segment labelled "No step count yet"; no element in either has a `style` attribute.
2. Implement with the token table; `.fchip.on` and `.seg button.on` use `--selected`; `.pbar` track `--line`.

**Done when** both test files pass.

### 3B2: charts (size M)

**Boards:** `D-Money.dc.html` (`.gb*`, `.sbar`, `.sleg`, `.aging`, `.ag-*`, `.chartsvg`, `.cs-*`, `.sw-l`), `D-Today.dc.html` (`.g-bar`, `.g-fill`, `.g-ready`, `.g-pace`, `.g-legend`), `D-Team.dc.html` (`.bars`, `.bar*`, the mini bars in the stat tile), `D-TeamDept.dc.html` (spend and jobs chart), `D-STYLE.md` "Charts".

**Files (new):** `src/parts/charts/GoalBar.tsx`, `MiniBars.tsx`, `BarChart.tsx`, `AgingBar.tsx`, `SplitBar.tsx`, `CashLine.tsx`, `ChartData.tsx`, `Charts.module.css`, `types.ts` (the view models below); `src/text/{en,hi}/common.json` (`chart.`); tests `tests/parts/charts.test.tsx` (new).

View models (what W4 maps engine views onto; W3 adds no engine type): `GoalBarData { invoicedPermille, readyPermille, pacePermille: number; label: string }`; `BarSeries { label: string; points: { key: string; label: string; valuePermille: number | null; value: string; receiptId?: string }[] }`; `AgingData { buckets: { id: 'not-due' | '1-30' | '31-60' | '61-90' | 'over-90'; label: string; count: string; amount: string; permille: number }[]; receiptId: string; label: string }`; `SplitData { parts: { dept: DeptId; amount: string; permille: number }[]; label: string }`; `CashData { points: { key: string; label: string; actualPermille: number | null; forecastPermille: number | null }[]; axis: string[]; assumptions: string[]; receiptId: string; label: string }`. Every number is an integer the engine scaled; every string is engine text.

1. Failing tests:
   - GoalBar: `role="img"` with the given label; in a `viewBox="0 0 1000 14"` the filled rect has `width="789"` for 789, the ready rect starts at `x="789"` with the stripe pattern, the pace marker sits at `x` equal to `pacePermille`; nothing has a `style` attribute.
   - MiniBars: one rect per height, the last `data-current`; `aria-hidden` when no label is given (it sits beside a figure that says the number).
   - BarChart: single and paired series; each rect `height` equals its `valuePermille`; a `null` point draws no bar and its label shows "N/A" in ranked bars and nothing in series bars (never 0); values above bars are the engine strings; `role="img"` with the label; `ChartData` renders "View chart data" as a `details` with a table of the strings; an empty series renders nothing at all (the caller says why in words).
   - AgingBar: five segments in the order not due, 1 to 30, 31 to 60, 61 to 90, over 90 (fills `--chart-ink`, `--wait-ring`, `--wait`, `--fail-ring`, `--fail`); a zero bucket draws no segment and a hollow legend square; the legend lists words, counts and amounts; one receipt for the tile.
   - SplitBar: segments carry `data-dept`; the legend names each department with its amount.
   - CashLine: the actual polyline and the dashed forecast polyline take their `points` from the data; today's dot is at the first actual point; the assumptions list renders under the chart and "Forecast" is said in words (catalogue M9).
2. Implement; department data uses the department solids, single series `--chart-ink` and `--chart-rest`; never the accent for data (D-STYLE "Charts").

**Done when** the chart tests pass. No place uses a chart with engine data in W3 except where the data exists (none of the money series exist yet; see 3F).

### 3B3: stories, previews, swipe, bottom tabs, gallery (size M)

**Boards:** `D-Today.dc.html` (`.stories`, `.story`, `.st-*`, `.pv*`, `.v-*`, `.paper`, `.pp-*`, `.chg`, `.bx`, `.op`, `.post*`, `.short*`, `.ab`, `.opt*`), `D-Phone-Today.dc.html` (`.swipe`, `.under*`, `.tabs`, `.tab*`, `.hscroll`), `D-Start.dc.html` (`.gal`, `.way`, `.w-*`, `.facts`, `.fact`, `.f-*`).

**Files (new):** `src/parts/StoriesRow.tsx`, `PreviewFrame.tsx`, `SwipeCard.tsx`, `BottomTabs.tsx`, `Gallery.tsx` (`Gallery`, `GalleryTile`) and CSS modules; `src/text/{en,hi}/common.json` (`story.`, `preview.`, `swipe.`, `tabs.`, `gallery.`); tests `tests/parts/feed.test.tsx` (new).

1. Failing tests:
   - StoriesRow: a list of buttons, each named by agent and status words ("Producer, needs you", "Editor, 3 of 5", "Bookkeeper, idle"); status words carry the tone class (wait, working, plain); the avatar is the 60 px story avatar with ring and badge; `onOpen(id)` on click; a `lead` slot (Chausar, W4 4C) and an `onAdd` item render only when given; `scroll` puts it in the phone's horizontal row.
   - PreviewFrame: `variant="video"` draws the preview ground, the title, an optional tag ("Not watched yet") and a play button named "Watch {title}" that calls `onOpen`; duration and chapters render only when given; there is no `video` or `img` element in W3. `variant="paper"` renders the given lines with values as DM Mono and the total as a `Figure` with its receipt, inside `role="img"` with the given label. `variant="change"` renders the Change pill (3B5a) and optional breakdown boxes. `variant="text"` renders `QueueItemView` sections. `variant="choice"` renders a `radiogroup` of labelled options. `variant="post"` renders account, platform and text.
   - SwipeCard: a pointer drag right of 96 px or more calls `onRight`; left of 96 px calls `onLeft`; less snaps back and calls nothing; `rightLocked` calls nothing and shows `lockedNote`; the underlay says the primary's words and "asks once more" when `asksAgain`; under reduced motion the snap has no transition; it never decides anything itself (it only calls the handlers).
   - BottomTabs: `nav` named "Places" with the links it is given, `aria-current="page"` on the current, a `data-current` tab line, Today's badge mono `aria-hidden` plus sr-only count.
   - GalleryTile: an `article` labelled by its name; icon; a category chip or "You run this"; "What you do" with the engine's hours text; "What your AI team does" with an avatar stack; "Clients usually pay" as a `Figure estimate` (the "model estimate" chip, never a receipt); one Start button named "Start {name}" (secondary, so no card in the gallery fills a button except the featured tile).
2. Implement. The swipe underlay uses `--accent` and `--accent-ink`; the mid-swipe card `--shadow-swipe`; preview grounds `--pv-*`.

**Done when** `tests/parts/feed.test.tsx` passes.

### 3B4: paths, strength, board, bell, composer, thread, diff card (size M)

**Boards:** `D-Clients.dc.html` (`.board`, `.col*`, `.colx*`, `.pc*`, `.path`, `.dots`, `.str`), `D-Network.dc.html` (`.r-path`, `.pth`, `.unc`, `.dots`), `D-TeamChat.dc.html` (`.cpanel`, `.cp-*`, `.bub`, `.mine`, `.day`, `.fold*`, `.runc*`, `.prop*`, `.diff`, `.ver`, `.sugs`, `.cbox`, `.send`), `D-Chats.dc.html` (`.cv-comp`, `.sugg`), the bell `.ib .dot` in every board.

**Files (new):** `src/parts/PathLine.tsx`, `StrengthDots.tsx`, `Board.tsx`, `NotificationBell.tsx`, `Composer.tsx`, `ChatThread.tsx`, `DiffCard.tsx` and CSS modules; `src/text/{en,hi}/common.json` (`path.`, `strength.`, `board.`, `bell.`, `composer.`, `thread.`, `diff.`); tests `tests/parts/talk.test.tsx` (new).

These parts are used by places in W4 (4B, 4C, 4D, 4E, 4G) except Board, which 3E2 uses with leads. They are built and tested now so W4 only wires data.

1. Failing tests:
   - PathLine: `role="img"` labelled "Path: you, then Meera Joshi, then Kavya Reddy. Both steps confirmed." or, with an unconfirmed step, "Possible path: you, then Rahul Mehta, then Sameer Joshi. The second step is not confirmed."; the unconfirmed segment is dashed (`data-confirmed="false"`) and the visible words "possible path, not confirmed" appear (spec 8).
   - StrengthDots: a button labelled "Strength: cold, 1 of 5. Open how you know them" with five dots, `level` of them `data-filled`; clicking calls `onOpen` (the receipt of how you know them, W4 4D).
   - Board: a `role="group"` with its label; each column is a `section` with an `h2` and a `Count`; cards in a list; a `folded` column is a button "Show Lost, 2 people" with `aria-expanded="false"` that expands on click.
   - NotificationBell: a button "Notifications, 2 new" with a dot, or "Notifications" with none; never a number on the icon.
   - Composer: a labelled textarea ("Message Editor", visually hidden label); Send (`aria-label="Send"`) disabled while empty; Enter sends, Shift+Enter makes a new line, nothing sends during IME composition; the text clears only after `onSend` resolves (catalogue O22) and stays, with the error line, when it rejects; suggestion chips prefill and never send.
   - ChatThread: `role="log"` labelled "Conversation with Editor", `aria-live="polite"`; day separators; the owner's messages and the agent's with time in DM Mono; a folded run row is a button "Cut episode 14 · 3 steps done" with `aria-expanded`.
   - DiffCard: heading "Proposed change to Editor's instructions"; the applies-to line; a group "The change, with the lines around it" where added and removed lines say "Added:" and "Removed:" in words; "Version 4 to 5, you can undo"; Reject (secondary) and Accept (the one primary); `stale` hides both buttons and says "This was drafted against an older version." (spec 8).
2. Implement. The owner's bubble uses `--selected` and `--on-selected`; the diff's added line `--accent-soft` with `--accent-text`; the removed line `--fail-soft` with `--fail`.

**Done when** `tests/parts/talk.test.tsx` passes.

### 3B5a: approval card, change, steps, run sheet, sheet panel (size L)

**Boards:** `D-Today.dc.html` (`.qcard`, `.qc-*`, `.qk*`, `.mchg`, `.ofr`), `D-TeamDept.dc.html` (`.steps`, `.sr`, `.tick`, `.spin`, `.pend-dot`), `D-TeamChat.dc.html` (`.cpanel`, `.cp-h`, `.cp-tabs`), `D-Work.dc.html` (`.sd-*` failure box).

**Files (changed):** `src/parts/ApprovalRow.tsx` and CSS, `Change.tsx`, `Steps.tsx`, `RunSheet.tsx`, `Sheet.tsx` and their CSS; `src/text/{en,hi}/common.json` (`approval.` additions only, `steps.` additions only, `sheet.`); tests `tests/parts/approval-card.test.tsx` (new), `tests/parts/approval-row.test.tsx`, `tests/parts/approval-row-incomplete.test.tsx`, `tests/parts/sheet-steps.test.tsx`.

1. Failing tests:
   - Every existing test in the four existing files passes unchanged (behaviour is kept; only look changes). Any assertion that names a v1 visual (none known) is listed in the PR if it has to change.
   - `layout="card"`: an `article` with `data-card` and the row id; the head has the agent's Avatar (state from the props), the name with an optional DeptChip (W4 4A gives the department), the meta "Lumen Studio · 08:40" (business and the time of `createdAt`, formatted by `Intl.DateTimeFormat` in the UI language, as `places/business/shared.tsx` already does for dates), and a KindChip with the words for the row's kind from `states.ts` ("Draft", "Price change", "Quote", "Plan", "Invoice", "CA sign-off", "Question", "Setup", "Locked", "Post"); the title is an `h3`; the line clamps to two lines; a `preview` slot; the note line says "Approve unlocks after you watch it" (the verb from the row's view action: watch, read, open) while locked, "Asks once more" when the primary has `secondAsk`, and "Nothing changes until you approve" on a `plan` row; actions are size lg, the secondary first and the primary last, each half the width; there is exactly one primary.
   - Rendering a preview in the card does not set viewed: Approve stays locked until `onView` runs through Watch, Read or Open.
   - The second ask in a card behaves as in a row (Approve asks again inside the card; Cancel returns focus; a digest change shows the new version with "This changed. Here is the new version.").
   - `layout="compact"`: title and line two lines each, the change as a small pill, buttons size sm; still one primary.
   - `descriptionComplete: false` still shows the W1 line in both layouts.
   - Change: the old value is in an `s` element, an arrow icon, the new value in DM Mono, the receipt or estimate; sr text "{after}, was {before}".
   - Steps: done shows a check on `--accent-soft`; current shows the still arc and bold words; pending a dashed circle; failed an x with the error in fail words; waiting amber words; the sr words of v1 stay.
   - Sheet: `width="panel"` sets `data-width="panel"` (440 px); the head has an avatar slot and a close button named from `sheet.close` with the sheet's name; existing focus-return tests pass.
   - RunSheet: the failure box ("What went wrong", the engine's error words) on `--fail-soft`; Run again stays where it was; existing tests pass.
2. Implement from the D classes above; card `--pad-tile`, `--r-tile`, `--shadow-tile`; locked primary from 3B1a.

**Done when** the five test files pass.

### 3B5b: gate, provenance, empty state, row, job list, status line, fields, connector label (size M)

**Boards:** `D-TeamDept.dc.html` (`.gate`, `.floor`, `.flow`, `.fr`), D base `.lrow`, `.lr-*`, `.sic*`, `.k*`, `.hint`; `D-Work.dc.html` (`.fin` list); `D-Network.dc.html` (`.why`, quoted fact lines).

**Files (changed):** `src/parts/Gate.tsx`, `Provenance.tsx`, `EmptyState.tsx`, `Row.tsx`, `JobList.tsx`, `StatusLine.tsx`, `Field.tsx`, `Secret.tsx`, `ConnectorLabel.tsx` and CSS; `src/text/{en,hi}/common.json` (`gate.` additions, `provenance.` additions); tests `tests/parts/controls.test.tsx`, `tests/parts/basics.test.tsx`, `tests/parts/quiet.test.tsx`, new `tests/parts/rows.test.tsx`.

1. Failing tests:
   - Gate keeps `role="switch"` and `aria-checked` (existing tests pass) and now shows both words, "Auto" and "Hold", with the current one `data-on` and both `aria-hidden` (the switch's label says the state); a floor step shows the lock icon and "Always asks you" on `--wait-soft`, with no switch.
   - Provenance: with `quoted`, the line "Shown as written" sits under the quoted text (catalogue U17); `estimate` prose shows "model estimate".
   - EmptyState: one sentence and optional action rows; it renders no button when no action is given (catalogue U12: "never show a control that acts on nothing").
   - Row: the `lrow` look (60 px, status circle or avatar, title, sub, end time) with J and K and Enter as before.
   - A link that has no address yet renders as a disabled control "link not ready yet" (`Provenance` or `Row` prop `linkPending`).
   - StatusLine, Field, Secret, ConnectorLabel: existing tests pass; ConnectorLabel's planned chip still has no button (must-keep).
2. Implement.

**Done when** the four test files pass.

### 3C: Today (size L)

**Boards:** `D-Today.dc.html` (all of it), `shots/D-Today.png`; the phone pieces wait for 3H1.

**Files:** `src/places/today/index.tsx` (layout; the decide, read-back, stale and session logic stays as it is), `Today.module.css`, `WorkingNow.tsx` (becomes the Working now tile), new `Greeting.tsx`, `GoalCard.tsx` (+ `goal.ts`, the `GoalCardData` view model), `NextStep.tsx` (built and tested with props; not rendered until W4 4I), `TeamAtWork.tsx`, `NeedsYou.tsx`, `CardPreview.tsx`, `Earlier.tsx`; `src/text/{en,hi}/today.json`; tests `tests/places/today.test.tsx` (existing, must pass), new `tests/places/today-v2.test.tsx`, `tests/a11y.test.tsx` rows.

Layout (desktop): header (eyebrow date, greeting, sub line); row 1 the goal card (`c7`, or `c12` while there is no next step); the Team at work tile (`c12`); Needs you (heading with count, filter chips, a two-column grid of cards, a row of four compact cards, the rest folded behind "Show N more"); row 5 Working now (`c7`) and Earlier (`c5`).

1. Failing tests (fake engine, `ClockProvider` set to Friday 23 October 2026, 19:05):
   - Greeting: the eyebrow says "Friday, 23 October" (formatted in the UI language); the `h1` says "Good evening" at 19:05, "Good morning" at 08:00 and "Good afternoon" at 14:00; no name is shown.
   - The sub line is the engine's `queue.summary` followed by "{count} agents are working." where count is the number of active runs (counting is fine; no figure is computed).
   - Goal card fallback: the dark card says "Invoiced this month" and shows the `billed` figure of `venture.books.summary {period: 'this-month'}` through `Figure` with its receipt (`assertFiguresProved`); there is no bar, no percentage, no "Change the goal" button and no `role="img"` named like "of the goal". `GoalCard` with full `GoalCardData` props (a unit test in the same file) renders the amount, "of {goal}", the percent, the GoalBar labelled "79% of the goal invoiced. Issuing INV-0042 takes it to 92%. Today's pace is 74%.", the legend and three foot figures each with a dark receipt, and an edit button "Change the goal"; with `state: 'unset'` it asks for a goal with a suggested figure labelled "model estimate" (spec 8).
   - Team at work: the tile head says "{n} working · {n} need you · {n} idle" from agent states (an agent is working when it has an active run, needs you when its run waits, failed when its latest run failed, idle otherwise); the stories list every agent from `venture.team.list`, sorted needs you, working, failed, idle (catalogue U2); the Producer story is named "Producer, needs you" and its avatar has `data-state="waiting"`; Editor's says "3 of 5" from its run's `progress`; Researcher's says "Working" (indeterminate); clicking a story opens `?sheet=agent:<id>`; no story has a department tint or badge (`data-dept="none"`) until W4 4A; there is no Chausar story and no "Add agent" (4C, 4A).
   - Live tiles: one `article` per active or waiting run, at most four, named "{agent}, working" or "{agent}, waiting on you"; each has a ProgressRing ("3 of 5 steps done"; "Working, no step count yet"; "2 of 3 steps done, waiting on you"); the current step line comes from `venture.runs.get` (the step whose state is current or waiting); the waiting tile's "Answer below" moves focus to its card (the existing `rowForRun`).
   - Needs you: an `h2` "Needs you" with a wait count chip of `needsYou`; FilterChips "All 12", "To approve 7" (draft, price, quote, plan, invoice, signoff, connector), "Questions 3", "Setup 2" (setup and locked), then one chip per business with its count, shown only when rows come from more than one business, with the lock icon on a locked business; pressing "Questions" shows only question rows and puts `show=questions` in the address (catalogue U9); `#/today?show=setup` opens with Setup pressed.
   - Cards: the first six rows in the engine's order are `layout="card"`, the next four `layout="compact"`, the rest behind a button "Show 2 more" that reveals them and moves focus to the first one; `assertOnePrimary` and `assertFiguresProved` pass on the whole section.
   - Previews (`CardPreview`, built only from what the engine sends): a draft row shows the video variant with the row's title and the tag "Not watched yet" until viewed in this session; a price or quote row shows the Change pill with its receipt; a row with `viewRef.kind` file or plan shows the text variant from `venture.queue.view` sections; a row with nothing to show has no preview box (no empty frame). Opening the preview's play button opens the view sheet and counts as viewed; drawing it does not.
   - Draft card: Approve is locked with "Approve unlocks after you watch it" until Watch opens `?sheet=view:draft:draft-ep14`; after closing the sheet, Approve is enabled.
   - Price card: Approve asks once more inside the card; confirming calls `venture.queue.decide` once with the row's digest; the card then shrinks to one line with its receipt (`role="status"`).
   - Working now tile: rows for active and waiting runs plus failed runs that still have a Run again row on the queue; the Editor thumbnail run says "Stopped" in fail words with the engine's error line; each row has the avatar, purpose, agent and current step, a ProgressBar with "3 of 5" or "Step 2", and elapsed time; the purpose opens the run sheet (existing).
   - Earlier tile: the latest six `venture.journal.list` entries with their line and receipt; an `outcome_unknown` entry shows "Check it", which goes to `#/money/journal` where W1's Resolve is.
   - Keyboard: J, K and Enter still move through cards (each keeps `data-row-id`).
   - Hindi: `language="hi"` renders the place with no key showing as text.
2. Implement. D mapping: `.goal` and `.g-*` to `GoalCard.module.css` with `--goal-*` tokens and `--shadow-goal`; `.team`, `.live`, `.lc*` to `TeamAtWork`; `.needs`, `.cards` (rows auto height, since previews vary), `.quick`, `.qk*`, `.stackbar`, `.sb-*` to `NeedsYou`; `.lt` rows to `WorkingNow` and `Earlier`.

**Engine data that waits for W4:** goal amount, goal, percent, ready-to-issue segment, pace marker, days left, still to invoice, ahead or behind pace, and the next best step row (4I); departments on agents for tints, badges and department chips (4A); the Chausar story and Ask box (4C); the bell (4G); video frames, durations, chapters, check counts, invoice lines for paper previews, post text, title choices with estimates (4J queue previews); the client name, expiry and "Sends to the client" meta (4J approvals); Stop on a running row (4F); the owner's first name for the greeting (4J owner profile).

**Done when** both Today test files pass, `assertOnePrimary` and `assertFiguresProved` hold, and the Today rows in `a11y.test.tsx` (including "Questions filter pressed" and "Show 2 more opened") pass.

### 3D: Team (size L)

**Boards:** `D-Team.dc.html`, `D-TeamDept.dc.html`, `D-TeamChat.dc.html` (the panel shell only), their PNGs.

**Files:** `src/places/team/index.tsx`, `Team.module.css`, `AgentSheet.tsx` (becomes the 440 px agent panel), `shared.tsx`, new `TeamStats.tsx`, `AgentCard.tsx`, `DepartmentPanel.tsx`, `OneDepartment.tsx` (+ `departments.ts`, the `DepartmentData` view model), `PostureChoice.tsx`; `src/text/{en,hi}/team.json`; tests `tests/places/team.test.tsx` (existing, must pass), new `tests/places/team-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - The existing Team tests pass: a list named "Agents" with one item per agent; name, role, now and last result per agent; receipted last result opens its receipt; model-written last result says "model estimate" with no receipt.
   - Stats (`section` named "Team at a glance"): "Working now" with the count of agents that have an active run and their avatar stack (sr text "Editor and Researcher"); "Waiting on you" with the count in wait tone, the waiting agent's avatar and its run's purpose; "AI spend this month" from the `spent` line of `venture.money.overview` through `Figure` with its receipt. There is no "Done this week" tile until W4 4A.
   - Without departments (the engine today), one tile "Your agents" holds the list "Agents" as agent cards in a grid; there is no department toggle and no department panel.
   - Agent card: Avatar ring from the agent's run (`data-state`); the name is a button opening `?sheet=agent:<id>`; the role; the now line (a waiting agent's says "Waiting on you." in wait words, then the purpose) as a button opening its run; a ProgressBar with "3 of 5 · 4m" from `progress` and `elapsed`; the PostureChip; the last result with its receipt or "model estimate"; no Chat button until W4 4B.
   - Idle agents past eight fold behind "Show {n} idle" (catalogue U2).
   - `DepartmentPanel` with `DepartmentData` props: an `article` with `data-dept`, an `h2` with the department's name, the line "1 working · 1 run stopped" (plural forms in team.json), jobs this week as `Count`, spend as `Figure` with its receipt, its agent cards with `--ring-ground` set to the tint; a waiting count uses `--wait-strong`.
   - `OneDepartment` with props: the hero panel with three stat boxes; the "How {department} runs" flow with each step's Gate (Auto, Hold; a floor step "Always asks you"), "A change here makes version {n}. You can undo it." only when a version is given; recent work cards; with no agents, one sentence and a link "See ways to earn" to `#/onboarding` (spec 8).
   - Agent panel (`?sheet=agent:editor`): a complementary region named "Editor" at panel width; the head with avatar, name, role and state words, and a close button "Close Editor"; a `tablist` with "Steps" and "Runs" (`aria-selected`, arrow keys move between tabs, Home and End too); Steps shows PostureChoice as radio cards with each posture's consequence line ("The team finishes it, you check samples", "You check every piece", from team.json; catalogue O16) calling `venture.team.posture`, and the agent's steps with Gates calling `venture.team.gate`; Runs lists that agent's runs from `venture.runs.list {state: 'all'}` with rings and state words, each opening the run sheet. `POSTURE_ABOVE_STAGE` still shows the engine's words (existing test).
   - Hindi renders with no missing keys.
2. Implement. D mapping: `.stats`, `.stat`, `.s-*` to `TeamStats`; `.dp`, `.p-*`, `.dp-*`, `.agents`, `.acard`, `.a-*` to `DepartmentPanel` and `AgentCard`; `.hero`, `.big*`, `.flow`, `.fr`, `.recent`, `.wcard`, `.spendt` to `OneDepartment`; `.cpanel`, `.cp-*` to the panel.

**Engine data that waits for W4:** each agent's department, the department summaries (working, waiting, done this week, spend this month, jobs this week), the toggle and `?dept=` view, the 6-week spend and jobs series, "Add an agent" and Keeper's jobs (4A); the Chat button, the Chat tab, the instructions version, standing orders and "set by" lines (4B); the held spend amount (4A).

**Done when** both Team test files pass and the Team and agent panel rows in `a11y.test.tsx` pass.

### 3E1: Work (size M)

**Boards:** `D-Work.dc.html`, `shots/D-Work.png`.

**Files:** `src/places/work/index.tsx`, `Work.module.css`, `OrderList.tsx` (becomes orders grouped by client), `OrderFocus.tsx`, `PreviousRuns.tsx` (becomes Finished), new `RunTiles.tsx`, `StoppedRun.tsx`; W2's `PostButtons.tsx`, `JudgeLine.tsx`, `TranscribeButton.tsx`, `CalendarFile.tsx` restyled in place; `src/text/{en,hi}/work.json`; tests `tests/places/work.test.tsx`, `tests/places/work-orders.test.tsx` (existing, must pass), new `tests/places/work-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - FilterChips "All", "Needs you", "Running", "Stopped", "Done" reflect `?state=` (the existing `#/work?state=failed` address shows "Stopped" pressed); business chips appear only when runs come from more than one business.
   - Running now: one tile per active or waiting run with Avatar, agent, business, ProgressRing, the purpose as an `h3`, the current step, and "Run {id} · {elapsed}" in DM Mono; the waiting tile says "Step 3 of 3 waits on you" in wait words, the run's question from `venture.runs.get`, and an Answer button (the one primary) that opens the run sheet; there is no Stop button (W4 4F; the test asserts none named "Stop").
   - Stopped: a failed run that still has a Run again row shows a tile with the purpose, "Stopped at step {n} of {total}" (the position of the failed step, counted), "What went wrong" with the engine's error, the steps, and Run again (primary) that decides the queue row through `venture.queue.decide`; there is no "How to fix it" button until W4 4F.
   - Finished: done runs with result and receipt, or "model estimate".
   - Orders: one tile per client with orders, the client's initials avatar, the name opening the client sheet, "client since {date}", and what they owe as a `Figure` with receipt when `owed` is present; each order as an inner card with the request, a status chip from `states.ts`, the price receipt, the delivery's and invoice's own status words, and "Open on Today" when a delivery waits on the owner. There is no stage stepper until W4 4J.
   - The existing intake, share link, new order and W2 controls keep their tests.
2. Implement. D mapping: `.runs`, `.rt*` to `RunTiles`; `.stopped`, `.sd-*` to `StoppedRun`; `.fin` to Finished; `.orders`, `.cg*`, `.oc*` to the order groups (not `.osteps`).

**Engine data that waits for W4:** Stop, Force stop, Resume, the breaker's "already tried" words and "Run again keeps step 1" (4F); the order stage steps (Agreed, Price, Episode, Publish, Invoice, Paid) and the per-order "2 wait on you" line (4J order steps); render frames and contact sheets on run tiles (4J queue previews); runs across businesses when one is locked (4J).

**Done when** the three Work test files pass.

### 3E2: Clients with three tabs (size M)

**Boards:** `D-Clients.dc.html` (tabs, toolbar, board), `D-Network.dc.html` (the tab bar only), PNGs.

**Files:** `src/places/clients/index.tsx` (tabs shell), `Clients.module.css`, `ClientSheet.tsx`, `Leads.tsx` (sheets and add keep their behaviour), new `ClientsTab.tsx`, `PipelineTab.tsx`; `src/text/{en,hi}/clients.json`; tests `tests/places/clients.test.tsx`, `tests/places/clients-leads.test.tsx` (existing, must pass), new `tests/places/clients-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - The tabs are a `nav` named "Clients views" with links "Clients" (`#/clients`) and "Pipeline" (`#/clients/pipeline`), each with a `Count` (clients, leads); the current has `aria-current="page"`; `#/clients/leads` still works and shows Pipeline as current (the old address stays); there is no Network tab until W4 4D.
   - Clients tab: one row per client with initials avatar, name, last order line, and owed as `Figure` with receipt (or nothing owed); opening a row opens the client sheet (existing).
   - Pipeline tab: Board "Pipeline board" with one column per engine lead stage, in the engine's order (New, Drafted, Contacted, Replied, Won), Lost folded as "Show Lost, {n} people", Blocked folded the same way; each card shows initials, name, company, the email check line in the engine's words and the latest draft or send ("Draft ready", "Sent 21 Oct"); opening a card opens `?sheet=lead:<id>` (existing); "Add a lead" opens the existing add sheet. Cards do not move by drag or key until W4 4E.
   - The leads tests from W1 (real engine codes, the postal address field) still pass.
2. Implement. D mapping: `.seg` as links, `.board`, `.col*`, `.colx*`, `.pc*` (without `.pc-path`, `.dots` and the follow-up row, which need W4 data).

**Engine data that waits for W4:** the Network tab with search, imports, warm paths and "Import contacts" (4D); the pipeline stages Found, Asked, Talking, Proposal, Won, Lost, Not now, strength dots, path lines, follow-up dates, drafted handoffs, the four stat tiles, "Due today and late" and "How people moved" (4E with 4D).

**Done when** the three Clients test files pass.

### 3F: Money visuals (size M)

**Boards:** `D-Money.dc.html`, `shots/D-Money.png`.

**Files:** `src/places/money/index.tsx` (sub-pages as Segmented links, toolbar), `Overview.tsx` (tiles), `Invoices.tsx` (table), `Books.tsx`, `Spend.tsx`, `SpendPolicy.tsx`, `Journal.tsx` (restyle only), `parts.tsx`, `words.ts`, `Money.module.css`, new `OwedTile.tsx`, `DueNext.tsx`, `views.ts` (the `AgingData`, `BarSeries` and `CashData` slots W4 fills); `src/text/{en,hi}/money.json`; tests `tests/places/money.test.tsx`, `money-invoices.test.tsx`, `money-ledgers.test.tsx` (existing), new `tests/places/money-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - The sub-pages are a Segmented `nav` (Overview, Invoices, Books, Spend, Journal) with `aria-current`.
   - Tiles: "Invoiced this month" from the books `billed` figure with its receipt (no goal bar until W4 4I); "Received" from the overview `received` line with its receipt; "AI spend this month" from the overview `spent` line with its receipt (no department split until W4 4A). `assertFiguresProved` passes on the page.
   - Owed tile: the overview `owed` figure with receipt, the number of open invoices as a `Count`, and the open invoices from `venture.books.summary` oldest due first, each with client, balance and due date; no aging bar is drawn (no `role="img"` named "Owed by age") until W4 4J; no "Draft reminders" button (W4).
   - "Due to you next": open invoices due next, by date, with their balances; nothing about costs.
   - No in-and-out chart and no cash line is drawn, and no sentence promises them (catalogue U5 and U12).
   - Invoices: a table with headers Invoice, Client, Amount, Status, Due, Receipt, Action; amounts are `Figure`s; status chips from `states.ts` (Draft, Sent, Part paid, Paid, Void); a draft row's "Issue" opens the invoice sheet, whose second ask is unchanged; there is no "late" chip until the engine says it (W4 4J).
   - The Journal's W1 Resolve and the spend settings' W1 tests pass.
   - Money's existing "stays near forty words" test: 3F raises its limit to the count measured on the new Overview and says so in the PR; 3I then moves it into `budgets.test.tsx`. It is never skipped.
2. Implement. D mapping: `.row1`, `.mt`, `.m-*`, `.s-*` to the tiles; `.owe`, `.ow-*`, `.ag-l` to `OwedTile` (no `.aging`); `.lt` to `DueNext`; `.itile`, `.itab`, `.cl*`, `.amt`, `.due` to the table.

**Engine data that waits for W4:** the goal on the invoiced tile (4I); aging in five buckets, in and out by month with what was left, 13-week cash with assumptions, costs in the next three weeks, invoice lateness words, last month's comparison, money across businesses with business chips, the month picker beyond the books periods and Export for your CA (4J money views); spend by department and the held amount (4A); reminder drafts (4E).

**Done when** the four Money test files pass.

### 3G1: Connections and Business (size M)

**Boards:** none for these places; built from `D-STYLE.md` pieces (tiles `c4`, chips, `TileHead`, `Segmented` links, `lrow`), following spec 4.3 "Connections" and "Business".

**Files:** `src/places/connections/index.tsx`, `YourAi.tsx`, `BankImport.tsx`, `external.tsx`, W2's `Posting.tsx`, `StepsCheck.tsx`, `BankSheet.tsx`, `Connections.module.css`, new `CanDo.tsx`; `src/places/business/index.tsx`, `PlanView.tsx`, `PricesView.tsx`, `BuildView.tsx`, `KeepView.tsx`, `KeepMore.tsx`, `YourCa.tsx`, `SiteEdits.tsx`, W2's `PracticeView.tsx`, `RulesSection.tsx`, `Business.module.css`; `src/text/{en,hi}/connections.json`, `business.json`; tests `tests/places/connections.test.tsx`, `business.test.tsx`, `keep-custody.test.tsx`, `privacy.test.tsx` (existing), new `tests/places/connections-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - Connections: Your AI is the first tile; connectors are tiles grouped by the engine's category, each group an `h2`; each tile has the category icon, the name, the honest label chips (write, read, handoff, planned) from `connectorLabelOf`, and the engine's note; a planned connector has no action button (must-keep).
   - The connector sheet lists the engine's `requires` lines as numbered setup steps (catalogue K11, what exists) and the posting options as before.
   - "What Chausar can do on this computer" (`CanDo.tsx`, catalogue U10): one row per connector mode that is available and writes or sends, with the mode's `what` line, and the fixed sentence "Stopping a connection does not undo what already happened."
   - Your AI keeps W1's rules (the key field outside any form, `autocomplete="off"`, cleared in `finally`); each preset shows its `availabilityReason` as the one fix line (catalogue K10, what exists).
   - Business: the pages are a Segmented `nav` (Plan, Prices, Website build, Keep, Your CA when on the CA firm playbook, Practice from W2); Plan shows offers as cards with their price receipt or "Set your price", and "Setup, {done} of {total}" as a ProgressBar from `venture.get` (catalogue U6, U18); Keep keeps every custody test; the experimental storage notice shows here too (3A2's part).
2. Implement.

**Engine data that waits for W4:** the CLI found on this computer with version and sign-in state (4H); least-privilege setup guides and "Sends: nothing" lines (4J connectors); "Your network" source cards (4D); Business > Goals (4I) and Notifications (4G); the setup checklist's item names (4J); the accountant invite (4J).

**Done when** the five test files pass.

### 3G2: Start (size S)

**Boards:** `D-Start.dc.html`, `shots/D-Start.png`.

**Files:** `src/places/onboarding/index.tsx`, `Start.tsx` (look only; the flow, the passphrase and recovery code steps stay), `FirstRun.tsx`, `Onboarding.module.css`, new `HowStarting.tsx`, `Examples.tsx`, `ways.ts` (the `WayData` slot for the gallery); `src/text/{en,hi}/onboarding.json`; tests `tests/places/onboarding*.test.tsx`, `welcome-custody.test.tsx` (existing), new `tests/places/start-v2.test.tsx`, `tests/a11y.test.tsx` rows.

1. Failing tests:
   - `#/onboarding`: the eyebrow "Start a new business"; the `h1` is "Describe your business" while the engine lists no ways to earn (it becomes "Pick a way to earn" when the gallery has tiles); the sub line says nothing goes out until the owner approves.
   - "How starting works": three numbered steps (Describe or pick, Read your plan, Approve real work) with icons and words only, no figures.
   - The one-sentence tile: the labelled box, the hint "Write in English or हिन्दी", "Make my plan" as the one primary, and a group "Examples" of three buttons ("Wedding invitation videos", "GST filing for kirana shops", "बच्चों को ऑनलाइन गणित") that fill the box and call no engine method; the examples never cycle.
   - `Gallery` renders only when `ways` is given (W4); with it (a unit test with props), tiles in a 3-column grid and the featured tile with the one primary.
   - The existing onboarding and first-run tests pass (preview, vault, plan, recovery code shown once).
2. Implement. D mapping: `.how`, `.hsteps`, `.hstep` (icons in place of `.hs-pv` miniatures) to `HowStarting`; `.desc`, `.d-*`, `.ex*` to the box; `.gall`, `.way` through the Gallery part.

**Engine data that waits for W4:** the list of ways to earn with hours, AI team and price ranges (4J, `venture.playbooks.list`; one tile per playbook in W5); "Good fit for you" (4C, labelled "model estimate"); "Not sure which fits? Ask Chausar" (4C); the "for which business" picker and file drop (4J).

**Done when** the onboarding test files pass.

### 3H1: phone layout and swipe (size M)

**Boards:** `D-Phone-Today.dc.html`, `D-Phone-Team.dc.html`, the D phone block (`D-Phone-Today.dc.html` lines 298 to 344), PNGs.

**Files:** `src/shell/App.tsx`, `App.module.css`, `Rail.tsx` (not rendered when narrow), new `src/shell/useNarrow.ts` (`matchMedia('(max-width: 759px)')`, follows changes), new `src/shell/TopBar.tsx`, `src/shell/sheets.tsx` (`more` sheet), `src/places/today/NeedsYou.tsx` (SwipeCard wrap and the tip), `GoalCard.tsx` and `TeamAtWork.tsx` (phone variants), `src/places/team/*.module.css` (stacking), every place CSS module's narrow rules where needed, `index.html` (theme-color metas for light and dark), new `public/manifest.webmanifest`; `src/text/{en,hi}/common.json` (`phone.`, `more.`), `today.json` (`today.swipe.`); tests new `tests/shell/phone.test.tsx`, `tests/places/today-swipe.test.tsx`, `tests/a11y.test.tsx` rows (phone cases with a stubbed `matchMedia`).

1. Failing tests (with `matchMedia` stubbed to match `(max-width: 759px)`):
   - No rail is rendered; the top bar has the logo link "Chausar, Today" and the business button; there is no bell and no account button until W4.
   - BottomTabs "Places": Today (with the count badge), Team, Work, Clients, More; `aria-current` on the current; More is current on Money, Connections and Business.
   - More opens a sheet "More" with links to Money, Connections, Business and "Start a new business".
   - Sheets cover the screen (`data-cover` on the sheet container).
   - Today: each card is wrapped in a SwipeCard. Swiping right on the price card shows the second ask and sends nothing; confirming sends one decide. Swiping right on the locked draft sends nothing and shows "Approve unlocks after you watch it". Swiping left on a row with a Later action decides `later`; on a row without one, the card moves to the end of the list for this session with no engine call. Swipe never decides money alone (spec 8).
   - The tip "Swipe right to approve, left for later. Big steps still ask twice." has "Hide this tip"; hiding it lasts for the session only (nothing is stored).
   - Goal card phone variant: the foot stats move under the bar; stories and filter chips scroll sideways.
   - `index.html` has `theme-color` metas for light and dark equal to `--bg` in each theme; the manifest names "Chausar", lists `icon.svg`, and its colours equal the tokens; `public/theme.js` still sets `data-theme` before the first paint.
2. Implement. D mapping: `.top`, `.bizb`, `.pmain`, `.tabs`, `.tab*`, `.hscroll`, `.phone .*` overrides, `.swipe`, `.under*`, `.tip*`; targets at least `--target` (44 px); every phone card's buttons size xl.

**Engine data that waits for W4:** the Chats tab, which takes the second slot when 4C lands (Clients moves into More); the bell (4G); the business name in the hosted manifest (4J).

**Done when** both phone test files and the phone rows in `a11y.test.tsx` pass.

### 3H2: Hindi and copy (size M)

**Files:** every `src/text/hi/*.json` (review and fill), new `src/text/hi-review.json` (`{ "machineDrafted": [keys] }`, outside the globbed folders), new `tests/baselines/text-keys-w2.json` (the English keys at wave start), `tests/text.test.ts`, `tests/source-rules.test.ts` (two rules), new `tests/places/hindi-v2.test.tsx`.

1. Failing tests:
   - Every English key added in W3 (keys not in `text-keys-w2.json`) is in `hi-review.json`, and every listed key exists in both catalogues (the list is for the native reviewer the spec asks for).
   - Rendering Today, Team, Work, Clients, Money, Connections and Start in Hindi with the fake engine shows no text that looks like a key (`/^[a-z]+(\.[a-zA-Z0-9]+)+$/`).
   - Source rules: a `:lang(hi)` rule lets chips, kind chips and filter chips wrap to two lines (spec 8); `text-overflow: ellipsis` and `line-clamp` appear only in rules whose class names a prose part (title, line, role, now, sub, name), never one that names a figure (fig, amt, value, figure, count).
   - Banned English copy (catalogue U14 house style): no "AI-powered", "magic", "seamless", "revolutionary", "supercharge", "unlock your", "delve", and no "!" in English copy.
2. Fill the Hindi strings the place packages left as drafts, keep placeholders and plural forms identical.

**Done when** the text, source-rules and Hindi tests pass.

### 3I: screenshot walk, real-browser checks and word baselines (size M)

**Boards:** all twelve D boards and their PNGs.

**Files (new):** `scripts/ui-shots/main.cjs` and `scripts/ui-shots.mjs` (Electron, already a dev dependency: offscreen windows at 1280 and 390 wide, full page height, `nativeTheme.themeSource` light and dark, `?lang=hi` for the Hindi pass, against `npm run dev:ui`), `tests/budgets.test.tsx`, `tests/baselines/words.json`, `parts.html`, `specimens/index.tsx`; **changed:** `tsconfig.json` (`include` gains `specimens`), `.gitignore` (`app/ui/.shots/`), `tests/places/money.test.tsx` (the 45-word test moves into `budgets.test.tsx`), `docs/venture/ink.md` (known limits: every "placeholder until W4" item).

1. The walk (each address at 1280 and 390, light and dark; Hindi at 390 light):

   | D board | Address | Compared for |
   |---|---|---|
   | D-Today, D-Phone-Today | `#/today` | header, goal card (fallback), team at work, cards, working now, earlier |
   | D-Team, D-Phone-Team | `#/team` | stats, agent cards (no departments yet) |
   | D-TeamDept | (W4 4A) | the `OneDepartment` part on the parts page below |
   | D-TeamChat | `#/team?sheet=agent:editor` | the panel shell (no chat yet) |
   | D-Work | `#/work`, `#/work?state=failed` | run tiles, stopped tile, finished, orders |
   | D-Clients | `#/clients/pipeline` | tabs, board (lead stages) |
   | D-Network, D-Chats | (W4 4D, 4C) | DiffCard, ChatThread, PathLine on the parts page |
   | D-Money | `#/money`, `#/money/invoices` | tiles, owed, due next, table |
   | D-Start | `#/onboarding` | how starting works, the one-sentence tile |
   | none | `#/connections`, `#/connections/ai`, `#/business/plan`, `#/business/keep`, sheets run, receipt, view, invoice | the D pieces applied |

   W4-only parts are shot on a parts page that exists only in the dev server: `app/ui/parts.html` with `app/ui/specimens/index.tsx` (outside `src/`, so its sample data never enters the app's source; added to `tsconfig.json`'s `include`), fed by test-style props. `build:ui` builds only `index.html`, and a test checks `dist` has no `parts.html`. Nothing in the app links to it.
2. Real-browser checks in the same Electron run: inject `axe-core` from `node_modules` and run it on `#root` with colour contrast on, for every address, both themes, both widths; any violation fails the script. Then press through the interaction plan (open a sheet, the business menu, J and K, the second ask) and check focus lands where the tests say.
3. Unprimed review (catalogue Q24): a fresh subagent gets only the shots and the D PNGs, is not told what is expected, and writes the strongest case for "broken" first, then the differences from D; the integrator fixes or lists each one.
4. Word baselines: `budgets.test.tsx` renders each place at rest with the fake engine and checks `words(main())` against `tests/baselines/words.json` (first measured here, rounded up to the next 10, may only shrink), and per part: a card's own copy (kind chip, note line, buttons) at most 12 words, a page sub line at most 20.
5. A side-by-side page `app/ui/.shots/index.html` (D on the left, the app on the right) for the founder's look check, published as a private artifact for him.

**Done when** the script runs clean (axe with contrast in every case), the review's findings are fixed or listed in the PR, `budgets.test.tsx` passes, and `ink.md` lists every placeholder.

## What only W4 provides, by place

| Place | Data the engine does not send yet | W4 package |
|---|---|---|
| Rail and header | Chats item, Ask Chausar box, bell with count | 4C, 4G |
| Today | goal progress, pace, days left, ready to issue, next best step; department of each agent; Chausar story; card previews (frames, durations, chapters, invoice lines, post text, title choices, check counts); row meta (client, expiry, "Sends to the client"); Stop on running rows; the owner's first name | 4I; 4A; 4C; 4J queue previews; 4J approvals; 4F; 4J owner profile |
| Team | departments and their summaries, toggle, one-department view, 6-week chart, Add an agent, Keeper, held spend; Chat button, chat tab, instructions version, standing orders | 4A; 4B |
| Work | Stop, Force stop, Resume, breaker words, run-again scope; order stage steps; frames on tiles | 4F; 4J order steps; 4J queue previews |
| Clients | Network tab; pipeline stages, strength, warm paths, follow-ups, drafts and handoffs, stat tiles, funnel | 4D; 4E |
| Money | goal on invoiced; aging buckets, in and out by month, 13-week cash, costs ahead, lateness, comparisons, cross-business money, export; spend by department; reminder drafts | 4I; 4J money views; 4A; 4E |
| Connections | CLI status; setup guides; network sources | 4H; 4J connectors; 4D |
| Business | Goals page; Notifications page; checklist item names; accountant invite | 4I; 4G; 4J |
| Start | ways to earn list; "Good fit for you"; Ask Chausar | 4J playbook list (tiles in W5); 4C |
| Phone | Chats tab; bell; business name in the hosted manifest | 4C; 4G; 4J |

The 4J items (queue previews, approvals meta, owner profile, order steps, money views, connector guides, playbook list) are not named in the master plan's W4 outline; the W4 plan should give them their own packages.

## Wave 3 done when

Every package's tests pass; `npm run typecheck:ui`, `npm run test:ui` (no skipped tests, `scripts/ui-bench.mjs`) and `npm run build:ui` are clean; `npm run typecheck` and the six bench shards are green (W3 touches no engine file, so they should be unchanged); 3I's walk and real-browser axe are clean in both themes at both widths; the PR "Ink v2 wave 3: the look" has a board-by-board table (address, what matches, what waits for W4) and the founder's side-by-side page.

## Choices made here that the founder may want to change

- The 12 px type floor wins over D's 11.5 px chips and 10.5 px chart labels; half sizes snap to the Ink scale.
- Nothing loops: no slow pulse for working agents and no cycling example prompts (D and the catalogue suggested both).
- Word budgets rise from "35 to 45 words at rest" to measured per-place baselines, because D carries much more on each screen.
- Places show only real data; the goal card shows the real invoiced figure without a bar until goals exist, and Pipeline uses today's lead stages until W4's pipeline.
- In the dark theme the goal card is lifted (#1f2124 with a border) so it does not vanish into the page; amber words on department tints use a darker amber (#A84D08) to reach 4.5:1.
