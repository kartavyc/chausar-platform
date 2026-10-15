import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { writebackPlaces } from '../../app/ui/src/places/lane-writeback';
import { subPlaces } from '../../app/ui/src/places/subplaces/writeback';
import { wb4Catalogue } from '../../app/ui/src/text/lanes/writeback';

// Synthetic replies shaped by writeback.overview / writeback.caps in docs/lanes/writeback.md.
type Handler = (payload: Record<string, unknown>) => unknown;
const module = writebackPlaces[0]!;
const en = wb4Catalogue.en, hi = wb4Catalogue.hi;

const action = (over: Record<string, unknown> = {}) => ({ action: 'smtp.send', title: 'Send a mail', kind: 'seen-outside', tier: 1, alwaysWaits: true, undoable: false,
  status: 'experimental', qualification: 'synthetic-tested', writeScore: '3/3', granted: false, grantable: true, sandboxVerified: false, ...over });
const conn = (over: Record<string, unknown> = {}) => ({
  id: 'connection-1', system: 'mail', label: 'Accounts mailbox', environment: 'sandbox', account: { smtpHost: 'smtp.example.com', from: 'accounts@example.com' }, read: true,
  createdAt: '2026-10-10T10:00:00Z', link: null, credential: 'missing', credentialShape: 'pair', actions: [action()], sandboxRuns: [], ...over });
const zoho = conn({ id: 'connection-2', system: 'zoho-books', label: 'Zoho trial', environment: 'live', account: { organizationId: '60012345678' }, credential: 'linked', credentialShape: 'token',
  link: { connectionId: 'cx-1', group: 'zoho-books', label: 'Zoho read', active: true },
  actions: [action({ action: 'invoice.createDraft', title: 'Create a draft invoice', kind: 'inside-undoable', tier: 2, alwaysWaits: false, undoable: true, granted: true }),
    action({ action: 'payment.record', title: 'Record a payment', kind: 'inside-undoable', tier: 2, alwaysWaits: false, undoable: true }),
    action({ action: 'invoice.paymentReminder', title: 'Send a payment reminder', tier: 1, alwaysWaits: true })] });
const gst = conn({ id: 'connection-3', system: 'gst-portal', label: 'GST', environment: 'live', account: { gstin: '27ABCDE1234F1Z5' }, credential: 'not-needed', credentialShape: 'none',
  actions: [action({ action: 'return.file', title: 'File a return', kind: 'cannot-undo', tier: 'prepare-only', status: 'prepare-only', alwaysWaits: true, grantable: false, qualification: 'unqualified', writeScore: null })] });
const systems = [
  { system: 'mail', fields: [{ name: 'smtpHost', required: true, secret: false, example: 'smtp.example.com' }, { name: 'from', required: true, secret: false, example: 'accounts@example.com' },
    { name: 'imapHost', required: false, secret: false, example: 'imap.example.com' }], credential: 'pair', linkable: [], actions: 1 },
  { system: 'zoho-books', fields: [{ name: 'organizationId', required: true, secret: false, example: '60012345678' }, { name: 'dataCenter', required: true, secret: false, example: 'in' }], credential: 'token', linkable: ['zoho-books'], actions: 6 },
];
const overview = (over: Record<string, unknown> = {}) => ({ demo: false, connections: [conn(), zoho, gst], linkable: [{ id: 'cx-1', system: 'zoho-books', group: 'zoho-books', label: 'Zoho read', branch: 'main' }], systems, ...over });
const capsReply = { settings: { approvalHours: { 'inside-undoable': 168, 'seen-outside': 24, money: 24, 'cannot-undo': 24 }, reminderCapPerCustomer: 1, reminderCapPerDay: 20, stopWords: ['STOP', 'RUKO'] },
  timeZone: 'America/New_York', today: '2026-10-14', now: '2026-10-15T02:00:00Z', counts: { preparedToday: 3, sentToday: 2, customersToday: 2 } };

function setup({ address, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: { address: Address; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler> }) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const table: Record<string, Handler> = { 'writeback.overview': () => overview(), 'writeback.caps': () => capsReply, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    return <TextProvider language={language}>{module.render({ address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt: () => {}, navigate: next => setAt(next ?? { place: 'work', sub: address.sub ?? 'write' }) })}</TextProvider>;
  }
  render(<Harness />);
  return { called: (method: string) => calls.filter(c => c.method === method) };
}
const refuse = (code: string) => () => { throw Object.assign(new Error(`raw engine text for ${code}`), { code }); };
const WRITE: Address = { place: 'work', sub: 'write' };
const sheetOf = (id: string): Address => ({ place: 'work', sub: 'write', sheet: id });

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite')); });
afterEach(() => cleanup());

test('the module draws work/write and work/caps only, and names its sub-places', () => {
  expect(module.id).toBe('writeback');
  expect(module.handles({ place: 'work', sub: 'write' })).toBe(true);
  expect(module.handles({ place: 'work', sub: 'caps' })).toBe(true);
  expect(module.handles({ place: 'work', sub: 'write', sheet: 'connection-1' })).toBe(true);
  expect(module.handles({ place: 'work' })).toBe(false);
  expect(module.handles({ place: 'work', sub: 'approvals' })).toBe(false);
  expect(module.handles({ place: 'books', sub: 'write' })).toBe(false);
  expect(subPlaces).toEqual([{ place: 'work', id: 'write' }, { place: 'work', id: 'caps' }]);
  expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
});

test.each([['en', 'simple'], ['en', 'guided'], ['en', 'books'], ['hi', 'simple'], ['hi', 'guided'], ['hi', 'books']] as const)('the list draws in %s, %s view', async (language, view) => {
  const w = wb4Catalogue[language];
  setup({ address: WRITE, language, view });
  expect(await screen.findByRole('button', { name: 'Accounts mailbox' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(w['wb4.write.title']);
  const table = screen.getByRole('table');
  const headers = within(table).getAllByRole('columnheader').map(h => h.textContent);
  expect(headers.length).toBe(view === 'simple' ? 3 : view === 'guided' ? 5 : 6);
  expect(within(table).getByText(w['wb4.sys.zoho-books'])).toBeTruthy();
  expect(within(table).getByText(w['wb4.cred.linked'])).toBeTruthy();
  if (view !== 'simple') {
    expect(within(table).getByText(w['wb4.env.sandbox'])).toBeTruthy();
    expect(within(table).getByText(w['wb4.grants.count'].replace('{n}', '1').replace('{total}', '3'))).toBeTruthy();
  }
  expect(screen.getByRole('button', { name: w['wb4.connect.open'] })).toBeTruthy();
});

test('empty list says so', async () => {
  setup({ address: WRITE, handlers: { 'writeback.overview': () => overview({ connections: [] }) } });
  expect(await screen.findByText(en['wb4.empty'])).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

test('an engine without the method shows not built yet', async () => {
  setup({ address: WRITE, handlers: { 'writeback.overview': refuse('UNKNOWN_METHOD') } });
  await waitFor(() => expect(document.body.textContent).toMatch(/not built/i));
  expect(screen.queryByRole('table')).toBeNull();
  expect(document.body.textContent).not.toContain('raw engine text');
});

test('a viewer sees the list and the sheet but no control', async () => {
  setup({ address: sheetOf('connection-1'), viewer: true, role: 'viewer' });
  expect(await screen.findByText(en['wb4.readOnly'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: en['wb4.connect.open'] })).toBeNull();
  expect(screen.queryByRole('button', { name: en['wb4.grant.save'] })).toBeNull();
  expect(screen.queryByRole('button', { name: en['wb4.disc.open'] })).toBeNull();
  expect(screen.queryByRole('button', { name: en['wb4.cred.save'] })).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true);
});

test('a member who is not an owner reads only', async () => {
  setup({ address: WRITE, role: 'accountant' });
  expect(await screen.findByText(en['wb4.adminOnly'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: en['wb4.connect.open'] })).toBeNull();
});

test('connect sends the exact payload with a linked sign-in', async () => {
  const { called } = setup({ address: WRITE, handlers: { 'writeback.connect': () => ({ ...zoho, id: 'connection-9', write: [] }) } });
  fireEvent.click(await screen.findByRole('button', { name: en['wb4.connect.open'] }));
  const form = screen.getByRole('form', { name: en['wb4.connect.title'] });
  fireEvent.change(within(form).getByLabelText(en['wb4.connect.system']), { target: { value: 'zoho-books' } });
  fireEvent.change(within(form).getByLabelText(en['wb4.connect.label']), { target: { value: ' Zoho live ' } });
  const org = within(form).getByLabelText(en['wb4.field.organizationId']) as HTMLInputElement;
  expect(org.placeholder).toBe('60012345678');
  fireEvent.change(org, { target: { value: '600123' } });
  fireEvent.change(within(form).getByLabelText(en['wb4.field.dataCenter']), { target: { value: 'in' } });
  fireEvent.change(within(form).getByLabelText(en['wb4.connect.link']), { target: { value: 'cx-1' } });
  fireEvent.click(within(form).getByRole('button', { name: en['wb4.connect.send'] }));
  await waitFor(() => expect(called('writeback.connect')).toHaveLength(1));
  expect(called('writeback.connect')[0]!.payload).toEqual({ system: 'zoho-books', label: 'Zoho live', environment: 'live', account: { organizationId: '600123', dataCenter: 'in' }, linkTo: 'cx-1' });
});

test('in the demo only practice is offered and sent', async () => {
  const { called } = setup({ address: WRITE, handlers: { 'writeback.overview': () => overview({ demo: true, connections: [] }), 'writeback.connect': () => ({ id: 'connection-9' }) } });
  fireEvent.click(await screen.findByRole('button', { name: en['wb4.connect.open'] }));
  expect(screen.getByText(en['wb4.demo'])).toBeTruthy();
  const env = screen.getByLabelText(en['wb4.connect.env']) as HTMLSelectElement;
  expect([...env.options].map(o => o.value)).toEqual(['practice']);
  fireEvent.change(screen.getByLabelText(en['wb4.connect.label']), { target: { value: 'Practice mail' } });
  fireEvent.change(screen.getByLabelText(en['wb4.field.smtpHost']), { target: { value: 'smtp.example.com' } });
  fireEvent.change(screen.getByLabelText(en['wb4.field.from']), { target: { value: 'a@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: en['wb4.connect.send'] }));
  await waitFor(() => expect(called('writeback.connect')).toHaveLength(1));
  expect(called('writeback.connect')[0]!.payload).toEqual({ system: 'mail', label: 'Practice mail', environment: 'practice', account: { smtpHost: 'smtp.example.com', from: 'a@example.com' } });
});

test('a refused connect is shown as words, not the engine text', async () => {
  setup({ address: WRITE, handlers: { 'writeback.connect': refuse('DEMO_EXTERNAL_DISABLED') } });
  fireEvent.click(await screen.findByRole('button', { name: en['wb4.connect.open'] }));
  fireEvent.change(screen.getByLabelText(en['wb4.connect.label']), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText(en['wb4.field.smtpHost']), { target: { value: 'h' } });
  fireEvent.change(screen.getByLabelText(en['wb4.field.from']), { target: { value: 'f' } });
  fireEvent.click(screen.getByRole('button', { name: en['wb4.connect.send'] }));
  expect(await screen.findByText(en['wb4.code.DEMO_EXTERNAL_DISABLED'])).toBeTruthy();
  expect(document.body.textContent).not.toContain('raw engine text');
});

test('grants send the full write list; prepare-only rows cannot be granted', async () => {
  const { called } = setup({ address: sheetOf('connection-2'), handlers: { 'writeback.grant': () => ({ id: 'connection-2' }) } });
  const grants = await screen.findByRole('button', { name: en['wb4.grant.save'] });
  const list = grants.closest('form')!;
  fireEvent.click(within(list).getByLabelText('Record a payment'));
  expect(within(list).getByText(new RegExp(en['wb4.grant.waits']))).toBeTruthy();
  fireEvent.click(grants);
  await waitFor(() => expect(called('writeback.grant')).toHaveLength(1));
  expect(called('writeback.grant')[0]!.payload).toEqual({ connectionId: 'connection-2', write: ['invoice.createDraft', 'payment.record'] });
  cleanup();
  setup({ address: sheetOf('connection-3') });
  const box = await screen.findByLabelText('File a return') as HTMLInputElement;
  expect(box.disabled).toBe(true);
  expect(screen.getByText(new RegExp(en['wb4.grant.prepareOnly']))).toBeTruthy();
});

test('a pair key is sent as id:secret and the fields are cleared', async () => {
  const { called } = setup({ address: sheetOf('connection-1'), handlers: { 'writeback.credentials.set': () => ({ stored: true, connectionId: 'connection-1' }) } });
  const id = await screen.findByLabelText(en['wb4.cred.mailId']) as HTMLInputElement;
  const secret = screen.getByLabelText(en['wb4.cred.mailSecret']) as HTMLInputElement;
  expect(secret.type).toBe('password');
  fireEvent.change(id, { target: { value: 'accounts' } });
  fireEvent.change(secret, { target: { value: 's3cret-value' } });
  fireEvent.click(screen.getByRole('button', { name: en['wb4.cred.save'] }));
  await waitFor(() => expect(called('writeback.credentials.set')).toHaveLength(1));
  expect(called('writeback.credentials.set')[0]!.payload).toEqual({ connectionId: 'connection-1', secret: 'accounts:s3cret-value' });
  expect(id.value).toBe('');
  expect(secret.value).toBe('');
  expect(await screen.findByText(en['wb4.cred.saved'])).toBeTruthy();
  expect(document.body.innerHTML).not.toContain('s3cret-value');
});

test('a linked connection has no key form and says where the sign-in lives', async () => {
  setup({ address: sheetOf('connection-2') });
  expect(await screen.findByText(en['wb4.cred.linkedNote'])).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(screen.queryByRole('button', { name: en['wb4.cred.save'] })).toBeNull();
});

test('the sandbox test explains why it cannot run, and shows a refusal as words', async () => {
  setup({ address: sheetOf('connection-2'), view: 'books' });
  expect(await screen.findByText(en['wb4.q.needSandbox'])).toBeTruthy();
  cleanup();
  const ready = overview({ connections: [conn({ credential: 'stored', actions: [action({ granted: true })] })] });
  const { called } = setup({ address: sheetOf('connection-1'), view: 'books', handlers: { 'writeback.overview': () => ready, 'writeback.qualifySandbox': refuse('WRITE_CREDENTIALS_UNAVAILABLE') } });
  const box = await screen.findByLabelText(en['wb4.q.case'].replace('{action}', 'Send a mail'));
  expect(screen.queryByRole('button', { name: en['wb4.q.run'] })).toBeNull();
  fireEvent.change(box, { target: { value: '{"to":"test@example.com","subject":"Test"}' } });
  fireEvent.click(screen.getByRole('button', { name: en['wb4.q.run'] }));
  expect(await screen.findByText(en['wb4.code.WRITE_CREDENTIALS_UNAVAILABLE'])).toBeTruthy();
  expect(called('writeback.qualifySandbox')[0]!.payload).toEqual({ connectionId: 'connection-1', cases: [{ action: 'smtp.send', payload: { to: 'test@example.com', subject: 'Test' } }] });
  expect(document.body.textContent).not.toContain('raw engine text');
});

test('the sandbox test result is shown check by check', async () => {
  const ready = overview({ connections: [conn({ credential: 'stored', actions: [action({ granted: true })] })] });
  setup({ address: sheetOf('connection-1'), view: 'books', handlers: { 'writeback.overview': () => ready,
    'writeback.qualifySandbox': () => ({ level: 'sandbox-verified', connectionId: 'connection-1', rows: [{ action: 'smtp.send', checks: [{ name: 'applied-once-and-read-back', passed: true }, { name: 'same-key-sends-nothing', passed: false }], score: '1/2' }] }) } });
  fireEvent.change(await screen.findByLabelText(en['wb4.q.case'].replace('{action}', 'Send a mail')), { target: { value: '{}' } });
  fireEvent.click(screen.getByRole('button', { name: en['wb4.q.run'] }));
  expect(await screen.findByText(/Score 1\/2/)).toBeTruthy();
  expect(screen.getByText(new RegExp(en['wb4.q.check.same-key-sends-nothing']))).toBeTruthy();
});

test('disconnect asks once more before it sends', async () => {
  const { called } = setup({ address: sheetOf('connection-1'), handlers: { 'writeback.disconnect': () => ({ id: 'connection-1' }) } });
  fireEvent.click(await screen.findByRole('button', { name: en['wb4.disc.open'] }));
  expect(called('writeback.disconnect')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: en['wb4.disc.yes'] }));
  await waitFor(() => expect(called('writeback.disconnect')).toHaveLength(1));
  expect(called('writeback.disconnect')[0]!.payload).toEqual({ connectionId: 'connection-1' });
});

test('an invalid reply gives the error state, not a crash', async () => {
  setup({ address: WRITE, handlers: { 'writeback.overview': () => overview({ connections: [conn({ environment: 'production' })] }) } });
  await waitFor(() => expect(document.body.textContent).toMatch(/INVALID_REPLY/));
  expect(screen.queryByRole('table')).toBeNull();
});

test('limits show the write-back day with its zone, and send the configure payload', async () => {
  const { called } = setup({ address: { place: 'work', sub: 'caps' }, handlers: { 'writeback.configure': () => capsReply.settings } });
  const today = await screen.findByText(new RegExp(`America/New_York ${en['wb4.caps.todayValue'].split('{zone} ')[1]}`));
  expect(today.textContent).toMatch(/14/);
  expect(screen.getByText(en['wb4.caps.zoneNote'].replace('{zone}', 'America/New_York'))).toBeTruthy();
  expect(screen.getByText(en['wb4.caps.hours'].replace('{n}', '168'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en['wb4.caps.edit'] }));
  const form = screen.getByRole('form', { name: en['wb4.caps.edit'] });
  fireEvent.change(within(form).getByLabelText(en['wb4.kind.money']), { target: { value: '12' } });
  fireEvent.change(within(form).getByLabelText(en['wb4.caps.perDay']), { target: { value: '30' } });
  fireEvent.change(within(form).getByLabelText(en['wb4.caps.stopWords']), { target: { value: 'STOP\n  RUKO \n\nBAND KARO' } });
  fireEvent.click(within(form).getByRole('button', { name: en['wb4.caps.save'] }));
  await waitFor(() => expect(called('writeback.configure')).toHaveLength(1));
  expect(called('writeback.configure')[0]!.payload).toEqual({ approvalHours: { 'inside-undoable': 168, 'seen-outside': 24, money: 12, 'cannot-undo': 24 }, reminderCapPerCustomer: 1, reminderCapPerDay: 30, stopWords: ['STOP', 'RUKO', 'BAND KARO'] });
});

test('limits refuse an out-of-range value before sending, and read only for others', async () => {
  const { called } = setup({ address: { place: 'work', sub: 'caps' }, language: 'hi', view: 'simple' });
  expect(await screen.findByText(/America\/New_York/)).toBeTruthy();
  expect(screen.queryByText(hi['wb4.caps.customers'])).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: hi['wb4.caps.edit'] }));
  fireEvent.change(screen.getByLabelText(hi['wb4.caps.perCustomer']), { target: { value: '9' } });
  fireEvent.submit(screen.getByRole('form', { name: hi['wb4.caps.edit'] }));
  expect(await screen.findByText(hi['wb4.caps.badPerCustomer'])).toBeTruthy();
  expect(called('writeback.configure')).toHaveLength(0);
  cleanup();
  setup({ address: { place: 'work', sub: 'caps' }, viewer: true, role: 'viewer', view: 'books' });
  expect(await screen.findByText(en['wb4.caps.customers'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: en['wb4.caps.edit'] })).toBeNull();
});
