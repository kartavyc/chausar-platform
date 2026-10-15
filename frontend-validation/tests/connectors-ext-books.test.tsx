import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { connectorsBooksPlace } from '../../app/ui/src/screens/connectors/index';
import { connectorsExtPlaces } from '../../app/ui/src/places/lane-connectors-ext';
import { placeModuleFor } from '../../app/ui/src/places/registry';

// Synthetic replies shaped by the engine (platform/runtime/connectors-ext/service.ts, tally-export.ts).
type Handler = (payload: Record<string, unknown>) => unknown;
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const schedule = { operation: 'invoices', everyHours: 6, freshnessTargetHours: 24, catchUp: 'run-once', autoImport: false, lastRunAt: '2026-10-15T06:00:00.000Z', lastOutcome: 'refused:SOURCE_TOTAL_MISMATCH', runs: { day: '2026-10-15', count: 2 } };
const base = { branch: 'main', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'm1', status: 'active' };
const zoho = { ...base, id: 'connection_zoho', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', sourceId: 'cx-zoho-books-1', settings: { region: 'in' }, schedule };
const razorpay = { ...base, id: 'connection_rzp', group: 'razorpay', road: 'interface', label: 'Razorpay', company: 'Synthetic Co', sourceId: 'cx-razorpay-1', settings: {}, schedule: null };
const db = { ...base, id: 'connection_db', group: 'plain-database', road: 'database', label: 'Shop database', company: 'Synthetic Co', sourceId: 'cx-plain-database-1', settings: { engine: 'postgres', host: 'db.local', port: '5432', database: 'shop', user: 'reader' } };
const tally = { ...base, id: 'connection_tally', group: 'tally', road: 'file', label: 'Tally (office)', company: 'Synthetic Traders', sourceId: 'cx-tally-1', settings: {} };
const fileConn = { ...base, id: 'connection_csv', group: 'sheet', road: 'file', label: 'Sheet', company: 'Synthetic Co', sourceId: 'cx-sheet-1', settings: {} };
const fresh = (sourceId: string, over: Record<string, unknown> = {}) => ({ sourceId, months: MONTHS.map(month => ({ month, status: month === '2026-09' ? 'loaded' : month === '2026-07' ? 'failed' : 'not-loaded-yet' })),
  lastRead: '2026-10-14T09:00:00.000Z', lastFailure: null, unmappedFields: [], connection: null, schedule: null, stale: null, ...over });
const envelope = (over: Record<string, unknown> = {}) => ({ id: 'envelope_1', connectionId: 'connection_db', sourceId: 'cx-plain-database-1', company: 'Synthetic Co', branch: 'main', group: 'plain-database', operation: 'orders',
  recipeId: 'plain-db.orders', recipeVersion: '1', recipeDigest: 'd', road: 'database', fetchedAt: '2026-10-15T10:00:00.000Z', requestedPeriod: null, period: { from: '2026-10-01', to: '2026-10-14' },
  status: 'accepted', refusal: null, abstention: null,
  checks: [{ id: 'source-total', status: 'passed', expected: '15000050', observed: '15000050' }, { id: 'source-row-count', status: 'passed', expected: 3, observed: 3 }],
  observed: { rowCount: 3, total: '15000050', unit: 'INR' }, sourceTotals: { rowCount: 3, total: '15000050', reference: 'database-aggregate', provenance: 'database-aggregate' },
  unmappedFields: ['notes'], excludedRows: 0, contentHash: 'h', sensitivity: 'financial', notices: [], read: null, committed: null, createdBy: 'm1', pendingRows: 3, pendingExpiresAt: '2026-10-15T16:00:00.000Z', ...over });
const systems = { asOf: '2026-10-15T00:00:00.000Z', board: {}, signIn: {}, groups: [
  { id: 'zoho-books', name: 'Zoho Books', operations: [
    { id: 'invoices-api', label: 'Invoices (core)', depth: 'read', road: 'interface', status: 'tested', owner: 'core', limitation: '' },
    { id: 'invoices', label: 'Invoices', depth: 'read', road: 'interface', status: 'tested', owner: 'connectors-ext', limitation: '' },
    { id: 'payments', label: 'Payments', depth: 'read', road: 'interface', status: 'tested', owner: 'connectors-ext', limitation: '' }] },
  { id: 'razorpay', name: 'Razorpay', operations: [{ id: 'settlements', label: 'Settlements', depth: 'read', road: 'interface', status: 'tested', owner: 'connectors-ext', limitation: '' }] },
] };
const made = { exportId: 'tallyexport_1', fileName: 'chausar-tally-sales-2026-10-01-to-2026-10-14.ps1', script: '# Chausar read-only Tally export\r\nWrite-Output done', guideFileName: 'chausar-tally-guide.txt',
  guide: { en: '1. Copy the script to the computer where Tally runs.\n2. Run it.', hi: '1. स्क्रिप्ट को उस कंप्यूटर पर कॉपी करें जिस पर Tally चलता है।\n2. उसे चलाएँ।' }, expiresAt: '2026-11-14T10:00:00.000Z' };

const BASE: Record<string, Handler> = {
  'connectorsx.connections': () => [zoho, razorpay, db, tally, fileConn],
  'connectorsx.freshness': () => [fresh('cx-zoho-books-1', { stale: true, schedule }), fresh('cx-razorpay-1', { lastRead: null })],
  'connectorsx.systems': () => systems,
  'connectorsx.schedule': payload => ({ ...(payload['connectionId'] === 'connection_rzp' ? razorpay : zoho), schedule: payload['schedule'] === null ? null : { ...(payload['schedule'] as object), lastRunAt: null, lastOutcome: null, runs: { day: '', count: 0 } } }),
  'connectorsx.plainDb.tables': () => [{ schema: 'public', name: 'orders', columns: [{ name: 'order_id', type: 'integer', nullable: false }, { name: 'placed_on', type: 'date', nullable: false }, { name: 'total_paise', type: 'bigint', nullable: false }] }],
  'connectorsx.plainDb.read': () => envelope(),
  'connectorsx.importCommit': () => envelope({ committed: { importId: 'import_1', at: '2026-10-15T10:05:00.000Z', rows: 3, duplicate: false }, pendingRows: 0, pendingExpiresAt: null }),
  'connectorsx.discard': () => envelope({ pendingRows: 0, pendingExpiresAt: null }),
  'connectorsx.tally.exporter': () => made,
  'connectorsx.tally.importExport': () => envelope({ id: 'envelope_2', connectionId: 'connection_tally', sourceId: 'cx-tally-1', group: 'tally', operation: 'sales-register', road: 'file', unmappedFields: [],
    checks: [{ id: 'source-total', status: 'passed', expected: '9900', observed: '9900' }], observed: { rowCount: 2, total: '9900', unit: 'INR' }, sourceTotals: { rowCount: null, total: '9900', reference: 'Sales Accounts', provenance: 'source-declared' } }),
};

function setup({ sub, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: { sub: string; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler> }) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(await handler(payload));
  } };
  const openReceipt = vi.fn();
  function Harness() {
    const [at, setAt] = useState<Address>({ place: 'books', sub });
    return <TextProvider language={language}>{connectorsBooksPlace.render({ address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt, navigate: next => setAt(next ?? { place: 'books' }) })}</TextProvider>;
  }
  render(<Harness />);
  return { called: (method: string) => calls.filter(c => c.method === method), openReceipt };
}
const refuse = (code: string): Handler => () => { throw Object.assign(new Error(code), { code }); };

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:https://frontend-fixture.invalid/file') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => cleanup());

test('the module answers only its three Books sub-places, and the real lookup sends them to it', () => {
  expect(connectorsExtPlaces).toContain(connectorsBooksPlace);
  for (const sub of ['scheduled', 'database', 'tally-export']) {
    expect(connectorsBooksPlace.handles({ place: 'books', sub })).toBe(true);
    expect(placeModuleFor({ place: 'books', sub })?.id).toBe('connectors-ext.books');
  }
  for (const address of [{ place: 'books', sub: 'sources' }, { place: 'books' }, { place: 'work', sub: 'scheduled' }] as Address[]) expect(connectorsBooksPlace.handles(address)).toBe(false);
});

test('scheduled reads list interface connections with schedule, freshness, last run and budgets', async () => {
  setup({ sub: 'scheduled' });
  const table = await screen.findByRole('table');
  expect(within(table).getByText('Zoho Books')).toBeTruthy();
  expect(within(table).getByText('Razorpay')).toBeTruthy();
  expect(within(table).queryByText('Shop database')).toBeNull();
  expect(within(table).getByText('Every 6 hours: Invoices')).toBeTruthy();
  expect(within(table).getByText('Past its freshness target')).toBeTruthy();
  expect(within(table).getByText('Refused', { exact: false })).toBeTruthy();
  expect(within(table).getByText('SOURCE_TOTAL_MISMATCH')).toBeTruthy();
  expect(within(table).getByText('No schedule')).toBeTruthy();
  expect(screen.getByText('At most 3 reads each time Chausar checks, and at most 24 reads a day for each connection.')).toBeTruthy();
  expect(screen.getByText(/only while autonomy is on and this computer is awake, and only for the owner/)).toBeTruthy();
  const squares = within(screen.getAllByRole('list', { name: 'Last twelve months' })[0]!).getAllByRole('img');
  expect(squares).toHaveLength(12);
  expect(squares[8]?.getAttribute('aria-label')).toBe('Jul 2026: failed');
  expect(squares[10]?.getAttribute('aria-label')).toBe('Sep 2026: loaded');
});

test('Simple drops the detail columns; Books keeps them', async () => {
  setup({ sub: 'scheduled', view: 'simple' });
  await screen.findByText('Every 6 hours: Invoices');
  expect(screen.queryByRole('columnheader', { name: 'Last twelve months' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Last scheduled run' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Freshness' })).toBeTruthy();
  cleanup();
  setup({ sub: 'scheduled', view: 'books' });
  await screen.findByText('Every 6 hours: Invoices');
  expect(screen.getByRole('columnheader', { name: 'Last twelve months' })).toBeTruthy();
  expect(screen.getByText(/Freshness target 24 hours/)).toBeTruthy();
});

test('setting a schedule sends the exact fields; turning it off sends null', async () => {
  const { called } = setup({ sub: 'scheduled' });
  const row = (await screen.findByText('Razorpay')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Set a schedule' }));
  const form = await screen.findByRole('form', { name: 'Schedule for Razorpay' });
  expect(within(form).getByRole('radio', { name: 'Settlements' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.change(within(form).getByLabelText('Repeat every (hours)'), { target: { value: '12' } });
  fireEvent.change(within(form).getByLabelText('Freshness target (hours)'), { target: { value: '30' } });
  fireEvent.click(within(form).getByRole('radio', { name: 'Waits for the next slot' }));
  fireEvent.click(within(form).getByRole('radio', { name: 'Yes' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Save the schedule' }));
  await waitFor(() => expect(called('connectorsx.schedule')).toHaveLength(1));
  expect(called('connectorsx.schedule')[0]?.payload).toEqual({ connectionId: 'connection_rzp', schedule: { operation: 'settlements', everyHours: 12, freshnessTargetHours: 30, catchUp: 'skip', autoImport: true } });
  expect(await screen.findByText('Saved. It runs while autonomy is on and the computer is awake.')).toBeTruthy();
  const zohoRow = screen.getByText('Zoho Books').closest('tr')!;
  fireEvent.click(within(zohoRow).getByRole('button', { name: 'Turn off' }));
  await waitFor(() => expect(called('connectorsx.schedule')).toHaveLength(2));
  expect(called('connectorsx.schedule')[1]?.payload).toEqual({ connectionId: 'connection_zoho', schedule: null });
  expect(await screen.findByText('Turned off. Nothing repeats for this connection.')).toBeTruthy();
});

test('a target shorter than the interval cannot be sent, and engine refusals are words', async () => {
  const { called } = setup({ sub: 'scheduled', handlers: { 'connectorsx.schedule': refuse('SCHEDULE_NEEDS_SOURCE_TOTAL') } });
  fireEvent.click(within((await screen.findByText('Zoho Books')).closest('tr')!).getByRole('button', { name: 'Change' }));
  const form = await screen.findByRole('form', { name: 'Schedule for Zoho Books' });
  fireEvent.change(within(form).getByLabelText('Freshness target (hours)'), { target: { value: '2' } });
  expect((within(form).getByRole('button', { name: 'Save the schedule' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(form).getByLabelText('Freshness target (hours)'), { target: { value: '48' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save the schedule' }));
  expect(await screen.findByText("Only a read checked against the source's own total can repeat. This one waits for a total you type.")).toBeTruthy();
  expect(called('connectorsx.schedule')[0]?.payload['schedule']).toMatchObject({ operation: 'invoices', everyHours: 6, freshnessTargetHours: 48, catchUp: 'run-once', autoImport: false });
});

test('Hindi draws every sub-place in Devanagari', async () => {
  setup({ sub: 'scheduled', language: 'hi' });
  expect(await screen.findByText('हर 6 घंटे: Invoices')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: /तय समय पर पढ़ना/ })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'बंद करें' }).length).toBeGreaterThan(0);
  cleanup();
  setup({ sub: 'database', language: 'hi' });
  expect((await screen.findAllByText('Shop database')).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { level: 1, name: /डेटाबेस पढ़ें/ })).toBeTruthy();
  expect(screen.getByText(/भरोसा, क्रेडेंशियल/)).toBeTruthy();
  cleanup();
  setup({ sub: 'tally-export', language: 'hi' });
  expect(await screen.findByRole('heading', { level: 1, name: /दूसरे कंप्यूटर पर टैली/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'स्क्रिप्ट बनाएँ' })).toBeTruthy();
});

test('loading, empty, not installed and locked states', async () => {
  let release: (value: unknown) => void = () => undefined;
  setup({ sub: 'database', handlers: { 'connectorsx.connections': () => new Promise(resolve => { release = resolve; }) } });
  expect(await screen.findByText('Reading…')).toBeTruthy();
  release([]);
  expect(await screen.findByText('No database connection yet. Add one in Sources, Add a source.')).toBeTruthy();
  cleanup();
  setup({ sub: 'tally-export', handlers: { 'connectorsx.connections': refuse('UNKNOWN_METHOD') } });
  expect(await screen.findByText('Not installed in this build.')).toBeTruthy();
  cleanup();
  setup({ sub: 'scheduled', handlers: { 'connectorsx.connections': () => [{ ...zoho, road: 'cloud' }] } });
  expect(await screen.findByText('The reply could not be checked, so nothing from it is shown.')).toBeTruthy();
  expect(screen.queryByText('Zoho Books')).toBeNull();
  cleanup();
  setup({ sub: 'scheduled', handlers: { 'connectorsx.freshness': refuse('METHOD_UNAVAILABLE') } });
  expect(await screen.findByText('Not installed in this build: Freshness.')).toBeTruthy();
  expect(screen.getByText('Every 6 hours: Invoices')).toBeTruthy();
});

test('a viewer sees the pages and no control that changes anything', async () => {
  for (const sub of ['scheduled', 'database', 'tally-export']) {
    setup({ sub, viewer: true, role: 'viewer' });
    expect(await screen.findByText('Your seat can read this page. It cannot change anything here.')).toBeTruthy();
    await screen.findAllByRole('table');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('form')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    cleanup();
  }
});

test('database road: list tables, map columns, read, two figures side by side, then import', async () => {
  const { called } = setup({ sub: 'database' });
  expect(await screen.findByText('The database password is entered in Trust, credentials. It never travels with the connection.')).toBeTruthy();
  expect(screen.getByText(/Chausar only reads/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'List the tables' }));
  const form = await screen.findByRole('form', { name: 'What each column means' });
  expect(called('connectorsx.plainDb.tables')[0]?.payload).toEqual({ connectionId: 'connection_db' });
  expect((within(form).getByRole('button', { name: 'Read the table' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(form).getByLabelText('Row id'), { target: { value: 'order_id' } });
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: 'placed_on' } });
  fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: 'total_paise' } });
  fireEvent.click(within(form).getByRole('radio', { name: 'Whole paise' }));
  fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-10-01' } });
  fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-10-14' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Read the table' }));
  const result = await screen.findByRole('region', { name: 'What the read found' });
  expect(called('connectorsx.plainDb.read')[0]?.payload).toEqual({ connectionId: 'connection_db', mapping: {
    engine: 'postgres', table: { schema: 'public', name: 'orders' }, columns: { id: 'order_id', date: 'placed_on', amount: 'total_paise' }, measure: 'money', moneyUnit: 'minor', dateFormat: 'ISO',
    currency: 'INR', constantKind: 'invoice', period: { from: '2026-10-01', to: '2026-10-14' } } });
  const totalRow = within(result).getByText('Total').closest('tr')!;
  expect(within(totalRow).getAllByText('₹1,50,000.50')).toHaveLength(2);
  expect(within(within(result).getByText('Rows').closest('tr')!).getAllByText('3 rows')).toHaveLength(2);
  expect(within(result).getByText("The source's figure is the database's own COUNT and SUM, from the same read-only snapshot.")).toBeTruthy();
  expect(within(result).getByText('Fields no mapping covers: notes')).toBeTruthy();
  expect(called('connectorsx.importCommit')).toHaveLength(0);
  fireEvent.click(within(result).getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(called('connectorsx.importCommit')[0]?.payload).toEqual({ envelopeId: 'envelope_1' }));
  expect(await screen.findByText('Imported: 3 rows.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
});

test('a refused database read offers no import and says why; demo mode and a missing password are words', async () => {
  setup({ sub: 'database', handlers: { 'connectorsx.plainDb.read': () => envelope({ status: 'refused', refusal: { code: 'SOURCE_TOTAL_MISMATCH', reason: 'The total differs.' }, pendingRows: 0,
    checks: [{ id: 'source-total', status: 'failed', expected: '15000050', observed: '14000050' }] }) } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the tables' }));
  const form = await screen.findByRole('form', { name: 'What each column means' });
  fireEvent.change(within(form).getByLabelText('Row id'), { target: { value: 'order_id' } });
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: 'placed_on' } });
  fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: 'total_paise' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Read the table' }));
  const result = await screen.findByRole('region', { name: 'What the read found' });
  expect(within(result).getByText('Refused. Nothing from this read reaches an answer.')).toBeTruthy();
  expect(within(result).getByText('₹1,40,000.50')).toBeTruthy();
  expect(within(result).getByText('They differ')).toBeTruthy();
  expect(within(result).queryByRole('button', { name: 'Import' })).toBeNull();
  cleanup();
  setup({ sub: 'database', handlers: { 'connectorsx.plainDb.tables': refuse('DEMO_EXTERNAL_DISABLED') } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the tables' }));
  expect(await screen.findByText('This is a demo workspace. Outside systems stay off, so nothing is read.')).toBeTruthy();
  cleanup();
  setup({ sub: 'database', handlers: { 'connectorsx.plainDb.tables': refuse('DB_CREDENTIAL_REQUIRED') } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the tables' }));
  expect(await screen.findByText('Enter the database password in Trust, credentials first.')).toBeTruthy();
});

test('an accountant can read a mapped table but leaves listing tables to an owner', async () => {
  const { called } = setup({ sub: 'database', role: 'accountant' });
  expect(await screen.findByText('An owner lists the tables of a database.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'List the tables' })).toBeNull();
  expect(called('connectorsx.plainDb.tables')).toHaveLength(0);
});

test('Tally on another computer: make the script, save both files, read the guide, bring the answer back and set it aside', async () => {
  const { called } = setup({ sub: 'tally-export' });
  const form = await screen.findByRole('form', { name: 'Make the script' });
  fireEvent.click(within(form).getByRole('radio', { name: 'Purchase' }));
  fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-10-01' } });
  fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-10-14' } });
  fireEvent.change(within(form).getByLabelText('Ledgers, one per line'), { target: { value: 'Purchase Accounts\n\n  Freight Inward  ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Make the script' }));
  await waitFor(() => expect(called('connectorsx.tally.exporter')).toHaveLength(1));
  expect(called('connectorsx.tally.exporter')[0]?.payload).toEqual({ connectionId: 'connection_tally', register: 'purchase', period: { from: '2026-10-01', to: '2026-10-14' }, ledgers: ['Purchase Accounts', 'Freight Inward'], baseCurrency: 'INR' });
  const script = await screen.findByRole('link', { name: `Save ${made.fileName}` });
  expect(script.getAttribute('download')).toBe(made.fileName);
  expect(screen.getByRole('link', { name: 'Save chausar-tally-guide.txt' }).getAttribute('download')).toBe('chausar-tally-guide.txt');
  const blobs = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0] as Blob);
  expect(await blobs[0]!.text()).toBe(made.script);
  const guide = document.querySelector('[data-guide]')!;
  expect(guide.textContent).toBe(made.guide.en);
  fireEvent.click(screen.getByRole('radio', { name: 'हिन्दी' }));
  expect(document.querySelector('[data-guide]')!.textContent).toBe(made.guide.hi);
  const answer = new File(['{"exportId":"tallyexport_1","responses":[]}'], 'chausar-tally-purchase-answers.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Answer file'), { target: { files: [answer] } });
  await waitFor(() => expect(called('connectorsx.tally.importExport')).toHaveLength(1));
  expect(called('connectorsx.tally.importExport')[0]?.payload).toEqual({ connectionId: 'connection_tally', text: '{"exportId":"tallyexport_1","responses":[]}' });
  const result = await screen.findByRole('region', { name: 'What the read found' });
  expect(within(result).getAllByText('₹99')).toHaveLength(2);
  expect(within(result).getByText("The source's figure is a total the source itself states.")).toBeTruthy();
  fireEvent.click(within(result).getByRole('button', { name: 'Set aside' }));
  await waitFor(() => expect(called('connectorsx.discard')[0]?.payload).toEqual({ envelopeId: 'envelope_2' }));
  expect(await screen.findByText('Set aside. Nothing was imported.')).toBeTruthy();
  expect(called('connectorsx.importCommit')).toHaveLength(0);
});

test('Tally refusals and a not-installed exporter are words', async () => {
  setup({ sub: 'tally-export', handlers: { 'connectorsx.tally.exporter': refuse('UNKNOWN_METHOD'), 'connectorsx.tally.importExport': refuse('TALLY_EXPORT_MISMATCH') } });
  fireEvent.click(await screen.findByRole('button', { name: 'Make the script' }));
  expect(await screen.findByText('Not installed in this build: the Tally script.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Answer file'), { target: { files: [new File(['{}'], 'answers.json')] } });
  expect(await screen.findByText('This answer file answers other questions than the ones Chausar asked.')).toBeTruthy();
  cleanup();
  setup({ sub: 'tally-export', handlers: { 'connectorsx.connections': () => [zoho] } });
  expect(await screen.findByText('No Tally connection yet. Add one in Sources, Add a source.')).toBeTruthy();
});
