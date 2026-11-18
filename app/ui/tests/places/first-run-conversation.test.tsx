import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { skipAi } from './first-run-steps';

/**
 * About you is a conversation (founder, 14 Nov 2026). A follow-up used to send everything the owner had said as one
 * fresh read, so the AI rebuilt the plan: offers and agents renamed, facts dropped. Now a follow-up sends only the new
 * message, with what came before: the talk so far and the plan as the owner sees it (their own offer names, what they
 * unticked, the agents they left out). What the owner did on the card holds through the answer, whatever the AI says.
 * The name your AI proposes fills the Name box; a name the owner typed is never overwritten.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const MORE = 'I can make about 200 pieces a month and I am in Koregaon Park.';
const agent = (name: string, job: string, duties: string[], reads: string[]) => ({ name, job, duties, reads, digest: teamCardDigest({ name, job, duties, reads } as never) });
const TEAM = [
  agent('Mira', 'Keeps the pottery offer details in order.', ['Lists mug options', 'Tracks agreed order terms'], ['plan', 'notes']),
  agent('Dev', 'Prepares cafe prospect drafts.', ['Lists possible cafe leads'], ['clients', 'plan']),
  agent('Asha', 'Tracks customer follow-up activity.', ['Summarises order updates'], ['clients', 'orders']),
];
const OFFERS = [
  { name: 'Handmade cafe mugs', line: 'Hand-thrown mugs made for cafes.' },
  { name: 'Custom hotel tableware', line: 'Handmade bowls and mugs for a hotel.' },
  { name: 'Bulk pottery orders', line: 'Small-batch pottery made to an agreed design.' },
];
const WAY = {
  customer: 'Cafe and hotel owners in Pune who buy tableware in bulk.',
  reach: 'A list of cafes and hotels in Pune, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the pottery, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.'],
};
const FIRST = {
  family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' }, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: OFFERS, reply: 'You make pottery by hand and want bulk orders. How many pieces can you make a month?', way: WAY, team: TEAM, name: 'Pune Clay Studio',
};
const SECOND = {
  ...FIRST, idea: `${POTTER} ${MORE}`, reply: 'I added your capacity and Koregaon Park to how you earn. The plan looks ready to keep.',
  way: { ...WAY, youDo: 'Make up to about 200 pieces a month in Koregaon Park, set the prices and send each message.' },
};

type Call = [string, Record<string, unknown>];
function start(reads: unknown[]) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  let at = 0;
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(reads[Math.min(at++, reads.length - 1)]));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls, reads: () => calls.filter(([method]) => method === 'venture.about.read').map(([, params]) => params) };
}

async function plan() {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: POTTER } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  return keep;
}
async function say(words: string) {
  const box = screen.getByRole('textbox', { name: 'Message Chausar' });
  fireEvent.change(box, { target: { value: words } });
  await act(async () => { fireEvent.submit(box.closest('form')!); });
}
const nameBox = () => document.querySelector<HTMLInputElement>('[data-plan-name]')!;

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: a follow-up refines the plan', () => {
  it('sends only the new message, with the talk so far and the plan on the card', async () => {
    const run = start([FIRST, SECOND]);
    await plan();
    expect(run.reads()[0]).toEqual({ text: POTTER });
    await say(MORE);
    await waitFor(() => expect(run.reads()).toHaveLength(2));
    expect(run.reads()[1]).toEqual({
      text: MORE,
      before: {
        turns: [{ from: 'owner', text: POTTER }, { from: 'you', text: FIRST.reply }],
        plan: {
          familyId: 'creative', professionId: null, name: 'Pune Clay Studio',
          offers: OFFERS.map((offer) => ({ ...offer, kept: true, yours: false })),
          way: WAY,
          team: TEAM.map(({ digest: _digest, ...card }) => ({ ...card, left: false })),
        },
      },
    });
    // The answer lands in the same talk, and the card shows the refined plan.
    expect(await screen.findByText(SECOND.reply)).toBeTruthy();
    expect(screen.getByText(FIRST.reply)).toBeTruthy();
    expect(screen.getByText(SECOND.way.youDo)).toBeTruthy();
    for (const offer of OFFERS) expect(screen.getByRole('checkbox', { name: offer.name })).toBeTruthy();
    // A third message carries all four earlier turns.
    await say('Yes.');
    await waitFor(() => expect(run.reads()).toHaveLength(3));
    expect((run.reads()[2] as { text: string }).text).toBe('Yes.');
    expect((run.reads()[2] as { before: { turns: unknown[] } }).before.turns).toEqual([
      { from: 'owner', text: POTTER }, { from: 'you', text: FIRST.reply }, { from: 'owner', text: MORE }, { from: 'you', text: SECOND.reply },
    ]);
  });

  it('what the owner did on the card is told to the AI and holds through its answer', async () => {
    // The AI's second answer ignores every choice: it brings the unticked offer back and keeps all three agents.
    const run = start([FIRST, SECOND]);
    const keep = await plan();
    // The owner renames the first offer, unticks the second and leaves Dev out.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rename Handmade cafe mugs' })); });
    const edit = screen.getByRole('textbox', { name: 'Rename Handmade cafe mugs' });
    fireEvent.change(edit, { target: { value: 'Cafe mug sets' } });
    await act(async () => { fireEvent.keyDown(edit, { key: 'Enter' }); });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Custom hotel tableware' })); });
    const team = screen.getByRole('region', { name: 'Your team' });
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Leave Dev out' })); });
    await say(MORE);
    await waitFor(() => expect(run.reads()).toHaveLength(2));
    const sent = (run.reads()[1] as { before: { plan: { offers: unknown[]; team: { name: string; left: boolean }[] } } }).before.plan;
    expect(sent.offers).toEqual([
      { name: 'Cafe mug sets', line: OFFERS[0]!.line, kept: true, yours: true },
      { ...OFFERS[1], kept: false, yours: false },
      { ...OFFERS[2], kept: true, yours: false },
    ]);
    expect(sent.team.map((card) => [card.name, card.left])).toEqual([['Mira', false], ['Dev', true], ['Asha', false]]);
    await screen.findByText(SECOND.reply);
    // The unticked offer stays unticked, with its way back; Dev stays out, with his.
    expect(screen.getByText('Custom hotel tableware: removed.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Custom hotel tableware' })).toBeNull();
    const after = screen.getByRole('region', { name: 'Your team' });
    expect(within(after).getByText('Dev: left out.')).toBeTruthy();
    expect(within(after).getByRole('button', { name: 'Put Dev back' })).toBeTruthy();
    expect(keep.hasAttribute('disabled')).toBe(false);
  });

  it('an offer the AI drops stays on the card as removed when the owner had unticked it, so Undo is still there', async () => {
    const run = start([FIRST, { ...SECOND, offers: [OFFERS[0], OFFERS[2]] }]);
    await plan();
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Custom hotel tableware' })); });
    await say(MORE);
    await waitFor(() => expect(run.reads()).toHaveLength(2));
    await screen.findByText(SECOND.reply);
    expect(screen.getByText('Custom hotel tableware: removed.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(screen.getByRole('checkbox', { name: 'Custom hotel tableware' })).toBeTruthy();
  });

  it('a rename asked in the chat is still done by code, and the rest of that message goes on as a follow-up', async () => {
    const run = start([FIRST, SECOND]);
    await plan();
    await say('Call it Koregaon Clay, and add that I make 200 pieces a month');
    expect(await screen.findByText('Renamed it to Koregaon Clay.')).toBeTruthy();
    await waitFor(() => expect(run.reads()).toHaveLength(2));
    const next = run.reads()[1] as { text: string; before: { turns: { from: string; text: string }[]; plan: { name: string } } };
    expect(next.text).toBe('add that I make 200 pieces a month');
    expect(next.before.plan.name).toBe('Koregaon Clay');
    expect(next.before.turns.at(-1)).toEqual({ from: 'you', text: FIRST.reply });
  });
});

describe('first run: the name your AI proposes', () => {
  it('fills the Name box, and the plan is kept under it', async () => {
    start([FIRST]);
    await plan();
    await waitFor(() => expect(nameBox().value).toBe('Pune Clay Studio'));
  });

  it('a name the owner typed wins, and no follow-up overwrites it', async () => {
    const run = start([FIRST, { ...SECOND, name: 'Koregaon Park Pottery' }]);
    await plan();
    fireEvent.change(nameBox(), { target: { value: 'Asha Clay Works' } });
    await say(MORE);
    await waitFor(() => expect(run.reads()).toHaveLength(2));
    await screen.findByText(SECOND.reply);
    expect(nameBox().value).toBe('Asha Clay Works');
    expect((run.reads()[1] as { before: { plan: { name: string } } }).before.plan.name).toBe('Asha Clay Works');
  });

  it('a read with no name keeps the name the plan had', async () => {
    const { name: _name, ...bare } = FIRST;
    start([bare]);
    await plan();
    // The engine's own name for the idea (venture.preview), as before the AI named anything.
    await waitFor(() => expect(nameBox().value.length).toBeGreaterThan(1));
    expect(nameBox().value).not.toBe('Pune Clay Studio');
  });
});
