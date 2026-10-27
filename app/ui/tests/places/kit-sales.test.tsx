import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type QueueList } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules, receiptMark } from '../helpers/ink-rules';

/*
 * Ink v2 wave 5, package 5A2 on screen. Clients: a client's or a pipeline person's sheet drafts a sales proposal (P3),
 * five sections as the client will read them, its Investment a figure with its price receipt, a paid pilot one tick
 * away (P2); it waits on Today, where the owner reads and approves it, and only then offers the owner's own mail. An
 * ask outside what the business does shows the engine's reply to copy (P4). Business > Go or no go (M18): the card
 * from what the owner types, the most they could lose as a figure with its receipt, every Go card saying Go spends
 * nothing. Business > Prices: a share price is the advanced option, one fold away; the fixed price stays first.
 */

type Fake = ReturnType<typeof createFakeClient>;

function start({ hash, language = 'en', stub }: { hash: string; language?: Language; stub?: (method: string, params: unknown) => unknown }) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const stubbed = stub?.(method, params);
    if (stubbed instanceof Error) throw stubbed;
    return stubbed === undefined ? request(method as never, params as never) : stubbed;
  });
  client.request = spy as unknown as Fake['request'];
  render(<App client={client} language={language} />);
  return { spy, client, request };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await settle(); };
const type = async (element: HTMLElement, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);

describe('Clients: the sales proposal (5A2, P2 and P3)', () => {
  it('drafts from the client sheet: five sections, Investment as a receipted figure, waiting on Today, then the owner sends it', async () => {
    const { spy, request } = start({ hash: '#/clients?sheet=client:c-boat' });
    const client = await screen.findByRole('complementary', { name: 'Boat Audio' });
    await press(await within(client).findByRole('button', { name: 'Draft a proposal' }));
    const sheet = await screen.findByRole('complementary', { name: 'A proposal' });
    expect(within(sheet).getByText('No proposal for them yet. Pick an offer, and Chausar drafts one from your records.')).toBeTruthy();
    // Simple first: the offer to pick, a paid pilot one tick away, one primary.
    expect(within(sheet).getByRole('checkbox', { name: 'Offer it as a paid pilot first' })).toBeTruthy();
    await press(within(sheet).getByRole('button', { name: 'Draft proposal' }));
    expect(calls(spy, 'venture.salesProposal.draft')).toEqual([{ clientId: 'c-boat', offerId: 'offer_sponsor' }]);

    const drafted = await screen.findByRole('complementary', { name: 'Proposal for Boat Audio' });
    for (const title of ['What we heard', 'Roadmap', 'Investment', 'Next step', 'Open questions']) expect(within(drafted).getByRole('region', { name: title })).toBeTruthy();
    expect(within(drafted).getByText('Waiting on you')).toBeTruthy();
    expect(within(drafted).getByText('Written by Chausar')).toBeTruthy();
    const investment = within(drafted).getByRole('region', { name: 'Investment' });
    const receiptButton = within(investment).getByRole('button', { name: /^Receipt/ });
    expect(receiptButton).toBeTruthy();
    expect(within(drafted).getByText('Please tell us [the day you would like to start].')).toBeTruthy();
    expect(within(drafted).queryByRole('button', { name: 'Open in mail' })).toBeNull();
    assertInkRules();

    // Today: the owner reads it, then approves.
    const queue = await request('venture.queue.list', {}) as QueueList;
    const row = queue.rows.find((item) => item.kind === 'proposal' && item.title === 'Proposal for Boat Audio is ready')!;
    expect(row.actions.map((action) => [action.id, action.primary, action.requiresView ?? false])).toEqual([['read', false, false], ['approve', true, true]]);
    expect((await request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' })).reason).toBe('VIEW_FIRST');
    const view = await request('venture.queue.view', { kind: 'file', id: row.viewRef!.id, opened: true });
    expect(view.sections.map((section) => section.heading)).toEqual(['What we heard', 'Roadmap', 'Investment', 'Next step', 'Open questions']);
    expect((await request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true })).line)
      .toBe('Approved. Open it in Clients to send it yourself; Chausar never sends it.');
    await settle();
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'Proposal for Boat Audio' })).getByText('Approved')).toBeTruthy());
    const approved = screen.getByRole('complementary', { name: 'Proposal for Boat Audio' });
    const mail = within(approved).getByRole('button', { name: 'Open in mail' });
    expect(mail.getAttribute('data-variant')).toBe('primary');
    expect(calls(spy, 'venture.outreach.open')).toEqual([]);
    assertInkRules();
  });

  it('words the engine\'s refusals in Hindi too: an unpriced offer, and a pilot that would be free', async () => {
    start({
      hash: '#/clients?sheet=proposal:client:c-boat', language: 'hi',
      stub: (method, params) => (method === 'venture.salesProposal.draft'
        ? new EngineError((params as { pilot?: boolean }).pilot ? 'PILOT_UNPRICED' : 'OFFER_UNPRICED', 'Set your price.')
        : undefined),
    });
    const sheet = await screen.findByRole('complementary', { name: 'एक प्रस्ताव' });
    await within(sheet).findByText('Sponsor slot');
    await press(within(sheet).getByRole('button', { name: 'प्रस्ताव का ड्राफ़्ट बनाएँ' }));
    expect(within(sheet).getByRole('alert').textContent).toBe('पहले इस ऑफ़र का दाम बिज़नेस, दाम में तय करें।');
    await press(within(sheet).getByRole('checkbox', { name: 'पहले इसे पैसे वाले पायलट की तरह दें' }));
    await press(within(sheet).getByRole('button', { name: 'प्रस्ताव का ड्राफ़्ट बनाएँ' }));
    expect(within(sheet).getByRole('alert').textContent).toBe('पायलट कभी मुफ़्त नहीं होता। पहले इस ऑफ़र का दाम बिज़नेस, दाम में तय करें।');
  });

  it('an ask outside what the business does drafts nothing: the engine\'s fixed reply, quoted, to copy', async () => {
    const reply = 'This is outside what we do. We can help with bookkeeping. For website, a web designer near you can help.';
    start({
      hash: '#/clients?sheet=proposal:client:c-boat',
      stub: (method) => (method === 'venture.salesProposal.draft' ? {
        id: null, at: null, to: 'Boat Audio', offerId: 'offer_sponsor', offerName: 'Sponsor slot', pilot: false, status: 'outside', sections: [], investment: [],
        placeholders: [], checks: [], author: 'template', line: 'This is outside what your business does, so nothing was drafted and Chausar will not follow up with them. Copy the reply if you want to answer.',
        exit: { verdict: 'outside', reply, rest: ['website'] }, digest: null, handoffs: null,
      } : undefined),
    });
    const sheet = await screen.findByRole('complementary', { name: 'A proposal' });
    await within(sheet).findByText('Sponsor slot');
    await press(within(sheet).getByRole('button', { name: 'Draft proposal' }));
    const shown = await screen.findByRole('complementary', { name: 'Proposal for Boat Audio' });
    expect(within(shown).getByText('Not drafted')).toBeTruthy();
    expect(within(shown).getByText('Outside what you do')).toBeTruthy();
    expect(within(shown).getByText(reply).closest('[data-content]')).toBeTruthy();
    expect(within(shown).getByRole('button', { name: 'Copy the reply' })).toBeTruthy();
    assertInkRules();
  });
});

describe('Business: Go or no go (5A2, M18)', () => {
  it('makes the card from what the owner types: Go, the most they could lose with its receipt, and Go spends nothing', async () => {
    const { spy } = start({ hash: '#/business/go-no-go' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Go or no go' })).toBeTruthy();
    expect(screen.getByText('No cards yet. Make one before you start something new.')).toBeTruthy();
    await type(screen.getByLabelText('What you are deciding'), 'A reels pack for gyms');
    await type(screen.getByLabelText('What it costs to start, in rupees'), '20,000');
    await type(screen.getByLabelText('What it costs each month, in rupees'), '5000');
    await type(screen.getByLabelText('How many months you will try it'), '3');
    await type(screen.getByLabelText('The most you are willing to lose, in rupees'), '50000.00');
    await press(screen.getByRole('button', { name: 'Make the card' }));
    expect(calls(spy, 'venture.goNoGo.card')).toEqual([{
      playbook: 'youtube', subject: 'A reels pack for gyms', inputs: { upfront: '20,000', monthly: '5000', months: '3', limit: '50000.00' },
    }]);
    const card = await screen.findByRole('region', { name: 'A reels pack for gyms' });
    expect(within(card).getByText('Go')).toBeTruthy();
    expect(within(card).getByText('The most you could lose is within your limit.')).toBeTruthy();
    expect(within(card).getByText('INR 35,000.00')).toBeTruthy();
    expect(within(card).getByRole('button', { name: receiptMark(/gonogo_/) })).toBeTruthy();
    expect(within(card).getByText('Go spends nothing: each spend still asks you.')).toBeTruthy();
    assertInkRules();
  });

  it('Hold names every answer missing; an amount the engine cannot read is refused in plain words', async () => {
    const { spy } = start({ hash: '#/business/go-no-go' });
    await type(await screen.findByLabelText('What you are deciding'), 'Product photos');
    await type(screen.getByLabelText('What it costs to start, in rupees'), 'twenty');
    await press(screen.getByRole('button', { name: 'Make the card' }));
    // The page reads nothing itself: the engine reads the rupees, and its refusal is worded here.
    expect(calls(spy, 'venture.goNoGo.card')[0]!.inputs).toEqual({ upfront: 'twenty', monthly: null, months: null, limit: null });
    expect(screen.getByRole('alert').textContent).toBe('Type each amount in rupees, like 20000.');
    await type(screen.getByLabelText('What it costs to start, in rupees'), '20000');
    await press(screen.getByRole('button', { name: 'Make the card' }));
    const card = await screen.findByRole('region', { name: 'Product photos' });
    expect(within(card).getByText('Hold')).toBeTruthy();
    expect(within(card).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['What it costs each month', 'How many months you will try it', 'The most you are willing to lose']);
    expect(within(card).queryByText('Go spends nothing: each spend still asks you.')).toBeNull();
    assertInkRules();
  });

  it('reads in Hindi', async () => {
    start({ hash: '#/business/go-no-go', language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'करें या न करें' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'कार्ड बनाएँ' })).toBeTruthy();
  });
});

describe('Business > Prices: a share is the advanced option, one step away (founder decision of 23 Oct)', () => {
  it('the fixed price stays first; the share waits in a fold, and saving it is a price change for Today', async () => {
    const { spy, request } = start({ hash: '#/business/prices' });
    const fold = (await screen.findByText('Charge a share')).closest('details')!;
    expect(fold.open).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Save price' }).length).toBeGreaterThan(0);
    assertInkRules();
    await press(within(fold).getByText('Charge a share'));
    await type(within(fold).getByLabelText('Share, in percent, for Sponsor slot'), '8.33');
    await press(within(fold).getByRole('button', { name: 'Save share' }));
    expect(calls(spy, 'venture.blueprint.update')).toEqual([{ patch: { offers: [{ id: 'offer_sponsor', share: { percent: '8.33' } }] } }]);
    const queue = await request('venture.queue.list', {}) as QueueList;
    const price = queue.rows.find((row) => row.kind === 'price' && row.change?.after.includes('%'))!;
    expect(price.change).toEqual({ label: 'Sponsor slot', before: expect.any(String), after: '8.33% of the amount your client confirms' });
    expect(price.actions.find((action) => action.id === 'approve')?.secondAsk).toBe(true);
    // The pending change above the cards, and the offer's card at rest, both say the share as the owner set it.
    await waitFor(() => expect(screen.getAllByText('8.33% of the amount your client confirms').length).toBe(2));
    // The offer's own card keeps the Ink rules (the pending change above it is Today's row, drawn as Today draws it).
    assertInkRules(screen.getByText('Sponsor slot', { selector: '[data-offer-name]' }).closest('li')!);
  });
});
