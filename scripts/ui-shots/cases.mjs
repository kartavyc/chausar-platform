// What the Ink screenshot walk visits (scripts/ui-shots/walk.mjs): every place, its main states, its sheets and the
// forms and second asks that open inside them, on the fake engine of `npm run dev:ui`. Each page load starts the fake
// engine afresh, so a case that needs another business switches to it through the business menu, like an owner would.
//
// A case:
//   id        file name stem (app/ui/.shots/<id>--<width>-<theme>[-hi].png)
//   path      what follows the server address: "#/today", "?lang=hi" is added for the Hindi pass
//   steps     done in order after the page settles: { press: name, in?: selector } clicks a button, link or tab by its
//             accessible name; { business: name } switches business through the menu; { hash } moves inside the app
//             without a reload; { key } presses a key; { unfold: true } opens every fold
//   board     the direction D board this is compared with at 1280 (docs/superpowers/designs/ink-v2-direction-d)
//   phone     the D phone board this is compared with at 390
//   widths    [1280, 390] unless said
//   hindi     also shot at 390, light, in Hindi
//   note      what the comparison looks at (the walk table in WALK.md)

export const PLACES = [
  { id: 'today', path: '#/today', board: 'D-Today', phone: 'D-Phone-Today', hindi: true, note: 'header, goal card (fallback), team at work, needs-you cards, working now, earlier' },
  { id: 'today-questions', path: '#/today?show=questions', note: 'filter chips: Questions pressed' },
  { id: 'today-more', path: '#/today', steps: [{ press: 'Show 2 more' }], note: 'the folded cards shown' },
  { id: 'today-second-ask', path: '#/today', steps: [{ press: 'Approve', in: '[data-row-id="q-price-sponsor"]' }], note: 'the second ask inside a price card' },
  { id: 'today-answer', path: '#/today', steps: [{ press: 'Answer', in: '[data-row-id="q-question-title"]' }], note: 'an answer box inside a card' },
  { id: 'today-menu', path: '#/today', steps: [{ press: /Switch business$/ }], note: 'the business menu as a popover' },
  { id: 'team', path: '#/team', board: 'D-Team', phone: 'D-Phone-Team', hindi: true, note: 'stats, agent cards (no departments yet)' },
  { id: 'team-agent', path: '#/team?sheet=agent:editor', board: 'D-TeamChat', hindi: true, note: 'the agent panel shell (no chat yet)' },
  { id: 'team-agent-runs', path: '#/team?sheet=agent:producer', steps: [{ press: 'Runs', in: 'aside' }], note: "the panel's Runs tab" },
  { id: 'team-quiet', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/team' }], note: 'a team with nobody working' },
  { id: 'work', path: '#/work', board: 'D-Work', hindi: true, note: 'run tiles, failed tile, finished, orders' },
  { id: 'work-failed', path: '#/work?state=failed', note: 'Failed filter' },
  { id: 'work-orders', path: '#/work?state=orders', note: 'every order' },
  { id: 'work-order', path: '#/work?order=o-boat-14', note: 'one order with a draft ready to read' },
  { id: 'clients', path: '#/clients', hindi: true, note: 'Clients tab' },
  { id: 'clients-pipeline', path: '#/clients/pipeline', board: 'D-Clients', hindi: true, note: 'tabs, board by lead stage' },
  { id: 'money', path: '#/money', board: 'D-Money', hindi: true, note: 'tiles, owed, due next' },
  { id: 'money-invoices', path: '#/money/invoices', hindi: true, note: 'invoice table' },
  { id: 'money-books', path: '#/money/books', note: 'books' },
  { id: 'money-books-ca', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/money/books' }, { press: 'Tax details' }], note: 'books for a CA firm, tax details open' },
  { id: 'money-spend', path: '#/money/spend', note: 'spend' },
  { id: 'money-spend-change', path: '#/money/spend', steps: [{ press: 'Change' }], note: 'spend limits being changed' },
  { id: 'money-journal', path: '#/money/journal', note: 'journal' },
  { id: 'money-journal-resolve', path: '#/money/journal', steps: [{ press: 'Resolve' }], note: "the journal's Resolve asked" },
  { id: 'connections', path: '#/connections', hindi: true, note: 'connector tiles, what Chausar can do' },
  { id: 'connections-ai', path: '#/connections/ai', note: 'Your AI' },
  { id: 'business-plan', path: '#/business/plan', hindi: true, note: 'plan, offers, setup progress' },
  { id: 'business-prices', path: '#/business/prices', note: 'prices' },
  { id: 'business-build', path: '#/business/build', note: 'website build' },
  { id: 'business-keep', path: '#/business/keep', note: 'keep this business' },
  { id: 'business-practice', path: '#/business/practice', note: 'practice and improve' },
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
  { id: 'sheet-receipt', path: '#/today?sheet=receipt:R-0415', hindi: true, note: 'receipt sheet' },
  { id: 'sheet-ca-receipt', path: '#/today', steps: [{ business: 'Ledgerline' }, { hash: '#/business/ca?sheet=ca-receipt:w-portal-sep' }], note: 'a CA calculator receipt' },
  { id: 'sheet-view-draft', path: '#/today?sheet=view:draft:draft-ep14', note: 'a draft to read' },
  { id: 'sheet-view-signoff', path: '#/today?sheet=view:file:ca-req-gst-sep', note: 'sign-off papers' },
  { id: 'sheet-new-order', path: '#/work?sheet=new-order:new', note: 'new order' },
  { id: 'sheet-client', path: '#/clients?sheet=client:c-boat', steps: [{ unfold: true }], note: 'client, more details open' },
  { id: 'sheet-lead', path: '#/clients/leads?sheet=lead:lead-pocket', note: 'lead' },
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
