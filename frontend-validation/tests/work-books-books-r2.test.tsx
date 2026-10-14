import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { booksPlace } from '../../app/ui/src/screens/books/index';
import { sheetOf } from '../../app/ui/src/screens/books/shared';

// Synthetic replies shaped by the round-2 Books contract in docs/lanes/work-books.md.
type Handler = (payload: Record<string, unknown>) => unknown;
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const row = (over: Record<string, unknown> = {}) => ({ sourceId: 'cx-zoho-1', system: 'Zoho Books', way: 'signed-in', scope: 'Synthetic Co', lastReadAt: null,
  months: MONTHS.map(month => ({ month, state: month === '2026-07' ? 'failed' : month === '2026-09' ? 'loading' : 'not-loaded-yet' })), rows: 0, refused: 1, unmapped: 1, experimental: true, connected: true,
  connection: { connectionId: 'connection-1', group: 'zoho-books', road: 'interface', status: 'active' }, lastFailure: { at: '2026-07-31T00:00:00Z', code: 'SOURCE_NETWORK_FAILED' }, stale: false, ...over });
const envelope = (over: Record<string, unknown> = {}) => ({ id: 'envelope-1', sourceId: 'cx-zoho-1', at: '2026-10-10T10:00:00Z', operation: 'invoices', recipeId: 'zoho-books.invoices.gross', recipeVersion: '1',
  status: 'accepted', refusal: null, abstention: null, period: { from: '2026-09-01', to: '2026-09-30' }, rows: 3, excludedRows: 0,
  total: { measure: 'money', unit: 'INR', ours: '150000', theirs: '150000', match: 'yes' }, checks: [{ id: 'source-total', status: 'passed' }], unmappedFields: [], notices: [], waiting: true, committed: null, ...over });
const connection = { connectionId: 'connection-1', sourceId: 'cx-zoho-1', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', branch: 'main', status: 'active',
  operations: [{ id: 'invoices', label: 'Invoices (gross)', limitation: 'The person enters the report total.', live: true }] };
const system = (over: Record<string, unknown> = {}) => ({ id: 'tally', name: 'Tally', family: 'accounting', depth: 'read', available: true, status: 'tested', tier: 'experimental', liveVerified: false,
  evidence: { synthetic: 6, madeToOrder: 0, realWithConsent: 0 }, ways: ['interface', 'file'], signIn: { method: 'key', note: 'Tally needs no sign-in.' }, settings: ['company', 'ledgers'],
  operations: [{ id: 'sales-register', label: 'Sales Register', depth: 'read', road: 'interface', status: 'tested', tier: 'experimental', limitation: 'This computer only.', evidence: { synthetic: 6, madeToOrder: 0, realWithConsent: 0 } },
    { id: 'write', label: 'Write', depth: 'full', road: 'interface', status: 'planned', tier: 'planned', limitation: 'Not installed.', evidence: { synthetic: 0, madeToOrder: 0, realWithConsent: 0 } }], ...over });
const proposal = (over: Record<string, unknown> = {}) => ({ id: 'proposal-1', sourceId: 'sheet', field: 'channel', target: 'channel', origin: 'person', state: 'proposed', proposedBy: 'Ravi', at: '2026-10-12T10:00:00Z',
  valid: true, fieldBound: true, digest: 'd1', scope: { system: 'csv', company: 'Synthetic Co', branches: ['main'] },
  bindings: [{ target: 'amountMinor', source: 'amount', type: 'money', state: 'accepted', acceptedBy: null, grade: 'reconciled', change: 'same' },
    { target: 'channel', source: 'channel', type: 'string', state: 'proposed', acceptedBy: null, grade: null, change: 'new' }],
  dropped: [], issues: [], removed: [], missingTargets: [], decided: null, libraryId: null, baseChanged: false, ...over });
const cell = (minor: string, receiptId: string | null) => ({ value: { minor }, refused: null, receiptId,
  receipt: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, counted: 2, excluded: 1, definitions: ['billed'], completeness: 'partial' } });
const trial = { trialId: 'trial-1', draftId: 'draft-1', proposalId: null, experimental: true, status: 'evaluated', change: { type: 'definition', target: 'billed' }, cost: { preparationMs: 40, diskBytes: 4096 },
  evaluationDigest: 'e1', impact: { digest: 'i1', strategy: 'prospective', affectedAnswers: 1, rebuild: 0, activeWork: 0 }, impactCode: null, limitations: ['Synthetic copy.'],
  rows: [{ answerId: 'a1', operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, now: cell('50000', 'r1'), withChange: cell('40000', null), differs: true },
    { answerId: 'a2', operation: 'received', period: null, now: cell('9000', 'r2'), withChange: cell('9000', null), differs: false }] };

const BASE: Record<string, Handler> = {
  'books.sources': () => ({ rows: [row()], unmappedFields: 1, freshness: { available: true } }),
  'books.source': () => ({ row: row(), reads: [], refusals: [], kinds: [], unmappedFields: ['cf_region'], connectors: { available: true }, connection, envelopes: [envelope({ waiting: false, committed: { at: '2026-10-10T11:00:00Z', rows: 3, duplicate: false } })] }),
  'books.readNow': () => envelope(),
  'books.importRead': () => envelope({ waiting: false, committed: { at: '2026-10-14T11:00:00Z', rows: 3, duplicate: false } }),
  'books.signIn': () => ({ sourceId: 'cx-zoho-1', method: 'browser', url: 'https://accounts.zoho.in/oauth/v2/auth?client_id=abc', expiresInSeconds: 600, note: null }),
  'books.pause': () => ({ ...connection, status: 'paused' }),
  'books.systems': () => ({ available: true, systems: [system(), system({ id: 'gst-provider', name: 'GST provider', depth: null, available: false, status: 'planned', tier: 'planned', ways: [], settings: [], operations: [] })] }),
  'books.connect': () => ({ connectionId: 'connection-2', sourceId: 'cx-tally-2', group: 'tally', road: 'interface', label: 'Tally', company: 'Synthetic Co', branch: 'main', status: 'active' }),
  'books.recipes': () => ({ available: true, recipes: [{ id: 'zoho-books.invoices.gross', version: '2', system: 'zoho-books', operation: 'invoices', title: 'Zoho invoices', state: 'failed', totals: 'report', measure: 'money', lastReadAt: '2026-10-10T10:00:00Z' }],
    proposals: [{ id: 'proposal-1', sourceId: 'sheet', field: 'channel', state: 'proposed', proposedBy: 'Ravi', at: '2026-10-12T10:00:00Z', valid: true }] }),
  'books.recipe': () => ({ recipe: { id: 'zoho-books.invoices.gross', version: '2', system: 'zoho-books', operation: 'invoices', title: 'Zoho invoices', state: 'failed', totals: 'report', measure: 'money', lastReadAt: '2026-10-10T10:00:00Z' },
    scope: { system: 'zoho-books', company: 'Synthetic Co', branch: 'main', gstin: null, period: { from: '2026-09-01', to: '2026-09-30' } },
    bindings: [{ meaning: 'amount', headings: ['total'], type: 'money', required: true, state: 'seed', acceptedBy: null, grade: null }],
    check: { envelopeId: 'envelope-1', at: '2026-10-10T10:00:00Z', measure: 'money', unit: 'INR', ours: '150000', theirs: '149000', match: 'no' },
    questions: [{ envelopeId: 'envelope-0', sourceId: 'cx-zoho-1', at: '2026-10-09T10:00:00Z', reason: 'value-not-in-list', detail: 'unknown_value', field: 'status', question: 'What does "void" mean?', choices: ['cancelled', 'ignore'], ours: null, theirs: null, measure: 'money', unit: 'INR' }],
    newer: { readWith: '1', current: '2' }, notices: ['Gross only.'], sourceIds: ['cx-zoho-1'] }),
  'books.proposal': () => proposal(),
  'books.decideProposal': () => proposal({ state: 'accepted', decided: { by: 'Owner', role: 'owner', at: '2026-10-14T00:00:00Z' }, libraryId: 'saved-1',
    bindings: [{ target: 'channel', source: 'channel', type: 'string', state: 'accepted', acceptedBy: { by: 'Owner', role: 'owner', at: '2026-10-14T00:00:00Z' }, grade: 'owner', change: 'new' }] }),
  'books.unmapped': () => ({ fields: [{ field: 'channel', sourceIds: ['sheet'], type: 'text', filled: { rows: 1, of: 2 }, origin: 'file', recipeId: null, mappable: true },
    { field: 'cf_region', sourceIds: ['cx-zoho-1'], type: 'unknown', filled: null, origin: 'connector', recipeId: 'zoho-books.invoices.gross', mappable: false }] }),
  'books.mapField': () => proposal(),
  'books.trialRead': () => ({ trial }),
  'books.trialQuestions': () => ({ available: true, questions: [{ id: 'a1', receiptId: 'r1', operation: 'billed', period: null, stale: false }, { id: 'a3', receiptId: 'r3', operation: 'earned', period: null, stale: true }] }),
  'books.trial': () => trial,
  'books.trialPublish': () => ({ trialId: 'trial-1', status: 'promoted', publicationId: 'pub-1', draftId: 'draft-1', proposalId: null }),
  'books.trialDiscard': () => ({ trialId: 'trial-1', status: 'discarded', cleanupComplete: true }),
  'books.memory': () => ({ lines: [{ id: 'profile:bp-2', text: 'Notebooks and pens', kind: 'claim', status: 'corrected', source: 'told-by-owner', receiptId: null, learnedAt: '2026-09-05T00:00:00Z',
    confirmedAt: '2026-09-05T00:00:00Z', earlier: [{ text: 'Notebooks', at: '2026-09-01T00:00:00Z' }], origin: 'business-profile', field: 'products', readOnly: true }] }),
  'books.forget': payload => ({ id: payload['id'], deleted: true }),
};

function setup({ address, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: { address: Address; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler> }) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const openReceipt = vi.fn();
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    return <TextProvider language={language}>{booksPlace.render({ address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt, navigate: next => setAt(next ?? { place: 'books' }) })}</TextProvider>;
  }
  render(<Harness />);
  return { openReceipt, called: (method: string) => calls.filter(c => c.method === method) };
}
const refuse = (code: string) => () => { throw Object.assign(new Error(code), { code }); };

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite')); });
afterEach(() => cleanup());

test('a connected system with no import is a row with failed and loading months and its last failure', async () => {
  setup({ address: { place: 'books', sub: 'sources' } });
  await screen.findByText('Zoho Books');
  const squares = within(screen.getByRole('list', { name: 'Last twelve months' })).getAllByRole('img');
  expect(squares[8]?.getAttribute('aria-label')).toBe('Jul 2026: failed');
  expect(squares[10]?.getAttribute('aria-label')).toBe('Sep 2026: loading');
  expect(screen.getByText(/Last failed read: .*SOURCE_NETWORK_FAILED/)).toBeTruthy();
  expect(screen.queryByText(/Not built yet: freshness/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add a source' }));
  await screen.findByText('GST provider');
});

test('read now shows the envelope with two totals and imports only after review; sign in shows the address as text', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { called } = setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') } });
  expect(await screen.findByRole('heading', { name: 'History of reads' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Report total in rupees (from the system's own report)"), { target: { value: '1500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read now' }));
  expect(await screen.findByText("The read passed its checks against the source's own totals.")).toBeTruthy();
  expect(called('books.readNow')[0]?.payload).toMatchObject({ sourceId: 'cx-zoho-1', operation: 'invoices', reportTotals: { total: '150000' } });
  expect(screen.getByText('They match.')).toBeTruthy();
  expect(called('books.importRead')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(called('books.importRead')[0]?.payload).toEqual({ envelopeId: 'envelope-1' }));
  expect(await screen.findByText('Imported: 3 rows.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  expect(await screen.findByText('Sign-in happens in your browser.')).toBeTruthy();
  expect(screen.getByText('https://accounts.zoho.in/oauth/v2/auth?client_id=abc')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(called('books.pause')[0]?.payload).toEqual({ sourceId: 'cx-zoho-1', paused: true }));
});

test('demo mode: a refused external read is a plain sentence, not a code', async () => {
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, handlers: { 'books.readNow': refuse('DEMO_EXTERNAL_DISABLED') } });
  await screen.findByRole('heading', { name: 'History of reads' });
  fireEvent.click(screen.getByRole('button', { name: 'Read now' }));
  expect(await screen.findByText(/This is the demo\. Chausar does not reach any outside system here/)).toBeTruthy();
});

test('an accountant reads and imports but cannot pause, sign in or remove; a viewer gets no controls', async () => {
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, role: 'accountant' });
  await screen.findByRole('heading', { name: 'History of reads' });
  expect(screen.getByRole('button', { name: 'Read now' })).toBeTruthy();
  for (const name of ['Pause', 'Sign in again', 'Remove the connection']) expect(screen.queryByRole('button', { name })).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, role: 'viewer', viewer: true });
  await screen.findByRole('heading', { name: 'History of reads' });
  for (const name of ['Read now', 'Pause', 'Sign in again']) expect(screen.queryByRole('button', { name })).toBeNull();
});

test('add a source: per-operation claims, planned systems, Tally asks which company and sends no secret', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'add' } });
  await screen.findByText('Tally');
  expect(screen.getByText('Planned, not available yet.')).toBeTruthy();
  expect(screen.getAllByText('6 synthetic, 0 made to order, 0 real with consent').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tally' }));
  expect(await screen.findByText('Which company?')).toBeTruthy();
  expect(screen.getAllByText('planned, not available yet').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('radio', { name: 'Another computer' }));
  expect(screen.getByText(/on another computer, export the Day Book/)).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'This computer' }));
  fireEvent.change(screen.getByLabelText('Which company?'), { target: { value: 'Synthetic Co' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(called('books.connect')[0]?.payload).toEqual({ group: 'tally', road: 'interface', company: 'Synthetic Co', settings: { company: 'Synthetic Co' } }));
  expect(await screen.findByText(/Connected\. Open the source to read it\./)).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'add', sheet: sheetOf('tally') }, role: 'accountant' });
  expect(await screen.findByText('An owner or cofounder adds a connection.')).toBeTruthy();
});

test('a recipe: scope in five fields, seed bindings nobody accepted, totals that differ, a question with its reason, a newer version', async () => {
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf('r:zoho-books.invoices.gross') } });
  expect(await screen.findByText('Totals do not match: the recipe is not accepted.')).toBeTruthy();
  expect(screen.getByText('Tax registration')).toBeTruthy();
  expect(screen.getByText('shipped with Chausar; no person has accepted it yet')).toBeTruthy();
  expect(screen.getByText('A value not in the list')).toBeTruthy();
  expect(screen.getByText('cancelled')).toBeTruthy();
  expect(screen.getByText(/the last read used version 1; version 2 is in use now/)).toBeTruthy();
});

test('map this field proposes through the engine, stays proposed until a named person accepts', async () => {
  let decided = false;
  const { called } = setup({ address: { place: 'books', sub: 'unmapped' }, handlers: {
    'books.proposal': () => decided ? BASE['books.decideProposal']!({}) : proposal(), 'books.decideProposal': payload => { decided = true; return BASE['books.decideProposal']!(payload); } } });
  await screen.findByText('channel');
  expect(screen.getByRole('button', { name: 'Changed in its own recipe' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Map this field' }));
  fireEvent.change(screen.getByLabelText('Meaning it holds (a dictionary word, such as description)'), { target: { value: 'channel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  await waitFor(() => expect(called('books.mapField')[0]?.payload).toEqual({ sourceId: 'sheet', field: 'channel', target: 'channel', type: 'string' }));
  expect(await screen.findByText('This proposal maps the field channel.')).toBeTruthy();
  expect(screen.getAllByText('proposed').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(called('books.decideProposal')[0]?.payload).toEqual({ id: 'proposal-1', decision: 'accept', digest: 'd1' }));
  expect(await screen.findByText(/Accepted by Owner, owner/)).toBeTruthy();
});

test('try a change on a copy: two columns, ink where they differ, receipts, publish with the reviewed digests', async () => {
  const { called, openReceipt } = setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') } });
  expect(await screen.findByText('The copy never runs an action and never sends anything out.')).toBeTruthy();
  expect(called('books.trialRead')[0]?.payload).toEqual({ draftId: 'draft-1' });
  const copyCell = await screen.findByRole('button', { name: 'Receipt on the copy: billed' });
  expect(copyCell.querySelector('[class*="ink"]')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Receipt on the copy: received' }).querySelector('[class*="grey"]')).toBeTruthy();
  fireEvent.click(copyCell);
  expect(await screen.findByText('2 rows counted, 1 left out')).toBeTruthy();
  const now = screen.getAllByRole('button').find(b => /₹/.test(b.textContent ?? '') && !/Receipt on the copy/.test(b.getAttribute('aria-label') ?? ''));
  fireEvent.click(now!);
  expect(openReceipt).toHaveBeenCalledWith('r1');
  expect(screen.getByText('Publishing changes 1 saved answers; 0 answers are rebuilt.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(called('books.trialPublish')[0]?.payload).toEqual({ trialId: 'trial-1', evaluationDigest: 'e1', impactDigest: 'i1' }));
  expect(await screen.findByText('Published. It is in use everywhere now.')).toBeTruthy();
});

test('making the copy: pick saved questions, stale ones unticked; an accountant cannot publish', async () => {
  let made = false;
  const { called } = setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') }, role: 'accountant',
    handlers: { 'books.trialRead': () => ({ trial: made ? trial : null }), 'books.trial': () => { made = true; return trial; } } });
  const fresh = await screen.findByRole('checkbox', { name: /billed/ });
  expect((fresh as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: /earned/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Make the copy' }));
  await waitFor(() => expect(called('books.trial')[0]?.payload).toEqual({ draftId: 'draft-1', savedAnswerIds: ['a1'] }));
  await screen.findByRole('button', { name: 'Receipt on the copy: billed' });
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(called('books.trialDiscard')[0]?.payload).toEqual({ trialId: 'trial-1' }));
});

test('memory: a business profile entry is read-only with its earlier version and can be deleted', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'memory' } });
  await screen.findByText('Notebooks and pens');
  expect(screen.getByText('Business profile: products')).toBeTruthy();
  expect(screen.getByText('Notebooks')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
  await waitFor(() => expect(called('books.forget')[0]?.payload).toEqual({ id: 'profile:bp-2' }));
});

test('Hindi words draw, and an engine without the new methods shows not built yet', async () => {
  setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') }, language: 'hi' });
  expect(await screen.findByText('नक़ल कभी कोई कार्रवाई नहीं करती और कभी कुछ बाहर नहीं भेजती।')).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'recipes' }, handlers: { 'books.recipes': refuse('UNKNOWN_METHOD') } });
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
});
