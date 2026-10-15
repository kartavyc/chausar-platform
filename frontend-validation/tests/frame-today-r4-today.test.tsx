import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { frameTodayPlaces } from '../../app/ui/src/places/lane-frame-today';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, registerFakeMethods, type FakeEngine } from '../../app/ui/src/bridge/fake';
import { approvalsTodayFixture, DEMO_MONEY_ID, DEMO_REMINDER_IDS, phoneDocumentsFixture } from '../../app/ui/src/bridge/fixtures/today-r4';
import { isCashWeekReply, isCloseStatusReply, isTodayReviewReply } from '../../app/ui/src/bridge/todayx-contract';
import { projectRound4, round4Open } from '../../app/ui/src/host/today-round4';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import { GroupStepper } from '../../app/ui/src/screens/today/GroupStepper';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { withReceiptDetail, type ReceiptView } from '../../app/ui/src/bridge/receipt-view';

// Synthetic demo shop and replies only; nothing reaches a network.
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in these checks'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const undo of cleanups.splice(0)) undo(); });
  cleanup(); document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
function show(ui: ReactElement, language: Language = 'en') {
  return render(<TextProvider language={language}>{ui}</TextProvider>);
}
async function host(view: View, options: { scenario?: 'populated' | 'read-only'; pdf?: boolean } = {}) {
  const engine = createFakeEngine({ scenario: options.scenario ?? 'populated', today4: true });
  cleanups.push(registerFakeMethods('approvals', approvalsTodayFixture()));
  cleanups.push(registerFakeMethods('phone', phoneDocumentsFixture(options.pdf ? { mediaType: 'application/pdf' } : {})));
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  await waitFor(() => expect(document.querySelector('[data-region="page"]')).not.toBeNull(), { timeout: 5000 });
  return { engine, user: userEvent.setup(), page: () => document.querySelector('[data-region="page"]') as HTMLElement, sheet: () => document.querySelector('[data-region="sheet"]') as HTMLElement | null };
}
const reviewRow = async (page: () => HTMLElement, name: string | RegExp) => within(page()).findByRole('button', { name }, { timeout: 5000 });
async function openRow(h: Awaited<ReturnType<typeof host>>, name: string | RegExp) {
  await h.user.click(await reviewRow(h.page, name));
  await h.user.click(within(h.page()).getByRole('button', { name: 'Review' }));
}

/* ------------------------------------------------------------------ the fake's replies keep the contracts */

test('the fake serves the round 4 reads in their checked shapes, and only when asked to', async () => {
  const engine = createFakeEngine({ scenario: 'populated', today4: true });
  expect(isTodayReviewReply(await engine.request('todayx.review', {}))).toBe(true);
  expect(isCloseStatusReply(await engine.request('todayx.closeStatus', {}))).toBe(true);
  expect(isCashWeekReply(await engine.request('todayx.cash.week', {}))).toBe(true);
  const plain = createFakeEngine({ scenario: 'populated' });
  await expect(plain.request('todayx.review', {})).rejects.toMatchObject({ code: 'UNKNOWN_METHOD' });
  const viewer = createFakeEngine({ scenario: 'read-only', today4: true });
  const seen = await viewer.request('todayx.review', {}) as { items: unknown[]; waiting: string };
  expect(seen.items).toEqual([]); expect(seen.waiting).toBe('5');
});

/* ------------------------------------------------------------------ the review rows join */

test('Today joins approvals and the phone document beside the core rows, and the rail counts them', { timeout: 20000 }, async () => {
  const h = await host('guided');
  await within(h.page()).findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  const core = await h.engine.request('today.review', { limit: 4 }) as { count: number | null };
  expect(await reviewRow(h.page, /3 messages to send/)).toBeTruthy();
  // Five at rest in all: the core rows come first; the rail counts every item this seat may act on.
  const rail = document.querySelector('[data-region="rail"]') ?? document.body;
  await waitFor(() => expect(rail.textContent).toContain(String((core.count ?? 0) + 5)));
  expect(h.engine.calls).toContain('todayx.review');
});

test('a summary row opens one approval per item, one after another, each approved on its own', { timeout: 20000 }, async () => {
  const h = await host('guided');
  await within(h.page()).findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await openRow(h, /3 messages to send/);
  await waitFor(() => expect(h.sheet()?.textContent).toContain('1 of 3'), { timeout: 5000 });
  expect(h.sheet()!.textContent).toContain('Dear Kiran Retail Demo');
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(h.sheet()?.textContent).toContain('2 of 3'));
  expect(h.sheet()!.textContent).toContain('Dear Meera Stores Demo');
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(h.sheet()?.textContent).toContain('3 of 3'));
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(h.sheet()?.querySelector('[data-group-results]')).not.toBeNull());
  const outcomes = [...h.sheet()!.querySelectorAll('[data-group-results] li')].map(li => li.getAttribute('data-outcome'));
  expect(outcomes).toEqual(['approved', 'later', 'approved']);
  // One approval per item: never approved together.
  expect(h.engine.calls.filter(c => c === 'approvals.approve')).toHaveLength(2);
  expect(h.engine.calls).not.toContain('approvals.approveGroup');
  expect(h.engine.calls.filter(c => c === 'approvals.get').length).toBeGreaterThanOrEqual(3);
  void DEMO_REMINDER_IDS;
});

test('a single approval opens in Work, Approvals, here from the Books queue', { timeout: 20000 }, async () => {
  const h = await host('books');
  await h.user.click(await within(h.page()).findByRole('button', { name: 'Pay a supplier bill' }, { timeout: 5000 }));
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/work\/approvals\?sheet=writeback_cwb__demo__payment/));
  void DEMO_MONEY_ID;
});

/* ------------------------------------------------------------------ a document from the phone */

test('a document from the phone is a row to confirm: checked like a file, nothing stored before Confirm', { timeout: 20000 }, async () => {
  const h = await host('guided');
  await within(h.page()).findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await openRow(h, /Document from WhatsApp/);
  await waitFor(() => expect(h.sheet()?.textContent).toContain('Nothing is stored until you confirm'));
  expect(h.engine.calls).not.toContain('phone.documents.preview');
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Check it' }));
  await waitFor(() => expect(h.sheet()?.querySelector('[data-doc-preview="accepted"]')).not.toBeNull());
  expect(h.sheet()!.textContent).toContain('3 rows read, 0 left out');
  expect(h.engine.calls).not.toContain('sources.import');
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Confirm and bring in' }));
  await waitFor(() => expect(h.sheet()?.querySelector('[data-doc-done]')?.textContent).toBe('Brought in: 3 rows.'));
  expect(h.engine.calls.indexOf('sources.import')).toBeGreaterThan(h.engine.calls.indexOf('phone.documents.preview'));
});

test('a PDF from the phone says it cannot be checked here yet, and can be discarded', { timeout: 20000 }, async () => {
  const h = await host('guided', { pdf: true });
  await within(h.page()).findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await openRow(h, /Document from WhatsApp/);
  await h.user.click(await within(h.sheet()!).findByRole('button', { name: 'Check it' }));
  await waitFor(() => expect(h.sheet()?.querySelector('[data-doc-unavailable]')).not.toBeNull());
  await h.user.click(within(h.sheet()!).getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(h.sheet()?.querySelector('[data-doc-discarded]')).not.toBeNull());
  expect(h.engine.calls).not.toContain('sources.import');
});

/* ------------------------------------------------------------------ Books: the queue, the waiting line, the close */

test('Books draws the joined queue and the month close from the read model; a viewer sees what waits for the owner', { timeout: 20000 }, async () => {
  const h = await host('books');
  const table = await waitFor(() => { const found = [...h.page().querySelectorAll('table')].find(tb => tb.textContent?.includes('3 messages to send')); expect(found).toBeTruthy(); return found!; }, { timeout: 5000 });
  expect(table.textContent).toContain('Pay a supplier bill');
  expect(table.textContent).toContain('Document from WhatsApp');
  expect(h.page().textContent).not.toContain('The queue table is not built');
  await waitFor(() => expect(h.page().querySelector('[data-close-step="gstr2b"]')).not.toBeNull());
  const steps = ['bank', 'gstr2b', 'tds', 'trial-balance'].map(step => h.page().querySelector(`[data-close-step="${step}"]`)?.textContent ?? '');
  expect(steps[1]).toContain('Open');
  expect(h.page().textContent).toMatch(/August 2026 close/);
  cleanup(); for (const undo of cleanups.splice(0)) undo();

  const v = await host('books', { scenario: 'read-only' });
  await waitFor(() => expect(v.page().textContent).toContain('Waiting for the owner: 5 items'), { timeout: 5000 });
});

/* ------------------------------------------------------------------ Simple: today's cash */

test('Simple: today\'s cash is typed and saved as told by owner, and its bar fills', { timeout: 20000 }, async () => {
  const h = await host('simple');
  const field = await within(h.page()).findByRole('textbox', { name: /Today’s cash sales|Today's cash sales/ }, { timeout: 5000 });
  await h.user.type(field, '12,500');
  await h.user.click(within(h.page()).getByRole('button', { name: 'Enter' }));
  await waitFor(() => expect(h.engine.calls).toContain('todayx.cash.save'));
  const week = await h.engine.request('todayx.cash.week', {}) as { days: { paise: string | null }[] };
  expect(week.days[6]!.paise).toBe('1250000');
  await waitFor(() => expect(within(h.page()).getAllByText('₹12,500').length).toBeGreaterThan(0));
  // Told cash has no receipt: drawn as a figure with no receipt link, labelled told by owner.
  expect(within(h.page()).queryByRole('button', { name: /12,500/ })).toBeNull();
  expect(h.page().querySelector('[data-told]')?.textContent).toContain('told by owner');
});

test('Simple: cash that is not an amount keeps the typed text and says so; Devanagari digits are read as digits', { timeout: 20000 }, async () => {
  const h = await host('simple');
  const field = await within(h.page()).findByRole('textbox', { name: /Today’s cash sales|Today's cash sales/ }, { timeout: 5000 }) as HTMLInputElement;
  await h.user.type(field, 'twelve');
  await h.user.click(within(h.page()).getByRole('button', { name: 'Enter' }));
  await within(h.page()).findByText('Type the cash in rupees, like 12500.');
  expect(field.value).toBe('twelve');
  expect(h.engine.calls).not.toContain('todayx.cash.save');
  await h.user.clear(field);
  await h.user.type(field, '१२५००');
  await h.user.click(within(h.page()).getByRole('button', { name: 'Enter' }));
  await waitFor(() => expect(h.engine.calls).toContain('todayx.cash.save'));
  const week = await h.engine.request('todayx.cash.week', {}) as { days: { paise: string | null }[] };
  expect(week.days[6]!.paise).toBe('1250000');
});

test('Simple: a refused cash save keeps the typed text and says it was not saved', async () => {
  const user = userEvent.setup();
  const onSaveClosing = vi.fn(async () => 'failed' as const);
  const data = base({ cash: { week: { form: 'columns', sentence: 'Synthetic week', values: [] } } });
  show(<TodayScreen data={data} intents={{ onReview: vi.fn(), onReceipt: vi.fn(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  const field = screen.getByRole('textbox', { name: "Today's cash sales" }) as HTMLInputElement;
  await user.type(field, '8450');
  await user.click(screen.getByRole('button', { name: 'Enter' }));
  await screen.findByText('The cash was not saved. Try again.');
  expect(field.value).toBe('8450');
  onSaveClosing.mockImplementation(async () => 'saved' as const);
  await user.click(screen.getByRole('button', { name: 'Enter' }));
  await waitFor(() => expect(field.value).toBe(''));
  expect(screen.queryByText('The cash was not saved. Try again.')).toBeNull();
});

/* ------------------------------------------------------------------ grouped stepping: each refusal in its own words */

function stepper(approve: (call: number) => unknown) {
  const engine = createFakeEngine({ scenario: 'populated', today4: true });
  const fixture = approvalsTodayFixture();
  let calls = 0;
  cleanups.push(registerFakeMethods('approvals', { ...fixture, approve: (payload, context) => { calls++; const out = approve(calls); return out === undefined ? fixture['approve']!(payload, context) : (() => { throw out; })(); } }));
  show(<GroupStepper ids={[...DEMO_REMINDER_IDS]} title="3 messages to send" rpc={engine} language="en" viewer={false} origin={null}
    onClose={vi.fn()} onChanged={vi.fn()} onOpenInWork={vi.fn()} onReceipt={vi.fn()} />);
  return { engine, user: userEvent.setup() };
}
const refusal = (code: string) => Object.assign(new Error(code), { code });

test('grouped stepping: a changed preview is read again and shown, then approved on its own', { timeout: 20000 }, async () => {
  const s = stepper(call => call === 1 ? refusal('PREVIEW_CHANGED') : undefined);
  await screen.findByText(/Dear Kiran Retail Demo/, undefined, { timeout: 5000 });
  const gets = () => s.engine.calls.filter(c => c === 'approvals.get').length;
  const before = gets();
  await s.user.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('It changed since you opened it. This is the new version; read it before you approve.');
  expect(gets()).toBe(before + 1);
  expect(screen.queryByText('This item is no longer waiting.')).toBeNull();
  await s.user.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(document.body.textContent).toContain('2 of 3'));
});

test('grouped stepping: only a gone item says no longer waiting; any other refusal says it failed, and the summary says failed', { timeout: 20000 }, async () => {
  const s = stepper(call => call === 1 ? refusal('APPROVAL_EXPIRED') : call === 2 ? refusal('STORE_BUSY') : undefined);
  await screen.findByText(/Dear Kiran Retail Demo/, undefined, { timeout: 5000 });
  await s.user.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('This item is no longer waiting.');
  await s.user.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(document.body.textContent).toContain('2 of 3'));
  await s.user.click(await screen.findByRole('button', { name: 'Approve' }));
  await screen.findByText('This could not be done (STORE_BUSY). It is still waiting.');
  expect(screen.queryByText('This item is no longer waiting.')).toBeNull();
  await s.user.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(document.body.textContent).toContain('3 of 3'));
  await s.user.click(await screen.findByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(document.querySelector('[data-group-results]')).not.toBeNull());
  const outcomes = [...document.querySelectorAll('[data-group-results] li')].map(li => li.getAttribute('data-outcome'));
  expect(outcomes).toEqual(['gone', 'failed', 'approved']);
  expect(document.querySelector('[data-group-results]')!.textContent).toContain('This could not be done (STORE_BUSY). It is still waiting.');
});

/* ------------------------------------------------------------------ the closing switch */

test('the closing switch: an owner turns daily closing on from Today and the closing row appears', { timeout: 20000 }, async () => {
  const h = await host('guided');
  const row = await within(h.page()).findByRole('button', { name: /Daily closing/ }, { timeout: 5000 });
  expect(row.textContent).toContain('Off');
  expect(within(h.page()).queryByText('Close today: cash, bank, entries')).toBeNull();
  await h.user.click(row);
  await h.user.click(within(h.page()).getByRole('radio', { name: 'Yes' }));
  await waitFor(() => expect(h.engine.calls).toContain('todayx.closing.set'));
  await waitFor(() => expect(within(h.page()).getByText('Close today: cash, bank, entries')).toBeTruthy());
  cleanup(); for (const undo of cleanups.splice(0)) undo();
  const v = await host('guided', { scenario: 'read-only' });
  await within(v.page()).findByText('Today', undefined, { timeout: 5000 }).catch(() => null);
  expect(within(v.page()).queryByRole('button', { name: /Daily closing/ })).toBeNull();
});

/* ------------------------------------------------------------------ the projection, pure */

const base = (fields: Partial<TodayData> = {}): TodayData => ({ state: { kind: 'ready' }, date: 'Thursday, 15 October', review: { count: { exact: '2', display: '2' }, rows: [] }, ...fields });
test('the projection joins without duplicates, keeps an unknown count unknown, and draws every close part', () => {
  const engine = { items: [
    { id: 'action:a1', source: 'action', kind: 'record-change', tier: 'tier-1', title: 'Core one', touches: null, amountPaise: null, since: '2026-10-15T01:00:00.000Z', core: true },
    { id: 'bill:b1', source: 'bill', kind: 'record-change', tier: 'tier-1', title: 'Book a bill', touches: 'Zoho Books: Demo', amountPaise: '5000', since: '2026-10-15T01:00:00.000Z', core: false },
  ], groups: [], approvals: 'ready', documents: 'not-built', phoneDocuments: [], count: '1', waiting: '0' } as const;
  const reads = { review: engine, close: { month: '2026-09', parts: { bank: 'done', gstr2b: 'not-applicable', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' }, notApplicable: 'composition' } as const, cash: null };
  const context = { language: 'en' as const, view: 'guided' as const, role: 'owner' as const, navigate: vi.fn() };
  const coreRow = { id: 'review-0', mark: 'you' as const, what: 'Core one' };
  const joined = projectRound4(base({ review: { count: { exact: '2', display: '2' }, rows: [coreRow] } }), reads, context);
  expect(joined.review.rows.map(r => r.what)).toEqual(['Core one', 'Book a bill']);
  // Summary rows and documents lead, so the at-rest cut never hides what only Today opens.
  const led = projectRound4(base({ review: { count: { exact: '2', display: '2' }, rows: [coreRow] } }), { ...reads, review: { ...engine, groups: [{ id: 'group:bill:b2', ids: ['bill:b2', 'bill:b3'], source: 'bill', kind: 'record-change', count: '2', since: '2026-10-15T01:00:00.000Z' }],
    documents: 'ready', phoneDocuments: [{ documentId: 'doc_1', channel: 'telegram', mediaType: 'image/jpeg', receivedAt: '2026-10-15T02:00:00.000Z' }] } as never }, context);
  expect(led.review.rows.map(r => r.what)).toEqual(['2 bills to book', 'Document from Telegram', 'Core one', 'Book a bill']);
  expect(joined.review.count?.exact).toBe('3');
  expect(joined.close?.steps.map(st => [st.step, st.state])).toEqual([['bank', 'done'], ['gstr2b', 'not-applicable'], ['tds', 'not-loaded-yet'], ['trial-balance', 'not-loaded-yet']]);
  expect(joined.close?.steps[1]?.notApplicable).toBe('composition');
  expect(joined.closeMissing).toBeUndefined();
  // The core list unavailable: the core approval is joined, so none is lost.
  const unavailable = projectRound4(base({ review: { rows: [], scoped: { completeness: 'unavailable', count: null, knownCount: null, hasMore: false } } }), reads, context);
  expect(unavailable.review.rows.map(r => r.what)).toEqual(['Core one', 'Book a bill']);
  // A known core count but an unknown scoped count stays unknown.
  const unknown = projectRound4(base({ review: { rows: [coreRow], count: { exact: null, display: 'not known' }, scoped: { completeness: 'incomplete', count: null, knownCount: 1, hasMore: false } } }), reads, context);
  expect(unknown.review.count?.exact).toBeNull();
  expect(round4Open(engine as never, 'r4:approval:bill:b1')).toEqual({ kind: 'approval', id: 'bill:b1' });
  expect(round4Open(engine as never, 'r4:approval:bill:zz')).toBeNull();
  // Books: the joined items are the queue, not more ledger rows.
  const books = projectRound4(base({ queueMissing: 'unknown' }), reads, { ...context, view: 'books' });
  expect(books.queue?.map(q => q.what)).toEqual(['Book a bill']);
  expect(books.queueMissing).toBeUndefined();
  expect(books.review.rows).toEqual([]);
});

test('a receipt for a period with no cash told says cash sales are left out, not counted', () => {
  const view: ReceiptView = { receiptId: 'r1', workedOut: { calculation: 'Billed', rowsRead: { exact: '3', display: '3' }, totalChecked: true }, calculation: 'Billed', asKnownOn: '15 Oct 2026',
    rowsCounted: { exact: '3', display: '3' }, leftOut: [], totals: [], smallPrint: {} } as unknown as ReceiptView;
  const merged = withReceiptDetail(view, { receiptId: 'r1', allowedBy: { kind: 'read-access' }, cash: 'not-captured' },
    { language: 'en', timeZone: 'Asia/Kolkata', allowedByWords: { 'read-access': 'your read access', 'send-approved': 'sent' }, cashWords: { reason: 'cash sales not captured', rows: 'not counted' } });
  expect(merged.leftOut).toEqual([{ reason: 'cash sales not captured', rows: { exact: null, display: 'not counted' } }]);
});

/* ------------------------------------------------------------------ Activity by job and record */

test('Activity filters by record and by job, each asking the engine again', async () => {
  const address: Address = { place: 'today', sub: 'activity' };
  const events = [
    { id: 'e1', at: '2026-10-14T06:05:00Z', type: 'job.step', state: 'done', actor: { kind: 'job', name: null }, values: { job: 'job_demo_brief' }, costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } },
    { id: 'e2', at: '2026-10-14T06:00:00Z', type: 'import.done', state: 'done', actor: { kind: 'you', name: null }, values: { source: 'source_tally_demo', rows: '4' }, costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } },
  ];
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    if (method === 'ui.context') throw Object.assign(Error('x'), { code: 'UNKNOWN_METHOD' });
    const shown = events.filter(e => (payload['job'] === undefined || e.values['job'] === payload['job']) && (payload['record'] === undefined || e.values['source'] === payload['record']));
    return { events: shown, nextCursor: null, total: String(shown.length) };
  });
  const props: PlaceRenderProps = { address, language: 'en', view: 'guided', member: { id: 'm', role: 'owner' }, viewer: false, rpc: { request }, live: () => true, openReceipt: vi.fn(), navigate: vi.fn() };
  show(<>{frameTodayPlaces.find((m) => m.handles(address))!.render(props)}</>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'source_tally_demo' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('todayx.activity', { record: 'source_tally_demo' }));
  await user.click(screen.getByRole('radio', { name: 'All records' }));
  await user.click(await screen.findByRole('radio', { name: 'job_demo_brief' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('todayx.activity', { job: 'job_demo_brief' }));
});

test('Activity in Simple: a job or record filter counts as set, so the folded filters open on it', async () => {
  const address: Address = { place: 'today', sub: 'activity' };
  const events = [
    { id: 'e1', at: '2026-10-14T06:05:00Z', type: 'job.step', state: 'done', actor: { kind: 'job', name: null }, values: { job: 'job_demo_brief' }, costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } },
  ];
  const request = vi.fn(async (method: string) => {
    if (method === 'ui.context') throw Object.assign(Error('x'), { code: 'UNKNOWN_METHOD' });
    return { events, nextCursor: null, total: String(events.length) };
  });
  const props = (view: View): PlaceRenderProps => ({ address, language: 'en', view, member: { id: 'm', role: 'owner' }, viewer: false, rpc: { request }, live: () => true, openReceipt: vi.fn(), navigate: vi.fn() });
  const place = frameTodayPlaces.find((m) => m.handles(address))!;
  const shown = show(<>{place.render(props('guided'))}</>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'job_demo_brief' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('todayx.activity', { job: 'job_demo_brief' }));
  shown.rerender(<TextProvider language="en">{place.render(props('simple'))}</TextProvider>);
  const fold = await waitFor(() => { const found = document.querySelector('details'); expect(found).not.toBeNull(); return found!; });
  expect(fold.open).toBe(true);
});

/* ------------------------------------------------------------------ the switch is hidden without its intent */

test('without the switch intent no settings row is drawn; with it the row names the current choice', () => {
  const closing = { on: true, day: '2026-10-15', parts: { cash: 'not-loaded-yet', bank: 'done', entries: 'not-done' } } as const;
  const intents = (extra: Partial<TodayIntents> = {}): TodayIntents => ({ onReview: vi.fn(), onReceipt: vi.fn(), ...extra });
  show(<TodayScreen data={base({ closing })} intents={intents()} view="guided" onNavigate={vi.fn()} />);
  expect(document.querySelector('[data-closing-switch]')).toBeNull();
  cleanup();
  show(<TodayScreen data={base({ closing })} intents={intents({ onSetClosing: vi.fn() })} view="books" onNavigate={vi.fn()} />, 'hi');
  expect(document.querySelector('[data-closing-switch]')?.textContent).toContain('चालू');
});
