// The direction D boards, what the walk compares each with, and what the comparison found (w3 package 3I, written from
// the shots of 26 October 2026 and an unprimed review of them, catalogue Q24; rewritten for wave 4 by package 4Z from
// the walk of 26 October 2026, once the engine sends the data wave 3 waited for). publish.mjs turns this into
// docs/superpowers/designs/ink-v2-direction-d/side-by-side.html and WALK.md. When a wave changes a place, change its
// entry here and run the walk with --publish again.
//
// cases: walk case ids (scripts/ui-shots/cases.mjs); the first is the one drawn beside the board, the rest under it.
// phone: a phone board, compared at 390.
// waits: what is still to come after wave 4, and where (W5 is the playbooks wave).

export const BOARDS = [
  {
    board: 'D-Today', title: 'Today', address: '#/today', cases: ['today', 'today-set', 'today-folds'],
    matches: [
      'Rail with the two-square logo, the business switcher and the amber Today count; Chats in the rail; the Ask Chausar box and the bell with its dot in the header.',
      'The dark goal card with the goal, the bar, the percent, today\'s pace, days left, still to invoice and received, each figure with its receipt; the Next best step beside it with Open and the one primary (W4 4I2).',
      'Team at work: Chausar first with "Ask anything", agents with rings, department badges and state words, Add agent; live tiles with progress rings, the current step and "Answer below".',
      'Needs you: wait-count chip, filter chips by kind and by business, preview cards (the plan paper, the price change, the video with chapters and checks, the sign-off paper with its lines), one filled primary per card, Approve locked until watched; Approve several and Sort under the chips (W4 4J19).',
      'Working now with Stop on each run, Earlier with receipts; Waiting on you and Ideas folded last (W4 4J22b).',
    ],
    differs: [
      'The greeting has no first name: the sample sets no owner profile (Business > About you sets one). No account button and no Ctrl K hint in the box.',
      'The next best step is the engine\'s, so on the sample it is the sponsor price, not D\'s invoice; there is no "Ready to issue" hatch on the bar, because nothing is drafted and ready on the sample.',
      'Stories show the open business\'s team (5 with Keeper), not D\'s 8 across businesses; Bookkeeper and Billing belong to Ledgerline.',
      'Amounts keep the engine\'s format ("₹1,12,400.00") where D drew whole rupees; type never goes below 12 px and nothing loops (plan choices).',
    ],
    waits: ['The owner\'s name in the greeting once About you is filled (built, empty on the sample)'],
  },
  {
    board: 'D-Phone-Today', title: 'Today on a phone', address: '#/today at 390', cases: ['today'], phone: true,
    matches: [
      'Top bar with the logo, the business button and the bell; bottom tabs Today (count badge), Chats, Team, Work, More, with Clients under More.',
      'The dark goal card with its bar and the next step, stories and live tiles in sideways rows, filter chips in a sideways row.',
      'The swipe tip with Hide; every card swipes, right through the card\'s own primary (the second ask holds), buttons xl.',
    ],
    differs: ['No account button.'],
    waits: [],
  },
  {
    board: 'D-Team', title: 'Team', address: '#/team', cases: ['team'],
    matches: [
      'The department toggle (All departments, Sales and clients, Marketing, Production, Money, Operations) and Add an agent (W4 4A2).',
      'Stat tiles: Working now with an avatar stack, Waiting on you in amber, Done this week with its bars, AI spend with its receipt and the held amount.',
      'Five tinted department panels with their icon, jobs this week, spend with its receipt and agent cards (ring, role, now line, step bar, posture chip, Chat); Keeper as code, not AI, with its jobs; Jobs done this week by department.',
    ],
    differs: [
      'Spend leads in rupees with the dollar line under it, as D drew: the business is in India and has a rupee rate (chosen by the founder on 27 October; Limits and rates changes it). A department with no own spend shows none.',
      'Money has no agents on the sample, so its panel says so and offers "See ways to earn"; D drew Bookkeeper and Billing there (they are Ledgerline\'s).',
      'The jobs chart is a bar list without the rupee column (the engine sends jobs per department, and spend separately).',
    ],
    waits: [],
  },
  {
    board: 'D-Phone-Team', title: 'Team on a phone', address: '#/team at 390', cases: ['team'], phone: true,
    matches: ['The department chips in a sideways row, stat tiles and full-width agent cards with rings, bars, posture chips and Chat.'],
    differs: ['Stat tiles stack one per row, where D has two by two: a long rupee figure must never share a row on a phone (3B1b rule).'],
    waits: [],
  },
  {
    board: 'D-TeamDept', title: 'One department', address: '#/team?dept=prod', cases: ['team-dept-prod', 'team-dept'],
    matches: [
      'In the app now (W4 4A2): the toggle with Production chosen; the hero panel on the Production tint with icon, purpose, jobs this week, spend with its receipt and playbook steps.',
      '"How Production runs" with its version: assigned agent steps with Auto and Hold, and "A change makes version 5. You can undo it". Owner-only publication stays outside the agent assignments.',
      'Agents in the department, Recent work as cards with state and progress, and Spend and jobs by week.',
    ],
    differs: [
      'Steps carry the agent\'s name and one icon per kind, not D\'s per-step descriptions (the engine\'s steps carry none). No Edit steps link: steps change through the agent\'s chat ("from now on").',
      'No live run checklist with frames on the agent card and no thumbnails in recent work: the run checklist is on the run sheet and Work.',
      'Spend in the chart and hero leads in rupees, with dollars beneath (as on Team).',
    ],
    waits: [],
  },
  {
    board: 'D-TeamChat', title: 'The agent panel', address: '#/team?sheet=agent:editor&tab=chat', cases: ['team-agent', 'team-agent-instructions', 'team-agent-notes', 'team-agent-skills'],
    matches: [
      'The 440 px panel beside the page; its head with avatar, name, role, the department chip, state in words ("Working, 3 of 5") and Close.',
      'Tabs Chat, Instructions with its version, Runs with its count, Notes and Can do in one row; previous and next agent above the thread.',
      'The thread: day lines, the owner\'s messages in ink, a note to save quoting the owner, runs folded to one row, the Recalled chip, the "from now on" change with Added in words, "Version 4 to 5, you can undo", Reject and Accept; the composer with suggestions and its hint.',
    ],
    differs: [
      'The plan names the sample editor `story-editor` (the engine\'s role id); the fake engine names it `editor`, so the shots use `agent:editor`.',
      'No video preview or run card with Run again inside the thread: the engine\'s thread items are messages, folded runs, notes and proposals; previews stay on Today, Work and the run sheet.',
      'The open agent\'s card on the page behind is not outlined, and its Chat button is not filled as on the board.',
    ],
    waits: [],
  },
  {
    board: 'D-Work', title: 'Work', address: '#/work', cases: ['work', 'work-stopped', 'work-run-sheet'],
    matches: [
      'Filter chips with business chips and New order; Running now tiles with avatar, ring, purpose, current step, "Run 31 · 4m" and Stop on each; the waiting tile in amber with the run\'s question, Stop and Answer.',
      'The failed tile: "Failed at step 2 of 3", What went wrong in the engine\'s words, the steps, Run again and How to fix it (W4 4F3); a run the owner stopped has its own tile with why, Run again and Resume.',
      'Orders by client with what they owe and the stage steps Agreed, Price, Episode, Publish, Invoice, Paid (W4 4J3), what waits on you, Open on Today and Mark delivered.',
    ],
    differs: [
      '"Failed", not D\'s "Stopped": Stopped is kept for the owner\'s own Stop and the breaker.',
      'No frames, A and B thumbnails or tool icons on the running tiles, so they are blank in the middle; Keeper\'s jobs are on Team, not here.',
      'An order says "Priced on receipt" with its receipt where D drew the old and new price.',
    ],
    waits: ['The filmstrip of browser posting runs (U7; needs W2 2B2\'s page model, listed in ink.md)'],
  },
  {
    board: 'D-Clients', title: 'Clients, pipeline', address: '#/clients/pipeline', cases: ['clients-pipeline', 'sheet-card'],
    matches: [
      'Tabs Clients, Pipeline and Network with counts; Import contacts and Add a lead; stat tiles Next steps this week, Drafts to send, Moved forward this week and Won this month, each with its receipt (W4 4E4).',
      'Filter chips (All, Due soon, Has a draft) and the path key; the board Found, Asked, Talking, Proposal, Won, with Not now folded; cards with strength dots, the path line ("possible path, not confirmed" dashed), the follow-up date and the draft state.',
      'How people moved, folded under the board.',
    ],
    differs: [
      'Column hints ("Not asked yet") are read out but not shown, to keep the board quiet; stat tiles carry a receipt where D drew avatar stacks and a sparkline.',
      'No business chips: they show only when more than one business has cards. The sample has 9 cards, not 19.',
    ],
    waits: ['Importing clients and their history (C22, W5)'],
  },
  {
    board: 'D-Network', title: 'Network', address: '#/clients/network', cases: ['clients-network', 'sheet-person', 'sheet-network-import', 'sheet-draft'],
    matches: [
      'The Network tab with its count; the search in plain words with the web line and the starters; Browse everyone; results as cards with avatar, 1st, role, strength dots, the Why line quoting the file, the checks, the path line, Open in LinkedIn, WhatsApp and Draft intro (W4 4D4, 4E4).',
      'Where your network comes from (file, people kept, items left out, the old-file line, Import a newer file), How well you know them by band with its receipt, Private to you with What Chausar keeps.',
      'The intro request as a sheet: to, the note, the note they can forward, Send it yourself from Mail, LinkedIn or WhatsApp, I sent it, I called them instead, "Chausar never sends".',
    ],
    differs: [
      'The intro request opens as a sheet beside the page, not as D\'s column beside the results.',
      'Web search is not set up in this build, so "Also look outside my network" is a line, not a choice (ink.md, Known limits).',
      'The sample\'s search answers the same seven people whatever is asked (the fake engine; the engine searches the owner\'s files).',
    ],
    waits: ['Web search, once a host composes one with its consent (4D3)'],
  },
  {
    board: 'D-Chats', title: 'Chats', address: '#/chats?thread=<id>', cases: ['chats', 'chats-raised', 'chats-estimate'],
    matches: [
      'Your chats with New chat, the search box and the groups; the chat head with the mark, its title and Pin; the chief\'s answer with each figure and its receipt, the worked table, "A short plan" with "each one asks you first" and the next step on the accent with Not now and Start; the footer line (W4 4C2).',
      'Start raises the step to Today: "On Today" links to its card there, and the next step moves up.',
      'A model-written figure carries "model estimate".',
    ],
    differs: [
      'No goal bar inside the worked table: the engine\'s answer carries its receipted lines, not a chart. Plan steps carry no price, and name an agent only where the engine does.',
      'No icon per chat in the list and no Pinned group on the sample; no "in this chat" agent stack in the head.',
    ],
    waits: [],
  },
  {
    board: 'D-Money', title: 'Money', address: '#/money', cases: ['money', 'money-bills', 'money-margins'],
    matches: [
      'Sub-pages Overview, Invoices, Bills, Books, Margins, Spend, Journal, Businesses; business chips, the month and Export for your CA (W4 4J20).',
      'Invoiced this month with the goal bar, days left and pace; Received; AI spend split by department with its receipt; Owed to you with the aging bar; Cash, next 13 weeks with the lowest week.',
    ],
    differs: [
      'In and out by month and the next three weeks are folds below the tiles (a 4J20 ruling), where D drew them open.',
      'Every amount carries a small receipt mark, not its code (chosen by the founder on 27 October); AI spend leads in rupees (as on Team).',
    ],
    waits: [],
  },
  {
    board: 'D-Start', title: 'Start', address: '#/onboarding', cases: ['onboarding'],
    matches: [
      '"Pick a way to earn" with the count; How starting works in three numbered steps; All ways to earn with category chips, Sort, and tiles with the category, "You run this", your time, what clients usually pay (model estimate), What it takes and Start (W4 4J21).',
      'Or describe it in one sentence with the country line, Make my plan, Start a new business or Add this to the open business, and examples; Not sure which fits? with Ask Chausar; Resume setup with its bar.',
    ],
    differs: [
      'Three ways, not twelve: the gallery shows only built playbooks (plan choice 10; W5 adds the rest).',
      'No "Good fit for you": the engine suggests a fit only with the owner\'s AI connected, and the sample has none.',
      'How starting works uses icons and words, not the miniature cards of D.',
    ],
    waits: ['More ways to earn with W5\'s playbooks'],
  },
];

/** Fixed during the walks, each with the test that holds it. */
export const FIXED = [
  'Wave 3: receipt sheets mark their root `data-receipt-sheet` through `<Sheet receipt>`, and the Ink rules helper lets money text sit there: the sheet is the proof (tests/shell/receipt-sheet.test.tsx).',
  'Wave 3: Hindi step counts ("5 में से 3") are set in the body face (`:lang(hi) [data-count]` in base.css; tests/hindi-counts.test.tsx; the walk checks the computed face in Chrome).',
  'Wave 3: on a phone the live tiles on Today scroll sideways and their row takes focus and is named (axe scrollable-region-focusable; tests/walk-findings.test.tsx).',
  'Wave 3: Money > Invoices with a sheet open at 1280: the table\'s visually hidden words escaped its scrolling tile; the tile is now positioned, and the table stacks under 840 px.',
  'Wave 3: on a phone a covering sheet is a modal dialog named by its title; the business menu is a labelled, non-modal dialog.',
  'Wave 3: lock notes, card heights, figures with words, "Priced on receipt", the tab badge and the avatar stack (tests/walk-findings.test.tsx, tests/budgets.test.tsx).',
  'Wave 4: the agent panel\'s chat thread is positioned, so its messages\' hidden words no longer stretch the sheet column; sending a message used to scroll the panel\'s head and thread out of view (tests/walk-findings.test.tsx).',
  'Wave 4: the agent panel\'s Chat fits an 860 px window with the sample line (the thread leaves 32rem), and its tab panel may shrink, so the panel never scrolls sideways (tests/walk-findings.test.tsx).',
  'Wave 4: the pipeline board is positioned, so its columns\' hidden hints scroll with it; at 390, and at 1280 with a card sheet open, the place was 1056 px wide (tests/walk-findings.test.tsx).',
  'Wave 4: in Chats, "On Today" links to the raised card (`?row=proposal:<id>`), so Today brings it into view even when it sits folded behind "Show more" (tests/places/chats.test.tsx).',
  'Wave 4: a plan\'s title in Chats keeps its words on one line and the step count wraps under it; in Hindi at 390 the title broke one word per line (tests/walk-findings.test.tsx).',
  'Wave 4: the walk itself: Hindi comes from the computer\'s languages (navigator.languages), as the app picks it, not `?lang=hi`; a case may start on a later day (`clock`), so Today\'s Ideas fold shows the sample idea after 28 Oct; Hindi steps press Hindi names; a test whose "Price" check met the new order stage named Price now skips the stage steps.',
];

/** Seen in the shots, the hand walk and the review, not fixed here; for the integrator or the founder. */
export const LISTED = [
  'Hindi: some words the engine writes stay English (row lines, some action labels, engine notes in chat), because the fake engine writes English; dates in mono read wide; every Hindi string is machine-drafted and waits for a native reviewer (src/text/hi-review.json, with the engine files that carry their own Hindi).',
  'Connections: a connector with one mode that writes and one planned shows both labels on one card (LinkedIn: browser posting writes, API posting is planned).',
  'Initials: Bookkeeper is "BO" and Ledgerline "LE" by the initials rule, where D drew "BK" and "LL".',
  'Dark theme: the locked primary (mute on accent soft, 5.2:1) reads quiet by design; the goal card is lifted to #1f2124 with a border, softer than D\'s black card.',
  'The fake engine cannot trip a breaker or make a draft stale between two clicks in one window, so those two flows are held by tests (work-controls.test.tsx: the breaker tile; today-actions.test.tsx: a stale edit) and not walked by hand.',
  'The fake engine\'s network search answers the same people whatever is asked, so a person just imported does not show in a search; the engine searches the owner\'s files (venture-network-search tests).',
  'A follow-up shows on Today only when it falls due (by date, 4E1): after "I sent it" the intro\'s follow-up is due 2 Nov, so the walk shows a due one with the fake\'s `?due` start (today-outreach).',
  'The handoff note under Send it yourself always says it opens "your mail app", also after WhatsApp or LinkedIn is chosen.',
  'Electron was not walked: this checkout has no Electron binary (node_modules/electron has no dist, and the launcher refuses to download one).',
];

/** Wave 4's first walk (4Z, 26 Oct), before its fixes; the last walk's numbers come from its report. */
export const WAVE4_FIRST_WALK = {
  checks: 479,
  failed: 24,
  why: [
    '13 checks: the pipeline board widened its place (hidden column hints outside the scroller), at 390 and with a card sheet open at 1280; fixed.',
    '8 checks: steps the walk pressed by stale names ("Runs" now carries its count, "Draft it" is "Open the draft" once a draft exists); the cases were updated.',
    '3 checks: Hindi shots pressed English button names; Hindi steps now carry their Hindi name.',
  ],
  axe: 0,
};
