import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, ColumnsChart, FigureOrMissing, Language, RowItem } from '../../app/ui/src/app/presentation';
import { frameTodayPlaces } from '../../app/ui/src/places/lane-frame-today';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import type { ActivityEvent, ActivityReply, PhoneMessagesReply, WorthReply } from '../../app/ui/src/bridge/todayx-contract';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { PhoneLinkPage, PhoneMessages, PhoneMessagesFromEngine } from '../../app/ui/src/screens/today/PhoneMessages';
import columnStyles from '../../app/ui/src/parts/charts/charts.module.css';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Synthetic events, rows and replies only. Every name ends in Demo.
afterEach(cleanup);

function show(ui: ReactElement, language: Language = 'en') {
  return render(<TextProvider language={language}>{ui}</TextProvider>);
}

/* ------------------------------------------------------------------ activity */

const ev = (id: string, fields: Partial<ActivityEvent> & Pick<ActivityEvent, 'type' | 'state'>): ActivityEvent => ({
  id, at: '2026-10-14T06:05:00Z', actor: { kind: 'chausar', name: null }, values: {}, costPaise: null, route: null, tainted: false,
  proof: { kind: 'none', id: null }, ...fields,
});
const MODEL = ev('e1', { type: 'model.request', state: 'done', costPaise: '1250', route: 'Claude Demo route', proof: { kind: 'model-request', id: 'mr-1' } });
const UNKNOWN = ev('e2', { type: 'action.unknown', state: 'unsure', actor: { kind: 'you', name: null }, values: { action: 'invoice.create', opens: '#/work/approvals' }, proof: { kind: 'action', id: 'act-1' } });
const RECEIPT = ev('e3', { type: 'answer.receipt', state: 'done', actor: { kind: 'person', name: 'Meera Demo' }, proof: { kind: 'receipt', id: 'R-77' } });
const TAINTED = ev('e4', { type: 'source.read', state: 'waiting-for-network', at: '2026-10-13T09:00:00Z', actor: { kind: 'job', name: 'Morning brief Demo' }, values: { source: 'Bank Demo' }, tainted: true });
const WAITING = ev('e6', { type: 'action.prepared', state: 'waiting-for-you', values: { action: 'payment.record' }, proof: { kind: 'action', id: 'act-2' } });
const LOCKED = ev('e5', { type: 'lock', state: 'stopped-by-rule', at: '2026-10-12T22:00:00Z' });
const FIRST_PAGE = [MODEL, UNKNOWN, RECEIPT, WAITING, TAINTED];

type Handler = (payload: Record<string, unknown>) => unknown;
const pages: Handler = (payload) => {
  if (payload['cursor'] === 'c2') return { events: [LOCKED], nextCursor: null, total: '6' } satisfies ActivityReply;
  const events = FIRST_PAGE.filter((e) => (payload['state'] === undefined || e.state === payload['state'])
    && (payload['day'] === undefined || e.at.startsWith(String(payload['day']))));
  const filtered = Object.keys(payload).length > 0;
  return { events, nextCursor: filtered ? null : 'c2', total: '6' } satisfies ActivityReply;
};

/** A checked `ui.context` naming the business zone; the activity page reads it for its times. */
const CONTEXT_DEMO = {
  workspace: { id: 'workspace-demo', name: 'Demo shop', demo: true },
  member: { id: 'member-demo', name: 'Asha Demo', role: 'owner', epoch: 1, branches: ['*'] },
  contextKey: 'a'.repeat(64), timeZone: 'Asia/Kolkata',
};

function activity(handler: Handler, { viewer = false, language = 'en' as Language } = {}) {
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    if (method === 'ui.context') return CONTEXT_DEMO;
    expect(method).toBe('todayx.activity');
    return handler(payload);
  });
  const address: Address = { place: 'today', sub: 'activity' };
  const module = frameTodayPlaces.find((m) => m.handles(address));
  if (module === undefined) throw new Error('frame-today must draw today/activity');
  const props: PlaceRenderProps = {
    address, language, view: 'guided', member: { id: 'member-demo', role: viewer ? 'viewer' : 'owner' }, viewer,
    rpc: { request }, live: () => true, openReceipt: vi.fn<(id: string) => void>(), navigate: vi.fn<(a: Address | null) => void>(),
  };
  show(<>{module.render(props)}</>, language);
  return { request, props };
}

test('the activity module draws only today/activity', () => {
  const module = frameTodayPlaces[0]!;
  expect(module.handles({ place: 'today', sub: 'activity' })).toBe(true);
  expect(module.handles({ place: 'today' })).toBe(false);
  expect(module.handles({ place: 'work', sub: 'activity' })).toBe(false);
});

test('activity draws one sentence per typed event, newest first, with route, cost, who, taint and the five states', async () => {
  const { request } = activity(pages);
  await screen.findByText('A request went to the AI model by Claude Demo route.');
  expect(request).toHaveBeenCalledWith('todayx.activity', {});
  const lines = screen.getAllByRole('listitem').filter((li) => li.closest('ol') !== null);
  expect(lines.map((li) => li.textContent ?? '')[0]).toContain('A request went to the AI model by Claude Demo route.');
  expect(screen.getByRole('button', { name: '₹12.50' })).toBeTruthy();
  expect(screen.getByText('Bank Demo was read. (read outside text)', { exact: false })).toBeTruthy();
  expect(screen.getByText('Not sure what happened: invoice.create. It is checked before any retry.', { exact: false })).toBeTruthy();
  expect(screen.getAllByText('by Meera Demo').length).toBe(1);
  expect(screen.getAllByText('by Morning brief Demo').length).toBe(1);
  expect(screen.getByText('Events in all: 6')).toBeTruthy();
  for (const words of ['done', 'not sure what happened', 'waiting for the network', 'waiting for you']) expect(screen.getAllByText(words).length).toBeGreaterThan(0);
  expect(screen.getAllByText('14 Oct 2026, 11:35').length).toBe(4);
  expect(screen.getByText('13 Oct 2026, 14:30')).toBeTruthy();
});

test('activity filters by state, person and day, each through rpc', async () => {
  const user = userEvent.setup();
  const { request } = activity(pages);
  await screen.findByText('Prepared: payment.record.');
  const stateGroup = screen.getByRole('radiogroup', { name: 'State' });
  await user.click(within(stateGroup).getByRole('radio', { name: 'waiting for you' }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith('todayx.activity', { state: 'waiting-for-you' }));
  await waitFor(() => expect(screen.queryByText('A request went to the AI model by Claude Demo route.')).toBeNull());
  expect(screen.getByText('Prepared: payment.record.')).toBeTruthy();
  await user.click(within(stateGroup).getByRole('radio', { name: 'All' }));
  await screen.findByText('A request went to the AI model by Claude Demo route.');
  await user.click(within(screen.getByRole('radiogroup', { name: 'Person' })).getByRole('radio', { name: 'Meera Demo' }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith('todayx.activity', { actor: 'Meera Demo' }));
  await user.click(within(screen.getByRole('radiogroup', { name: 'Day' })).getByRole('radio', { name: '13 Oct 2026' }));
  await waitFor(() => expect(request).toHaveBeenLastCalledWith('todayx.activity', { actor: 'Meera Demo', day: '2026-10-13' }));
});

test('activity pages with Show more and the engine cursor, keeping the lines already read', async () => {
  const user = userEvent.setup();
  const { request } = activity(pages);
  await screen.findByText('A request went to the AI model by Claude Demo route.');
  await user.click(screen.getByRole('button', { name: 'Show more' }));
  await screen.findByText('Chausar was locked.');
  expect(request).toHaveBeenLastCalledWith('todayx.activity', { cursor: 'c2' });
  expect(screen.getByText('A request went to the AI model by Claude Demo route.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});

test('each line opens its proof: a receipt, an address, or a sheet with the record id', async () => {
  const user = userEvent.setup();
  const { props } = activity(pages);
  await screen.findByText('A request went to the AI model by Claude Demo route.');
  await user.click(screen.getByRole('button', { name: /An answer was worked out with its receipt/ }));
  expect(props.openReceipt).toHaveBeenCalledWith('R-77');
  await user.click(screen.getByRole('button', { name: /Not sure what happened: invoice.create/ }));
  expect(props.navigate).toHaveBeenCalledWith({ place: 'work', sub: 'approvals' });
  await user.click(screen.getByRole('button', { name: /A request went to the AI model/ }));
  expect(await screen.findByText('Record id mr-1')).toBeTruthy();
  expect(screen.getByText('Route Claude Demo route')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^Close/ }));
  await waitFor(() => expect(screen.queryByText('Record id mr-1')).toBeNull());
  // The cost opens the same proof as its line.
  await user.click(screen.getByRole('button', { name: '₹12.50' }));
  expect(await screen.findByText('Record id mr-1')).toBeTruthy();
  expect(props.openReceipt).toHaveBeenCalledTimes(1);
});

test('activity shows not built yet when the engine method does not exist', async () => {
  activity(() => { throw Object.assign(new Error('no such method'), { code: 'UNKNOWN_METHOD' }); });
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
  expect(screen.queryByRole('radiogroup')).toBeNull();
});

test('a reply that fails its check shows Failed, never part of it', async () => {
  activity(() => ({ events: [{ ...MODEL, costPaise: '12.50' }], nextCursor: null, total: '1' }));
  expect(await screen.findByText('Something did not work. Nothing was changed.')).toBeTruthy();
  expect(screen.getByText('Code INVALID_REPLY')).toBeTruthy();
  expect(screen.queryByText(/Claude Demo route/)).toBeNull();
});

test('a viewer seat sees the activity with no control that changes anything', async () => {
  activity(pages, { viewer: true });
  await screen.findByText('A request went to the AI model by Claude Demo route.');
  const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
  for (const name of names) expect(name).not.toMatch(/^(Approve|Prepare|Not now|Change|Drop|Delete|Save|Undo|Remove|Continue|Update)$/);
});

test('activity sentences are built in Hindi from the same typed events', async () => {
  activity(pages, { language: 'hi' });
  expect(await screen.findByText('AI मॉडल को Claude Demo route से अनुरोध भेजा गया।')).toBeTruthy();
  expect(screen.getByText('Bank Demo पढ़ा गया। (बाहर का पाठ पढ़ा)', { exact: false })).toBeTruthy();
});

/* ------------------------------------------------------------------ worth a look */

const reviewRow = (n: number): RowItem => ({ id: `rv-${n}`, mark: 'wait', what: `Review Demo ${n}`, detail: 'Synthetic detail', can: ['review'] });
const WORTH: WorthReply = {
  state: 'ready',
  rows: [
    { id: 'w1', kind: 'moved', subject: 'Freight Outward Demo', at: null, figure: { unit: 'paise', exact: '31000000', receiptId: 'R-w1' }, opens: '#/reports/month' },
    { id: 'w2', kind: 'due-soon', subject: 'GSTR-3B', at: '2026-10-20', opens: '#/reports/due' },
    { id: 'w3', kind: 'file-refused', subject: 'statement-demo.pdf', at: null, opens: '#/books/sources' },
    { id: 'w4', kind: 'decision-due', subject: null, at: null, opens: null },
    { id: 'w5', kind: 'approval-expired', subject: null, at: null, opens: null },
  ],
};
function today(fields: Partial<TodayData>, reviews = 3): TodayData {
  return {
    state: { kind: 'ready' }, date: 'Wednesday, 14 October',
    review: { count: { exact: String(reviews), display: String(reviews) }, rows: Array.from({ length: reviews }, (_, i) => reviewRow(i + 1)) },
    ...fields,
  };
}
const intents = (): TodayIntents => ({ onReview: vi.fn(), onReceipt: vi.fn() });

function rowsIn(section: HTMLElement) {
  return within(section).queryAllByRole('listitem');
}

test('Guided: review rows and worth-a-look rows together are never more than five at rest; the rest wait behind See all', async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const handlers = intents();
  show(<TodayScreen data={today({ worth: WORTH })} intents={handlers} view="guided" onNavigate={onNavigate} />);
  const worth = screen.getByRole('region', { name: 'Worth a look' });
  expect(rowsIn(worth).length).toBe(2);
  expect(screen.getAllByText(/^Review Demo/).length).toBe(3);
  expect(within(worth).getByText('lead, not tested')).toBeTruthy();
  expect(within(worth).getByText('Freight Outward Demo')).toBeTruthy();
  await user.click(within(worth).getByRole('button', { name: 'See all 5' }));
  expect(rowsIn(worth).length).toBe(5);
  await user.click(within(worth).getByRole('button', { name: 'Show fewer' }));
  expect(rowsIn(worth).length).toBe(2);
  await user.click(within(worth).getByRole('button', { name: '₹3,10,000' }));
  expect(handlers.onReceipt).toHaveBeenCalledWith('R-w1');
  await user.click(within(worth).getByRole('button', { name: /A figure moved/ }));
  expect(onNavigate).toHaveBeenCalledWith({ place: 'reports', sub: 'month' });
});

test('four review rows leave room for one worth-a-look row; none awaiting leaves room for five', () => {
  show(<TodayScreen data={today({ worth: WORTH }, 4)} intents={intents()} view="guided" onNavigate={vi.fn()} />);
  expect(rowsIn(screen.getByRole('region', { name: 'Worth a look' })).length).toBe(1);
  cleanup();
  show(<TodayScreen data={today({ worth: WORTH }, 0)} intents={intents()} view="guided" onNavigate={vi.fn()} />);
  expect(screen.getByText('Nothing awaits your review.')).toBeTruthy();
  const worth = screen.getByRole('region', { name: 'Worth a look' });
  expect(rowsIn(worth).length).toBe(5);
  expect(within(worth).queryByRole('button', { name: /See all/ })).toBeNull();
});

test('worth a look not loaded yet shows its words in all three views', () => {
  for (const view of ['guided', 'simple', 'books'] as const) {
    show(<TodayScreen data={today({ worth: { state: 'not-loaded-yet', rows: [] } })} intents={intents()} view={view} onNavigate={vi.fn()} />);
    const worth = screen.getByRole('region', { name: 'Worth a look' });
    expect(within(worth).getByText('not loaded yet')).toBeTruthy();
    cleanup();
  }
});

test('Simple shows worth a look as its own taller rows with the short form spelled out; Books as table rows', async () => {
  const user = userEvent.setup();
  show(<TodayScreen data={today({ worth: WORTH })} intents={intents()} view="simple" onNavigate={vi.fn()} />, 'hi');
  const simple = screen.getByRole('region', { name: hi['TD-01.worth'] });
  expect(rowsIn(simple).length).toBe(2);
  expect(within(simple).getByRole('button', { name: '₹3.1 लाख' })).toBeTruthy();
  cleanup();
  const onNavigate = vi.fn();
  show(<TodayScreen data={today({ worth: WORTH })} intents={intents()} view="books" onNavigate={onNavigate} />);
  const books = screen.getByRole('region', { name: 'Worth a look' });
  const table = within(books).getByRole('table');
  expect(within(table).getAllByRole('row').length).toBe(3);
  expect(within(table).getByText('due 20 Oct 2026')).toBeTruthy();
  await user.click(within(table).getByRole('button', { name: 'A figure moved' }));
  expect(onNavigate).toHaveBeenCalledWith({ place: 'reports', sub: 'month' });
});

/* ------------------------------------------------------------------ Simple cash */

const week = (todayValue: FigureOrMissing): ColumnsChart => ({
  form: 'columns', sentence: 'Cash sales, last seven days',
  values: [
    { id: 'd1', label: 'Thu', value: { kind: 'money' as const, exact: '120000', display: '₹1,200', receiptId: 'R-d1', labels: [] } },
    { id: 'd7', label: 'Wed', value: todayValue },
  ],
});

test('Simple cash: today open and a field with Enter until entered; then the bar fills and says told by owner', async () => {
  const user = userEvent.setup();
  const onSaveClosing = vi.fn();
  const { container } = show(<TodayScreen data={today({ cash: { week: week({ kind: 'missing', missing: 'cash-not-captured' }) } })}
    intents={{ ...intents(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  const outline = columnStyles.outline;
  if (outline === undefined) throw new Error('Columns must expose its open bar style');
  expect(container.querySelectorAll(`rect.${outline}`).length).toBe(1);
  expect(screen.queryByText('told by owner')).toBeNull();
  await user.type(screen.getByRole('textbox', { name: "Today's cash sales" }), '8450');
  await user.click(screen.getByRole('button', { name: 'Enter' }));
  expect(onSaveClosing).toHaveBeenCalledWith('8450');
  cleanup();
  const told = { kind: 'money' as const, exact: '845000', display: '₹8,450', receiptId: 'R-told', labels: [] };
  const entered = show(<TodayScreen data={today({ cash: { entered: told, week: week({ kind: 'missing', missing: 'cash-not-captured' }) } })}
    intents={{ ...intents(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  expect(entered.container.querySelectorAll(`rect.${outline}`).length).toBe(0);
  expect(screen.getByText('told by owner')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getAllByRole('button', { name: /8,450/ }).length).toBe(2);
});

/* ------------------------------------------------------------------ Books close */

test('Books: the close as its four fixed rows with their states, the waiting line and the keys', () => {
  const { container } = show(<TodayScreen data={today({
    queue: [], waiting: { holder: 'the owner', what: '3 reminders' },
    close: { month: 'September', steps: [
      { id: 's2', mark: 'off', step: 'gstr2b', state: 'not-applicable', notApplicable: 'composition' },
      { id: 's1', mark: 'cha', step: 'bank', state: 'done', status: '31 of 31 lines', statusMono: true },
    ] },
  })} intents={intents()} view="books" onNavigate={vi.fn()} />);
  const steps = Array.from(container.querySelectorAll('[data-close-step]'));
  expect(steps.map((li) => li.getAttribute('data-close-step'))).toEqual(['bank', 'gstr2b', 'tds', 'trial-balance']);
  expect(steps[0]!.textContent).toContain('Bank reconciliation');
  expect(steps[0]!.textContent).toContain('31 of 31 lines');
  expect(steps[1]!.textContent).toContain('Purchases against GSTR-2B (AS-19)');
  expect(steps[1]!.textContent).toContain('Composition scheme: no GSTR-2B to match');
  expect(steps[2]!.textContent).toContain('TDS against Form 26AS');
  expect(steps[2]!.textContent).toContain('not loaded yet');
  expect(steps[3]!.textContent).toContain('Trial balance');
  expect(screen.getByText('September close')).toBeTruthy();
  expect(screen.getByText('Waiting for the owner: 3 reminders you prepared')).toBeTruthy();
  expect(screen.getByText(en['TD-03.keys'])).toBeTruthy();
});

/* ------------------------------------------------------------------ phone */

const PHONE: PhoneMessagesReply = {
  channels: [{ channel: 'whatsapp', state: 'on' }, { channel: 'telegram', state: 'not-built' }, { channel: 'mail', state: 'off' }],
  kinds: ['week-ahead', 'review'], sentThisMonth: '3', monthlyBudget: '30',
};

test('phone preview: the four fixed messages as sent, with no digit in any body, in both languages', () => {
  for (const language of ['en', 'hi'] as const) {
    const { container } = show(<PhoneMessages reply={PHONE} />, language);
    const bodies = Array.from(container.querySelectorAll('[data-phone-body]'));
    expect(bodies.length).toBe(8);
    for (const body of bodies) expect(body.textContent ?? '').not.toMatch(/[0-9०-९]/);
    cleanup();
  }
  show(<PhoneMessages reply={PHONE} />);
  expect(screen.getAllByText('Something is ready for your review.').length).toBe(2);
  expect(screen.getByText('3 of about 30 messages this month')).toBeTruthy();
  expect(screen.getByText(en['PH-01.buttons'])).toBeTruthy();
  expect(screen.getByText('not built yet')).toBeTruthy();
  expect(screen.queryAllByRole('button').length).toBe(0);
});

test('phone preview reads todayx.phoneMessages and shows not built yet when it is missing', async () => {
  const request = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'METHOD_UNAVAILABLE' }); });
  const address: Address = { place: 'tools', sub: 'phone' };
  show(<PhoneMessagesFromEngine rpc={{ request }} live={() => true} address={address} />);
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
  expect(request).toHaveBeenCalledWith('todayx.phoneMessages', {});
});

test('the link page holds the wordmark and one line', () => {
  show(<PhoneLinkPage state="open" />);
  expect(screen.getByText('Open Chausar on your computer to see this.')).toBeTruthy();
  cleanup();
  show(<PhoneLinkPage state="expired" />, 'hi');
  expect(screen.getByText(hi['PH-02.expired'])).toBeTruthy();
});
