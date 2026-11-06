import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { CustodyViewLite, EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * Business in the Ink v2 look (w3 package 3G1; spec 4.3 "Business"; catalogue U6, U18). Built from the D pieces: the
 * pages as a segmented nav, the plan's offers as cards priced by receipt, setup progress as a bar, and the founder's
 * "simple first" rule of 23 October: the simple path at rest, tax registration, GST fields and a price's working one
 * step away, and a business not registered for GST never sees a GST field.
 */

function start(hash: string, engine = new FakeEngine(), language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  render(<App client={createFakeClient(engine)} language={language} />);
  return engine;
}
async function ledgerline() {
  const engine = new FakeEngine();
  await engine.request('workspace.open', { folder: 'ledgerline' });
  return engine;
}
const offer = async (name: string) => (await screen.findByText(name, { selector: '[data-offer-name]' })).closest('li')!;
/** Renders the app at an address and records every engine call it makes, as [method, params]. */
function watched(engine: FakeEngine, hash: string): [string, unknown][] {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const client: EngineClient = {
    ...fake,
    request: ((method: string, params?: unknown) => {
      calls.push([method, params]);
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return calls;
}
/**
 * A region found by its heading's words, then checked to be named by that heading. Role queries over the whole page
 * are slow in jsdom, so a wait polls a cheap text query and the accessible name is checked once.
 */
async function region(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: 'h2' });
  const section = heading.closest('section') as HTMLElement;
  expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  return section;
}
/** The words a reader sees at rest: everything but what waits inside a closed fold (its summary still shows). */
function visibleText(root: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    const fold = element?.closest('details');
    if (fold && !fold.open && !element?.closest('summary')) continue;
    if (element?.closest('[hidden], .sr-only')) continue;
    parts.push(node.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ');
}
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/;
function keyLikeText(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (KEY_LIKE.test(node.textContent?.trim() ?? '')) found.push(node.textContent!.trim());
  return found;
}
/** Everything a reader could name as a tax field: figure labels, form labels, legends and the back office's lines. */
const TAX_WORDS = /GST|CGST|SGST|IGST|tax/i;
function taxFields(root: Element): string[] {
  return [...root.querySelectorAll('dt, label, legend, [data-tax-line]')].map((element) => element.textContent ?? '').filter((text) => TAX_WORDS.test(text));
}

describe('Business in the Ink v2 look', () => {
  it('the pages are a segmented nav with the current page marked, Your CA only on a CA firm', async () => {
    start('#/business/prices');
    const nav = await screen.findByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Plan and playbook', '#/business/plan'], ['Prices', '#/business/prices'], ['Website build', '#/business/build'],
      ['Practice and improve', '#/business/practice'], ['Keep this business', '#/business/keep'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Prices' }).getAttribute('aria-current')).toBe('page');
  });

  it("Plan shows each offer as a card: its price as a figure with the calculator's receipt, or Set price", async () => {
    start('#/business/plan');
    const sponsor = await offer('Sponsor slot');
    expect(within(sponsor).getByRole('heading', { level: 3 }).textContent).toContain('Sponsor slot');
    const figure = sponsor.querySelector('[data-figure]')!;
    expect(figure.querySelector('[data-ui-number]')?.textContent).toBe('₹15,000.00');
    expect(within(figure as HTMLElement).getByRole('button', { name: 'Receipt R-0408' })).toBeTruthy();
    const shorts = await offer('Shorts from your long video');
    expect(shorts.querySelector('[data-figure]')).toBeNull();
    expect(within(shorts).getByRole('link', { name: 'Set price' }).getAttribute('href')).toBe('#/business/prices');
    assertInkRules(document.body);
  });

  it('Plan shows how far setup has come as a bar, from the engine\'s own count', async () => {
    start('#/business/plan');
    // The heading's words first (a cheap query), then the region it names.
    const heading = await screen.findByText('Setup', { selector: 'h2' });
    const setup = heading.closest('section')!;
    expect(setup.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(await within(setup).findByRole('img', { name: '6 of 12 steps done' })).toBeTruthy();
    expect(setup.textContent).toContain('6 of 12');
    expect(within(setup).getByRole('link', { name: "What's left" }).getAttribute('href')).toBe('#/today?show=setup');
  });

  it('a business not registered for GST never sees a GST field, at rest or with every fold open', async () => {
    for (const hash of ['#/business/plan', '#/business/prices']) {
      window.location.hash = hash;
      const view = render(<App client={createFakeClient(new FakeEngine())} language="en" />);
      const main = document.querySelector('main')!;
      await within(main).findByText('Sponsor slot', { selector: '[data-offer-name]' });
      await waitFor(() => expect(main.querySelector('[data-figure]')).not.toBeNull());
      expect(visibleText(main), hash).not.toMatch(/GST/);
      for (const fold of main.querySelectorAll('details')) fold.open = true;
      expect(taxFields(main), hash).toEqual([]);
      if (hash.endsWith('plan')) expect(main.textContent).toContain('Invoices in INR.');
      view.unmount();
    }
  });

  it('a business not registered for GST never reads the word GST on any Business page, even with every fold open', async () => {
    for (const hash of ['#/business/plan', '#/business/prices', '#/business/build', '#/business/practice', '#/business/keep']) {
      window.location.hash = hash;
      const view = render(<App client={createFakeClient(new FakeEngine())} language="en" />);
      const main = document.querySelector('main')!;
      // Each step of the page in turn: the header, then its tiles, then the reads they started.
      await waitFor(() => expect(main.querySelector('h1')).not.toBeNull());
      await waitFor(() => expect(main.querySelectorAll('h2, h3').length, hash).toBeGreaterThan(1));
      for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      for (const fold of main.querySelectorAll('details')) fold.open = true;
      expect(main.textContent, hash).not.toMatch(/GST/);
      view.unmount();
    }
  });

  it('a GST-registered business keeps its tax details one step away on Plan', async () => {
    start('#/business/plan', await ledgerline());
    const office = await region('Back office');
    await waitFor(() => expect(office.textContent).toContain('Invoices in INR.'));
    expect(visibleText(office)).not.toMatch(/GST: registered/);
    const fold = within(office).getByText('Tax details').closest('details')!;
    expect(fold.open).toBe(false);
    fold.open = true;
    expect(visibleText(office)).toContain('GST: registered.');
    expect(visibleText(office)).toContain('For a tax invoice, add: Your SAC code.');
  });

  it("Prices: the price at rest, its working one step away, and Save price the card's one filled button", async () => {
    start('#/business/prices', await ledgerline());
    const books = await offer('Monthly books');
    await waitFor(() => expect(books.querySelector('[data-figure] [data-ui-number]')?.textContent).toBe('₹18,880.00'));
    expect(visibleText(books)).not.toContain('CGST at 9%');
    const fold = within(books).getByText('How this price is worked out').closest('details')!;
    expect(fold.open).toBe(false);
    fold.open = true;
    expect(visibleText(books)).toContain('CGST at 9%');
    // The working's figures are proved by the one receipt beside the total.
    expect(fold.closest('[data-figure-group]')?.querySelectorAll('[data-receipt]')).toHaveLength(1);
    expect([...books.querySelectorAll('[data-variant="primary"]')].map((button) => button.textContent)).toEqual(['Save price']);
    assertInkRules(document.body);
  });

  it('the experimental storage note shows under the header on every business page but Keep, which says it once itself', async () => {
    const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
    function custody(hash: string) {
      window.location.hash = hash;
      const fake = createFakeClient(new FakeEngine());
      const request = fake.request.bind(fake);
      const client: EngineClient = {
        ...fake,
        request: (async (method: string, params?: unknown) => {
          const reply = await request(method as never, params as never);
          if (method !== 'workspace.custody.get') return reply;
          const view = reply as unknown as CustodyViewLite;
          return { ...view, business: view.business && { ...view.business, storage: 'experimental-file' } };
        }) as EngineClient['request'],
      };
      return render(<App client={client} language="en" />);
    }
    for (const [hash, title] of [['#/business/plan', 'Plan and playbook'], ['#/business/prices', 'Prices'], ['#/business/practice', 'Practice and improve']] as const) {
      const { unmount } = custody(hash);
      const note = await within(document.querySelector('main')!).findByRole('note');
      expect(note.textContent, hash).toBe(EXPERIMENTAL);
      const header = screen.getByRole('heading', { level: 1, name: title }).closest('header')!;
      expect(header.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING, hash).toBeTruthy();
      unmount();
    }
    custody('#/business/keep');
    expect(await screen.findByText(EXPERIMENTAL)).toBeTruthy();
    expect(screen.getAllByText(EXPERIMENTAL)).toHaveLength(1);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it("Your CA: the CA of record with initials, and each rate table's sources one step away", async () => {
    start('#/business/ca', await ledgerline());
    const of = await region('CA of record');
    await within(of).findByText('Meera Joshi');
    expect(within(of).getByText('MJ').closest('[aria-hidden="true"]')).not.toBeNull();
    const rates = await region('Rate tables to confirm');
    expect(within(rates).getByRole('checkbox', { name: 'GST rates for services' })).toBeTruthy();
    expect(visibleText(rates)).not.toContain('CBIC rate notification for services, September 2025');
    for (const fold of rates.querySelectorAll('details')) fold.open = true;
    expect(visibleText(rates)).toContain('CBIC rate notification for services, September 2025');
    assertInkRules(document.body);
  });

  it("Your CA: each line the engine works out again, and each difference from the portal, sits with its paper's receipt", async () => {
    start('#/business/ca', await ledgerline());
    const papers = await region('Receipts of the latest papers');
    const portal = (await within(papers).findByText(/^Recomputed: differs\./)).closest('[data-ca-receipt]') as HTMLElement;
    expect(portal.getAttribute('data-ca-receipt')).toBe('w-portal-sep');
    const recomputed = within(portal).getByText(/^Recomputed: differs\./).closest('[data-figure-group]') as HTMLElement;
    expect(within(recomputed).getByRole('button', { name: /^Receipt / }).getAttribute('data-receipt')).toBe('w-portal-sep');
    const difference = within(portal).getByText(/^Net payable: ours /).closest('[data-figure-group]') as HTMLElement;
    expect(within(difference).getByRole('button', { name: /^Receipt / }).getAttribute('data-receipt')).toBe('w-portal-sep');
    // A paper worked out the same again carries its receipt too.
    const same = within(papers).getByText('Recomputed: same').closest('[data-figure-group]') as HTMLElement;
    expect(within(same).getByRole('button', { name: /^Receipt / }).getAttribute('data-receipt')).toBe('w-gst-sep');
    assertInkRules(document.body);
  });

  it("Your CA: a paper's receipt chip opens the CA firm's calculator receipt (venture.ca.receipt): its figures, its steps and the line from working it again", async () => {
    const calls = watched(await ledgerline(), '#/business/ca');
    const papers = await region('Receipts of the latest papers');
    const portal = (await within(papers).findByText(/^Recomputed: differs\./)).closest('[data-ca-receipt]') as HTMLElement;
    assertInkRules(document.body);
    const chip = within(portal).getAllByRole('button', { name: 'Receipt w-portal-sep' })[0]!;
    await act(async () => { fireEvent.click(chip); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = (await screen.findByText('w-portal-sep', { selector: 'aside h2, aside h2 *' })).closest('aside') as HTMLElement;
    await within(sheet).findByText('Net payable: the portal less ours', { selector: 'dt' });
    expect(within(sheet).getAllByText('INR 80.00').length).toBeGreaterThan(0);
    const steps = sheet.querySelector('ol[data-receipt-steps]') as HTMLElement;
    expect(within(steps).getAllByRole('listitem').map((step) => step.textContent)).toEqual([expect.stringContaining('Net payable: the portal less ours')]);
    expect(within(sheet).getByText('Recomputed: differs. Net payable: the portal less ours: the stored receipt has INR 80.00; worked again it is INR 75.00.')).toBeTruthy();
    expect(calls.filter(([method]) => method === 'venture.ca.receipt').map(([, params]) => params)).toContainEqual({ id: 'w-portal-sep' });
    expect(calls.filter(([method]) => method === 'venture.receipt.get')).toEqual([]);
  });

  it('a price receipt chip still opens the receipt from venture.receipt.get', async () => {
    const calls = watched(new FakeEngine(), '#/business/prices');
    const sponsor = await offer('Sponsor slot');
    const chip = await within(sponsor).findByRole('button', { name: 'Receipt R-0408' });
    await act(async () => { fireEvent.click(chip); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = (await screen.findByText('R-0408', { selector: 'aside h2, aside h2 *' })).closest('aside') as HTMLElement;
    await waitFor(() => expect(sheet.querySelector('dl')).not.toBeNull());
    expect(calls.filter(([method]) => method === 'venture.receipt.get').map(([, params]) => params)).toEqual([{ id: 'R-0408' }]);
    expect(calls.filter(([method]) => method === 'venture.ca.receipt')).toEqual([]);
  });

  it("Practice: what a rehearsal and an improvement run cost is the engine's own line, marked as its words", async () => {
    start('#/business/practice');
    const clients = await region('Practice clients');
    await act(async () => { fireEvent.click(await within(clients).findByRole('button', { name: 'Rehearse now' })); });
    const cost = await within(clients).findByText(/^Cost: /);
    expect(cost.closest('[data-engine-line]')).not.toBeNull();
    const improve = await region('Improve the playbook');
    await act(async () => { fireEvent.click(await within(improve).findByRole('button', { name: 'Run the improvement loop' })); });
    const costs = await within(improve).findAllByText(/^Cost: /);
    for (const line of costs) expect(line.closest('[data-engine-line]')).not.toBeNull();
    assertInkRules(document.body);
  });

  it('every business page keeps the Ink rules', async () => {
    for (const [hash, folder] of [['#/business/plan', null], ['#/business/plan', 'ledgerline'], ['#/business/build', null], ['#/business/keep', null], ['#/business/practice', null]] as const) {
      const engine = folder ? await ledgerline() : new FakeEngine();
      window.location.hash = hash;
      const view = render(<App client={createFakeClient(engine)} language="en" />);
      await waitFor(() => expect(document.querySelector('main h1')).not.toBeNull());
      await waitFor(() => expect(document.querySelector('main')!.querySelectorAll('h2, h3').length).toBeGreaterThan(1));
      for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      for (const fold of document.querySelectorAll('details')) fold.open = true;
      assertInkRules(document.body);
      view.unmount();
    }
  });

  it('speaks Hindi on every business page, with no key showing', async () => {
    for (const hash of ['#/business/plan', '#/business/prices', '#/business/build', '#/business/keep', '#/business/practice']) {
      window.location.hash = hash;
      const view = render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
      // Each step of the page in turn: the header, then its tiles.
      await waitFor(() => expect(document.querySelector('main h1')).not.toBeNull());
      await waitFor(() => expect(document.querySelector('main')!.querySelectorAll('h2, h3').length, hash).toBeGreaterThan(1));
      for (const fold of document.querySelectorAll('details')) fold.open = true;
      expect(keyLikeText(document.querySelector('main')!), hash).toEqual([]);
      view.unmount();
    }
  });

  it('Plan keeps the change form one press away', async () => {
    start('#/business/plan');
    const change = await screen.findByRole('button', { name: 'Change plan' });
    expect(screen.queryByLabelText('One line')).toBeNull();
    fireEvent.click(change);
    expect(screen.getByLabelText('One line')).toBeTruthy();
  });
});
