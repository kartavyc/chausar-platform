import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../src/engine/fake';
import { QUEUE, SAMPLE_PASSPHRASE } from '../src/engine/fixtures';
import { NARROW } from '../src/shell/useNarrow';

/**
 * axe-core on every place, sub-page and sheet, with the fake engine, in jsdom. jsdom computes no colours, so
 * colour-contrast is off here and tests/contrast.test.ts checks every text token pair instead. Page-level rules
 * (title, lang) belong to index.html; axe runs on the app's own root.
 */

/** A step in `press`: a button's name to press, or a labelled field to type into first (w3 3G2: the passphrase steps). */
type Press = string | RegExp | { fill: string; with: string };
interface Case { name: string; hash: string; options?: FakeOptions; before?: (engine: FakeEngine) => Promise<unknown>; press?: Press[]; openFolds?: boolean }

const ledgerline = (engine: FakeEngine) => engine.request('workspace.open', { folder: 'ledgerline' });

const PLACES: Case[] = [
  // The lighter Today pages first: the first page here also pays for warming jsdom up, and the full Today page (Ink v2,
  // twelve cards) takes axe the longest of any place.
  { name: 'Today, nothing needs you', hash: '#/today', options: { queue: [] } },
  { name: 'Today, Questions filter pressed', hash: '#/today?show=questions' },
  { name: 'Today', hash: '#/today' },
  { name: 'Team', hash: '#/team' },
  { name: 'Team, a team with nobody working', hash: '#/team', before: ledgerline },
  // W4 4A2: one department, and Operations with Keeper's jobs unfolded (a quarantined agent is ledgerline's, above).
  { name: 'Team, one department', hash: '#/team?dept=prod' },
  { name: "Team, Operations with Keeper's jobs", hash: '#/team?dept=ops', openFolds: true },
  { name: 'Work', hash: '#/work' },
  { name: 'Work, failed filter', hash: '#/work?state=failed' },
  { name: 'Work, one order', hash: '#/work?order=o-boat-12' },
  { name: 'Work, needs you filter', hash: '#/work?state=waiting' },
  { name: 'Work, running filter', hash: '#/work?state=active' },
  { name: 'Work, done filter', hash: '#/work?state=done' },
  { name: 'Work, every order', hash: '#/work?state=orders' },
  { name: 'Work, one business chosen', hash: '#/work?business=ledgerline' },
  { name: 'Work, a draft ready to read', hash: '#/work?order=o-boat-14' },
  // W4 4C2: Chats with Chausar as chief of staff: the list and a new chat, a thread with figures and a plan, a model
  // estimate and a message sent on to an agent, and a business with no chat yet.
  { name: 'Chats', hash: '#/chats' },
  { name: 'Chats, a thread with receipts and a plan', hash: '#/chats?thread=chiefthread-billed' },
  { name: 'Chats, a model estimate', hash: '#/chats?thread=chiefthread-titles' },
  { name: 'Chats, a message sent on to an agent', hash: '#/chats?thread=chiefthread-trailer' },
  { name: 'Chats, a business with no chat yet', hash: '#/chats', before: ledgerline },
  { name: 'Clients', hash: '#/clients' },
  { name: 'Clients, leads', hash: '#/clients/leads' },
  { name: 'Clients, pipeline', hash: '#/clients/pipeline' },
  { name: 'Clients, network', hash: '#/clients/network' },
  { name: 'Clients, network empty', hash: '#/clients/network', before: ledgerline },
  { name: 'Clients, pipeline with a draft ready, Has a draft pressed', hash: '#/clients/pipeline?show=drafts', before: (engine) => engine.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello there', body: 'A short note about our mic tests.' }) },
  { name: 'Clients, pipeline empty', hash: '#/clients/pipeline', before: ledgerline },
  // W4 4E4: the board with a follow-up late (its Due today and late list), and Today's follow-up, reply and notes cards.
  // Connections (above) draws the mailbox and calendar cards.
  { name: 'Clients, pipeline with a follow-up late', hash: '#/clients/pipeline', options: { pipelineDue: true } },
  { name: 'Today, a follow-up, replies and notes after a call (W4 4E4)', hash: '#/today', options: { pipelineDue: true, queue: [] } },
  { name: 'Money', hash: '#/money' },
  { name: 'Money, invoices', hash: '#/money/invoices' },
  { name: 'Money, books', hash: '#/money/books' },
  { name: 'Money, books for a CA firm', hash: '#/money/books', before: ledgerline },
  { name: 'Money, spend', hash: '#/money/spend' },
  { name: 'Money, journal', hash: '#/money/journal' },
  // W4 4J20: bills (with the GST fields of a registered business), margins, another month, all businesses, the meter.
  { name: 'Money, bills', hash: '#/money/bills' },
  { name: 'Money, adding a bill for a GST business', hash: '#/money/bills', before: ledgerline, press: ['Add a bill'] },
  { name: 'Money, margins', hash: '#/money/margins' },
  { name: 'Money, last month', hash: '#/money?month=2026-09' },
  { name: 'Money, all businesses', hash: '#/money/businesses' },
  { name: 'Money, spend with its limit used up', hash: '#/money/spend', before: (engine) => engine.request('venture.spend.policy.set', { capUsd: '0.50' }) },
  { name: 'Connections', hash: '#/connections' },
  { name: 'Connections, your AI', hash: '#/connections/ai' },
  { name: 'Business, plan', hash: '#/business/plan' },
  { name: 'Business, prices', hash: '#/business/prices' },
  // W4 4I2: the goal in use, and a business with no goal (the ask and the suggestion).
  { name: 'Business, goals', hash: '#/business/goals' },
  { name: 'Business, goals with none set', hash: '#/business/goals', before: ledgerline },
  { name: 'Today with no goal set', hash: '#/today', before: ledgerline },
  { name: 'Business, website build', hash: '#/business/build' },
  { name: 'Business, keep', hash: '#/business/keep' },
  // W4 4F3: the days away, and a stopped run's tile (Stop pressed on a run that waits on the owner).
  { name: 'Business, away', hash: '#/business/away' },
  { name: 'Work, a run stopped by the owner', hash: '#/work', before: (engine) => engine.request('venture.runs.stop', { runId: '29' }) },
  { name: 'Business, your CA', hash: '#/business/ca', before: ledgerline },
  { name: 'Business, practice and improve', hash: '#/business/practice' },
  // W4 4G4: the bell's settings, on this computer and on the hosted app; the approval page.
  { name: 'Business, notifications', hash: '#/business/notifications' },
  { name: 'Business, notifications on the hosted app', hash: '#/business/notifications', options: { hosted: true } },
  { name: 'Approval page, the oldest waiting', hash: '#/approve/next' },
  { name: 'Approval page, a row already decided', hash: '#/approve/q-gone' },
  { name: 'Work, an order the judge read on its own', hash: '#/work?order=o-mehta-sep', before: ledgerline },
  { name: 'New business', hash: '#/onboarding' },
  // W4 4J21: About you (the owner's name), and Today on a temporary business on the hosted app, in its last day.
  { name: 'Business, about you', hash: '#/business/owner' },
  { name: 'Today on a temporary hosted business', hash: '#/today', options: { trial: 'ending' } },
  // W4 4J19: who decided what; Today with Approve several open, and with a draft's Send back box open.
  { name: 'Business, decisions', hash: '#/business/decisions' },
  { name: 'Today, approve several', hash: '#/today', press: ['Approve several'] },
  { name: 'Today, send back a draft', hash: '#/today', press: ['Send back'] },
  // W4 4J22b: the business's voice, what the AI knows, and Today's folds opened (an overdue invoice makes an idea).
  { name: 'Business, your voice', hash: '#/business/voice' },
  { name: 'Business, what the AI knows', hash: '#/business/knowledge' },
  { name: 'Today, ideas and who is waiting on you', hash: '#/today', options: { now: () => '2026-11-02T06:30:00.000Z' }, openFolds: true },
  { name: 'First run', hash: '#/today', options: { fresh: true } },
  { name: 'Welcome back', hash: '#/today', options: { closed: true } },
];

const SHEETS: Case[] = [
  { name: 'run, working', hash: '#/today?sheet=run:31' },
  // W4 4E4: the card sheet (timeline, score, write to them, move it), a draft from before this session, the notes sheet.
  { name: 'pipeline card', hash: '#/clients/pipeline?sheet=card:opp_seed_tara' },
  { name: 'draft, from before this session', hash: '#/clients/pipeline?sheet=outreach:outreach_1' },
  { name: 'notes after a call', hash: '#/today?sheet=call-notes:calevent_kabir', options: { pipelineDue: true } },
  { name: 'run, waiting on you', hash: '#/today?sheet=run:29' },
  { name: 'run, failed', hash: '#/work?sheet=run:28' },
  { name: 'run, stopped by the owner (W4 4F3)', hash: '#/work?sheet=run:29', before: (engine) => engine.request('venture.runs.stop', { runId: '29' }) },
  { name: 'run, done', hash: '#/work?sheet=run:27', before: ledgerline },
  { name: 'receipt', hash: '#/today?sheet=receipt:R-0415' },
  { name: 'view, a draft', hash: '#/today?sheet=view:draft:draft-ep14' },
  { name: 'view, sign-off papers', hash: '#/today?sheet=view:file:ca-req-gst-sep' },
  { name: 'agent', hash: '#/team?sheet=agent:editor' },
  { name: 'agent, waiting on you', hash: '#/team?sheet=agent:producer' },
  { name: 'agent, Keeper', hash: '#/team?sheet=agent:keeper' },
  // W4 4B3: the agent panel's Chat (a change waiting, a note kept, runs folded), a run's question pinned, the chat
  // consent asked before a first message, and Notes.
  { name: 'agent, chat', hash: '#/team?sheet=agent:editor&tab=chat' },
  { name: 'agent, chat waiting on you', hash: '#/team?sheet=agent:producer&tab=chat' },
  { name: 'agent, notes', hash: '#/team?sheet=agent:editor&tab=notes' },
  // W4 4J22b: Instructions with how it talks and a test's replies shown, Can do with skills, and with a planned step.
  { name: 'agent, how it talks tested', hash: '#/team?sheet=agent:editor&tab=instructions', press: ['Test'], openFolds: true },
  { name: 'agent, can do with skills', hash: '#/team?sheet=agent:editor&tab=cando' },
  { name: 'agent, can do', hash: '#/team?sheet=agent:publisher&tab=cando' },
  { name: 'new order', hash: '#/work?sheet=new-order:new' },
  { name: 'client', hash: '#/clients?sheet=client:c-boat' },
  { name: 'add client', hash: '#/clients?sheet=client:new' },
  { name: 'lead', hash: '#/clients/leads?sheet=lead:lead-pocket' },
  { name: 'add lead', hash: '#/clients/leads?sheet=lead:new' },
  { name: 'person', hash: '#/clients/network?sheet=person:person_sana' },
  { name: 'network import', hash: '#/clients/network?sheet=network-import:linkedin-connections' },
  { name: 'invoice', hash: '#/money/invoices?sheet=invoice:inv-0039' },
  { name: 'payment', hash: '#/money/invoices?sheet=payment:inv-0039' },
  // W4 4J20: the accountant's month of books, and the limit sheet.
  { name: 'accountant', hash: '#/money?sheet=accountant:books' },
  { name: 'limit', hash: '#/money/spend?sheet=limit:business' },
  { name: 'connector', hash: '#/connections?sheet=connector:linkedin' },
  { name: 'bank statement import', hash: '#/connections?sheet=bank-import:bank-account' },
  { name: 'bank account', hash: '#/connections?sheet=bank:bank-account' },
  // w3 3G1: a planned connector's sheet, every mode and way to post planned.
  { name: 'connector, planned', hash: '#/connections?sheet=connector:instagram' },
  // W4 4J21: a connector's setup guide with least-privilege steps (GitHub).
  { name: 'connector, a setup guide', hash: '#/connections?sheet=connector:github' },
  { name: 'a sheet nobody provides', hash: '#/today?sheet=nothing:here' },
  // W4 4J19: a draft's own text open to edit.
  {
    name: 'edit a draft', hash: '#/today?sheet=edit-draft:q-script',
    options: { queue: [{ ...QUEUE.find((row) => row.id === 'run:d-ep14:review-1')!, id: 'q-script', title: 'Sponsor script for episode 14', viewRef: { kind: 'draft', id: 'd-ep14-script' }, actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }] }] },
  },
  // W4 4G4: the notification centre, and a run sheet over a run with several waiting items.
  { name: 'notification centre', hash: '#/work?sheet=notifications:all' },
  {
    name: 'run, several things need you', hash: '#/work?sheet=run:29',
    options: { queue: ['a', 'b', 'c'].map((n) => ({ ...QUEUE.find((row) => row.id === 'q-question-preview')!, id: `q-run29-${n}` })) },
  },
];

const LOADING = /^Loading$/;

/** Render the app at an address and wait until the place (and its sheet) show their content, not a loading line. */
async function settle({ hash, options, before, press, openFolds }: Case): Promise<HTMLElement> {
  const engine = new FakeEngine(options);
  if (before) await before(engine);
  window.location.hash = hash;
  const { container } = render(<App client={createFakeClient(engine)} language="en" />);
  await waitFor(() => {
    expect(container.querySelector('[data-boot]')).toBeNull();
    expect(container.querySelector('h1')).not.toBeNull();
    if (hash.includes('sheet=')) expect(container.querySelector('aside h2')?.textContent ?? '').not.toMatch(LOADING);
    for (const node of container.querySelectorAll('p, h2')) expect(node.textContent ?? '').not.toMatch(LOADING);
  });
  // Let the reads the content started finish before looking.
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  // Folds open before each press and at the end, so what they hold is checked too.
  const unfold = () => { if (openFolds) for (const fold of container.querySelectorAll('details')) fold.open = true; };
  for (const name of press ?? []) {
    unfold();
    if (typeof name !== 'string' && !(name instanceof RegExp)) {
      const [field] = await screen.findAllByLabelText(name.fill);
      fireEvent.change(field!, { target: { value: name.with } });
      continue;
    }
    const [button] = await screen.findAllByRole('button', { name });
    await act(async () => { fireEvent.click(button!); });
  }
  unfold();
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

/**
 * How long a case over Today may take. The full Today page (Ink v2, 3C) is the largest tree axe walks here, about 740
 * elements (twelve cards with their previews, the team, Working now, Earlier), and in jsdom on a loaded machine one
 * pass took up to 4.5 s, against vitest's 5 s default. So every case drawn on #/today (its sheets and second asks too)
 * gets 15 s; every other case keeps the default.
 */
const TODAY_MS = 15_000;
const timeoutOf = (each: Case) => (each.hash.startsWith('#/today') ? TODAY_MS : undefined);

async function violations(root: HTMLElement): Promise<string[]> {
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  return result.violations.flatMap((v) => v.nodes.map((node) => `${v.id} (${v.impact ?? 'none'}): ${v.help} at ${node.target.join(' ')}`));
}

describe('the axe check itself', () => {
  it('finds a real fault, so a clean result means something', async () => {
    const { container } = render(<div><button type="button" /><img src="x.png" /><input type="text" /></div>);
    const found = (await violations(container)).map((line) => line.split(' ')[0]);
    expect(found).toEqual(expect.arrayContaining(['button-name', 'image-alt', 'label']));
  });
});

describe('axe on every place', () => {
  for (const place of PLACES) {
    it(place.name, async () => {
      expect(await violations(await settle(place))).toEqual([]);
    }, timeoutOf(place));
  }
});

/** Forms and second asks that open inside a page or sheet: pressed in order, then checked. */
const OPENED: Case[] = [
  { name: 'Today, a second ask inside a row', hash: '#/today', press: ['Approve'] },
  { name: 'Chats, a plan step raised to Today', hash: '#/chats?thread=chiefthread-billed', press: ['Start'] },
  { name: 'Today, Show 8 more opened', hash: '#/today', press: ['Show 8 more'] },
  // 4Z3: the question waits behind the fold of the five most urgent cards.
  { name: 'Today, an answer box inside a card', hash: '#/today', press: ['Show 8 more', 'Answer'] },
  { name: 'Money, spend limits being changed', hash: '#/money/spend', press: ['Change'] },
  // W4 4B3: the chat consent asked before a first message, and a note's Forget asked once more.
  { name: 'Team, the chat consent asked', hash: '#/team?sheet=agent:bookkeeper&tab=chat', before: ledgerline, press: ['What are you working on?', 'Send'] },
  { name: 'Team, a note being forgotten', hash: '#/team?sheet=agent:editor&tab=notes', press: ['Forget'] },
  { name: 'Money, books with the tax details open', hash: '#/money/books', before: ledgerline, press: ['Tax details'] },
  { name: 'Money, journal with Resolve asked', hash: '#/money/journal', press: ['Resolve'] },
  { name: 'Business, staging a website edit', hash: '#/business/build', press: ['Stage an edit'] },
  { name: 'Business, practice: rehearsed, a version kept and its second ask, the judge turned off then asked on', hash: '#/business/practice', press: ['Rehearse now', 'Run the improvement loop', 'Use this version', 'Turn off', 'Turn on'] },
  {
    name: 'Work, the judge asked about a ready draft', hash: '#/work?order=o-boat-14', press: ['Ask the judge'],
    before: (engine) => engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' }),
  },
  // 4Z2: Lumen's episode 12 is delivered; Ledgerline's September books are done and not delivered yet.
  { name: 'Work, an order asked once more before it is marked delivered', hash: '#/work', before: (engine) => engine.request('workspace.open', { folder: 'ledgerline' }), press: ['Mark delivered'] },
  // W4 4F3: the Stop dialog and its Force stop ask, on a tile and in Working now; Away with its days set.
  { name: 'Work, the Stop dialog asking Force stop', hash: '#/work', press: ['Stop run 31', 'Force stop'] },
  { name: 'Today, the Stop dialog in Working now', hash: '#/today', press: ['Stop run 30'] },
  { name: 'Business, away with its days set', hash: '#/business/away', press: [{ fill: 'First day away', with: '2026-12-01' }, { fill: 'Last day away', with: '2026-12-05' }, 'Set the days'] },
  { name: 'Clients, blocking a lead', hash: '#/clients/leads?sheet=lead:lead-pocket', press: ['Block'] },
  // W4 4E4: a block is a flag on its card, not a stage; the folded stage is Not now.
  { name: 'Clients, pipeline with Not now opened and a blocked lead', hash: '#/clients/pipeline', before: (engine) => engine.request('venture.leads.block', { value: 'pocketaudio.in' }), press: ['Show Not now, 1 person'] },
  { name: 'Clients, a client sheet with More details open', hash: '#/clients?sheet=client:c-boat', openFolds: true },
  { name: 'Clients, a network search with its checks open', hash: '#/clients/network', press: [{ fill: 'Who are you looking for?', with: 'founders in Pune' }, 'Search'], openFolds: true },
  { name: 'Clients, Forget asking once more', hash: '#/clients/network?sheet=person:person_kabir', press: ['Forget'] },
  { name: 'Clients, add client with More details open', hash: '#/clients?sheet=client:new', openFolds: true },
  // W4 4J22a: drills run with their folds open, a routine's removal asked, an order contract's Sign asked, auto's readiness.
  { name: 'Business, practice with the drills run and every fold open', hash: '#/business/practice', press: ['Run the drills'], openFolds: true },
  { name: 'Business, routines with the history open and a removal asked', hash: '#/business/routines', openFolds: true, press: ['Remove'] },
  { name: 'Work, an order contract with its Sign asked', hash: '#/work?order=o-iyer-oct', before: ledgerline, press: ['Sign'] },
  { name: 'Team, the posture with what auto would need open', hash: '#/team?sheet=agent:editor&tab=instructions', openFolds: true },
  { name: 'Business, keep with every fold open and a restore asked', hash: '#/business/keep', openFolds: true, press: ['Restore'] },
  { name: 'Business, keep, a move code shown', hash: '#/business/keep', openFolds: true, press: ['Make the file'] },
  { name: 'Business, keep, a passphrase business', hash: '#/business/keep', openFolds: true, before: (engine) => engine.request('workspace.lock', {}).then(() => engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE })) },
  { name: 'Welcome back, a passphrase asked under its row', hash: '#/today', options: { closed: true }, press: [/Sitara Events/] },
  { name: 'Welcome back, more options', hash: '#/today', options: { closed: true }, openFolds: true },
  { name: 'Welcome back, the recovery code', hash: '#/today', options: { closed: true }, openFolds: true, press: ['Use a recovery code'] },
  { name: 'Welcome back, restore a backup', hash: '#/today', options: { closed: true }, openFolds: true, press: ['Restore a backup'] },
  { name: 'Welcome back, move a business here', hash: '#/today', options: { closed: true }, press: ['Move from another computer'] },
  { name: 'Welcome back, open by folder name on a new computer', hash: '#/today', options: { fresh: true }, openFolds: true, press: ['Open a business you already have', 'Open by folder name'] },
  // w3 3G1: Connections with every AI choice and a channel's posting limits open, an AI being connected, and the
  // simple-first folds of Business open for a GST-registered business (tax details, a price's working).
  { name: 'Connections, every AI choice and the posting limits open', hash: '#/connections', openFolds: true, press: [/^Posting limits for X$/] },
  { name: 'Connections, connecting an AI', hash: '#/connections/ai', press: ['Connect'] },
  { name: 'Business, plan for a CA firm with its tax details open', hash: '#/business/plan', before: ledgerline, openFolds: true },
  { name: 'Business, prices for a CA firm with the working open', hash: '#/business/prices', before: ledgerline, openFolds: true },
  { name: "Business, Your CA with a paper's calculator receipt open", hash: '#/business/ca?sheet=ca-receipt:w-portal-sep', before: ledgerline },
  // w3 3G2: Start's examples, its country choice, and the box asking for more on the first run.
  { name: 'New business, an example chosen', hash: '#/onboarding', press: ['Wedding invitation videos'] },
  { name: 'New business, the country being changed', hash: '#/onboarding', press: ['Change'] },
  { name: 'First run, the box asking for more', hash: '#/today', options: { fresh: true }, press: ['Start'] },
  {
    name: 'First run, the passphrase step', hash: '#/today', options: { fresh: true, deviceKeys: false },
    press: [{ fill: 'What do you want to start?', with: 'Monthly bookkeeping for cafes and small shops in Pune.' }, 'Start'],
  },
  {
    name: 'First run, the recovery code step', hash: '#/today', options: { fresh: true, deviceKeys: false },
    press: [
      { fill: 'What do you want to start?', with: 'Monthly bookkeeping for cafes and small shops in Pune.' }, 'Start',
      { fill: 'Passphrase', with: 'correct horse battery' }, { fill: 'Type it again', with: 'correct horse battery' }, 'Lock and start',
    ],
  },
];

describe('axe on every sheet', () => {
  for (const sheet of SHEETS) {
    it(sheet.name, async () => {
      const root = await settle(sheet);
      expect(root.querySelector('aside')).not.toBeNull();
      expect(await violations(root)).toEqual([]);
    }, timeoutOf(sheet));
  }
});

describe('axe on forms and second asks', () => {
  for (const opened of OPENED) {
    it(opened.name, async () => {
      expect(await violations(await settle(opened))).toEqual([]);
    }, timeoutOf(opened));
  }
});

/** w3 3H1: the phone frame (the top bar, the bottom tabs, a sheet that covers the screen, Today's swipe cards and tip),
 *  drawn with matchMedia saying the window is phone-wide. */
const PHONE: Case[] = [
  { name: 'phone, Today with its swipe cards and tip', hash: '#/today' },
  { name: 'phone, Team', hash: '#/team' },
  { name: 'phone, Work', hash: '#/work' },
  { name: 'phone, Money', hash: '#/money' },
  { name: 'phone, More', hash: '#/team?sheet=more:places' },
  { name: 'phone, the agent panel covering the screen', hash: '#/team?sheet=agent:editor' },
  { name: 'phone, the agent chat covering the screen (W4 4B3)', hash: '#/team?sheet=agent:editor&tab=chat' },
  { name: 'phone, a second ask inside a swipe card', hash: '#/today', press: ['Approve'] },
];

describe('axe on a phone', () => {
  for (const each of PHONE) {
    it(each.name, async () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: query === NARROW, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
      const root = await settle(each);
      expect(root.querySelector('[data-phone]')).not.toBeNull();
      expect(await violations(root)).toEqual([]);
    }, timeoutOf(each));
  }
});
