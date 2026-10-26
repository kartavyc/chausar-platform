import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

// The Pipeline tab of Clients (Ink v2 wave 4, package 4E4; the direction D board D-Clients): the board Found to Not
// now from the engine's venture.pipeline.list, its four tiles, the filter chips and the path lines' key, cards that move
// forward only through the engine (drag, or the bracket keys), "Due today and late" with its handoffs, "How people
// moved", and the card sheet. Everything shown comes from the fake engine, which answers as the engine's 4E1 to 4E3
// do; its sample cards are dated from the fake's clock. 23 Oct 2026 is a Friday.

type Fake = ReturnType<typeof createFakeClient>;
const FRIDAY = '2026-10-23T10:00:00.000Z';
/** Thursday after: Tara's follow-up (due Tuesday 27 Oct) is two days late. */
const THURSDAY = '2026-10-29T10:00:00.000Z';

/** later: the fake's clock moves on to this moment once its sample is made (the sample is dated from its first moment). */
async function start(hash = '#/clients/pipeline', options: { later?: string; language?: 'en' | 'hi'; prepare?: (client: Fake) => Promise<void>; override?: (client: Fake) => void } = {}) {
  window.location.hash = hash;
  const clock = { now: FRIDAY };
  const fake = createFakeClient(new FakeEngine({ now: () => clock.now }));
  if (options.later) clock.now = options.later;
  await options.prepare?.(fake);
  options.override?.(fake);
  const spy = vi.spyOn(fake, 'request');
  const view = render(<ClockProvider now={() => new Date(clock.now)}><App client={fake} language={options.language ?? 'en'} /></ClockProvider>);
  return { client: fake, spy, clock, ...view };
}

/** Clicks something that may change the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];

const board = () => screen.findByRole('group', { name: 'Pipeline board' });
const column = (root: HTMLElement, name: string) => within(root).getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const cardOf = (root: HTMLElement, name: string) => within(root).getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

/** The desktop app's preload: its checked external open, which takes https partner links and one mail link. */
function desktopOpen() {
  const open = vi.fn(async (_url: string) => {});
  (window as Window & { chausar?: unknown }).chausar = { openExternal: open };
  return open;
}
afterEach(() => { delete (window as Window & { chausar?: unknown }).chausar; });

describe('Pipeline: the board, Found to Not now (founder decision; 4E1 stages)', () => {
  it('has the stages in the engine order with their lines and counts, and Not now folded with its people', async () => {
    await start();
    const root = await board();
    await waitFor(() => expect(within(root).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Found', 'Asked', 'Talking', 'Proposal', 'Won']));
    expect(root.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(root.getAttribute('aria-describedby')!)?.textContent).toBe('Drag a card, or press the bracket keys to move it.');
    // Each stage's line describes its column for a screen reader; the board itself stays quiet.
    const described = (name: string) => document.getElementById(column(root, name).getAttribute('aria-describedby') ?? '');
    expect([described('Found')?.textContent, described('Asked')?.textContent, described('Won')?.textContent]).toEqual(['Not asked yet', 'You sent the first note', 'Now your clients']);
    expect(described('Found')?.classList.contains('sr-only')).toBe(true);
    expect(column(root, 'Found').querySelector('[data-count]')?.textContent).toBe('4');
    // Lost has nobody, so nothing is drawn for it; Not now folds until the owner opens it.
    expect(within(root).queryByRole('button', { name: /^Show Lost/ })).toBeNull();
    const strip = within(root).getByRole('button', { name: 'Show Not now, 1 person' });
    expect(within(root).queryByRole('heading', { level: 3, name: 'Sana Qureshi' })).toBeNull();
    await act(async () => { fireEvent.click(strip); });
    expect(cardOf(column(root, 'Not now'), 'Sana Qureshi').textContent).toContain('Ask again from');
    assertInkRules(document.body);
  });

  it('a card shows who, how well you know them, the path and its via line, the next step, the draft and the business', async () => {
    await start();
    const root = await board();
    const tara = await waitFor(() => cardOf(root, 'Tara Iyer'));
    expect(tara.querySelector('[aria-hidden="true"][data-dept]')?.textContent).toBe('TI');
    expect(tara.textContent).toContain('Kettle Audio');
    expect(within(tara).getByRole('img', { name: 'Strength: know well, 4 of 5.' })).toBeTruthy();
    expect(tara.textContent).toContain('Follow up 27 Oct');
    // The draft names its channel; the engine's whole line is its title and what a screen reader hears.
    expect(tara.querySelector('[data-draft]')?.textContent).toBe('Follow-up drafted, for Mail');
    expect(tara.textContent).not.toContain('Know well');
    // One business on the board: its cards need not name it (a second business adds the initials square to each).
    expect(within(tara).queryByRole('img', { name: 'Lumen Studio' })).toBeNull();
    const kabir = cardOf(root, 'Kabir Sethi');
    expect(kabir.textContent).toContain('via Tara Iyer');
    expect(kabir.querySelector('[data-draft]')?.textContent).toBe('Intro drafted, for Mail');
    // A path Chausar cannot confirm is dashed and said in words.
    expect(cardOf(root, 'Nisha Rao').textContent).toMatch(/possible path, not confirmed/i);
    // A lead's own card shows its email check, as the lead list did.
    expect(cardOf(root, 'Asha Rao').textContent).toContain('Email works');
  });

  it('a late next step says so in wait words', async () => {
    await start('#/clients/pipeline', { later: THURSDAY });
    const tara = await waitFor(() => cardOf(screen.getByRole('group', { name: 'Pipeline board' }), 'Tara Iyer'));
    const next = tara.querySelector('[data-late]');
    expect(next?.textContent).toBe('Follow up 27 Oct, 2 days late');
  });

  it('] moves a card on through venture.pipeline.move; a refusal shows the engine words and the card stays', async () => {
    const { spy } = await start();
    const root = await board();
    const kabir = await waitFor(() => cardOf(root, 'Kabir Sethi'));
    await act(async () => { fireEvent.keyDown(kabir, { key: ']' }); });
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_kabir', stage: 'asked' });
    expect(screen.getByRole('alert').textContent).toBe('Asked needs a recorded send: tap I sent it after you send, or say the day you sent it.');
    expect(cardOf(column(root, 'Found'), 'Kabir Sethi')).toBeTruthy();
    // The evidence is given in the card sheet, opened at Move it with the stage picked.
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=card%3Aopp_seed_kabir&tab=move-asked');
    const sheet = await screen.findByRole('complementary', { name: 'Kabir Sethi' });
    expect((await waitFor(() => within(sheet).getByLabelText('Move to') as HTMLSelectElement)).value).toBe('asked');
    expect(within(sheet).getByLabelText('The day you sent it')).toBeTruthy();
    // [ asks to go back, which the engine refuses: cards move forward only.
    await act(async () => { fireEvent.keyDown(cardOf(root, 'Tara Iyer'), { key: '[' }); });
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_tara', stage: 'found' });
    expect(screen.getByRole('alert').textContent).toBe('A card only moves forward. Move it to a later stage.');
    expect(cardOf(column(root, 'Asked'), 'Tara Iyer')).toBeTruthy();
  });

  it('a board move to Won, Lost or Not now never moves at once: the card sheet opens at Move it with that stage picked', async () => {
    const { spy } = await start();
    const root = await board();
    const leela = await waitFor(() => cardOf(root, 'Leela Menon'));
    await act(async () => { fireEvent.keyDown(leela, { key: ']' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await settle();
    expect(calls(spy, 'venture.pipeline.move')).toHaveLength(0);
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=card%3Aopp_seed_leela&tab=move-won');
    const sheet = await screen.findByRole('complementary', { name: 'Leela Menon' });
    expect((await waitFor(() => within(sheet).getByLabelText('Move to') as HTMLSelectElement)).value).toBe('won');
    expect(sheet.textContent).toContain('Chausar adds them to your clients.');
    await click(within(sheet).getByRole('button', { name: 'Move' }));
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_leela', stage: 'won' });
    expect(within(sheet).getByText('Won. Leela is now your client.')).toBeTruthy();
  });

  it('a move the engine takes says so, and the moved card keeps focus in its new column', async () => {
    await start('#/clients/pipeline', {
      override: (client) => {
        // The day sent, as the sheet would give it: the board's own move then goes through.
        const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
        client.request = ((m: string, p?: Record<string, unknown>) => (m === 'venture.pipeline.move' && p?.stage === 'asked'
          ? base(m, { ...p, evidence: { kind: 'note', on: '2026-10-23' } }) : base(m, p))) as EngineClient['request'];
      },
    });
    const root = await board();
    const nisha = await waitFor(() => cardOf(root, 'Nisha Rao'));
    within(nisha).getByRole('button', { name: 'Nisha Rao' }).focus();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: ']' }); });
    await settle();
    expect(document.querySelector('[data-move-line]')?.textContent).toMatch(/^Moved to Asked\. Follow up \d+ [A-Z][a-z]{2}\.$/);
    await waitFor(() => expect(cardOf(column(root, 'Asked'), 'Nisha Rao')).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Nisha Rao'));
    expect(document.activeElement?.closest('[data-column]')?.getAttribute('data-column')).toBe('asked');
  });

  it('a Proposal card shows its quote with the receipt; a Won card names its client', async () => {
    await start();
    const root = await board();
    const leela = await waitFor(() => cardOf(root, 'Leela Menon'));
    const quote = leela.querySelector('[data-quote]')!;
    expect(quote.textContent).toContain('₹18,000');
    expect(quote.querySelector('[data-receipt]')?.getAttribute('data-receipt')).toBe('R-pipe-quote-leela');
    expect(cardOf(root, 'Pooja Nair').querySelector('[data-client]')?.textContent).toMatch(/^Now a client since \d+ [A-Z][a-z]{2}\.$/);
    assertInkRules(document.body);
  });

  it('a card dropped on a column asks the engine to move it there', async () => {
    const { spy } = await start();
    const root = await board();
    const nisha = await waitFor(() => cardOf(root, 'Nisha Rao'));
    const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'none' };
    fireEvent.dragStart(nisha.closest('li')!, { dataTransfer });
    await act(async () => { fireEvent.drop(column(root, 'Proposal'), { dataTransfer }); });
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_nisha', stage: 'proposal' });
    expect(screen.getByRole('alert').textContent).toBe('Proposal needs the quote you sent, or a note of what you offered.');
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=card%3Aopp_seed_nisha&tab=move-proposal');
  });
});

describe('Pipeline: tiles, chips and the key', () => {
  it('the four tiles each give the engine count with its receipt and line', async () => {
    await start();
    const tiles = await screen.findByRole('list', { name: 'Your pipeline at a glance' });
    const items = await waitFor(() => { const found = within(tiles).getAllByRole('listitem'); expect(found).toHaveLength(4); return found; });
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual(['Next steps this week', 'Drafts to send', 'Moved forward this week', 'Won this month']);
    // The engine's breakdown is read with the tile, not shown: the board stays quiet at rest.
    expect(items[1]!.querySelector('[data-tile-line]')?.textContent).toBe('2 for Mail');
    expect(items[1]!.querySelector('[data-tile-line]')?.classList.contains('sr-only')).toBe(true);
    // At rest, as D-Clients shows them: Next steps says how many are late, today and later; Won this month names the client.
    const shown = (item: HTMLElement) => item.querySelector('[data-tile-line]');
    expect([shown(items[0]!)?.textContent, shown(items[0]!)?.classList.contains('sr-only')]).toEqual(['0 late, 0 today, 0 later', false]);
    expect([shown(items[3]!)?.textContent, shown(items[3]!)?.classList.contains('sr-only')]).toEqual(['Pooja Nair', false]);
    expect(within(items[0]!).getByRole('button', { name: /receipt/i }).getAttribute('data-receipt')).toMatch(/^R-pipe-next-steps-/);
    assertInkRules(document.body);
  });

  it('All, Due soon and Has a draft filter through the engine and stay in the address; the key names the path lines', async () => {
    const { spy } = await start();
    const chips = await screen.findByRole('group', { name: 'Show' });
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent?.replace(/\d+/g, '').trim())).toEqual(['All', 'Due soon', 'Has a draft']);
    await click(within(chips).getByRole('button', { name: /^Has a draft/ }));
    expect(window.location.hash).toBe('#/clients/pipeline?show=drafts');
    await settle();
    expect(calls(spy, 'venture.pipeline.list').some(([, params]) => (params as { filter?: string }).filter === 'draft')).toBe(true);
    const root = await board();
    await waitFor(() => expect(within(root).queryByRole('heading', { level: 3, name: 'Nisha Rao' })).toBeNull());
    expect(cardOf(root, 'Tara Iyer')).toBeTruthy();
    const key = screen.getByRole('group', { name: 'Path lines' });
    expect(key.textContent).toContain('strong');
    expect(key.textContent).toContain('not confirmed');
  });
});

describe('Pipeline: Due today and late, and How people moved', () => {
  it('a due follow-up opens the owner\'s mail app with the nudge, then I sent it records the send', async () => {
    const open = desktopOpen();
    const { spy } = await start('#/clients/pipeline', { later: THURSDAY });
    const due = await screen.findByRole('region', { name: 'Due today and late' });
    const tara = await waitFor(() => within(due).getByText('Follow up 27 Oct, 2 days late. Nudge drafted for Mail.').closest('li') as HTMLElement);
    expect(tara.textContent).toContain('Tara Iyer, Kettle Audio');
    await click(within(tara).getByRole('button', { name: 'Open in Mail' }));
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatch(/^mailto:tara@kettleaudio\.example\?subject=Following%20up&body=/);
    expect(within(tara).getByText('Opens your mail app with the text filled in. Chausar sends nothing here, and counts only the notes you mark as sent.')).toBeTruthy();
    await click(within(tara).getByRole('button', { name: 'I sent it' }));
    await settle();
    const sent = calls(spy, 'venture.outreach.sent').at(-1)![1] as { draftId: string; at: string; channel: string };
    expect(sent).toEqual({ draftId: expect.stringMatching(/^outreach_/), at: THURSDAY, channel: 'own-mailbox' });
    expect(due.textContent).toContain('Chausar fills in the text and opens the app. You press send, then tap I sent it.');
  });

  it('How people moved, folded at rest, draws each stage by how many reached it, then the count and the share that moved on', async () => {
    const { client } = await start();
    const funnel = await screen.findByRole('region', { name: 'How people moved' });
    expect(funnel.querySelector('details')?.open).toBe(false);
    await act(async () => { funnel.querySelector('details')!.open = true; });
    // Each bar is the engine's own per mille (reachedPermille), and its words are the engine's count and share.
    const engine = (await client.request('venture.pipeline.list', {})) as { funnel: { stage: string; reached: number; reachedPermille: number; share: string | null }[] };
    const drawn = engine.funnel.filter((item) => !['lost', 'not-now'].includes(item.stage));
    expect(drawn.length).toBe(5);
    expect(drawn.some((item) => item.reachedPermille > 0 && item.reachedPermille < 1000)).toBe(true);
    for (const item of drawn) {
      const row = funnel.querySelector(`[data-key="${item.stage}"]`)!;
      expect([item.stage, Number(row.querySelector('meter')?.getAttribute('value'))]).toEqual([item.stage, item.reachedPermille]);
      expect(row.textContent).toContain(item.share ? `${item.reached} · ${item.share}` : String(item.reached));
    }
    await waitFor(() => expect(within(funnel).getByRole('img', { name: /How many people reached each stage/ })).toBeTruthy());
    expect(within(funnel).getByText('View chart data')).toBeTruthy();
    expect(funnel.querySelectorAll('table [data-receipt]').length).toBeGreaterThan(0);
    expect(funnel.querySelector('[data-forecast]')?.textContent).toMatch(/^Not enough history yet/);
  });
});

describe('Pipeline: the card sheet', () => {
  it('shows the timeline (sent, scheduled, projected and estimated), the score with its reasons and the trigger', async () => {
    await start();
    await click(await screen.findByRole('button', { name: 'Tara Iyer' }));
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=card%3Aopp_seed_tara');
    const sheet = await screen.findByRole('complementary', { name: 'Tara Iyer' });
    await waitFor(() => expect(sheet.textContent).toContain('What happened'));
    expect(sheet.querySelector('[data-trigger]')?.textContent).toBe('LinkedIn connections, Connections.csv, line 14');
    expect(sheet.textContent).toContain('Warm');
    expect(within(sheet).getByRole('list', { name: 'Why this score' }).textContent).toContain('Title contains "partnerships": +20');
    const sent = sheet.querySelector('[data-what="sent"]');
    expect(sent?.textContent).toContain("First note sent by email, 22 Oct. Chausar doesn't track opens.");
    expect(sheet.querySelector('[data-what="scheduled"]')?.textContent).toContain('Follow up 27 Oct');
    const projected = sheet.querySelector('[data-what="projected"]');
    expect(projected?.hasAttribute('data-estimated')).toBe(true);
    expect(projected?.textContent).toContain('estimated');
    // Its waiting draft opens from the card (4E4: the card names it by id).
    expect(within(sheet).getByRole('button', { name: 'Open the draft' })).toBeTruthy();
    assertInkRules(document.body);
  });

  it('Move it moves forward with what the stage rests on, and says the engine words', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_tara');
    const sheet = await screen.findByRole('complementary', { name: 'Tara Iyer' });
    // Simple first: each form opens from its own button.
    expect(within(sheet).queryByLabelText('Move to')).toBeNull();
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Move the card' })));
    const select = within(sheet).getByLabelText('Move to') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'talking' } });
    fireEvent.change(within(sheet).getByLabelText('The day they wrote back'), { target: { value: '2026-10-23' } });
    await click(within(sheet).getByRole('button', { name: 'Move' }));
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_tara', stage: 'talking', evidence: { kind: 'note', on: '2026-10-23' } });
    expect(within(sheet).getByText('Moved to Talking. Follow-ups stopped.')).toBeTruthy();
  });

  it('Proposal rests on a quote picked from the business\'s quotes, newest first, or on a note of what was offered', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_vikram&tab=move-proposal');
    const sheet = await screen.findByRole('complementary', { name: 'Vikram Bhat' });
    const evidence = await waitFor(() => within(sheet).getByLabelText('What they have from you') as HTMLSelectElement);
    expect([...evidence.options].filter((option) => !option.disabled).map((option) => option.textContent)).toEqual(['Short reel (4), ₹9,600, 22 Oct', 'Monthly edits, ₹18,000, 20 Oct', 'A note of what you offered']);
    // Nothing is picked for the owner: Move stays locked until they say what the Proposal rests on.
    expect(evidence.value).toBe('');
    const go = within(sheet).getByRole('button', { name: 'Move' });
    expect([go.getAttribute('aria-disabled'), go.title]).toEqual(['true', 'Pick what they have from you first.']);
    await click(go);
    expect(calls(spy, 'venture.pipeline.move')).toHaveLength(0);
    expect(sheet.querySelector('[data-picked-quote]')).toBeNull();
    fireEvent.change(evidence, { target: { value: 'R-pipe-quote-reel' } });
    // The chosen quote shows beside the list as its figure, with its receipt.
    const chosen = sheet.querySelector('[data-picked-quote]')!;
    expect(chosen.textContent).toContain('₹9,600');
    expect(chosen.querySelector('[data-receipt]')?.getAttribute('data-receipt')).toBe('R-pipe-quote-reel');
    expect(go.getAttribute('aria-disabled')).not.toBe('true');
    await click(go);
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_vikram', stage: 'proposal', evidence: { kind: 'quote', id: 'R-pipe-quote-reel' } });
    expect(within(sheet).getByText('Moved to Proposal.')).toBeTruthy();
  });

  it('a receipt that is not a quote is refused by the engine, and the refusal reads in the owner\'s language', async () => {
    const fake = createFakeClient(new FakeEngine({ now: () => FRIDAY }));
    const board = (await fake.request('venture.pipeline.list', {})) as { funnel: { receiptId: string }[] };
    let refused: { code?: string } = {};
    try {
      await fake.request('venture.pipeline.move', { id: 'opp_seed_vikram', stage: 'proposal', evidence: { kind: 'quote', id: board.funnel[0]!.receiptId } });
    } catch (error) { refused = error as { code?: string }; }
    expect(refused.code).toBe('PIPELINE_NOT_A_QUOTE');
    await start('#/clients/pipeline?sheet=card:opp_seed_vikram&tab=move-proposal', {
      language: 'hi',
      override: (client) => {
        const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
        client.request = (async (m: string, p?: unknown) => {
          if (m === 'venture.pipeline.move') throw new EngineError('PIPELINE_NOT_A_QUOTE', 'That receipt is for an order or an invoice, not a quote.');
          return base(m, p);
        }) as EngineClient['request'];
      },
    });
    const sheet = await screen.findByRole('complementary', { name: 'Vikram Bhat' });
    const evidence = await waitFor(() => sheet.querySelector('select[id$="-rests"]') as HTMLSelectElement);
    fireEvent.change(evidence, { target: { value: 'R-pipe-quote-reel' } });
    await click(sheet.querySelector('form button[type="submit"]') as HTMLElement);
    await settle();
    expect(sheet.querySelector('[data-moved]')?.textContent).toBe('यह रसीद किसी ऑर्डर या बिल की है, कोटेशन की नहीं। अपना बनाया कोटेशन चुनें, या लिखें कि आपने क्या पेश किया।');
  });

  it('a note for Proposal keeps Move locked until it has words', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_vikram&tab=move-proposal');
    const sheet = await screen.findByRole('complementary', { name: 'Vikram Bhat' });
    fireEvent.change(await waitFor(() => within(sheet).getByLabelText('What they have from you')), { target: { value: 'note' } });
    const go = within(sheet).getByRole('button', { name: 'Move' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    await click(go);
    expect(calls(spy, 'venture.pipeline.move')).toHaveLength(0);
    fireEvent.change(within(sheet).getByLabelText('What you offered'), { target: { value: 'Four explainers a month' } });
    await click(go);
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_vikram', stage: 'proposal', evidence: { kind: 'note', text: 'Four explainers a month' } });
  });

  it('Lost starts with no reason picked, and Move stays locked until the owner picks one', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_tara&tab=move-lost');
    const sheet = await screen.findByRole('complementary', { name: 'Tara Iyer' });
    const reason = await waitFor(() => within(sheet).getByLabelText('Why') as HTMLSelectElement);
    expect(reason.value).toBe('');
    const go = within(sheet).getByRole('button', { name: 'Move' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    expect(go.title).toBe('Pick why first.');
    await click(go);
    expect(calls(spy, 'venture.pipeline.move')).toHaveLength(0);
    fireEvent.change(reason, { target: { value: 'timing' } });
    expect(go.getAttribute('aria-disabled')).not.toBe('true');
    await click(go);
    await settle();
    expect(calls(spy, 'venture.pipeline.move').at(-1)![1]).toEqual({ id: 'opp_seed_tara', stage: 'lost', reason: 'timing' });
  });

  it('sets the owner\'s own next step with its day', async () => {
    const { spy } = await start('#/clients/pipeline?sheet=card:opp_seed_kabir');
    const sheet = await screen.findByRole('complementary', { name: 'Kabir Sethi' });
    await click(await waitFor(() => within(sheet).getByRole('button', { name: 'Set a next step' })));
    fireEvent.change(within(sheet).getByLabelText('Your next step'), { target: { value: 'Ask Tara about Kabir' } });
    fireEvent.change(within(sheet).getByLabelText('Day'), { target: { value: '2026-10-27' } });
    await click(within(sheet).getByRole('button', { name: 'Set the next step' }));
    await settle();
    expect(calls(spy, 'venture.pipeline.setNext').at(-1)![1]).toEqual({ id: 'opp_seed_kabir', text: 'Ask Tara about Kabir', due: '2026-10-27' });
    expect(within(sheet).getByText('Next step set for 27 Oct 2026.')).toBeTruthy();
  });
});

describe('Pipeline in Hindi, and with nobody on it', () => {
  it('renders in Hindi with no key showing as text', async () => {
    const { container } = await start('#/clients/pipeline', { language: 'hi' });
    await screen.findByRole('button', { name: 'Tara Iyer' });
    expect(container.textContent).not.toMatch(/clients\.[a-z]/);
    expect(container.textContent).not.toMatch(/(board|state)\.[a-z]/);
  });

  it('in Hindi, card lines the engine gives in parts read from those parts: the day, the draft\'s channel, how long since they wrote', async () => {
    await start('#/clients/pipeline', { language: 'hi' });
    await screen.findByRole('heading', { level: 3, name: 'Tara Iyer' });
    const root = document.body;
    const tara = await waitFor(() => cardOf(root, 'Tara Iyer'));
    const next = tara.querySelector('[data-next]')!.textContent!;
    expect(next).toMatch(/^Follow up, \d+ /);
    expect(next).not.toMatch(/Oct|due/);
    expect(cardOf(root, 'Kabir Sethi').querySelector('[data-draft]')!.textContent).toBe('मेल के लिए ड्राफ़्ट');
    await click(within(cardOf(root, 'Vikram Bhat')).getByRole('button', { name: 'Vikram Bhat' }));
    const sheet = await screen.findByRole('complementary', { name: 'Vikram Bhat' });
    expect(sheet.querySelector('[data-thread]')!.textContent).toBe('बातचीत जारी है: उन्होंने 3 दिन पहले लिखा।');
  });

  it('an empty pipeline says so in one sentence, with its ways forward', async () => {
    await start('#/clients/pipeline', { prepare: async (client) => { await client.request('workspace.open', { folder: 'ledgerline' }); } });
    expect(await screen.findByText('Nobody is in your pipeline yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Pipeline board' })).toBeNull();
    assertInkRules(document.body);
    assertOnePrimary(document.body);
  });

  it('says so when the board cannot be read, and draws no board', async () => {
    await start('#/clients/pipeline', {
      override: (client) => {
        const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
        client.request = ((m: string, p?: unknown) => (m === 'venture.pipeline.list' ? Promise.reject(new Error('The engine is not answering.')) : base(m, p))) as EngineClient['request'];
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('The engine is not answering.');
    expect(screen.queryByRole('group', { name: 'Pipeline board' })).toBeNull();
  });
});
