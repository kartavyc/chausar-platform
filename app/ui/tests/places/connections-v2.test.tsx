import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CONNECTORS, MODEL_PRESETS } from '../../src/engine/fixtures-business';
import { connectorLabelOf } from '../../src/parts/ConnectorLabel';
import type { BooksSummaryLite, ConnectorCardLite, EngineClient, MethodName } from '../../src/engine/types';
import { assertInkRules, receiptMark } from '../helpers/ink-rules';

/**
 * Connections in the Ink v2 look (w3 package 3G1; spec 4.3 "Connections"; catalogue U10, K10, K11). Built from the
 * D pieces: Your AI first, then each category's connectors as tiles under a heading, each tile with its category
 * icon, name, honest label and the engine's note. A planned connector never looks live and offers nothing to press
 * but its name; the connector sheet turns the engine's `requires` lines into numbered setup steps; "What Chausar can do
 * on this computer" lists every way that writes or sends.
 */

type Intercept = (params: unknown, original: () => Promise<unknown>) => unknown;
function start(hash = '#/connections', options: { language?: 'en' | 'hi'; hosted?: boolean; intercept?: Partial<Record<MethodName, Intercept>> } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine(options.hosted ? { hosted: true } : undefined));
  const request = fake.request.bind(fake);
  const client: EngineClient = {
    ...fake,
    transport: options.hosted ? 'hosted' : fake.transport,
    request: ((method: MethodName, params?: unknown) => {
      const own = options.intercept?.[method];
      if (own) return Promise.resolve().then(() => own(params, () => request(method, params as never)));
      return request(method, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language={options.language ?? 'en'} />);
}
/**
 * The one honest rule for a tile's head chip and its look: the most its modes do today; else Writes when a way to post
 * works; else Reads for the bank card, whose statement import works; else Planned, drawn open and dashed.
 */
function honestLabel(card: ConnectorCardLite): ReturnType<typeof connectorLabelOf> {
  const own = connectorLabelOf(card);
  if (own !== 'planned') return own;
  if (card.postingOptions.some((option) => option.status === 'available')) return 'write';
  return card.id === 'bank-account' ? 'read' : 'planned';
}
/** A connector's tile, found by its name button. ByText with a selector, since a role query over the whole page is slow in jsdom. */
const tile = async (name: string) => (await screen.findByText(name, { selector: '[data-connector-name]' })).closest('li')!;
/**
 * A region found by its heading's words, then checked to be named by that heading. Role queries over the whole page
 * are slow in jsdom (each one walks every element), so a wait polls a cheap text query and the role is checked once.
 */
async function region(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: 'h2' });
  const section = heading.closest('section') as HTMLElement;
  expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  return section;
}
/** A sheet beside the page, by its title. */
const sheetNamed = async (title: string) => (await screen.findByText(title, { selector: 'aside h2' })).closest('aside') as HTMLElement;
/** A fieldset, by its legend. */
const fieldset = async (legend: string) => (await screen.findByText(legend, { selector: 'legend' })).closest('fieldset') as HTMLElement;
const names = (elements: HTMLElement[]) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim());
/** Text nodes that look like a catalogue key ("connections.ai.title"), which a missing translation would show. */
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/;
function keyLikeText(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    if (KEY_LIKE.test(text)) found.push(text);
  }
  return found;
}

describe('Connections in the Ink v2 look', () => {
  it('Your AI is the first tile, then each category of connectors under its own heading', async () => {
    start();
    await screen.findByText('Build', { selector: 'h2' });
    const main = document.querySelector('main')!;
    // The first tile in the page is a region named by its heading, Your AI.
    const first = main.querySelector('section[aria-labelledby]')!;
    expect(document.getElementById(first.getAttribute('aria-labelledby')!)?.textContent).toBe('Your AI');
    const categories = [...new Set(CONNECTORS.map((card) => card.categoryLabel))];
    const groups = categories.map((label) => screen.getByText(label, { selector: 'h2' }).closest('section')!);
    // The groups follow the engine's order, and every connector sits in its own category's group.
    for (const [index, label] of categories.entries()) {
      const inGroup = CONNECTORS.filter((card) => card.categoryLabel === label).map((card) => card.name);
      expect(within(groups[index]!).getAllByRole('listitem').map((item) => item.querySelector('[data-connector-name]')?.textContent), label).toEqual(inGroup);
    }
    assertInkRules(document.body);
  });

  it("each tile shows its category icon, its name, its honest label and the engine's note, and looks as live as its label", async () => {
    start();
    for (const card of CONNECTORS) {
      const item = await tile(card.name);
      const icon = item.querySelector('[data-category-icon]');
      expect(icon?.getAttribute('data-category-icon'), card.id).toBe(card.category);
      expect(icon?.getAttribute('aria-hidden'), card.id).toBe('true');
      const label = honestLabel(card);
      expect(item.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label'), card.id).toBe(label);
      // One rule for both: the chip says Planned exactly when the tile is drawn planned.
      expect(item.querySelector('[data-tile-state]')?.getAttribute('data-tile-state'), card.id).toBe(label === 'planned' ? 'planned' : 'live');
      expect(item.textContent, card.id).toContain(card.note);
    }
  });

  it('a way to post that works makes the chip say Writes; the bank reads the statements you import, with Planned only on reading the bank directly', async () => {
    start();
    const linkedin = await tile('X');
    expect(linkedin.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label')).toBe('write');
    // The planned API keeps its own line, apart from the chip.
    const api = linkedin.querySelector('[data-posting-planned="api"]') as HTMLElement;
    expect(api.textContent).toContain('API');
    expect(api.querySelector('[data-label]')?.getAttribute('data-label')).toBe('planned');

    const bank = await tile('Bank account (read only)');
    expect(bank.querySelector('[data-tile-state]')?.getAttribute('data-tile-state')).toBe('live');
    expect(bank.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label')).toBe('read');
    expect(bank.textContent).toContain('Statement files you import work today.');
    const planned = [...bank.querySelectorAll('[data-label="planned"]')];
    expect(planned).toHaveLength(1);
    expect(planned[0]!.closest('[data-bank-direct]')?.textContent).toContain('Reading your bank directly');

    // Nothing works for Instagram yet: Planned in the chip and an open, dashed tile.
    const instagram = await tile('Instagram');
    expect(instagram.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label')).toBe('planned');
    expect(instagram.querySelector('[data-tile-state]')?.getAttribute('data-tile-state')).toBe('planned');
  });

  it('a planned connector never looks live: nothing to press but its name and the vendor link, and no Works today', async () => {
    start();
    const planned = CONNECTORS.filter((card) => honestLabel(card) === 'planned');
    expect(planned.length).toBeGreaterThan(5);
    for (const card of planned) {
      const item = await tile(card.name);
      expect(names(within(item).getAllByRole('button')), card.id).toEqual([card.name]);
      expect(item.querySelector('[data-variant="primary"]'), card.id).toBeNull();
      expect(item.textContent, card.id).not.toContain('Works today');
      expect(names(within(item).queryAllByRole('link')), card.id).toEqual(card.vendorUrl ? [`Visit site, ${card.name}`] : []);
    }
    // A connector that works keeps its real action.
    expect(within(await tile('Lovable')).getByRole('button', { name: 'Open Lovable' })).toBeTruthy();
    expect(within(await tile('X')).getByRole('button', { name: 'Sign in to X' })).toBeTruthy();
    expect(within(await tile('Bank account (read only)')).getByRole('button', { name: 'Import a statement' })).toBeTruthy();
  });

  it("the connector sheet lists what each way of posting needs, numbered in the engine's order: setup steps for a way that works, what it needs first for a planned one", async () => {
    start('#/connections?sheet=connector:x');
    const sheet = await sheetNamed('X');
    const linkedin = CONNECTORS.find((card) => card.id === 'x')!;
    for (const option of linkedin.postingOptions) {
      const block = sheet.querySelector(`[data-posting-option="${option.mode}"]`) as HTMLElement;
      const steps = block.querySelector('ol');
      if (option.requires.length === 0) { expect(steps, option.mode).toBeNull(); continue; }
      expect(steps, option.mode).not.toBeNull();
      expect(within(steps!).getAllByRole('listitem').map((item) => item.textContent), option.mode).toEqual(option.requires);
      const heading = document.getElementById(steps!.getAttribute('aria-labelledby') ?? '');
      expect(heading?.textContent, option.mode).toBe(option.status === 'available' ? 'To set it up' : 'What it needs first');
    }
    expect(sheet.textContent).toContain('Sign-in: X sign-in');
    assertInkRules(document.body);
  });

  it('a planned connector sheet says Planned for every mode and offers no setup it cannot do', async () => {
    start('#/connections?sheet=connector:razorpay');
    const sheet = await sheetNamed('Razorpay');
    expect(within(sheet).queryByText('Works today')).toBeNull();
    for (const label of sheet.querySelectorAll('[data-mode] [data-label]')) expect(label.getAttribute('data-label')).toBe('planned');
    expect(within(sheet).queryAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Close Razorpay']);
    assertInkRules(document.body);
  });

  it('What Chausar can do on this computer lists every way that writes or sends, with the engine\'s words, and what stopping means', async () => {
    start();
    const canDo = await region('What Chausar can do on this computer');
    const rows = await within(canDo).findAllByRole('listitem');
    const expected = CONNECTORS.flatMap((card) => [
      ...card.modes.filter((mode) => mode.mode === 'write' && mode.status === 'available').map((mode) => [card.name, mode.what]),
      ...card.postingOptions.filter((option) => option.status === 'available').map((option) => [card.name, option.what]),
    ]);
    expect(expected.length).toBe(3);
    expect(rows.map((row) => [row.querySelector('[data-can-do-name]')?.textContent, row.querySelector('[data-can-do-what]')?.textContent])).toEqual(expected);
    expect(canDo.textContent).toContain('Stopping a connection does not undo what already happened.');
    expect(canDo.textContent).not.toContain('GitHub');
  });

  it('on hosted, the capabilities are titled for the server, not this computer', async () => {
    start('#/connections', { hosted: true });
    // The title is the page's own words; the rows below it stay the engine's.
    await region('What Chausar can do on the server');
    expect(screen.queryByText('What Chausar can do on this computer')).toBeNull();
  });

  it('says so when nothing writes or sends yet', async () => {
    const planned = CONNECTORS.map((card): ConnectorCardLite => ({
      ...card,
      modes: card.modes.map((mode) => ({ ...mode, status: 'planned' })),
      postingOptions: card.postingOptions.map((option) => ({ ...option, status: 'planned' })),
    }));
    start('#/connections', { intercept: { 'venture.connectors.list': () => planned } });
    const canDo = await region('What Chausar can do on this computer');
    expect(await within(canDo).findByText('Nothing here writes or sends for you yet.')).toBeTruthy();
    expect(within(canDo).queryAllByRole('listitem')).toHaveLength(0);
    expect(canDo.textContent).toContain('Stopping a connection does not undo what already happened.');
  });

  it('Your AI: every choice, grouped by how you pay, says whether it can connect and gives its one fix line', async () => {
    start();
    const section = await region('Your AI');
    const every = await within(section).findByText('Every choice');
    fireEvent.click(every);
    const groups: Record<string, string> = { 'provider-api': 'With your own key', 'this-computer': 'With an AI app on this computer', 'chausar-engine': 'Without AI' };
    for (const preset of MODEL_PRESETS) {
      const item = within(section).getByText(preset.label).closest('li')!;
      expect(item.querySelector('[data-fix-line]')?.textContent, preset.id).toBe(preset.availabilityReason);
      expect(item.querySelector('[data-availability]')?.getAttribute('data-availability'), preset.id).toBe(preset.availability);
      const group = item.closest('[data-runs-on]')!;
      expect(group.getAttribute('data-runs-on'), preset.id).toBe(preset.runsOn);
      // Under "Add an AI" (a level 3 heading), each group is a level 4 heading.
      expect(within(group as HTMLElement).getByRole('heading', { level: 4 }).textContent, preset.id).toBe(groups[preset.runsOn]);
    }
    assertInkRules(document.body);
  });

  it("this month's AI spend is the engine's own line, marked as its words", async () => {
    start();
    const section = await region('Your AI');
    const spent = await within(section).findByText(/^This month:/);
    expect(spent.closest('[data-engine-line]')).not.toBeNull();
    assertInkRules(document.body);
  });

  it('the privacy rule and transcription sit beside Your AI as their own tiles', async () => {
    start();
    const yourAi = await region('Your AI');
    // The side tiles come with the engine's AI status: wait for it first, then for each tile.
    await within(yourAi).findByText(/^This month:/);
    const privacy = await fieldset('What may leave this computer');
    const transcription = await fieldset('Transcription on this computer');
    expect(yourAi.contains(privacy)).toBe(false);
    expect(yourAi.contains(transcription)).toBe(false);
  });

  it("the bank sheet keeps its figures honest: the engine's own lines are marked as its words, never as quotes, and a payment carries its receipt", async () => {
    start('#/connections?sheet=bank:bank-account');
    const sheet = await sheetNamed('Bank account');
    await waitFor(() => expect(within(sheet).getByText('TRANSFER TO SAVINGS')).toBeTruthy());
    // The sheet's header says what it is once: a connection, named Bank account.
    expect(within(sheet).getAllByText('Bank account')).toHaveLength(1);
    // Each row's In or Out amount and each alert rule are lines the engine wrote: engine lines, not quoted words.
    const engineWords = [...sheet.querySelectorAll('[data-direction]'), ...within(sheet).getAllByText(/^When ₹/)];
    expect(engineWords.length).toBeGreaterThan(5);
    for (const words of engineWords) {
      expect(words.closest('[data-engine-line]'), words.textContent ?? '').not.toBeNull();
      expect(words.closest('[data-content]'), words.textContent ?? '').toBeNull();
    }
    assertInkRules(document.body);
    const payment = within(sheet).getByText('NEFT/INV-0039/BOAT AUDIO').closest('[data-bank-row]') as HTMLElement;
    await act(async () => { fireEvent.click(within(payment).getByRole('button', { name: 'Record payment' })); });
    await waitFor(() => expect(within(sheet).getByText('Recorded ₹26,200.00 as a payment of INV-0039.')).toBeTruthy());
    expect(within(payment).getByRole('button', { name: receiptMark(/./) })).toBeTruthy();
    const rent = within(sheet).getByText('OFFICE RENT OCTOBER').closest('[data-bank-row]') as HTMLElement;
    await act(async () => { fireEvent.click(within(rent).getByRole('button', { name: 'Add as cost' })); });
    const added = await within(sheet).findByText('Added ₹25,000.00 to your costs.');
    expect(added.closest('[data-engine-line]')).not.toBeNull();
    expect(added.closest('[data-content]')).toBeNull();
    assertInkRules(document.body);
  });

  it('money in that names no invoice offers Record payment only when there is an open invoice to record it against', async () => {
    const none = (_params: unknown, original: () => Promise<unknown>) => original().then((books) => ({ ...(books as BooksSummaryLite), openInvoices: [] }));
    start('#/connections?sheet=bank:bank-account', { intercept: { 'venture.books.summary': none } });
    const sheet = await sheetNamed('Bank account');
    const credit = (await within(sheet).findByText('NEFT LARGE CREDIT')).closest('[data-bank-row]') as HTMLElement;
    await within(credit).findByText('No open invoices to match this to.');
    expect(within(credit).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(credit).getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('with open invoices, money in that names none offers Record payment once one is picked', async () => {
    start('#/connections?sheet=bank:bank-account');
    const sheet = await sheetNamed('Bank account');
    const credit = (await within(sheet).findByText('NEFT LARGE CREDIT')).closest('[data-bank-row]') as HTMLElement;
    await within(credit).findByLabelText('Invoice it pays');
    expect(within(credit).getByRole('button', { name: 'Record payment' })).toBeTruthy();
  });

  it('speaks Hindi everywhere on the page and in the sheets, with no key showing', async () => {
    start('#/connections?sheet=connector:x', { language: 'hi' });
    const sheet = await sheetNamed('X');
    await screen.findByText('कनेक्शन', { selector: 'h1' });
    await waitFor(() => expect(document.querySelector('main')!.querySelectorAll('li').length).toBeGreaterThan(10));
    expect(keyLikeText(document.querySelector('main')!)).toEqual([]);
    expect(keyLikeText(sheet)).toEqual([]);
  });
});
