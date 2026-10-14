import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { sheetOf } from '../../app/ui/src/screens/work/contract';

// Every reply here is synthetic and shaped by docs/lanes/work-books.md.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });

function fakeRpc(handlers: Record<string, Handler>) {
  return {
    request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
      const handler = handlers[method];
      if (!handler) throw refuse('UNKNOWN_METHOD');
      return handler(payload);
    }),
  };
}

function Harness({ rpc, start, language, view, viewer }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; view: View; viewer: boolean }) {
  const [address, setAddress] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {workPlace.render({
        address, language, view, viewer, rpc, member: { id: 'member-1', role: viewer ? 'viewer' : 'owner' },
        live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? (address.sub === undefined ? { place: 'work' } : { place: 'work', sub: address.sub })),
      })}
    </TextProvider>
  );
}

function show(handlers: Record<string, Handler>, start: Address = { place: 'work' }, opts: { language?: Language; view?: View; viewer?: boolean } = {}) {
  const rpc = fakeRpc(handlers);
  const utils = render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} view={opts.view ?? 'guided'} viewer={opts.viewer ?? false} />);
  return { rpc, ...utils };
}

const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
const steps = (states: string[] = ['done', 'waiting-for-you', 'not-reached', 'not-reached', 'not-reached']) =>
  NAMES.map((name, i) => ({ name, state: states[i], at: states[i] === 'done' ? '2026-10-01T09:00:00Z' : null }));

function row(id: string, tier: 'tier-2' | 'tier-1' | 'prepare-only', extra: Record<string, unknown> = {}) {
  return {
    id, source: 'action', kind: 'record-change', tier, title: `Synthetic ${id}`, touches: 'Fixture system', amount: null,
    preparedBy: { kind: 'person', name: 'Anil Demo' }, createdAt: '2026-10-01T09:00:00Z', expiresAt: null, state: 'prepared', practice: false, ...extra,
  };
}
function detail(id: string, extra: Record<string, unknown> = {}) {
  return {
    ...row(id, 'tier-1'), digest: 'digest-1', revision: 1, reason: 'autonomy-off',
    change: { fields: [{ name: 'Phone', before: '111', after: '222' }] }, steps: steps(),
    can: ['approve', 'notNow', 'change', 'drop'], readOnly: false, prepareOnly: false, needsSecondAsk: false, ...extra,
  };
}
const actionReply = (id: string, extra: Record<string, unknown> = {}) => ({
  id, system: 'fixture', action: 'record.update', title: `Done ${id}`, touches: null, amount: null, state: 'verified',
  steps: steps(['done', 'done', 'done', 'done', 'done']), approvedBy: 'Owner', channel: 'desktop', request: { phone: '222' },
  readBack: [{ field: 'phone', asked: '222', found: '222', same: true }], rule: 'autonomy-off', attestation: null,
  wouldHaveDone: 'waited', createdAt: '2026-10-01T09:00:00Z', settledAt: '2026-10-01T09:01:00Z', can: [], ...extra,
});
const list = (items: unknown[], expired: unknown[] = []) => () => ({ items, expired, snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } });
const pace = () => ({ fastStreak: 0, warn: false });

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('queue: tier 2 first, then tier 1, prepare-only last, each with its tier word', async () => {
  const { container } = show({ 'approvals.list': list([row('action:a', 'tier-1'), row('action:p', 'prepare-only'), row('action:b', 'tier-2')]) });
  await screen.findByText('Synthetic action:b');
  const ids = Array.from(container.querySelectorAll('[data-row-id]')).map(el => el.getAttribute('data-row-id'));
  expect(ids).toEqual(['action:b', 'action:a', 'action:p']);
  expect(screen.getByText(/^tier 2 · /)).toBeTruthy();
  expect(screen.getByText(/^prepare only · /)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Awaiting your review');
});

test('a missing engine method shows not built yet', async () => {
  show({});
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
});

test('a reply that does not match the contract fails with INVALID_REPLY and a retry', async () => {
  show({ 'approvals.list': () => ({ items: 'nope' }) });
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

test('a viewer seat sees the approval but no Approve', async () => {
  show({ 'approvals.list': list([row('action:a', 'tier-1')]), 'approvals.get': () => detail('action:a'), 'approvals.pace': pace },
    { place: 'work', sub: 'approvals', sheet: sheetOf('action:a') }, { viewer: true });
  await screen.findByRole('heading', { name: 'Synthetic action:a' });
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull();
});

test('Approve sends the digest, then does it once and shows the five steps', async () => {
  const { rpc } = show({
    'approvals.list': list([row('action:a', 'tier-1')]), 'approvals.get': () => detail('action:a'), 'approvals.pace': pace,
    'approvals.approve': () => detail('action:a', { state: 'approved' }), 'approvals.execute': () => actionReply('action:a'),
  }, { place: 'work', sub: 'approvals', sheet: sheetOf('action:a') });
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  await screen.findByRole('heading', { name: 'Done action:a' });
  expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id: 'action:a', digest: 'digest-1' });
  expect(rpc.request).toHaveBeenCalledWith('approvals.execute', { id: 'action:a' });
  expect(screen.getByText('Recorded. It went through and was read back.')).toBeTruthy();
});

test('money asks once more: the amount must be typed before approve with secondAsk', async () => {
  const money = detail('action:m', { kind: 'money', tier: 'tier-2', amount: { minor: '1250000' }, needsSecondAsk: true, reason: 'always-waits:money' });
  const { rpc } = show({
    'approvals.list': list([row('action:m', 'tier-2')]), 'approvals.get': () => money, 'approvals.pace': pace,
    'approvals.approve': () => ({ ...money, state: 'approved' }), 'approvals.execute': () => actionReply('action:m'),
  }, { place: 'work', sub: 'approvals', sheet: sheetOf('action:m') });
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  const dialog = await screen.findByRole('dialog', { name: 'Approve this payment?' });
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
  await userEvent.type(within(dialog).getByRole('textbox'), '999');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Approve payment' }));
  expect(await screen.findByText('That is not the amount. Nothing was approved.')).toBeTruthy();
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
  await userEvent.clear(within(dialog).getByRole('textbox'));
  await userEvent.type(within(dialog).getByRole('textbox'), '12,500');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Approve payment' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id: 'action:m', digest: 'digest-1', secondAsk: true }));
});

test('practice is labelled, calls approvals.practice and never approves', async () => {
  const { rpc } = show({
    'approvals.list': list([row('action:p', 'tier-1', { practice: true })]), 'approvals.get': () => detail('action:p', { practice: true, kind: 'message', change: { asWritten: 'Dear fixture' } }),
    'approvals.pace': pace, 'approvals.practice': () => ({ practice: true, available: true, steps: steps(), wouldSend: 'Dear fixture' }),
  }, { place: 'work', sub: 'approvals', sheet: sheetOf('action:p') });
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('Practice run. Nothing was sent.')).toBeTruthy();
  expect(screen.getAllByText('practice').length).toBeGreaterThan(0);
  expect(rpc.request).toHaveBeenCalledWith('approvals.practice', { id: 'action:p' });
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
});

test('a preview that changed is read again and says so', async () => {
  let reads = 0;
  const { rpc } = show({
    'approvals.list': list([row('action:a', 'tier-1')]), 'approvals.get': () => { reads += 1; return detail('action:a', { digest: `digest-${reads}` }); },
    'approvals.pace': pace, 'approvals.approve': () => { throw refuse('PREVIEW_CHANGED'); },
  }, { place: 'work', sub: 'approvals', sheet: sheetOf('action:a') });
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('It changed. Prepared again.')).toBeTruthy();
  await waitFor(() => expect(reads).toBe(2));
  expect(rpc.request.mock.calls.filter(([m]) => m === 'approvals.approve')).toHaveLength(1);
});

test('a grouped approval approves item by item and shows each result', async () => {
  const a = detail('action:g1'), b = detail('action:g2', { digest: 'digest-2' });
  const { rpc } = show({
    'approvals.list': list([row('action:g1', 'tier-1'), row('action:g2', 'tier-1'), row('action:g3', 'tier-1')]), 'approvals.pace': () => ({ fastStreak: 3, warn: true }),
    'approvals.group': () => ({ title: '2 bank matches', undoable: true, items: [a, b] }),
    'approvals.approveGroup': () => ({ results: [{ id: 'action:g1', ok: true, state: 'approved' }, { id: 'action:g2', ok: false, code: 'PREVIEW_CHANGED' }] }),
  });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic action:g1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Synthetic action:g2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Look at 2 together' }));
  await screen.findByRole('heading', { name: '2 bank matches' });
  expect(screen.getByText('You approved the last 3 in under 2 seconds each. Take a look at this one.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
  expect(await screen.findByText('Refused. Code PREVIEW_CHANGED.')).toBeTruthy();
  expect(screen.getByText('Approved.')).toBeTruthy();
  expect(rpc.request).toHaveBeenCalledWith('approvals.group', { ids: ['action:g1', 'action:g2'] });
  expect(rpc.request).toHaveBeenCalledWith('approvals.approveGroup', { items: [{ id: 'action:g1', digest: 'digest-1' }, { id: 'action:g2', digest: 'digest-2' }] });
});

test('an unknown result is resolved by asking, never by sending again', async () => {
  const { rpc } = show({
    'approvals.list': list([]), 'approvals.pace': pace,
    'approvals.get': () => detail('action:u', { state: 'unknown', can: ['reconcile'], steps: steps(['done', 'done', 'unsure', 'not-reached', 'not-reached']) }),
    'approvals.resolveUnknown': () => actionReply('action:u'),
  }, { place: 'work', sub: 'approvals', sheet: sheetOf('action:u') });
  await userEvent.click(await screen.findByRole('button', { name: 'It was sent' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.resolveUnknown', { id: 'action:u', result: 'was-sent' }));
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.approve', expect.anything());
});

test('a catalogue entry shows its eleven fields', async () => {
  const base = { system: 'tally', systemTitle: 'Tally', action: 'voucher.create', title: 'Create a voucher', kind: 'money', waits: true, status: 'prepare-only', source: 'writeback' };
  show({
    'approvals.catalogue': () => ({ rows: [base], writeback: { available: false } }),
    'approvals.catalogueEntry': () => ({ ...base, description: 'Prepares a voucher.', idempotency: 'One key per voucher.', readBack: 'Reads the voucher back.', retryWindow: null, tier: 'tier-2', expires: '2027-01-01', readStatus: 'live' }),
  }, { place: 'work', sub: 'cando', sheet: sheetOf('tally', 'voucher.create') });
  const sheet = (await screen.findByRole('heading', { name: 'Create a voucher', level: 2 })).closest('section')!;
  expect(sheet.querySelectorAll('dt')).toHaveLength(11);
  expect(within(sheet).getByText('How it avoids doing it twice')).toBeTruthy();
  expect(screen.getByText('More systems arrive with write-back. Not built yet.')).toBeTruthy();
});

test('Pause on a job calls jobs.pause', async () => {
  const card = {
    id: 'job-1', goal: 'Chase overdue invoices', doneWhen: 'All are paid.', owner: 'Owner', budget: { minor: '50000' }, reserve: { minor: '5000' }, spent: { minor: '1200' },
    stopRule: { maxRuns: 10, deadline: '2026-12-01' }, actions: ['reminder.send'], testedRoutes: ['local'], reviewOn: null, missedRun: 'run-once-on-wake',
    runsOn: 'this-computer', runs: 2, lastRunAt: null, nextRunAt: null, untrustedInstructions: true, digest: 'jd-1', revision: 1,
  };
  const { rpc } = show({
    'approvals.jobs': () => ({ items: [{ id: 'job-1', goal: 'Chase overdue invoices', state: 'running', reason: null, nextRunAt: null, resumesAt: null, spent: { minor: '1200' }, budget: { minor: '50000' }, can: ['pause'] }], active: 1, limit: 10, proposals: { available: false } }),
    'approvals.job': () => ({ ...card, timeline: [{ at: '2026-10-01T09:00:00Z', event: 'Read the books', amount: { minor: '200' }, needsModel: false, reason: null }], result: null }),
    'jobs.pause': () => ({ id: 'job-1', state: 'paused' }),
  }, { place: 'work', sub: 'jobs', sheet: 'job-1' });
  await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('jobs.pause', { id: 'job-1' }));
  expect(screen.getByText('instructions only, no tools, untrusted')).toBeTruthy();
  expect(screen.getByText(/runs without one/)).toBeTruthy();
});

test('Hindi draws the page in Hindi', async () => {
  show({ 'approvals.list': list([row('action:a', 'tier-2')]) }, { place: 'work' }, { language: 'hi' });
  expect(await screen.findByText('आपकी समीक्षा का इंतज़ार')).toBeTruthy();
  expect(screen.queryByText(/Awaiting your review/)).toBeNull();
  expect(screen.getByText(/^टियर 2/)).toBeTruthy();
});

test('Simple and Books views both draw the queue', async () => {
  show({ 'approvals.list': list([row('action:a', 'tier-1', { amount: { minor: '120000' } })]) }, { place: 'work' }, { view: 'books' });
  expect(await screen.findByRole('columnheader', { name: 'Prepared by' })).toBeTruthy();
  expect(screen.getByText('₹1,200')).toBeTruthy();
  cleanup();
  const { container } = show({ 'approvals.list': list([row('action:a', 'tier-1')]) }, { place: 'work' }, { view: 'simple' });
  await screen.findByText('Synthetic action:a');
  expect(container.querySelector('table')).toBeNull();
  expect(screen.queryByText(/Anil Demo/)).toBeNull();
});

test('the record of actions opens one with its read-back and Reverse refusal', async () => {
  const { rpc } = show({
    'approvals.ledger': () => ({ items: [actionReply('action:r', { can: ['reverse'] })] }),
    'approvals.action': () => actionReply('action:r', { can: ['reverse'] }),
    'approvals.reverse': () => { throw refuse('REVERSAL_NOT_AVAILABLE'); },
  }, { place: 'work', sub: 'actions' });
  await userEvent.click(await screen.findByRole('button', { name: 'Done action:r' }));
  await screen.findByText('Read back, field by field');
  await userEvent.click(screen.getByRole('button', { name: 'Reverse' }));
  expect(await screen.findByText('This cannot be reversed from here.')).toBeTruthy();
  expect(rpc.request).toHaveBeenCalledWith('approvals.reverse', { id: 'action:r' });
});
