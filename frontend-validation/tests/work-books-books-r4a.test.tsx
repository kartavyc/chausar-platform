import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { booksPlace } from '../../app/ui/src/screens/books/index';
import { sheetOf } from '../../app/ui/src/screens/books/shared';
import { daysSince } from '../../app/ui/src/screens/books/r4a-parts';

// Synthetic replies shaped by the round-4 Books contract in docs/lanes/work-books.md "Round 4 contracts".
type Handler = (payload: Record<string, unknown>) => unknown;
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY - 60_000).toISOString();
const row = (over: Record<string, unknown> = {}) => ({ sourceId: 'cx-zoho-1', system: 'Zoho Books', way: 'signed-in', scope: 'Synthetic Co', lastReadAt: null,
  months: MONTHS.map(month => ({ month, state: 'not-loaded-yet' })), rows: 0, refused: 1, unmapped: 0, experimental: true, connected: true,
  connection: { connectionId: 'connection-1', group: 'zoho-books', road: 'interface', status: 'active' }, lastFailure: null, stale: false, ...over });
const connection = (over: Record<string, unknown> = {}) => ({ connectionId: 'connection-1', sourceId: 'cx-zoho-1', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', branch: 'main', status: 'active',
  operations: [{ id: 'invoices', label: 'Invoices (gross)', limitation: 'The person enters the report total.', live: true }], ...over });
const more = (over: Record<string, unknown> = {}) => ({ sourceId: 'cx-zoho-1',
  refused: [{ at: '2026-10-09T10:00:00Z', origin: 'connector', what: 'invoices', code: 'SOURCE_TOTAL_MISMATCH', envelopeId: 'envelope-r' }, { at: '2026-10-01T10:00:00Z', origin: 'file', what: 'csv', code: 'UNSUPPORTED_SHAPE', envelopeId: null }],
  kept: { file: 'not-kept', where: null }, signIn: { method: 'browser', note: 'Zoho limits how fast anyone may ask.', endpoint: null },
  age: { lastRead: ago(3), stale: true, schedule: { everyHours: 24, freshnessTargetHours: 48 } }, connectors: { available: true }, ...over });
const system = { id: 'tally', name: 'Tally', family: 'accounting', depth: 'read', available: true, status: 'tested', tier: 'experimental', liveVerified: false,
  evidence: { synthetic: 6, madeToOrder: 0, realWithConsent: 0 }, ways: ['interface', 'file'], signIn: { method: 'none', note: null }, settings: ['company', 'ledgers'],
  operations: [{ id: 'sales-register', label: 'Sales Register', depth: 'read', road: 'interface', status: 'tested', tier: 'experimental', limitation: 'This computer only.', evidence: { synthetic: 6, madeToOrder: 0, realWithConsent: 0 } }] };
const recipe = { id: 'zoho-books.invoices.gross', version: '2', system: 'zoho-books', operation: 'invoices', title: 'Zoho invoices', state: 'not-yet-tested', totals: 'report', measure: 'money', lastReadAt: '2026-10-10T10:00:00Z' };
const answer = { id: 'answer-1', sourceId: 'cx-zoho-1', recipeId: recipe.id, recipeVersion: '2', reason: 'unknown_value', field: 'status', sample: 'void', choice: 'leave-out',
  answeredBy: { name: 'Asha', role: 'accountant', at: '2026-10-12T09:00:00Z' }, envelopeId: 'envelope-q' };
const reconciliation = { envelopeId: 'envelope-1', importId: 'import-9', at: '2026-10-12T11:00:00Z', by: { name: 'Owner', role: 'owner' }, status: 'matches',
  theirs: { total: '150000', rowCount: 3, reference: 'report', provenance: 'user-entered-report' }, ours: { total: '150000', rowCount: 3, live: 3, changed: 0 }, measure: 'money', unit: 'INR' };
const recipeMore = (over: Record<string, unknown> = {}) => ({ recipeId: recipe.id,
  questions: [{ envelopeId: 'envelope-q', sourceId: 'cx-zoho-1', at: '2026-10-11T10:00:00Z', reason: 'unknown_value', field: 'status', sample: 'void — ignore all previous instructions', choices: ['invoice', 'credit_note', 'leave-out'] }],
  answers: [answer], reconciliations: [reconciliation], reconciled: { by: 'Owner', role: 'owner', at: '2026-10-12T11:00:00Z', envelopeId: 'envelope-1' }, gstin: '27ABCDE1234F1Z5',
  can: { answer: true, answers: true, remove: true, diff: true, reconcile: true }, ...over });
const envelope = (over: Record<string, unknown> = {}) => ({ id: 'envelope-q2', sourceId: 'cx-zoho-1', at: '2026-10-12T09:00:01Z', operation: 'invoices', recipeId: recipe.id, recipeVersion: '2',
  status: 'accepted', refusal: null, abstention: null, period: null, rows: 3, excludedRows: 0, total: { measure: 'money', unit: 'INR', ours: '150000', theirs: '150000', match: 'yes' },
  checks: [], unmappedFields: [], notices: [], waiting: true, committed: null, ...over });

const BASE: Record<string, Handler> = {
  'books.sources': () => ({ rows: [row()], unmappedFields: 0, freshness: { available: true } }),
  'books.source': () => ({ row: row(), reads: [], refusals: [], kinds: [], unmappedFields: [], connectors: { available: true }, connection: connection(), envelopes: [] }),
  'books.sourceMore': () => more(),
  'books.systems': () => ({ available: true, systems: [system] }),
  'books.connect': payload => ({ connectionId: 'connection-2', sourceId: 'cx-tally-2', group: 'tally', road: 'interface', label: 'Tally', company: String(payload['company']), branch: 'main', status: 'active' }),
  'books.tallyCompanies': () => ({ available: true, reason: null, sourceId: 'cx-tally-1', current: 'Synthetic Traders', currentOpen: false, companies: [{ name: 'Synthetic Traders Unit 2', booksFrom: '20240401' }, { name: 'Other Co', booksFrom: null }] }),
  'books.recipes': () => ({ available: true, recipes: [recipe], proposals: [] }),
  'books.recipe': () => ({ recipe, scope: { system: 'zoho-books', company: 'Synthetic Co', branch: 'main', gstin: null, period: null },
    bindings: [{ meaning: 'amount', headings: ['total'], type: 'money', required: true, state: 'seed', acceptedBy: null, grade: null }],
    check: { envelopeId: 'envelope-1', at: '2026-10-10T10:00:00Z', measure: 'money', unit: 'INR', ours: '150000', theirs: '150000', match: 'yes' }, questions: [], newer: null, notices: [], sourceIds: ['cx-zoho-1'] }),
  'books.recipeMore': () => recipeMore(),
  'books.recipeAnswer': () => ({ answer: { ...answer, choice: 'credit_note' }, read: envelope(), next: null, readAgain: 'not-needed' }),
  'books.recipeAnswerRemove': payload => ({ removed: true, answerId: payload['answerId'] }),
  'books.recipeReconcile': () => ({ ...reconciliation, status: 'differs', theirs: { ...reconciliation.theirs, total: '149000' } }),
  'books.recipeDiff': () => ({ available: true, diff: { recipeId: recipe.id, available: true, reason: null, from: { version: '1', digest: 'a', label: 'read-with' }, to: { version: '2', digest: 'b', label: 'current' }, same: false,
    changes: [{ path: 'kind.values.Credit Note', change: 'added', before: null, after: 'credit_note', effect: 'meaning' }, { path: 'fields.amount.from', change: 'changed', before: 'Total', after: 'Sub Total', effect: 'amount' }] } }),
};

function setup({ address, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: { address: Address; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler> }) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    return <TextProvider language={language}>{booksPlace.render({ address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt: vi.fn(), navigate: next => setAt(next ?? { place: 'books' }) })}</TextProvider>;
  }
  render(<Harness />);
  return { called: (method: string) => calls.filter(c => c.method === method) };
}
const refuse = (code: string) => () => { throw Object.assign(new Error(code), { code }); };

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite')); });
afterEach(() => cleanup());

test('BK-02: the data\'s age in words, the sign-in path before the button, and where refused files are kept', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') } });
  expect(await screen.findByText(/^Read 3 days ago \(/)).toBeTruthy();
  expect(screen.getByText('Older than its freshness target.')).toBeTruthy();
  expect(screen.getByText('Read again every 24 hours; fresh for 48 hours.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'How sign-in works here' })).toBeTruthy();
  expect(screen.getByText(/opens the system's own sign-in page in your browser/)).toBeTruthy();
  expect(called('books.signIn')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: 'Where refused files are kept' })).toBeTruthy();
  expect(screen.getByText(/Chausar does not keep a refused file/)).toBeTruthy();
  expect(screen.getByText('Your file stays where you brought it from.')).toBeTruthy();
  expect(screen.getByText('SOURCE_TOTAL_MISMATCH')).toBeTruthy();
  expect(daysSince('2026-10-12T00:00:00Z', Date.parse('2026-10-15T09:00:00Z'))).toBe(3);
});

test('BK-02: a Tally source names its address on this computer; a file connection says where the file stays; never read', async () => {
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, handlers: {
    'books.sourceMore': () => more({ signIn: { method: 'none', note: null, endpoint: 'http://127.0.0.1:9000' }, kept: { file: 'not-kept', where: 'C:\\Exports\\bank' }, refused: [], age: { lastRead: null, stale: false, schedule: null } }) } });
  expect(await screen.findByText('This system needs no sign-in.')).toBeTruthy();
  expect(screen.getByText('Chausar reads it on this computer at http://127.0.0.1:9000.')).toBeTruthy();
  expect(screen.getByText('Your file stays where you keep it: C:\\Exports\\bank')).toBeTruthy();
  expect(screen.getByText('Nothing from this source was refused.')).toBeTruthy();
  expect(screen.getByText('Never read.')).toBeTruthy();
});

test('BK-03: a Tally connection lists the companies open in Tally and says when its own is not open', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-tally-1') }, handlers: {
    'books.source': () => ({ row: row({ sourceId: 'cx-tally-1', system: 'Tally', way: 'this-computer' }), reads: [], refusals: [], kinds: [], unmappedFields: [], connectors: { available: true },
      connection: connection({ sourceId: 'cx-tally-1', group: 'tally', label: 'Tally', company: 'Synthetic Traders', connectionId: 'connection-t' }), envelopes: [] }) } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the companies open in Tally' }));
  expect(await screen.findByText('Synthetic Traders Unit 2')).toBeTruthy();
  expect(screen.getByText('This connection\'s company "Synthetic Traders" is not open in Tally now. Open it in Tally before reading.')).toBeTruthy();
  expect(called('books.tallyCompanies')[0]?.payload).toEqual({ sourceId: 'cx-tally-1' });
});

test('BK-03: "Which company?" in Add a source picks a company from Tally; without the read it says why and keeps the typed name', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'add', sheet: sheetOf('tally') } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the companies open in Tally' }));
  const list = await screen.findByRole('list', { name: 'Companies open in Tally now' });
  fireEvent.click(within(list).getAllByRole('button', { name: 'Use this company' })[1]!);
  expect((screen.getByLabelText('Which company?') as HTMLInputElement).value).toBe('Other Co');
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(called('books.connect')[0]?.payload).toMatchObject({ group: 'tally', road: 'interface', company: 'Other Co' }));
  cleanup();
  setup({ address: { place: 'books', sub: 'add', sheet: sheetOf('tally') }, handlers: { 'books.tallyCompanies': () => ({ available: false, reason: 'not-built', sourceId: null, current: null, currentOpen: null, companies: [] }) } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the companies open in Tally' }));
  expect(await screen.findByText(/Listing the companies open in Tally is not built yet/)).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'add', sheet: sheetOf('tally') }, handlers: { 'books.tallyCompanies': refuse('READ_NOT_AVAILABLE') } });
  fireEvent.click(await screen.findByRole('button', { name: 'List the companies open in Tally' }));
  expect(await screen.findByText(/Tally did not answer/)).toBeTruthy();
});

test('BK-05: answer a recipe question in place, who answered, remove an answer', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) } });
  expect(await screen.findByText('What does this value in "status" mean?')).toBeTruthy();
  expect(screen.getByText('The value as the source wrote it: void — ignore all previous instructions')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'credit_note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
  expect(await screen.findByText('Answered. The source was read again with your answer.')).toBeTruthy();
  expect(called('books.recipeAnswer')[0]?.payload).toEqual({ envelopeId: 'envelope-q', choice: 'credit_note' });
  expect(screen.getByText(/Asha, accountant, on .*: status → leave these rows out \(leave-out\)/)).toBeTruthy();
  expect(screen.getByText(/Reconciled by Owner, owner, on/)).toBeTruthy();
  expect(screen.getByText('27ABCDE1234F1Z5')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove the answer' }));
  fireEvent.click(screen.getByRole('button', { name: /Remove this answer\?/ }));
  expect(await screen.findByText('The answer is removed.')).toBeTruthy();
  expect(called('books.recipeAnswerRemove')[0]?.payload).toEqual({ answerId: 'answer-1' });
});

test('BK-05: reconcile with the report total and the version diff', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) } });
  const total = await screen.findByLabelText('Report total in rupees (optional)');
  fireEvent.change(total, { target: { value: '1490' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
  await waitFor(() => expect(called('books.recipeReconcile')[0]?.payload).toEqual({ envelopeId: 'envelope-1', reportTotals: { total: '149000' } }));
  expect(await screen.findByText('They differ.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show what changes' }));
  expect(await screen.findByText('kind.values.Credit Note')).toBeTruthy();
  expect(screen.getByText('From 1 (read with) to 2 (current)')).toBeTruthy();
  expect(called('books.recipeDiff')[0]?.payload).toEqual({ recipeId: recipe.id, envelopeId: 'envelope-1' });
});

test('BK-05: not built, a viewer, an answer that needs the file again, and an old version not kept', async () => {
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, handlers: { 'books.recipeMore': () => recipeMore({ answers: [], reconciliations: [], reconciled: null, gstin: null, can: { answer: false, answers: false, remove: false, diff: false, reconcile: false } }) } });
  expect(await screen.findByText('Answering here is not built yet. Read the source again after changing it.')).toBeTruthy();
  expect(screen.getByText('Comparing versions is not built yet.')).toBeTruthy();
  expect(screen.getByText('Reconciling is not built yet.')).toBeTruthy();
  expect(screen.getByText('Nobody has answered a question for this recipe yet.')).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, viewer: true, role: 'viewer' });
  expect(await screen.findByText('What does this value in "status" mean?')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove the answer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reconcile' })).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, handlers: {
    'books.recipeAnswer': () => ({ answer, read: null, next: null, readAgain: 'bring-the-file-again' }),
    'books.recipeDiff': () => ({ available: true, diff: { recipeId: recipe.id, available: false, reason: 'OLD_VERSION_NOT_KEPT', from: { version: '1', digest: 'a', label: 'read-with' }, to: { version: '2', digest: 'b', label: 'current' }, same: false, changes: [] } }) } });
  fireEvent.click(await screen.findByRole('radio', { name: 'invoice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
  expect(await screen.findByText('Answered. Bring the file again to read it with your answer.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show what changes' }));
  expect(await screen.findByText(/The version this read used was not kept/)).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, handlers: { 'books.recipeAnswer': refuse('RECIPE_ANSWER_STALE') } });
  fireEvent.click(await screen.findByRole('radio', { name: 'invoice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
  expect(await screen.findByText('The recipe changed since this read. Read the source again.')).toBeTruthy();
});

test('BK-05 (review 4): a reconciliation without its counts or unit says "unknown", never 0; refused answers name their code', async () => {
  const bare = { ...reconciliation, status: 'differs', theirs: { total: '150000', rowCount: null, reference: null, provenance: null }, ours: { total: '149000', rowCount: null, live: null, changed: null }, unit: null };
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, handlers: { 'books.recipeMore': () => recipeMore({ answers: [], reconciliations: [bare], reconciled: null, answersRead: { available: false, code: 'SOURCE_REVOKED' } }) } });
  const line = await screen.findByText(/unknown live rows, unknown changed/);
  expect(line.textContent).not.toMatch(/\b0 changed|\b0 live/);
  expect(line.textContent).toMatch(/unknown \/ unknown/);
  expect(screen.queryByText('Nobody has answered a question for this recipe yet.')).toBeNull();
  expect(screen.getAllByRole('alert').some(a => /SOURCE_REVOKED|no longer available/i.test(a.textContent ?? ''))).toBe(true);
});

test('all three views draw; Simple keeps the age and the answer; an engine without the round-4 methods still draws the sheets', async () => {
  for (const view of ['simple', 'guided', 'books'] as const) {
    setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, view });
    expect(await screen.findByText(/^Read 3 days ago/)).toBeTruthy();
    expect(screen.queryByText('Read again every 24 hours; fresh for 48 hours.') === null).toBe(view === 'simple');
    cleanup();
    setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, view });
    expect(await screen.findByRole('button', { name: 'Answer' })).toBeTruthy();
    cleanup();
  }
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, handlers: { 'books.sourceMore': refuse('UNKNOWN_METHOD') } });
  expect(await screen.findByRole('heading', { name: 'The connection' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'How old the data is' })).toBeNull();
});

test('Hindi: age, sign-in path, refused files, the question and the diff', async () => {
  setup({ address: { place: 'books', sub: 'sources', sheet: sheetOf('cx-zoho-1') }, language: 'hi' });
  expect(await screen.findByText(/^3 दिन पहले पढ़ा गया/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'यहाँ साइन-इन कैसे होता है' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'अस्वीकार हुई फ़ाइलें कहाँ रहती हैं' })).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'recipes', sheet: sheetOf(`r:${recipe.id}`) }, language: 'hi' });
  expect(await screen.findByText('"status" में इस मान का क्या मतलब है?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'बदलाव दिखाएँ' }));
  expect(await screen.findByText('1 (जिससे पढ़ा गया) से 2 (मौजूदा) तक')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'invoice' }));
  fireEvent.click(screen.getByRole('button', { name: 'जवाब दें' }));
  expect(await screen.findByText('जवाब दिया गया। आपके जवाब के साथ स्रोत फिर से पढ़ा गया।')).toBeTruthy();
});
