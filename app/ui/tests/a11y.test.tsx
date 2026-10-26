import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../src/engine/fake';
import { SAMPLE_PASSPHRASE } from '../src/engine/fixtures';
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
  { name: 'Work', hash: '#/work' },
  { name: 'Work, failed filter', hash: '#/work?state=failed' },
  { name: 'Work, one order', hash: '#/work?order=o-boat-12' },
  { name: 'Work, needs you filter', hash: '#/work?state=waiting' },
  { name: 'Work, running filter', hash: '#/work?state=active' },
  { name: 'Work, done filter', hash: '#/work?state=done' },
  { name: 'Work, every order', hash: '#/work?state=orders' },
  { name: 'Work, one business chosen', hash: '#/work?business=ledgerline' },
  { name: 'Work, a draft ready to read', hash: '#/work?order=o-boat-14' },
  { name: 'Clients', hash: '#/clients' },
  { name: 'Clients, leads', hash: '#/clients/leads' },
  { name: 'Clients, pipeline', hash: '#/clients/pipeline' },
  { name: 'Clients, pipeline with a draft ready, Has a draft pressed', hash: '#/clients/pipeline?show=drafts', before: (engine) => engine.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello there', body: 'A short note about our mic tests.' }) },
  { name: 'Clients, pipeline empty', hash: '#/clients/pipeline', before: ledgerline },
  { name: 'Money', hash: '#/money' },
  { name: 'Money, invoices', hash: '#/money/invoices' },
  { name: 'Money, books', hash: '#/money/books' },
  { name: 'Money, books for a CA firm', hash: '#/money/books', before: ledgerline },
  { name: 'Money, spend', hash: '#/money/spend' },
  { name: 'Money, journal', hash: '#/money/journal' },
  { name: 'Connections', hash: '#/connections' },
  { name: 'Connections, your AI', hash: '#/connections/ai' },
  { name: 'Business, plan', hash: '#/business/plan' },
  { name: 'Business, prices', hash: '#/business/prices' },
  { name: 'Business, website build', hash: '#/business/build' },
  { name: 'Business, keep', hash: '#/business/keep' },
  { name: 'Business, your CA', hash: '#/business/ca', before: ledgerline },
  { name: 'Business, practice and improve', hash: '#/business/practice' },
  { name: 'Work, an order the judge read on its own', hash: '#/work?order=o-mehta-sep', before: ledgerline },
  { name: 'New business', hash: '#/onboarding' },
  { name: 'First run', hash: '#/today', options: { fresh: true } },
  { name: 'Welcome back', hash: '#/today', options: { closed: true } },
];

const SHEETS: Case[] = [
  { name: 'run, working', hash: '#/today?sheet=run:31' },
  { name: 'run, waiting on you', hash: '#/today?sheet=run:29' },
  { name: 'run, failed', hash: '#/work?sheet=run:28' },
  { name: 'run, done', hash: '#/work?sheet=run:27', before: ledgerline },
  { name: 'receipt', hash: '#/today?sheet=receipt:R-0415' },
  { name: 'view, a draft', hash: '#/today?sheet=view:draft:draft-ep14' },
  { name: 'view, sign-off papers', hash: '#/today?sheet=view:file:ca-req-gst-sep' },
  { name: 'agent', hash: '#/team?sheet=agent:editor' },
  { name: 'agent, waiting on you', hash: '#/team?sheet=agent:producer' },
  { name: 'new order', hash: '#/work?sheet=new-order:new' },
  { name: 'client', hash: '#/clients?sheet=client:c-boat' },
  { name: 'add client', hash: '#/clients?sheet=client:new' },
  { name: 'lead', hash: '#/clients/leads?sheet=lead:lead-pocket' },
  { name: 'add lead', hash: '#/clients/leads?sheet=lead:new' },
  { name: 'invoice', hash: '#/money/invoices?sheet=invoice:inv-0039' },
  { name: 'payment', hash: '#/money/invoices?sheet=payment:inv-0039' },
  { name: 'connector', hash: '#/connections?sheet=connector:linkedin' },
  { name: 'bank statement import', hash: '#/connections?sheet=bank-import:bank-account' },
  { name: 'bank account', hash: '#/connections?sheet=bank:bank-account' },
  // w3 3G1: a planned connector's sheet, every mode and way to post planned.
  { name: 'connector, planned', hash: '#/connections?sheet=connector:instagram' },
  { name: 'a sheet nobody provides', hash: '#/today?sheet=nothing:here' },
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
  { name: 'Today, Show 2 more opened', hash: '#/today', press: ['Show 2 more'] },
  { name: 'Today, an answer box inside a card', hash: '#/today', press: ['Answer'] },
  { name: 'Money, spend limits being changed', hash: '#/money/spend', press: ['Change'] },
  { name: 'Money, books with the tax details open', hash: '#/money/books', before: ledgerline, press: ['Tax details'] },
  { name: 'Money, journal with Resolve asked', hash: '#/money/journal', press: ['Resolve'] },
  { name: 'Business, staging a website edit', hash: '#/business/build', press: ['Stage an edit'] },
  { name: 'Business, practice: rehearsed, a version kept and its second ask, the judge turned off then asked on', hash: '#/business/practice', press: ['Rehearse now', 'Run the improvement loop', 'Use this version', 'Turn off', 'Turn on'] },
  {
    name: 'Work, the judge asked about a ready draft', hash: '#/work?order=o-boat-14', press: ['Ask the judge'],
    before: (engine) => engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' }),
  },
  { name: 'Work, an order asked once more before it is marked delivered', hash: '#/work', press: ['Mark delivered'] },
  { name: 'Clients, blocking a lead', hash: '#/clients/leads?sheet=lead:lead-pocket', press: ['Block'] },
  { name: 'Clients, pipeline with Blocked opened', hash: '#/clients/pipeline', before: (engine) => engine.request('venture.leads.block', { value: 'pocketaudio.in' }), press: ['Show Blocked, 1 person'] },
  { name: 'Clients, a client sheet with More details open', hash: '#/clients?sheet=client:c-boat', openFolds: true },
  { name: 'Clients, add client with More details open', hash: '#/clients?sheet=client:new', openFolds: true },
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
  { name: 'Connections, every AI choice and the posting limits open', hash: '#/connections', openFolds: true, press: [/^Posting limits for LinkedIn$/] },
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
