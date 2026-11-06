import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * Today's team at work with the engine's departments (Ink v2 wave 4, package 4A2): every story and live tile carries
 * its agent's department, as a tint, a badge and, on a live tile, the department's name; Keeper is a story like any
 * agent; "Add agent" leads to the ways to earn.
 */

function start() {
  window.location.hash = '#/today';
  render(<ClockProvider now={() => new Date(2026, 9, 23, 19, 5)}><App client={createFakeClient(new FakeEngine())} language="en" /></ClockProvider>);
}

describe('Today w4: the team at work by department', () => {
  it('stories and live tiles carry the department: the tint, the badge and the name; Keeper is a story; Add agent leads to the ways to earn', async () => {
    start();
    const team = await screen.findByRole('region', { name: 'Team at work' });
    const stories = within(team).getByRole('list', { name: 'Your agents' });
    await waitFor(() => expect(within(stories).getByRole('button', { name: 'Keeper, idle' })).toBeTruthy());
    const dept = (name: RegExp) => within(stories).getByRole('button', { name }).querySelector('[data-dept]')?.getAttribute('data-dept');
    expect(dept(/^Editor/)).toBe('prod');
    expect(dept(/^Producer/)).toBe('sales');
    expect(dept(/^Researcher/)).toBe('mkt');
    expect(dept(/^Keeper/)).toBe('ops');
    expect(within(stories).getByRole('button', { name: /^Editor/ }).querySelector('[data-badge][data-dept="prod"]')).not.toBeNull();

    await waitFor(() => expect(within(team).getAllByRole('article')).toHaveLength(3));
    const [editor, researcher, producer] = within(team).getAllByRole('article');
    expect(editor!.querySelector('[data-tile-dept]')?.textContent).toBe('Production');
    expect(editor!.querySelector('[data-tile-dept]')?.getAttribute('data-dept')).toBe('prod');
    expect(researcher!.querySelector('[data-tile-dept]')?.textContent).toBe('Marketing');
    expect(producer!.querySelector('[data-tile-dept]')?.textContent).toBe('Sales and clients');
    expect(editor!.querySelector('[aria-hidden="true"][data-dept="prod"]')).not.toBeNull();

    const add = within(stories).getByRole('button', { name: 'Add agent' });
    await act(async () => { fireEvent.click(add); });
    expect(window.location.hash).toBe('#/onboarding');
    assertInkRules(document.body);
    assertOnePrimary(document.body);
  });
});

/*
 * Today's follow-up and reply cards and the notes after a call (Ink v2 wave 4, package 4E4, from the engine's 4E1 and
 * 4E3): the card layout with the handoff as the primary and "I sent it"; a reply that waits on the owner, with "Reply
 * in Mail" to the address it came from; "Add notes" opening the notes sheet, whose next steps are raised to Today, and
 * a next step with no day in the notes asking for the day as Approve's answer. The fake's sample is dated from its first
 * moment; its clock then moves on. Only these rows are on Today here (the sample queue is left out).
 */

type Fake = ReturnType<typeof createFakeClient>;
const FRIDAY = '2026-10-23T10:00:00.000Z';
const THURSDAY = '2026-10-29T10:00:00.000Z';

async function startOutreach(options: { prepare?: (client: Fake) => Promise<void>; language?: 'en' | 'hi' } = {}) {
  window.location.hash = '#/today';
  const clock = { now: FRIDAY };
  const fake = createFakeClient(new FakeEngine({ now: () => clock.now, queue: [] }));
  clock.now = THURSDAY;
  await options.prepare?.(fake);
  const spy = vi.spyOn(fake, 'request');
  render(<ClockProvider now={() => new Date(clock.now)}><App client={fake} language={options.language ?? 'en'} /></ClockProvider>);
  return { client: fake, spy };
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await settle(); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];
const cardTitled = async (title: string | RegExp) => (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;
const mailbox = async (client: Fake) => {
  await client.request('venture.mailbox.connect', { host: 'imap.zoho.in', port: 993, user: 'owner@lumen.example', appPassword: 'abcd efgh ijkl mnop' });
  await client.request('venture.mailbox.sync', {});
};
const calendar = async (client: Fake) => { await client.request('venture.network.calendar', { url: 'https://calendar.google.com/calendar/ical/owner/private-abc/basic.ics' }); };

function desktopOpen() {
  const open = vi.fn(async (_url: string) => {});
  (window as Window & { chausar?: unknown }).chausar = { openExternal: open };
  return open;
}
afterEach(() => { delete (window as Window & { chausar?: unknown }).chausar; });

describe('Today w4: follow-ups, replies and notes after a call (4E4)', () => {
  it('a late follow-up is a card in Today\'s own words, its handoff the primary, with I sent it beside it', async () => {
    const open = desktopOpen();
    const { spy } = await startOutreach();
    const card = await cardTitled('Follow up with Tara Iyer');
    expect(card.textContent).toContain('Tara Iyer, Kettle Audio: follow-up is 2 days late. Nudge drafted for Mail.');
    expect(card.querySelector('[data-kind]')?.textContent).toBe('Follow-up');
    const primary = within(card).getByRole('button', { name: 'Open in Mail' });
    expect(primary.dataset.variant).toBe('primary');
    assertOnePrimary(document.body);
    await press(primary);
    // The handoff is not a decision: it opens the owner's mail app and the card stays.
    expect(calls(spy, 'venture.queue.decide')).toHaveLength(0);
    expect(open.mock.calls[0]![0]).toMatch(/^mailto:tara@kettleaudio\.example\?subject=Following%20up/);
    expect(within(card).getByRole('status').textContent).toContain('counts only the notes you mark as sent');
    await press(within(card).getByRole('button', { name: 'I sent it' }));
    expect(calls(spy, 'venture.queue.decide').at(-1)![1]).toMatchObject({ action: 'sent' });
    await waitFor(() => expect(screen.getByText(/Recorded\. Next follow-up/)).toBeTruthy());
    assertInkRules(document.body);
  });

  it('a follow-up reads in Hindi from its parts', async () => {
    await startOutreach({ language: 'hi' });
    const card = await cardTitled('Tara Iyer से दोबारा बात करें');
    expect(card.textContent).toContain('2 दिन देर');
    expect(within(card).getByRole('button', { name: 'मेल में खोलें' })).toBeTruthy();
  });

  it('a reply that asks about pricing opens the owner\'s mail to reply, and a match Chausar is unsure of asks', async () => {
    const open = desktopOpen();
    const { spy } = await startOutreach({ prepare: mailbox });
    const pricing = await cardTitled('Tara asked about pricing. Reply yourself.');
    expect(pricing.querySelector('[data-kind]')?.textContent).toBe('Reply');
    await press(within(pricing).getByRole('button', { name: 'Reply in Mail' }));
    expect(open.mock.calls[0]![0]).toBe('mailto:tara@kettleaudio.example?subject=Re%3A%20Following%20up');
    expect(calls(spy, 'venture.queue.decide')).toHaveLength(0);
    const unsure = await cardTitled('Is this from Kabir about Kettle Audio?');
    await press(within(unsure).getByRole('button', { name: 'Yes, it is' }));
    expect(calls(spy, 'venture.queue.decide').at(-1)![1]).toMatchObject({ action: 'approve' });
    await waitFor(() => expect(screen.getByText(/Attached to Kabir Sethi's card\./)).toBeTruthy());
  });

  it('Add notes opens the notes sheet; the steps come back drafted and one is raised to Today, asking for its day', async () => {
    const { spy } = await startOutreach({ prepare: calendar });
    const notice = await cardTitled('Add notes from your call with Kabir?');
    await press(within(notice).getByRole('button', { name: 'Add notes' }));
    expect(window.location.hash).toBe('#/today?sheet=call-notes%3Acalevent_kabir');
    const sheet = await screen.findByRole('complementary', { name: 'Notes from your call' });
    fireEvent.change(within(sheet).getByLabelText('Your notes'), { target: { value: 'Kabir liked the mic reviews.\nSend Kabir the rate card.' } });
    await press(within(sheet).getByRole('button', { name: 'Draft next steps' }));
    expect(calls(spy, 'venture.meeting.digest').at(-1)![1]).toEqual({ eventId: 'calevent_kabir', notes: 'Kabir liked the mic reviews.\nSend Kabir the rate card.' });
    expect(within(sheet).getAllByRole('status')[0]!.textContent).toBe('Drafted 1 proposal from your notes. Raise each to Today to approve it.');
    expect(sheet.textContent).toContain('No day was written in your notes, so you choose it when you approve.');
    await press(within(sheet).getByRole('button', { name: 'Raise to Today' }));
    expect(within(sheet).getByText('On Today for your approval.')).toBeTruthy();
    const step = await cardTitled('Next step for Kabir Sethi: Send Kabir the rate card');
    expect(step.textContent).toContain('Pick the day, then approve.');
    await press(within(step).getByRole('button', { name: 'Approve' }));
    const day = within(step).getByLabelText('The day') as HTMLInputElement;
    expect(day.type).toBe('date');
    expect(calls(spy, 'venture.queue.decide')).toHaveLength(0);
    fireEvent.change(day, { target: { value: '2026-11-02' } });
    await press(within(step).getByRole('button', { name: 'Approve' }));
    expect(calls(spy, 'venture.queue.decide').at(-1)![1]).toMatchObject({ action: 'approve', answer: '2026-11-02' });
  });
});

describe('Today w4: opt-outs, dead domains and the notes consent (4E4 review)', () => {
  const readTwice = async (client: Fake) => { await mailbox(client); await client.request('venture.mailbox.sync', {}); };

  it('an opt-out the mail cannot prove asks to block her other address and close her card, in Hindi too', async () => {
    const { spy } = await startOutreach({ prepare: readTwice });
    const card = await cardTitled('Tara asked not to be contacted. Block tara@kettleaudio.example and close the card too?');
    expect(card.textContent).toContain('Tara asked not to be contacted from tara.iyer@gmail.com. Blocked tara.iyer@gmail.com. Mail of');
    expect(within(card).getByRole('button', { name: 'Not now' })).toBeTruthy();
    await press(within(card).getByRole('button', { name: 'Block and close' }));
    expect(calls(spy, 'venture.queue.decide').at(-1)![1]).toMatchObject({ action: 'approve' });
    await waitFor(() => expect(screen.getByText(/Blocked tara@kettleaudio\.example and closed the card as Lost\./)).toBeTruthy());
  });

  it('once blocked, Tara cannot be added again, and no draft or handoff reaches her; her closed card says so', async () => {
    const { client } = await startOutreach({ prepare: readTwice });
    const card = await cardTitled('Tara asked not to be contacted. Block tara@kettleaudio.example and close the card too?');
    await press(within(card).getByRole('button', { name: 'Block and close' }));
    await waitFor(() => expect(screen.getByText(/Blocked tara@kettleaudio\.example and closed the card as Lost\./)).toBeTruthy());
    const refused = async (method: string, payload: unknown) => {
      try { await (client.request as (m: string, p: unknown) => Promise<unknown>)(method, payload); } catch (error) { return error as EngineError; }
      throw new Error(`${method} was not refused`);
    };
    const add = await refused('venture.pipeline.add', { personId: 'person_tara', trigger: { kind: 'owner' } });
    expect([add.code, add.message]).toEqual(['PIPELINE_BLOCKED', 'This person asked not to be contacted, or is on your blocklist.']);
    const intro = await refused('venture.outreach.draft', { opportunityId: 'opp_seed_kabir', kind: 'intro-request', channel: 'email' });
    expect([intro.code, intro.message]).toEqual(['OUTREACH_BLOCKED', 'Tara Iyer asked not to be contacted, or is on your blocklist.']);
    const board = await client.request('venture.pipeline.list', {}) as { columns: { cards: { id: string; draftId?: string | null; blocked?: string }[] }[] };
    const cards = board.columns.flatMap((column) => column.cards);
    const kabir = cards.find((item) => item.id === 'opp_seed_kabir')!;
    const handoff = await refused('venture.outreach.open', { draftId: kabir.draftId });
    expect([handoff.code, handoff.message]).toEqual(['OUTREACH_BLOCKED', 'Tara Iyer asked not to be contacted, or is on your blocklist.']);
    expect(cards.find((item) => item.id === 'opp_seed_tara')!.blocked).toBe('This person asked not to be contacted, or is on your blocklist.');
  });

  it('a dead free-mail domain asks before blocking it whole, with the warning', async () => {
    await startOutreach({ prepare: readTwice });
    const card = await cardTitled('rediffmail.com takes no mail. Block the whole domain?');
    expect(card.textContent).toContain('rediffmail.com is a free mail service many people use. Blocking it blocks all of them.');
    await press(within(card).getByRole('button', { name: 'Only the address' }));
    await waitFor(() => expect(screen.getByText(/Only the address stays blocked\. The domain is not\./)).toBeTruthy());
  });

  it('the opt-out and domain answers read in Hindi', async () => {
    await startOutreach({ prepare: readTwice, language: 'hi' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'रोकें और बंद करें' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'पूरा डोमेन रोकें' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'सिर्फ़ यह पता' })).toBeTruthy();
  });

  it('a follow-up card shows no time, since its time is only its due day', async () => {
    await startOutreach();
    const card = await cardTitled('Follow up with Tara Iyer');
    expect(card.querySelector('[data-meta] .mono')).toBeNull();
  });

  it('the notes sheet shows the consent words before Agree, and sends that consent\'s digest', async () => {
    window.location.hash = '#/today?sheet=call-notes:calevent_kabir';
    const clock = { now: FRIDAY };
    const fake = createFakeClient(new FakeEngine({ now: () => clock.now, queue: [] }));
    clock.now = THURSDAY;
    await calendar(fake);
    const base = fake.request.bind(fake) as (m: string, p?: unknown) => Promise<unknown>;
    let agreed = false;
    fake.request = (async (m: string, p?: Record<string, unknown>) => {
      if (m === 'venture.meeting.digest' && !agreed) throw new EngineError('CHAT_CONSENT_REQUIRED', 'Agree first.');
      if (m === 'venture.network.people') return { ...(await base(m, p) as object), consent: { state: 'needed', text: 'Your notes go to your own AI to be read. Nothing is sent anywhere else.', digest: 'consent-d1', at: null } };
      if (m === 'venture.chats.consent') { agreed = true; return { state: 'given', text: null, digest: p?.digest, at: THURSDAY }; }
      return base(m, p);
    }) as EngineClient['request'];
    const spy = vi.spyOn(fake, 'request');
    render(<ClockProvider now={() => new Date(clock.now)}><App client={fake} language="en" /></ClockProvider>);
    const sheet = await screen.findByRole('complementary', { name: 'Notes from your call' });
    fireEvent.change(within(sheet).getByLabelText('Your notes'), { target: { value: 'Send Kabir the rate card.' } });
    await press(within(sheet).getByRole('button', { name: 'Draft next steps' }));
    expect(sheet.querySelector('[data-consent]')?.textContent).toBe('Your notes go to your own AI to be read. Nothing is sent anywhere else.');
    await press(within(sheet).getByRole('button', { name: 'I agree' }));
    expect(calls(spy, 'venture.chats.consent').at(-1)![1]).toEqual({ digest: 'consent-d1' });
    await waitFor(() => expect(within(sheet).getAllByRole('status')[0]!.textContent).toMatch(/^Drafted 1 proposal/));
  });
});
