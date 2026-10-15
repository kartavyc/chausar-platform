import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { sheetOf } from '../../app/ui/src/screens/work/contract';
import { otherLanePages, routeLine } from '../../app/ui/src/screens/work/R4Parts';
import { r4Words } from '../../app/ui/src/screens/work/text-r4';
import { laneSubPlaces } from '../../app/ui/src/places/subplaces/index';
import { laneWords } from '../../app/ui/src/text/lanes/index';

// Round 4 for Work. Every reply is synthetic and shaped by docs/lanes/work-books.md ("Round 4 contracts").
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
type Sub = (kinds: readonly string[], onEvent: (event: unknown) => void) => () => void;
function Harness({ rpc, start, language, role, view, subscribe, onNavigate }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; role: string; view: View; subscribe?: Sub; onNavigate: (a: Address | null) => void }) {
  const [address, setAddress] = useState<Address>(start);
  const props = { address, language, view, viewer: role === 'viewer', rpc, member: { id: 'member-1', role }, live: () => true, openReceipt: () => {},
    navigate: (next: Address | null) => { onNavigate(next); setAddress(next ?? { place: 'work', sub: address.sub ?? 'approvals' }); }, ...(subscribe ? { subscribe } : {}) };
  return <TextProvider language={language}>{workPlace.render(props)}</TextProvider>;
}
function show(handlers: Record<string, Handler>, start: Address, opts: { language?: Language; role?: string; view?: View; subscribe?: Sub } = {}) {
  const rpc = fakeRpc(handlers); const navigate = vi.fn();
  render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} role={opts.role ?? 'owner'} view={opts.view ?? 'guided'} subscribe={opts.subscribe} onNavigate={navigate} />);
  return { rpc, navigate };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const steps = (...states: string[]) => ['prepared', 'approved', 'done', 'read-back', 'recorded'].map((name, i) => ({ name, state: states[i] ?? 'not-reached', at: null }));
const detail = (extra: Record<string, unknown> = {}) => ({
  id: 'action:a1', source: 'action', kind: 'money', tier: 'tier-2', title: 'Pay a supplier', touches: 'Books app: supplier-b', amount: { minor: '250000' },
  preparedBy: { kind: 'person', name: 'Owner' }, createdAt: '2026-10-15T09:00:00Z', expiresAt: '2026-10-22T09:00:00Z', state: 'prepared', practice: false,
  digest: 'digest-a1', revision: 1, reason: 'always-waits:money', change: { fields: [{ name: 'amountMinor', before: '', after: '250000' }] },
  steps: steps('done', 'waiting-for-you'), can: ['approve', 'notNow', 'change', 'drop'], readOnly: false, prepareOnly: false, needsSecondAsk: true, ...extra,
});
const LIST = () => ({ items: [], expired: [], snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } });
const lane = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Synthetic ${id}`, goal: `Do ${id}.`, doneWhen: 'You accept the result.', every: 'day', intervalMs: 86_400_000, stepsPerDelivery: 1, missedRun: 'run-once-on-wake',
  budget: { minor: '5000' }, actions: [], steps: [{ kind: 'calculate', title: 'Work out the figure', needsModel: false }], needsModel: false, experimental: false, available: true, code: null, ...extra,
});
const TEMPLATES = () => ({ templates: [], fromSentence: { available: false }, monthEnd: { available: false },
  lane: { available: true, templates: [lane('cash-position'), lane('stock-check', { available: false, code: 'TEMPLATE_CALCULATION_MISSING', experimental: true }), lane('receivables-week', { stepsPerDelivery: 7 })], activeJobs: 1, activeJobCap: 10 } });
const JOBS = () => ({ items: [], active: 0, limit: 10, proposals: { available: true, items: [] } });

test('WK-09: Start a job offers jobs-ext ready-made jobs; one that cannot start says why; proposing opens its card', async () => {
  const { rpc, navigate } = show({ 'approvals.jobs': JOBS, 'approvals.jobTemplates': TEMPLATES, 'approvals.proposeJob': () => ({ id: 'proposal:jp1', proposal: { id: 'jp1', digest: 'd'.repeat(64) } }), 'approvals.list': LIST,
    'approvals.get': () => detail({ id: 'proposal:jp1', source: 'proposal', kind: 'job' }) }, { place: 'work', sub: 'jobs', sheet: 'start' });
  const part = await screen.findByText('Ready-made jobs from job extensions');
  const block = part.closest('[data-part="lane-templates"]') as HTMLElement;
  expect(within(block).getByText('1 of 10 jobs are active.')).toBeTruthy();
  const stock = block.querySelector('[data-lane-template="stock-check"]') as HTMLElement;
  expect(within(stock).getByText(/Your published meanings have no calculation this job needs\./)).toBeTruthy();
  expect(within(stock).queryByRole('button')).toBeNull();
  const week = block.querySelector('[data-lane-template="receivables-week"]') as HTMLElement;
  await userEvent.click(within(week).getByRole('button'));
  expect(within(week).queryByText(/run every missed one/)).toBeNull();
  const cash = block.querySelector('[data-lane-template="cash-position"]') as HTMLElement;
  await userEvent.click(within(cash).getByRole('button'));
  await userEvent.click(within(cash).getByLabelText(/run every missed one/));
  await userEvent.click(within(cash).getByRole('button', { name: /Propose/ }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.proposeJob', { laneTemplate: 'cash-position', budgetMinor: '5000', missedRun: 'run-all' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ place: 'work', sub: 'approvals', sheet: sheetOf('proposal:jp1') }));
});

test('WK-09 in Hindi; without job extensions the part says not built', async () => {
  show({ 'approvals.jobs': JOBS, 'approvals.jobTemplates': TEMPLATES }, { place: 'work', sub: 'jobs', sheet: 'start' }, { language: 'hi' });
  expect(await screen.findByText('जॉब एक्सटेंशन के तैयार जॉब')).toBeTruthy();
  expect(screen.getByText(/आपके प्रकाशित अर्थों में वह गणना नहीं है/)).toBeTruthy();
  cleanup();
  show({ 'approvals.jobs': JOBS, 'approvals.jobTemplates': () => ({ templates: [], fromSentence: { available: false } }) }, { place: 'work', sub: 'jobs', sheet: 'start' });
  expect(await screen.findByText('Ready-made jobs from job extensions are not built yet.')).toBeTruthy();
});

test('WK-02: a core action is practised: checked, not run; the exact request and the steps as practice; a refusal says its code', async () => {
  let refused = false;
  const { rpc } = show({ 'approvals.list': LIST, 'approvals.pace': () => ({ fastStreak: 0, warn: false }), 'approvals.get': () => detail(),
    'approvals.practice': () => ({ practice: true, available: true, mode: 'checked-not-run', steps: steps('done', refused ? 'stopped-by-rule' : 'done'), wouldSend: null, requests: 0,
      outcome: refused ? 'refused' : 'would-create-local-draft', ...(refused ? { code: 'INVALID_ACTION' } : {}), request: { invoiceId: 'INV-1', text: 'Due Friday.' } }) },
  { place: 'work', sub: 'approvals', sheet: sheetOf('action:a1') });
  await userEvent.click(await screen.findByRole('button', { name: 'Practice this' }));
  await screen.findByText('Practice: checked, not run');
  const block = document.querySelector('[data-part="core-practice"]') as HTMLElement;
  expect(within(block).getByText('Practice: checked, not run')).toBeTruthy();
  expect(within(block).getByText('It would create a local draft in Chausar. Nothing is sent.')).toBeTruthy();
  expect(within(block).getByText('INV-1')).toBeTruthy();
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
  refused = true;
  await userEvent.click(screen.getByRole('button', { name: 'Practice this' }));
  expect(await screen.findByText('The real action would refuse this request. Code INVALID_ACTION.')).toBeTruthy();
});

test('second ask: a core money action asks for the approver’s own secret, sent once with the approval', async () => {
  const { rpc } = show({ 'approvals.list': LIST, 'approvals.pace': () => ({ fastStreak: 0, warn: false }), 'approvals.get': () => detail({ secondAsk: { by: 'passphrase', whose: 'own-secret' } }),
    'approvals.approve': () => detail({ state: 'approved', can: ['drop'], steps: steps('done', 'done', 'waiting-for-you') }), 'approvals.execute': () => { throw refuse('SENDING_CLOSED'); } },
  { place: 'work', sub: 'approvals', sheet: sheetOf('action:a1') }, { language: 'hi' });
  const approve = await screen.findAllByRole('button', { name: /मंज़ूर/ });
  await userEvent.click(approve[0]!);
  const form = await screen.findByRole('dialog', { name: 'अपने मंज़ूरी-राज़ से मंज़ूर करें' });
  await userEvent.type(within(form).getByLabelText('मंज़ूरी-राज़'), 'synthetic secret');
  await userEvent.click(within(form).getByRole('button', { name: 'मंज़ूर करें' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id: 'action:a1', digest: 'digest-a1', secondAsk: true, reauth: 'synthetic secret' }));
});

test('second ask: a seat with no approval secret is told to set one first, and no field is offered', async () => {
  const { rpc } = show({ 'approvals.list': LIST, 'approvals.pace': () => ({ fastStreak: 0, warn: false }), 'approvals.get': () => detail({ secondAsk: { by: 'passphrase', whose: 'own-secret', setFirst: true } }) },
  { place: 'work', sub: 'approvals', sheet: sheetOf('action:a1') });
  expect(await screen.findByText(/Set your approval secret in Trust first/)).toBeTruthy();
  const approve = await screen.findAllByRole('button', { name: /Approve/ });
  await userEvent.click(approve[0]!);
  expect(screen.queryByRole('dialog', { name: 'Approve with your approval secret' })).toBeNull();
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
});

test('second ask: a locked second ask says until when, and offers no field', async () => {
  const { rpc } = show({ 'approvals.list': LIST, 'approvals.pace': () => ({ fastStreak: 0, warn: false }), 'approvals.get': () => detail({ secondAsk: { by: 'passphrase', whose: 'vault-passphrase', lockedUntil: '2099-10-15T12:30:00.000Z' } }) },
  { place: 'work', sub: 'approvals', sheet: sheetOf('action:a1') });
  expect(await screen.findByText(/The second ask is locked until/)).toBeTruthy();
  const approve = await screen.findAllByRole('button', { name: /Approve/ });
  await userEvent.click(approve[0]!);
  expect(screen.queryByRole('dialog', { name: 'Approve with your passphrase' })).toBeNull();
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
});

test('WK-03: after Approve, each grouped item draws its own five steps', async () => {
  const item = (id: string) => detail({ id, kind: 'record-change', tier: 'tier-1', title: `Note ${id}`, amount: null, needsSecondAsk: false, change: { fields: [{ name: 'text', before: '', after: 'Prefers mail' }] } });
  // The group sheet is opened from the queue's ticks; here it is drawn directly through its pane.
  const { GroupPane } = await import('../../app/ui/src/screens/work/GroupPane');
  const rpc = fakeRpc({ 'approvals.pace': () => ({ fastStreak: 0, warn: false }), 'approvals.group': () => ({ title: '2 changes that can be undone', undoable: true, items: [item('action:n1'), item('action:n2')] }),
    'approvals.approveGroup': () => ({ results: [{ id: 'action:n1', ok: true, state: 'approved', steps: steps('done', 'done', 'waiting-for-you') }, { id: 'action:n2', ok: false, code: 'PREVIEW_CHANGED', steps: steps('done', 'waiting-for-you') }] }) });
  const { workWords } = await import('../../app/ui/src/screens/work/text');
  const p = { address: { place: 'work', sub: 'approvals' }, language: 'en', view: 'guided', viewer: false, rpc, member: { id: 'm', role: 'owner' }, live: () => true, openReceipt: () => {}, navigate: () => {},
    w: workWords('en'), host: { rpc, address: { place: 'work', sub: 'approvals' }, live: () => true }, sub: 'approvals' } as any;
  render(<TextProvider language="en"><GroupPane p={p} ids={['action:n1', 'action:n2']} origin={null} onClose={() => {}} onListChanged={() => {}} /></TextProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /Approve 2/ }));
  await waitFor(() => expect(document.querySelector('[data-group-steps="action:n1"]')).toBeTruthy());
  expect(document.querySelector('[data-group-steps="action:n2"]')).toBeTruthy();
});

const REMINDERS = (extra: Record<string, unknown> = {}) => ({ available: true, connections: [{ id: 'conn-mail', label: 'Office mail', system: 'mail', environment: 'practice' }],
  caps: { timeZone: 'Asia/Kolkata', today: '2026-10-15', preparedToday: 3, sentToday: 1, perCustomer: 1, perDay: 20 }, items: [], ...extra });

test('WK-12: Reminders: today in write-back’s time zone, and Prepare a reminder from a picked customer and invoice', async () => {
  const { rpc, navigate } = show({ 'approvals.reminders': () => REMINDERS(),
    'records.search': () => ({ records: [{ id: 'cust-a', kind: 'customer', name: 'Synthetic Traders', sources: [], facts: 2 }] }),
    'records.invoices': () => ({ id: 'cust-a', name: 'Synthetic Traders', invoices: ['INV-A'] }),
    'approvals.prepareReminder': () => ({ id: 'writeback:wb1', blocked: null }) }, { place: 'work', sub: 'reminders' });
  expect(await screen.findByText(/Today is 2026-10-15 in Asia\/Kolkata: 3 of 20 reminders prepared, 1 sent/)).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Find a customer by name'), 'Synthetic');
  await userEvent.click(screen.getByRole('button', { name: 'Find' }));
  await userEvent.click(await screen.findByLabelText('Synthetic Traders'));
  await userEvent.click(await screen.findByLabelText('INV-A'));
  await userEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.prepareReminder', { connectionId: 'conn-mail', customerId: 'cust-a', invoiceId: 'INV-A', language: 'en' }));
  // Listing a customer's invoices calculates nothing: records.get (which runs aging) is never asked.
  expect(rpc.request).toHaveBeenCalledWith('records.invoices', { id: 'cust-a' });
  expect(rpc.request.mock.calls.some((c: unknown[]) => c[0] === 'records.get')).toBe(false);
  await userEvent.click(await screen.findByRole('button', { name: 'Open its approval' }));
  expect(navigate).toHaveBeenCalledWith({ place: 'work', sub: 'approvals', sheet: sheetOf('writeback:wb1') });
});

test('WK-12 (review 4): a missing sent count is never drawn as 0; the line keeps to the limits', async () => {
  show({ 'approvals.reminders': () => REMINDERS({ caps: { timeZone: 'Asia/Kolkata', today: '2026-10-15', preparedToday: 3, sentToday: null, perCustomer: 1, perDay: 20 } }) }, { place: 'work', sub: 'reminders' });
  expect(await screen.findByText('At most 20 reminders a day, and 1 per customer a day.')).toBeTruthy();
  expect(screen.queryByText(/0 sent/)).toBeNull();
});

test('WK-12: a blocked reminder says why; no connection says so; without write-back not built; Hindi', async () => {
  show({ 'approvals.reminders': () => REMINDERS({ connections: [] }) }, { place: 'work', sub: 'reminders' }, { language: 'hi' });
  expect(await screen.findByText('अभी कोई मेल या WhatsApp कनेक्शन याद-दिलाने वाले संदेश नहीं भेज सकता।')).toBeTruthy();
  expect(screen.getByText(/Asia\/Kolkata में आज 2026-10-15 है/)).toBeTruthy();
  cleanup();
  show({ 'approvals.reminders': () => ({ available: false }) }, { place: 'work', sub: 'reminders' });
  expect(await screen.findByText('Reminders arrive with write-back. Not built yet.')).toBeTruthy();
  cleanup();
  show({ 'approvals.reminders': () => REMINDERS(), 'records.search': () => ({ records: [{ id: 'cust-a', kind: 'customer', name: 'A' }] }),
    'records.invoices': () => ({ id: 'cust-a', name: 'A', invoices: ['INV-A'] }),
    'approvals.prepareReminder': () => ({ id: null, blocked: { code: 'FOLLOW_UP_NO_CONSENT', reason: 'No reminder: this customer has not agreed to reminders.' } }) }, { place: 'work', sub: 'reminders' });
  await userEvent.click(await screen.findByRole('button', { name: 'Find' }));
  await userEvent.click(await screen.findByLabelText('A'));
  await userEvent.click(await screen.findByLabelText('INV-A'));
  await userEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Not prepared: No reminder: this customer has not agreed to reminders.');
});

test('WK-12: "Record the agreement" opens the exact Books record when write-back names one; the caps line says its time zone', async () => {
  const reminder = { customerId: 'cust-a', invoiceId: 'INV-A', channel: 'email', asWritten: 'Hello.', invoiceLink: null, outstanding: { minor: '100000' }, notes: null,
    agreement: [{ channel: 'email', answer: 'not-asked', source: null, on: null }, { channel: 'whatsapp', answer: 'not-asked', source: null, on: null }], stoppedOn: null,
    caps: { perCustomer: 1, perDay: 20, day: '2026-10-15', preparedOnDay: 1, customerOnDay: 1, reached: false, customerReached: true, timeZone: 'Asia/Kolkata', today: '2026-10-15' },
    blocked: { code: 'FOLLOW_UP_NO_CONSENT', reason: 'No reminder: this customer has not agreed to reminders.' }, recordId: 'cust-a' };
  const { navigate } = show({ 'approvals.list': LIST, 'approvals.pace': () => ({ fastStreak: 0, warn: false }),
    'approvals.get': () => detail({ id: 'writeback:wb1', source: 'writeback', kind: 'message', amount: null, needsSecondAsk: false, change: { asWritten: 'Hello.' }, reminder }) },
  { place: 'work', sub: 'approvals', sheet: sheetOf('writeback:wb1') });
  expect(await screen.findByText(/Counted on .* in Asia\/Kolkata, write-back’s own time zone\./)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Open this customer’s page' }));
  const target = navigate.mock.calls.at(-1)?.[0];
  expect(target.place).toBe('books'); expect(target.sub).toBe('customers'); expect(typeof target.sheet).toBe('string');
});

test('WK-15: after a restore, delete again what came back when core-data serves it', async () => {
  const { rpc } = show({ 'approvals.afterRestore': () => ({ sendingClosed: false, items: [], notes: [], noteKeys: [], deletions: { available: true } }), 'approvals.reapplyDeletions': () => ({ reapplied: 2 }) },
    { place: 'work', sub: 'after-restore' });
  await userEvent.click(await screen.findByRole('button', { name: 'Delete again what came back' }));
  expect(await screen.findByText('2 customer records deleted again.')).toBeTruthy();
  expect(rpc.request).toHaveBeenCalledWith('approvals.reapplyDeletions', {});
  cleanup();
  show({ 'approvals.afterRestore': () => ({ sendingClosed: false, items: [], notes: [], noteKeys: [], deletions: { available: true } }) }, { place: 'work', sub: 'after-restore' }, { role: 'viewer' });
  expect(await screen.findByText(/Customer records you deleted after the backup came back/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Delete again what came back' })).toBeNull();
});

const card = { id: 'job_1', goal: 'Cash position every morning.', doneWhen: 'You accept it.', owner: 'Owner', budget: { minor: '5000' }, reserve: { minor: '700' }, spent: { minor: '0' },
  stopRule: { maxRuns: 30, deadline: '2026-11-15T00:00:00Z' }, actions: [], testedRoutes: ['local-llama'], reviewOn: '2026-11-15', missedRun: 'skip', runsOn: 'this-computer', runs: 1,
  lastRunAt: null, nextRunAt: null, untrustedInstructions: false, digest: 'jd-1', revision: 1 };
const jobRow = { id: 'job_1', goal: card.goal, state: 'scheduled', reason: null, nextRunAt: null, resumesAt: null, spent: { minor: '0' }, budget: { minor: '5000' }, can: ['pause'] };
const jobSheet = (extra: Record<string, unknown> = {}) => ({ ...card, result: null, timeline: [],
  routes: [{ routeId: 'local-llama', spent: { minor: '0' }, minutes: 4, basis: 'zero', tested: true }, { routeId: 'cloud-b', spent: { minor: '1200' }, minutes: null, basis: 'estimate', tested: false }],
  untestedStop: { at: '2026-10-15T09:00:00Z', reason: 'This job was not tested on the route cloud-b.' },
  children: { available: true, items: [{ id: 'c1', title: 'Invoice INV-1', state: 'done', result: { done: ['Reminder prepared'], open: [], receiptIds: ['r-1'] } }, { id: 'c2', title: 'Invoice INV-2', state: 'failed', result: null }] }, ...extra });

test('WK-08: a local model priced at zero with its minutes, an untested route apart, child task results; Simple hides the routes', async () => {
  show({ 'approvals.jobs': () => ({ items: [jobRow], active: 1, limit: 10, proposals: { available: false } }), 'approvals.job': () => jobSheet() }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  await screen.findByText('Model routes');
  const routes = document.querySelector('[data-part="routes"]') as HTMLElement;
  expect(within(routes).getByText('local-llama: on this computer, priced at zero · 4 minutes')).toBeTruthy();
  expect(routes.querySelector('[data-route="cloud-b"]')?.getAttribute('data-route-state')).toBe('untested');
  expect(within(routes).getByText(/Stopped: it reached a model route it was not tested on\./)).toBeTruthy();
  const kids = document.querySelector('[data-part="children"]') as HTMLElement;
  expect(within(kids).getByText('1 done, 0 still open')).toBeTruthy();
  expect(within(kids).getByText('No result: this child task did not deliver one.')).toBeTruthy();
  cleanup();
  show({ 'approvals.jobs': () => ({ items: [jobRow], active: 1, limit: 10, proposals: { available: false } }), 'approvals.job': () => jobSheet({ children: { available: false } }) },
    { place: 'work', sub: 'jobs', sheet: 'job__1' }, { view: 'simple', language: 'hi' });
  await screen.findAllByText(card.goal);
  expect(document.querySelector('[data-part="routes"]')).toBeNull();
  expect(document.querySelector('[data-part="children"]')).toBeNull();
  const r = r4Words('hi');
  expect(routeLine({ routeId: 'x', spent: { minor: '0' }, minutes: null, basis: 'zero', tested: false }, r, 'hi')).toBe('x: इसी कंप्यूटर पर, क़ीमत शून्य · मिनट गिने नहीं गए · इस रूट पर परखा नहीं गया');
});

test('live refresh: with the host’s subscribe the queue re-reads on an event and stops on leave; without it nothing subscribes', async () => {
  const listeners: ((e: unknown) => void)[] = []; const stopped = vi.fn();
  const subscribe = vi.fn((kinds: readonly string[], onEvent: (e: unknown) => void) => { expect(kinds).toContain('actions'); listeners.push(onEvent); return stopped; });
  const { rpc } = show({ 'approvals.list': LIST }, { place: 'work', sub: 'approvals' }, { subscribe });
  await waitFor(() => expect(rpc.request).toHaveBeenCalledTimes(1));
  await act(async () => { listeners[0]!({ kind: 'actions' }); });
  await waitFor(() => expect(rpc.request.mock.calls.filter(c => c[0] === 'approvals.list').length).toBe(2));
  cleanup();
  expect(stopped).toHaveBeenCalled();
  const plain = show({ 'approvals.list': LIST }, { place: 'work', sub: 'approvals' });
  await waitFor(() => expect(plain.rpc.request).toHaveBeenCalledTimes(1));
});

test('links: other lanes’ Work pages are named in their own words; our Reminders sub-place is registered and named in both languages', () => {
  expect(laneSubPlaces['work-books']).toContainEqual({ place: 'work', id: 'reminders' });
  expect(laneWords['work-books']!.en['SH-01.sub.work.reminders']).toBe('Reminders');
  expect(laneWords['work-books']!.hi['SH-01.sub.work.reminders']).toBeTruthy();
  expect(otherLanePages(['work-books'], 'hi')).toEqual([{ lane: 'work-books', id: 'reminders', name: laneWords['work-books']!.hi['SH-01.sub.work.reminders'] }]);
  for (const page of otherLanePages(['jobs-ext', 'writeback'], 'en')) expect(page.name.length).toBeGreaterThan(0);
});

test('WK-14: a computer that cannot be driven says so with its code and offers no window; exports are listed', async () => {
  show({ 'approvals.drivingStatus': () => ({ available: true, rules: { windows: 1, mode: 'read-export', typesSecrets: false }, status: { state: 'done', window: { id: 'w1', title: 'Tally Prime' }, steps: [], reason: null, exports: [{ id: 'export_1', name: 'window.png', bytes: 10 }] },
    windows: [], driver: { available: false, code: 'DRIVER_UNAVAILABLE' } }) }, { place: 'work', sub: 'driving' });
  expect(await screen.findByText('This computer cannot be driven here. Code DRIVER_UNAVAILABLE.')).toBeTruthy();
  expect(screen.getByText('window.png')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
});
