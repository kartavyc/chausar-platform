import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { sheetOf } from '../../app/ui/src/screens/work/contract';

// Write-back in Work. Every reply is synthetic and shaped by docs/lanes/work-books.md.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
function Harness({ rpc, start, language, view, viewer }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; view: View; viewer: boolean }) {
  const [address, setAddress] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {workPlace.render({
        address, language, view, viewer, rpc, member: { id: 'member-1', role: viewer ? 'viewer' : 'owner' }, live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? (address.sub === undefined ? { place: 'work' } : { place: 'work', sub: address.sub })),
      })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, start: Address, opts: { language?: Language; view?: View } = {}) {
  const rpc = fakeRpc({ 'approvals.list': () => ({ items: [], expired: [], snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } }), ...handlers });
  render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} view={opts.view ?? 'guided'} viewer={false} />);
  return { rpc };
}
const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
const steps = (states: string[] = ['done', 'waiting-for-you', 'not-reached', 'not-reached', 'not-reached']) => NAMES.map((name, i) => ({ name, state: states[i], at: states[i] === 'done' ? '2026-10-14T09:00:00Z' : null }));
const extra = { system: 'razorpay', action: 'paymentLink.create', systemTitle: 'Razorpay', catalogueKind: 'money', waitsBecause: 'Money always waits for a person.', connection: { label: 'Practice Razorpay', environment: 'practice', removed: false }, notices: [], externalId: null, settledBy: null };
function sheet(id: string, more: Record<string, unknown> = {}) {
  return {
    id, source: 'writeback', kind: 'money', tier: 'tier-2', title: 'Create a Razorpay payment link', touches: 'Razorpay: Customer A', amount: { minor: '50000' },
    preparedBy: { kind: 'person', name: 'Anil Demo' }, createdAt: '2026-10-14T09:00:00Z', expiresAt: null, state: 'prepared', practice: false,
    digest: 'digest-wb', revision: 1, reason: 'always-waits:money', change: { fields: [{ name: 'amount', before: '', after: '₹500.00' }] }, steps: steps(),
    can: ['approve', 'notNow', 'drop'], readOnly: false, prepareOnly: false, needsSecondAsk: true, writeback: extra, secondAsk: { by: 'typed-amount' }, ...more,
  };
}
const record = (id: string, more: Record<string, unknown> = {}) => ({
  id, system: 'razorpay', action: 'paymentLink.create', title: 'Create a Razorpay payment link', touches: 'Razorpay: Customer A', amount: { minor: '50000' }, state: 'verified',
  steps: steps(['done', 'done', 'done', 'done', 'done']), approvedBy: 'Owner', channel: 'desktop', request: { amountMinor: '50000' },
  readBack: [{ field: 'amount', asked: '50000', found: '50000', same: true }], rule: 'always-waits:money', attestation: null, wouldHaveDone: 'waited',
  createdAt: '2026-10-14T09:00:00Z', settledAt: '2026-10-14T09:01:00Z', can: [], writeback: { ...extra, settledBy: 'system' }, ...more,
});
const pace = () => ({ fastStreak: 0, warn: false });
const at = (id: string) => ({ place: 'work' as const, sub: 'approvals', sheet: sheetOf(id) });

beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('a write-back item shows its system, connection and reason, and after Approve runs once and shows the read-back source', async () => {
  const id = 'writeback:action_a';
  const { rpc } = show({
    'approvals.get': () => sheet(id), 'approvals.pace': pace,
    'approvals.approve': () => ({ ...sheet(id), state: 'approved' }), 'approvals.execute': () => record(id),
  }, at(id));
  expect(await screen.findByText('Practice Razorpay · practice')).toBeTruthy();
  expect(screen.getByText('Money always waits for a person.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  const dialog = await screen.findByRole('dialog', { name: 'Approve this payment?' });
  await userEvent.type(within(dialog).getByRole('textbox'), '500');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Approve payment' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id, digest: 'digest-wb', secondAsk: true }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.execute', { id }));
  expect(await screen.findByText('Read back from the system.')).toBeTruthy();
});

test('when write-back asks for a passphrase, the second ask is a password field passed as reauth', async () => {
  const id = 'writeback:action_r';
  const { rpc } = show({
    'approvals.get': () => sheet(id, { secondAsk: { by: 'passphrase' } }), 'approvals.pace': pace,
    'approvals.approve': () => ({ ...sheet(id), state: 'approved' }), 'approvals.execute': () => record(id),
  }, at(id));
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  const dialog = await screen.findByRole('dialog', { name: 'Approve with your passphrase' });
  expect(screen.queryByRole('dialog', { name: 'Approve this payment?' })).toBeNull();
  const field = within(dialog).getByLabelText('Passphrase', { selector: 'input' });
  expect(field.getAttribute('type')).toBe('password');
  await userEvent.type(field, 'synthetic pass');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id, digest: 'digest-wb', secondAsk: true, reauth: 'synthetic pass' }));
});

test('execute that sends nothing shows write-back\'s notice', async () => {
  const id = 'writeback:action_n';
  show({
    'approvals.get': () => sheet(id, { kind: 'message', needsSecondAsk: false, secondAsk: undefined, change: { asWritten: 'Hello' } }), 'approvals.pace': pace,
    'approvals.approve': () => ({ ...sheet(id), state: 'approved' }),
    'approvals.execute': () => record(id, { state: 'prepared', steps: steps(), notice: { kind: 'prepared-again', message: 'The target changed after you approved. It was prepared again; nothing was sent.' } }),
  }, at(id));
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('The target changed after you approved. It was prepared again; nothing was sent.')).toBeTruthy();
});

test('prepare only: Get file and checklist saves two files and shows where', async () => {
  const id = 'writeback:action_gst';
  const { rpc } = show({
    'approvals.get': () => sheet(id, { kind: 'prepare-only', tier: 'prepare-only', prepareOnly: true, needsSecondAsk: false, secondAsk: undefined, can: ['notNow', 'drop'], amount: null, change: { asWritten: 'GSTR-3B for 2026-09.' } }),
    'approvals.pace': pace,
    'approvals.exportPrepared': () => ({ files: [
      { name: 'chausar-prepared-20261014-090000Z-abc-prepared.json', path: '/synthetic/app/exports/chausar-prepared-20261014-090000Z-abc-prepared.json', bytes: 120 },
      { name: 'chausar-prepared-20261014-090000Z-abc-checklist.txt', path: '/synthetic/app/exports/chausar-prepared-20261014-090000Z-abc-checklist.txt', bytes: 640 },
    ] }),
  }, at(id));
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  await userEvent.click(await screen.findByRole('button', { name: 'Get file and checklist' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.exportPrepared', { id }));
  expect(await screen.findByText('/synthetic/app/exports/chausar-prepared-20261014-090000Z-abc-checklist.txt')).toBeTruthy();
  expect(screen.getByText('Saved to this computer:')).toBeTruthy();
});

const reminder = (more: Record<string, unknown> = {}) => ({
  customerId: 'cust-1', invoiceId: 'inv-1', channel: 'email', asWritten: 'Hello. Invoice inv-1 has ₹300.00 due.\nYou can pay here: https://pay.example/inv-1', invoiceLink: 'https://pay.example/inv-1',
  outstanding: { minor: '30000' },
  notes: [{ id: 'msmed-45-days', text: { en: 'Pay a micro or small supplier within 45 days.', hi: '45 दिन के भीतर भुगतान करें।' }, source: 'MSMED Act, 2006, sections 15 and 16', checkedOn: '2026-10-14', notLegalAdvice: true }],
  agreement: [{ channel: 'email', answer: 'yes', source: 'signed-form-7', on: '2026-10-01' }, { channel: 'whatsapp', answer: 'not-asked', source: null, on: null }],
  stoppedOn: null, caps: { perCustomer: 1, perDay: 20, day: '2026-10-14', preparedOnDay: 3, customerOnDay: 1, reached: false, customerReached: true }, blocked: null, ...more,
});
const reminderSheet = (id: string, r: Record<string, unknown>) => sheet(id, { kind: 'message', needsSecondAsk: false, secondAsk: undefined, change: { asWritten: String(r.asWritten) }, reminder: r, preparedBy: { kind: 'job', name: 'Invoice follow-up' } });

test('a reminder shows the link, the agreement per channel with source and date, the limits and the owner\'s sourced notes', async () => {
  show({ 'approvals.get': () => reminderSheet('writeback:action_rem', reminder()), 'approvals.pace': pace }, at('writeback:action_rem'));
  const part = await screen.findByText('Reminder to the customer');
  const block = part.closest('[data-part="reminder"]') as HTMLElement;
  expect(within(block).getByText('https://pay.example/inv-1')).toBeTruthy();
  expect(within(block).getByText('Mail')).toBeTruthy(); expect(within(block).getByText('yes')).toBeTruthy(); expect(within(block).getByText('not asked')).toBeTruthy();
  expect(within(block).getByText(/^from signed-form-7, /)).toBeTruthy();
  expect(within(block).getByText('Limits: 1 per customer a day, 20 a day in all. Prepared that day: 3.')).toBeTruthy();
  expect(within(block).getByText('For you only: payment rules')).toBeTruthy();
  expect(within(block).getByText('Pay a micro or small supplier within 45 days.')).toBeTruthy();
  expect(within(block).getByText(/Source: MSMED Act, 2006, sections 15 and 16 · Checked on .* · Not legal advice\./)).toBeTruthy();
});

test('a stopped customer, a reached cap and a block at prepare are said in words; another seat sees no notes', async () => {
  const r = reminder({ notes: null, stoppedOn: '2026-10-02', blocked: { code: 'FOLLOW_UP_STOPPED', reason: 'No reminder: this customer asked to stop.' }, caps: { perCustomer: 1, perDay: 20, day: '2026-10-14', preparedOnDay: 20, customerOnDay: 1, reached: true, customerReached: true } });
  show({ 'approvals.get': () => reminderSheet('writeback:action_stop', { ...r }), 'approvals.pace': pace }, at('writeback:action_stop'));
  expect(await screen.findByText(/^Stopped by the customer on /)).toBeTruthy();
  expect(screen.getByText('20 reminders were prepared today. The rest wait until tomorrow.')).toBeTruthy();
  expect(screen.getByText('Blocked at prepare: No reminder: this customer asked to stop.')).toBeTruthy();
  expect(screen.queryByText('For you only: payment rules')).toBeNull();
});

test('a reminder reads in Hindi, notes included', async () => {
  show({ 'approvals.get': () => reminderSheet('writeback:action_hi', reminder()), 'approvals.pace': pace }, at('writeback:action_hi'), { language: 'hi' });
  expect(await screen.findByText('ग्राहक को याद दिलाना')).toBeTruthy();
  expect(screen.getByText('45 दिन के भीतर भुगतान करें।')).toBeTruthy();
});

test('what it can do: a write-back row shows its write score and its entry the test, grants and the eleven fields', async () => {
  const row = { system: 'mail', systemTitle: 'Your own mail server', action: 'smtp.send', title: 'Send an email from your own mail server', kind: 'seen-outside', waits: true, status: 'experimental', source: 'writeback', qualification: 'synthetic-tested', writeScore: '3/3' };
  show({
    'approvals.catalogue': () => ({ rows: [row], writeback: { available: true } }),
    'approvals.catalogueEntry': () => ({ ...row, description: 'A message to someone outside the business always waits for a person.', idempotency: 'Message-ID from the effect key.', readBack: 'Searches the Sent folder.', retryWindow: '7 days',
      tier: 'tier-2', expires: '2027-04-01', readStatus: null, waitsBecause: 'A message to someone outside the business always waits for a person.', plannedStatus: 'live', businessReference: 'Message-ID header.',
      approvalLifetime: '1 day', reviewedOn: '2026-10-01', installed: true, grants: 1, undo: null, connections: [{ id: 'c1', label: 'Shop mail', environment: 'practice', read: true, write: true }] }),
  }, { place: 'work', sub: 'cando' }, { view: 'books' });
  expect(await screen.findByText('3/3')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Send an email from your own mail server' }));
  expect(await screen.findByText('tested on practice systems')).toBeTruthy();
  expect(screen.getByText('Shop mail (practice): may write')).toBeTruthy();
  expect(screen.getByText('Message-ID header.')).toBeTruthy();
  expect(screen.getByText('1 day')).toBeTruthy();
});
