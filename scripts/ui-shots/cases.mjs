// What the Ink screenshot walk visits (scripts/ui-shots/walk.mjs): every place, its main states, its sheets and the
// forms and second asks that open inside them, on the fake engine of `npm run dev:ui`. Each page load starts the fake
// engine afresh, so a case that needs another business switches to it through the business menu, like an owner would.
//
// A case:
//   id        file name stem (app/ui/.shots/<id>--<width>-<theme>[-hi].png)
//   path      what follows the server address: "#/today"; the Hindi pass sets the computer's languages to Hindi
//             (navigator.languages), and the app picks Hindi from them itself
//   steps     done in order after the page settles: { press: name, hi?: name, in?: selector } clicks a button, link or
//             tab by its accessible name (its Hindi name in the Hindi pass, when given); { business: name } switches business through the menu; { hash } moves inside the app
//             without a reload; { key } presses a key; { unfold: true } opens every fold
//   board     the direction D board this is compared with at 1280 (docs/superpowers/designs/ink-v2-direction-d)
//   phone     the D phone board this is compared with at 390
//   clock     an ISO time the page's clock starts at (the fake engine dates from new Date()); the real clock unless said
//   widths    [1280, 390] unless said
//   hindi     also shot at 390, light, in Hindi
//   note      what the comparison looks at (the walk table in WALK.md)

export const PLACES = [
  { id: 'today', path: '#/today', board: 'D-Today', phone: 'D-Phone-Today', hindi: true, note: 'header, goal card with the goal and the next best step (4I2), team at work, needs-you cards, working now, earlier' },
  { id: 'today-questions', path: '#/today?show=questions', note: 'filter chips: Questions pressed' },
  { id: 'today-more', path: '#/today', steps: [{ press: 'Show 8 more' }], note: 'the folded cards shown (4Z3: five full cards, the rest folded)' },
  { id: 'today-second-ask', path: '#/today', steps: [{ press: 'Approve', in: '[data-row-id="q-price-sponsor"]' }], note: 'the second ask inside a price card' },
  { id: 'today-goal-unset', path: '#/today', steps: [{ business: 'Ledgerline' }], note: 'W4 4I2: no goal for the month: the ask, last month, the suggestion' },
  { id: 'today-answer', path: '#/today', steps: [{ press: 'Show 8 more' }, { press: 'Answer', in: '[data-row-id="q-question-title"]' }], note: 'an answer box inside a card (4Z3: it waits behind the fold)' },
  { id: 'today-menu', path: '#/today', steps: [{ press: /Switch business$/ }], note: 'the business menu as a popover' },
  { id: 'today-send-back', path: '#/today', steps: [{ press: 'Send back', in: '[data-row-id="run:d-ep14:review-1"]' }], note: 'W4 4J19: a draft sent back with the words of the owner, the box prefilled "Revise this to "' },
  { id: 'today-set', path: '#/today', steps: [{ press: 'Approve several' }], note: 'W4 4J19: approve several: nothing ticked, no approve all, the total and refusals the engine works out' },
  { id: 'today-sort', path: '#/today', steps: [{ press: 'Sort' }], note: 'W4 4J19: Sort Today by, with the fixed choices when there is no AI' },
  { id: 'business-decisions', path: '#/business/decisions', note: 'W4 4J19: who decided what, on what rule, with Stop always allowing' },
  { id: 'business-voice', path: '#/business/voice', hindi: true, note: 'W4 4J22b: a voice per language and channel, six sections, version, Go back, Learn from your writing' },
  { id: 'business-knowledge', path: '#/business/knowledge', note: 'W4 4J22b: sources with the screen and Forget lines, add, test a question, files the agents need' },
  { id: 'today-folds', path: '#/today', clock: '2026-10-29T10:00:00+05:30', steps: [{ unfold: true }], note: 'W4 4J22b: who is waiting on you and ideas, folded last (on 29 Oct: the sample idea shows only after 28 Oct)' },
  { id: 'team', path: '#/team', board: 'D-Team', phone: 'D-Phone-Team', hindi: true, note: 'stats, the department toggle and panels, Keeper, jobs by department (W4 4A2)' },
  { id: 'team-dept-prod', path: '#/team?dept=prod', board: 'D-TeamDept', hindi: true, note: 'W4 4A2: one department in the app: the hero panel, its agents, how it runs with Auto and Hold, recent work' },
  { id: 'team-agent', path: '#/team?sheet=agent:editor&tab=chat', board: 'D-TeamChat', hindi: true, note: 'W4 4B3: the Chat tab: folded runs, Recalled chip, a "from now on" change as a DiffCard, the composer' },
  { id: 'team-agent-instructions', path: '#/team?sheet=agent:editor', note: 'W4 4B3: Instructions: the version, each step with its guidance and checks, standing orders, posture and who set it' },
  { id: 'team-agent-waiting', path: '#/team?sheet=agent:producer&tab=chat', note: "W4 4B3: the run's question pinned above the thread, with Answer" },
  { id: 'team-agent-notes', path: '#/team?sheet=agent:editor&tab=notes', note: 'W4 4B3: Notes with their source and date, Edit, Forget and the change lines with Undo' },
  { id: 'team-agent-persona', path: '#/team?sheet=agent:editor&tab=instructions', steps: [{ press: 'Test', hi: 'आज़माएँ', in: 'aside' }], hindi: true, note: 'W4 4J22b: How it talks in Instructions: a test on the practice clients with its cost, Go back, the agent file' },
  { id: 'team-agent-skills', path: '#/team?sheet=agent:editor&tab=cando', hindi: true, note: 'W4 4J22b: Can do: skills with "Try this", then see, do and off; the tabs in one row' },
  { id: 'team-agent-cando', path: '#/team?sheet=agent:publisher&tab=cando', note: 'W4 4J22b: Can do: the one tool list, see, do and off, each with its state, a planned step' },
  { id: 'team-agent-runs', path: '#/team?sheet=agent:producer&tab=runs', note: "the panel's Runs tab (by its address)" },
  { id: 'team-quiet', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/team' }], note: 'a team with nobody working' },
  { id: 'work', path: '#/work', board: 'D-Work', hindi: true, note: 'run tiles, failed tile, finished, orders' },
  { id: 'work-failed', path: '#/work?state=failed', note: 'Failed filter' },
  { id: 'work-stop-ask', path: '#/work', steps: [{ press: 'Stop run 31', hi: 'रन 31 रोकें' }, { press: 'Force stop', hi: 'तुरंत रोकें' }], hindi: true, note: 'W4 4F3: the Stop dialog on a run tile, Force stop asking once more with the step it throws away' },
  { id: 'work-stopped', path: '#/work', steps: [{ press: 'Stop run 29' }, { press: 'Stop', in: '[role="dialog"]' }], note: 'W4 4F3: a run stopped by the owner, on its own tile with why, Run again and Resume' },
  { id: 'work-run-sheet', path: '#/work?sheet=run:31', note: 'W4 4F3: the run sheet: scope line, Usually, per-call states and the steer box' },
  { id: 'work-orders', path: '#/work?state=orders', note: 'every order' },
  { id: 'work-order', path: '#/work?order=o-boat-14', note: 'one order with a draft ready to read' },
  { id: 'chats', path: '#/chats?thread=chiefthread-billed', board: 'D-Chats', hindi: true, note: 'W4 4C2: the list by group, a thread with receipted figures, the worked table, the plan and its next step, the composer' },
  { id: 'chats-new', path: '#/chats', note: 'W4 4C2: a new chat beside the list (on a phone, the list with New chat)' },
  { id: 'chats-raised', path: '#/chats?thread=chiefthread-billed', steps: [{ press: 'Start' }], note: 'W4 4C2: a plan step raised to Today, "On Today" with its link, the next step up' },
  { id: 'chats-estimate', path: '#/chats?thread=chiefthread-titles', note: 'W4 4C2: a number the AI wrote, labelled model estimate' },
  { id: 'clients', path: '#/clients', hindi: true, note: 'Clients tab' },
  { id: 'clients-pipeline', path: '#/clients/pipeline', board: 'D-Clients', hindi: true, note: 'W4 4E4: tiles, chips and the path key, the board Found to Not now, due today and late, how people moved' },
  { id: 'clients-pipeline-due', path: '?due#/clients/pipeline', note: 'W4 4E4: a follow-up late on its card and in Due today and late' },
  { id: 'today-outreach', path: '?due#/today', note: 'W4 4E4: a follow-up, two replies and Add notes after a call, as cards' },
  { id: 'clients-network', path: '#/clients/network', board: 'D-Network', hindi: true, note: 'W4 4D4: search, everyone by name, where the network comes from, bands, private' },
  { id: 'money', path: '#/money', board: 'D-Money', hindi: true, note: 'tiles, owed by age, in and out, cash ahead, next three weeks (W4 4J20)' },
  { id: 'money-all', path: '#/money/businesses', note: 'money across businesses (W4 4J6, 4J20)' },
  { id: 'money-invoices', path: '#/money/invoices', hindi: true, note: 'invoice table, lateness, invoices that repeat' },
  { id: 'money-bills', path: '#/money/bills', note: 'bills (W4 4J5, 4J20)' },
  { id: 'money-margins', path: '#/money/margins', note: 'margins per client (W4 4J4, 4J20)' },
  { id: 'money-books', path: '#/money/books', note: 'books' },
  { id: 'money-books-ca', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/money/books' }, { press: 'Tax details' }], note: 'books for a CA firm, tax details open' },
  { id: 'money-spend', path: '#/money/spend', note: 'spend' },
  { id: 'money-spend-change', path: '#/money/spend', steps: [{ press: 'Change' }], note: 'spend limits being changed' },
  { id: 'money-journal', path: '#/money/journal', note: 'journal' },
  { id: 'money-journal-resolve', path: '#/money/journal', steps: [{ press: 'Resolve' }], note: "the journal's Resolve asked" },
  { id: 'connections', path: '#/connections', hindi: true, note: 'connector tiles, what Chausar can do' },
  { id: 'connections-ai', path: '#/connections/ai', note: 'Your AI' },
  { id: 'connections-cli', path: '#/connections', steps: [{ press: 'Check again', hi: 'फिर से जाँचें' }, { unfold: true }], hindi: true, note: 'W4 4H2: Your AI apps, the state, line, fix and facts of each tool' },
  { id: 'business-plan', path: '#/business/plan', hindi: true, note: 'plan, offers, setup progress' },
  { id: 'business-prices', path: '#/business/prices', note: 'prices' },
  { id: 'business-goals', path: '#/business/goals', hindi: true, note: 'W4 4I2: the month goal in use with its bar, the month picker, earlier goals' },
  { id: 'business-goals-unset', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/business/goals' }], note: 'W4 4I2: no goal yet, last month and the suggestion as a model estimate' },
  { id: 'business-build', path: '#/business/build', note: 'website build' },
  { id: 'business-keep', path: '#/business/keep', note: 'keep this business' },
  { id: 'business-away', path: '#/business/away', hindi: true, note: 'W4 4F3: Away: the days, what falls due, what keeps running, the reply to paste' },
  { id: 'today-menu-pause', path: '#/today', steps: [{ press: /Switch business$/ }, { press: 'Stop all' }], note: 'W4 4F3: the business menu with Pause all, Stop all (asking, with how many runs) and Away' },
  { id: 'business-notifications', path: '#/business/notifications', hindi: true, note: 'W4 4G4: pause, quiet hours, the digest, the tray and relay (phone alerts need the hosted app)' },
  { id: 'approve-next', path: '#/approve/next', note: 'W4 4G4: the approval page a phone alert opens, the oldest waiting as one card' },
  { id: 'notification-centre', path: '#/work?sheet=notifications:all', hindi: true, note: 'W4 4G4: the bell\'s centre with the digest and Mark all read' },
  { id: 'business-practice', path: '#/business/practice', note: 'practice and improve' },
  { id: 'business-practice-drills', path: '#/business/practice', steps: [{ press: 'Run the drills' }, { unfold: true }], note: 'W4 4J22a: drills run against the version in use, each result; what the loop tried; guidance and its checks' },
  { id: 'business-routines', path: '#/business/routines', hindi: true, note: 'W4 4J22a: routines with their schedule and zone, the next run, history, Turn off, Change, Remove; Add folded' },
  { id: 'business-routines-open', path: '#/business/routines', steps: [{ unfold: true }], note: 'W4 4J22a: the history and the add form opened' },
  { id: 'work-contract', path: '#/work?order=o-iyer-oct', steps: [{ business: 'Ledgerline' }, { hash: '#/work?order=o-iyer-oct' }], note: 'W4 4J22a: the order contract waiting to be signed, with Sign' },
  { id: 'team-agent-locked', path: '#/team?sheet=agent:editor&tab=instructions', steps: [{ unfold: true }], note: 'W4 4J22a: Auto locked with its chip and reason, the shadow summary, what auto would need, the Auto steps line' },
  { id: 'money-journal-chain', path: '#/money/journal', steps: [{ unfold: true }], note: 'W4 4J22a: Record intact with the count, Check a receipt' },
  { id: 'business-ca', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/business/ca' }], note: 'Your CA, for a CA firm' },
  { id: 'onboarding', path: '#/onboarding', board: 'D-Start', hindi: true, note: 'how starting works, the one-sentence tile' },
  { id: 'onboarding-example', path: '#/onboarding', steps: [{ press: 'Wedding invitation videos' }], note: 'an example chosen' },
  { id: 'first-run', path: '?fresh#/today', hindi: true, note: 'the first run (the fake engine reads ?fresh)' },
  { id: 'welcome-back', path: '?closed#/today', note: 'welcome back, every business closed (?closed)' },
];

export const SHEETS = [
  { id: 'sheet-run', path: '#/today?sheet=run:31', hindi: true, note: 'run sheet, working' },
  { id: 'sheet-run-waiting', path: '#/today?sheet=run:29', note: 'run sheet, waiting on you' },
  { id: 'sheet-run-failed', path: '#/work?sheet=run:28', note: 'run sheet, failed' },
  // W4 4J22a: the run sheet's quality lines on the sample runs (the fake's decorateRun).
  { id: 'sheet-run-coverage', path: '#/work?sheet=run:27', note: 'W4 4J22a: coverage as a fraction (212 of 214 bank lines matched, Partial) and the check that did not run' },
  { id: 'sheet-run-outcome', path: '#/work?sheet=run:27', note: 'W4 4J22a: the outcome of a run that acted outside: Not checked, with the engine line' },
  { id: 'sheet-run-report', path: '#/work?sheet=run:27', steps: [{ unfold: true }], note: 'W4 4J22a: the report opened: measured, looked at, needs you, review incomplete' },
  { id: 'sheet-run-interrupted', path: '#/today?sheet=run:29', note: 'W4 4J22a: Interrupted: nothing was sent again' },
  { id: 'sheet-run-expiry', path: '#/today?sheet=run:29', hindi: true, note: 'W4 4J22a: the question with Expires in 3 h' },
  { id: 'sheet-receipt', path: '#/today?sheet=receipt:R-0415', hindi: true, note: 'receipt sheet' },
  { id: 'sheet-ca-receipt', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/business/ca?sheet=ca-receipt:w-portal-sep' }], note: 'a CA calculator receipt' },
  { id: 'sheet-view-draft', path: '#/today?sheet=view:draft:draft-ep14', note: 'a draft to read' },
  { id: 'sheet-view-signoff', path: '#/today?sheet=view:file:ca-req-gst-sep', note: 'sign-off papers' },
  { id: 'sheet-new-order', path: '#/work?sheet=new-order:new', note: 'new order' },
  { id: 'sheet-client', path: '#/clients?sheet=client:c-boat', steps: [{ unfold: true }], note: 'client, more details open' },
  { id: 'sheet-lead', path: '#/clients/leads?sheet=lead:lead-pocket', note: 'lead' },
  { id: 'sheet-person', path: '#/clients/network?sheet=person:person_nisha', note: 'W4 4D4: person, paths with one not confirmed' },
  { id: 'sheet-card', path: '#/clients/pipeline?sheet=card:opp_seed_tara', note: 'W4 4E4: the card sheet: next step, trigger, score, timeline with the estimate, write to them, move it' },
  { id: 'sheet-draft', path: '#/clients/pipeline?sheet=card:opp_seed_kabir', steps: [{ press: 'Open the draft' }], board: 'D-Network', note: 'W4 4E4: the intro request already drafted, opened from its card: to, the note, the note to forward, Send it yourself from, I sent it' },
  { id: 'sheet-call-notes', path: '?due#/today?sheet=call-notes:calevent_kabir', note: 'W4 4E4: notes after a call' },
  { id: 'sheet-network-import', path: '#/clients/network?sheet=network-import:linkedin-connections', note: 'W4 4D4: import a file' },
  { id: 'sheet-invoice', path: '#/money/invoices?sheet=invoice:inv-0039', hindi: true, note: 'invoice' },
  { id: 'sheet-payment', path: '#/money/invoices?sheet=payment:inv-0039', note: 'record a payment' },
  { id: 'sheet-connector', path: '#/connections?sheet=connector:linkedin', note: 'a connector with setup steps' },
  { id: 'sheet-connector-planned', path: '#/connections?sheet=connector:instagram', note: 'a planned connector' },
  { id: 'sheet-bank', path: '#/connections?sheet=bank:bank-account', note: 'bank account' },
  { id: 'sheet-more', path: '#/team?sheet=more:places', widths: [390], note: "the phone's More" },
];

/**
 * The dev-only parts page (app/ui/parts.html, outside src/, never built): `?app=<start>` mounts the whole app on a fake
 * engine started that way (`empty`: nothing waits on Today; `departments`: the team with the department views W4 4A1
 * sends, laid over the fake's team as the Team tests do); `?show=<part>` draws the parts W4 feeds with test-style
 * props, marked "sample props" on the page.
 */
export const DEV_PAGE = [
  { id: 'today-empty', page: 'parts.html', path: '?app=empty#/today', note: 'Today with nothing waiting' },
  { id: 'team-departments', page: 'parts.html', path: '?app=departments#/team', note: 'Team with department panels (W4 4A data, dev page)' },
  { id: 'team-dept', page: 'parts.html', path: '?app=departments#/team?dept=prod', board: 'D-TeamDept', note: 'one department (W4 4A data, dev page)' },
  { id: 'parts-network', page: 'parts.html', path: '?show=network', board: 'D-Network', note: 'warm paths, strength, pipeline in the W4 stages, with sample props' },
  { id: 'parts-chats', page: 'parts.html', path: '?show=chats', board: 'D-Chats', note: 'chat thread, composer, instruction change, with sample props' },
  { id: 'parts-goal', page: 'parts.html', path: '?show=goal', note: 'goal card with a goal, next step, gallery, with sample props (W4 4I, 4J)' },
  { id: 'parts-money', page: 'parts.html', path: '?show=money', note: 'in and out, aging, cash line, spend split, with sample props (W4 4J, 4A)' },
];

/**
 * Focus, pressed through like an owner would, checked where the tests say it lands. Each returns problems (empty when
 * all is well). `b` is the Browser; `find(expression)` returns what the page says.
 */
export const INTERACTIONS = [
  {
    id: 'keys-j-and-k', path: '#/today', widths: [1280],
    async run(b, { sleep }) {
      const problems = [];
      const rows = await b.evaluate(`[...document.querySelectorAll('main [data-row-id]')].map((e) => e.dataset.rowId)`);
      await b.evaluate(`document.activeElement?.blur()`);
      const focused = () => b.evaluate(`document.activeElement?.getAttribute('data-row-id') ?? ''`);
      await b.key('j'); await sleep(150);
      if ((await focused()) !== rows[0]) problems.push(`J did not focus the first row (${rows[0]}), focus is on "${await focused()}"`);
      await b.key('j'); await sleep(150);
      if ((await focused()) !== rows[1]) problems.push(`J again did not focus the second row (${rows[1]})`);
      await b.key('k'); await sleep(150);
      if ((await focused()) !== rows[0]) problems.push('K did not go back to the first row');
      return problems;
    },
  },
  {
    id: 'second-ask', path: '#/today', widths: [1280, 390],
    async run(b, { sleep, button }) {
      const problems = [];
      const card = '[data-row-id="q-price-sponsor"]';
      await b.click(button('Approve', card), 'Approve on the price card');
      await sleep(300);
      const asked = await b.evaluate(`(() => { const a = document.activeElement; return { name: a?.textContent?.trim(), inCard: Boolean(a?.closest('${card}')) }; })()`);
      if (asked.name !== 'Not now' || !asked.inCard) problems.push(`after Approve, focus should be on "Not now" in the card, it is on "${asked.name}"`);
      await b.click(button('Not now', card), 'Not now');
      await sleep(300);
      const back = await b.evaluate(`(() => { const a = document.activeElement; return { name: a?.textContent?.trim(), inCard: Boolean(a?.closest('${card}')) }; })()`);
      if (back.name !== 'Approve' || !back.inCard) problems.push(`after Not now, focus should be back on Approve, it is on "${back.name}"`);
      return problems;
    },
  },
  {
    id: 'sheet-focus', path: '#/team', widths: [1280, 390],
    async run(b, { sleep }) {
      const problems = [];
      const opener = `[...document.querySelectorAll('main button')].find((e) => e.textContent.trim() === 'Editor')`;
      await b.evaluate(`(${opener})?.setAttribute('data-walk-opener', '')`);
      await b.click(opener, 'the Editor button');
      await sleep(900);
      const inSheet = await b.evaluate(`(() => { const a = document.activeElement; return { tag: a?.tagName, inAside: Boolean(a?.closest('aside')) }; })()`);
      if (inSheet.tag !== 'H2' || !inSheet.inAside) problems.push(`opening the agent panel should focus its title, focus is on <${inSheet.tag}>`);
      await b.key('Escape');
      await sleep(600);
      const after = await b.evaluate(`(() => ({ open: Boolean(document.querySelector('aside[data-sheet]')), back: document.activeElement?.hasAttribute('data-walk-opener') ?? false, now: document.activeElement?.textContent?.trim().slice(0, 40) }))()`);
      if (after.open) problems.push('Esc did not close the agent panel');
      if (!after.back) problems.push(`closing the panel should put focus back on the Editor button, it is on "${after.now}"`);
      return problems;
    },
  },
  {
    // On a phone a sheet covers the screen as a modal dialog and the page behind it is inert: Tab past its last control
    // must stay inside it, never reach the place, the top bar or the tabs behind.
    id: 'sheet-tab-stays-inside', path: '#/team?sheet=agent:editor', widths: [390],
    async run(b, { sleep }) {
      const problems = [];
      const stops = await b.evaluate(`document.querySelectorAll('[data-cover] button, [data-cover] a[href], [data-cover] input, [data-cover] [tabindex="0"]').length`);
      for (let i = 0; i < stops + 3; i++) {
        await b.key('Tab');
        await sleep(60);
        const where = await b.evaluate(`(() => { const a = document.activeElement; return { inside: Boolean(a?.closest('[data-cover][role=dialog]')), body: a === document.body, name: (a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 40) }; })()`);
        if (!where.inside && !where.body) { problems.push(`Tab ${i + 1} left the covering sheet for "${where.name}"`); break; }
      }
      return problems;
    },
  },
  {
    id: 'menu-focus', path: '#/today', widths: [1280, 390],
    async run(b, { sleep, button }) {
      const problems = [];
      await b.click(button(/Switch business$/), 'the business button');
      await sleep(400);
      const open = await b.evaluate(`(() => { const a = document.activeElement; return { role: a?.getAttribute('role'), label: a?.getAttribute('aria-label') ?? '' }; })()`);
      if (open.role !== 'dialog' || !open.label.startsWith('Business menu')) problems.push(`the open menu should have focus, focus is on role "${open.role}" "${open.label}"`);
      await b.key('Escape');
      await sleep(300);
      const back = await b.evaluate(`(() => ({ open: Boolean(document.querySelector('[role=dialog][aria-label^="Business menu"]')), name: document.activeElement?.textContent?.trim() ?? '' }))()`);
      if (back.open) problems.push('Esc did not close the business menu');
      if (!/Switch business$/.test(back.name)) problems.push(`Esc should put focus back on the business button, it is on "${back.name}"`);
      return problems;
    },
  },
];
