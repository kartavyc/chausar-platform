import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type DeliveryLite, type DraftPostLite, type MethodName, type ShareLink, type SocialCalendarFile } from '../../src/engine/types';

// Work, Ink v2 wave 2 package 2F2: the calendar file of a content calendar draft (venture.social.calendar). The engine
// builds the CSV from the approved draft and says which posts it left out and why; the screen saves the file exactly as
// it came, under the name the engine gave it, and shows the engine's words. No file is built in Ink.

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls, ...view };
}

/** Captures the file the page hands the owner: its name, type and exact text. */
function catchSaves() {
  const saved: { name: string; type: string; bytes: Promise<ArrayBuffer> }[] = [];
  let blob: Blob | null = null;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (value: Blob) => { blob = value; return 'blob:chausar/1'; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    if (blob) saved.push({ name: this.download, type: blob.type, bytes: blob.arrayBuffer() });
  });
  return saved;
}

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
});

const SOCIAL: DeliveryLite = {
  id: 'd-social', at: '2026-10-21T09:00:00.000Z', orderId: 'o-boat-14', status: 'accepted', practice: false,
  deliverable: { title: 'Posts for November' }, verdict: { choice: 'accepted', at: '2026-10-21T09:10:00.000Z' },
};
/** What the share list says the draft holds: older words than the engine's file, to show the screen never joins them. */
const STALE_POSTS: DraftPostLite[] = [
  { draftId: 'd-social.post-1', channel: 'linkedin', name: 'LinkedIn', connectorId: 'linkedin', text: 'Morning yoga, the old words.' },
  { draftId: 'd-social.post-2', channel: 'threads', name: 'Threads', connectorId: null, text: 'Breathe, the old words.' },
];
const approved: ShareLink['answer'] = { draftId: 'd-social', decision: 'approved', comment: null, at: '2026-10-21T11:00:00.000Z', via: 'owner-recorded' };
const link: ShareLink = { id: 'share-1', url: null, reason: 'Share links open only on the hosted Chausar with a public address.', expiresAt: '2026-10-28T09:00:00.000Z', answer: approved };
const CSV = '﻿date,channel,text,alt_text,owner_approved_at,client_approved_at\n2026-11-02,linkedin,"Morning yoga in Goa, slow and steady.",,2026-10-21T14:40+05:30,2026-10-21T16:30+05:30\n2026-11-03,x,"\'@asha thanks",,2026-10-21T14:40+05:30,2026-10-21T16:30+05:30\n';
const FILE: SocialCalendarFile = {
  csv: CSV, fileName: 'chausar-calendar-2026-11.csv', rows: 2,
  blocked: [{ draftId: 'd-social.post-3', name: 'Threads', text: 'Breathe first, then move.', line: 'This post has no slot in the calendar. Threads has no slots in this calendar, and the draft has 1 post for it.' }],
  defused: ['d-social.post-2'], threads: ['d-social.post-4'], gaps: ['Threads has no slots in this calendar, and the draft has 1 post for it.', 'LinkedIn has 3 slots and 2 posts.'],
};
const social = (calendar: () => unknown) => ({
  'venture.delivery.list': () => [SOCIAL],
  'venture.share.list': () => ({ links: [link], shares: [link], posts: STALE_POSTS }),
  'venture.social.calendar': calendar,
});

describe('Work: the calendar file', () => {
  it("saves the CSV the engine built, under the engine's name, and lists the posts it left out in the engine's words", async () => {
    const saved = catchSaves();
    const { calls } = start('#/work?order=o-boat-14', { intercept: social(() => FILE) });
    // The first render of the whole order (Ink v2 Work) can pass findBy's 1 s default on a loaded machine, so this
    // first wait allows 5 s; the later ones find a page already drawn.
    const region = await screen.findByRole('region', { name: 'Calendar file' }, { timeout: 5000 });
    expect(within(region).getByText('2 posts in the file, each on its date from the plan.')).toBeTruthy();
    const left = await within(region).findByRole('list', { name: 'Left out of the file' });
    // The left-out post's channel and words come from the engine's answer, never from another list.
    const row = within(left).getByText('Breathe first, then move.').closest('li')!;
    expect(row.textContent).toContain('Threads');
    expect(row.textContent).toContain('This post has no slot in the calendar. Threads has no slots in this calendar, and the draft has 1 post for it.');
    expect(region.textContent).not.toContain('the old words');
    expect(calls.filter((c) => c.method === 'venture.social.calendar').every((c) => JSON.stringify(c.params) === JSON.stringify({ runId: 'd-social' }))).toBe(true);
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Download the calendar file' })); });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('chausar-calendar-2026-11.csv');
    expect(saved[0]!.type).toBe('text/csv');
    // Byte for byte what the engine sent, the byte order mark first (Blob.text() would drop it).
    const bytes = new Uint8Array(await saved[0]!.bytes);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(CSV);
  });

  it('says what to do before posting from the file: the apostrophe, the threads, and where the draft and the plan differ', async () => {
    start('#/work?order=o-boat-14', { intercept: social(() => FILE) });
    const region = await screen.findByRole('region', { name: 'Calendar file' });
    expect(within(region).getByText('One post starts with a mark that spreadsheets treat as a formula, so the file adds an apostrophe in front of it. Remove the apostrophe before you post it.')).toBeTruthy();
    expect(within(region).getByText('One post is a thread. Post it by hand, part by part, in the order the file numbers the parts.')).toBeTruthy();
    const gaps = within(region).getByRole('list', { name: 'Where the draft and the plan differ' });
    expect(within(gaps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Threads has no slots in this calendar, and the draft has 1 post for it.', 'LinkedIn has 3 slots and 2 posts.']);
  });

  it('says nothing extra when no cell was changed, no post is a thread and the plan fits', async () => {
    start('#/work?order=o-boat-14', { intercept: social(() => ({ ...FILE, defused: [], threads: [], gaps: [] })) });
    const region = await screen.findByRole('region', { name: 'Calendar file' });
    expect(region.textContent).not.toContain('apostrophe');
    expect(region.textContent).not.toContain('thread');
    expect(within(region).queryByRole('list', { name: 'Where the draft and the plan differ' })).toBeNull();
  });

  it('with no post ready it says so and saves nothing', async () => {
    const saved = catchSaves();
    const empty: SocialCalendarFile = {
      csv: '﻿date,channel,text,alt_text,owner_approved_at,client_approved_at\n', fileName: 'chausar-calendar-2026-11.csv', rows: 0,
      blocked: [{ draftId: 'd-social.post-1', name: 'LinkedIn', text: 'Morning yoga in Goa, slow and steady.', line: 'Your client has not approved this draft.' }], defused: [], threads: [], gaps: [],
    };
    start('#/work?order=o-boat-14', { intercept: social(() => empty) });
    const region = await screen.findByRole('region', { name: 'Calendar file' });
    expect(within(region).getByText('No post is ready for the file yet.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Download the calendar file' })); });
    await waitFor(() => expect(within(region).getByRole('status').textContent).toBe('No post is ready for the file yet. Each post below says why.'));
    expect(saved).toHaveLength(0);
  });

  it('a draft with no calendar shows nothing; another refusal is said in the engine\'s words', async () => {
    const first = start('#/work?order=o-boat-14', { intercept: social(() => { throw new EngineError('CALENDAR_NO_SLOTS', 'This order has no calendar, so code planned no slots.'); }) });
    await screen.findByRole('region', { name: 'Preview for the client' });
    await waitFor(() => expect(first.calls.some((c) => c.method === 'venture.social.calendar')).toBe(true));
    expect(screen.queryByRole('region', { name: 'Calendar file' })).toBeNull();
    first.unmount();

    start('#/work?order=o-boat-14', { intercept: social(() => { throw new EngineError('DELIVERY_NOT_READY', 'This run has no draft yet. The calendar file comes from a draft you approved.'); }) });
    const region = await screen.findByRole('region', { name: 'Calendar file' });
    await waitFor(() => expect(within(region).getByRole('alert').textContent).toBe("Couldn't make the calendar file: This run has no draft yet. The calendar file comes from a draft you approved."));
  });

  it('in Hindi: the same place, heading, button and left-out list, in Hindi words', async () => {
    start('#/work?order=o-boat-14', { language: 'hi', intercept: social(() => FILE) });
    const region = await screen.findByRole('region', { name: 'कैलेंडर फ़ाइल' });
    expect(within(region).getByRole('button', { name: 'कैलेंडर फ़ाइल डाउनलोड करें' })).toBeTruthy();
    const left = within(region).getByRole('list', { name: 'फ़ाइल से बाहर रखी गई पोस्ट' });
    expect(within(left).getByText('Breathe first, then move.')).toBeTruthy();
    expect(region.textContent).not.toContain('Download the calendar file');
  });
});

describe('the fake engine answers the calendar file by the engine rules', () => {
  it('refuses a draft that is not a social one, and an unknown draft', async () => {
    const engine = new FakeEngine();
    await expect(engine.request('venture.social.calendar', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code: 'CALENDAR_NOT_A_SOCIAL_DRAFT' });
    await expect(engine.request('venture.social.calendar', { runId: 'd-missing' })).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND' });
  });
});
