import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../src/engine/fake';
import { SAMPLE_PASSPHRASE } from '../src/engine/fixtures';

/**
 * axe-core on every place, sub-page and sheet, with the fake engine, in jsdom. jsdom computes no colours, so
 * colour-contrast is off here and tests/contrast.test.ts checks every text token pair instead. Page-level rules
 * (title, lang) belong to index.html; axe runs on the app's own root.
 */

interface Case { name: string; hash: string; options?: FakeOptions; before?: (engine: FakeEngine) => Promise<unknown>; press?: (string | RegExp)[]; openFolds?: boolean }

const ledgerline = (engine: FakeEngine) => engine.request('workspace.open', { folder: 'ledgerline' });

const PLACES: Case[] = [
  { name: 'Today', hash: '#/today' },
  { name: 'Today, nothing needs you', hash: '#/today', options: { queue: [] } },
  { name: 'Team', hash: '#/team' },
  { name: 'Work', hash: '#/work' },
  { name: 'Work, failed filter', hash: '#/work?state=failed' },
  { name: 'Work, one order', hash: '#/work?order=o-boat-12' },
  { name: 'Clients', hash: '#/clients' },
  { name: 'Clients, leads', hash: '#/clients/leads' },
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
  { name: 'new order', hash: '#/work?sheet=new-order:new' },
  { name: 'client', hash: '#/clients?sheet=client:c-boat' },
  { name: 'add client', hash: '#/clients?sheet=client:new' },
  { name: 'lead', hash: '#/clients/leads?sheet=lead:lead-pocket' },
  { name: 'add lead', hash: '#/clients/leads?sheet=lead:new' },
  { name: 'invoice', hash: '#/money/invoices?sheet=invoice:inv-0039' },
  { name: 'payment', hash: '#/money/invoices?sheet=payment:inv-0039' },
  { name: 'connector', hash: '#/connections?sheet=connector:linkedin' },
  { name: 'bank statement import', hash: '#/connections?sheet=bank-import:bank-account' },
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
    const [button] = await screen.findAllByRole('button', { name });
    await act(async () => { fireEvent.click(button!); });
  }
  unfold();
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

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
    });
  }
});

/** Forms and second asks that open inside a page or sheet: pressed in order, then checked. */
const OPENED: Case[] = [
  { name: 'Today, a second ask inside a row', hash: '#/today', press: ['Approve'] },
  { name: 'Money, spend limits being changed', hash: '#/money/spend', press: ['Change'] },
  { name: 'Business, staging a website edit', hash: '#/business/build', press: ['Stage an edit'] },
  { name: 'Clients, blocking a lead', hash: '#/clients/leads?sheet=lead:lead-pocket', press: ['Block'] },
  { name: 'Business, keep with every fold open and a restore asked', hash: '#/business/keep', openFolds: true, press: ['Restore'] },
  { name: 'Business, keep, a move code shown', hash: '#/business/keep', openFolds: true, press: ['Make the file'] },
  { name: 'Business, keep, a passphrase business', hash: '#/business/keep', openFolds: true, before: (engine) => engine.request('workspace.lock', {}).then(() => engine.request('workspace.open', { folder: 'sitara', passphrase: SAMPLE_PASSPHRASE })) },
  { name: 'Welcome back, a passphrase asked under its row', hash: '#/today', options: { closed: true }, press: [/Sitara Events/] },
  { name: 'Welcome back, more options', hash: '#/today', options: { closed: true }, openFolds: true },
  { name: 'Welcome back, the recovery code', hash: '#/today', options: { closed: true }, openFolds: true, press: ['Use a recovery code'] },
  { name: 'Welcome back, restore a backup', hash: '#/today', options: { closed: true }, openFolds: true, press: ['Restore a backup'] },
  { name: 'Welcome back, move a business here', hash: '#/today', options: { closed: true }, press: ['Move from another computer'] },
  { name: 'Welcome back, open by folder name on a new computer', hash: '#/today', options: { fresh: true }, openFolds: true, press: ['Open a business you already have', 'Open by folder name'] },
];

describe('axe on every sheet', () => {
  for (const sheet of SHEETS) {
    it(sheet.name, async () => {
      const root = await settle(sheet);
      expect(root.querySelector('aside')).not.toBeNull();
      expect(await violations(root)).toEqual([]);
    });
  }
});

describe('axe on forms and second asks', () => {
  for (const opened of OPENED) {
    it(opened.name, async () => {
      expect(await violations(await settle(opened))).toEqual([]);
    });
  }
});
