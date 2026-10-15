import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Language, View } from '../../app/ui/src/app/presentation';
import { learningPlace } from '../../app/ui/src/screens/learning/index';
import { placeModuleFor } from '../../app/ui/src/places/registry';

// Every reply is synthetic and shaped like platform/runtime/learning-ext/{dictionary,models,accounts}.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
const AT = '2026-10-14T09:00:00.000Z';
const cases = (passed: boolean) => [
  { id: 'billed', passed: true, expectedMinor: '300000', actualMinor: '300000' },
  { id: 'margin', passed, expectedMinor: '130000', ...(passed ? { actualMinor: '130000' } : { code: 'CALC_FAILED' }) },
];
const edit = (over: Record<string, unknown> = {}) => ({
  id: 'dictedit_1', at: AT, memberId: 'm1', edit: { edit: 'add-field', name: 'narration', type: 'string' },
  evidence: { origin: 'unmapped-field', count: 3, importIds: ['imp1'], sourceIds: ['src1'], decisionIds: [], header: 'Narration' },
  baseHash: 'h1', baseVersion: 4, draftDigest: 'd1', keyDigest: 'k1', status: 'awaiting-review', before: cases(false), after: cases(true),
  failing: [], regressions: [], digest: 'a'.repeat(64), decidedAt: null, decidedBy: null, publishedHash: null, stale: false, ...over,
});
const failedEdit = edit({ id: 'dictedit_2', edit: { edit: 'remove-definition', name: 'margin' }, status: 'failed-answer-key', after: cases(false), failing: ['margin'], regressions: ['margin'], digest: 'b'.repeat(64) });
const proposal = {
  id: 'dictproposal_1', at: AT, memberId: 'm1', origin: 'profile', pack: { pack: 'retail', confidence: 'high', scores: { retail: 2 }, matched: ['outlet', 'till'] },
  draft: { pack: 'retail', label: 'Fixture shop', currency: 'INR', gstMode: 'regular', fields: {}, definitions: [] }, draftDigest: 'dd',
  evidence: [{ name: 'billAmount', type: 'money', header: 'Bill Amount', files: [0], filled: 10, rows: 10, confidence: 'high', reasons: ['decimal-amounts', 'amount-header'], existing: false }],
  skipped: [{ header: 'GSTIN 27AAAA', reason: 'no-safe-name' }], sourceIds: [], contentHashes: ['c'], status: 'proposed', cases: [], failing: [], publishedHash: null,
  digest: 'p'.repeat(64), baseHash: null,
};
const key = (rows: unknown) => ({
  key: { id: 'demo-hand-worked', label: 'Demo shop, September, worked by hand', rows, expectedTotals: { rowCount: 10, amountMinor: '1230000' },
    cases: [{ id: 'billed', operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, expectedMinor: '300000' },
      { id: 'aging', operation: 'aging', period: { from: '2026-09-01', to: '2026-09-30' }, onDate: '2026-09-30', expectedMinor: '30000' }] },
  default: true, keyDigest: 'k'.repeat(64),
});
const accountSet = { id: 'acctset_1', at: AT, sourceIds: [], counts: { total: 2, decided: 0, needsQuestion: 1 }, proposals: [
  { accountId: 'a-1', name: 'HDFC Current', accountClass: 'bank', confidence: 'high', needsQuestion: false, evidence: [{ kind: 'parent-group', detail: 'Bank Accounts', accountClass: 'bank' }], decision: null },
  { accountId: 'a-2', name: 'Suspense', accountClass: null, confidence: 'low', needsQuestion: true, evidence: [], decision: null },
] };
const previewReply = { state: 'preview', previewId: 'model_preview_1', payload: '{"task":"learning_accounts_sort","accounts":[{"id":"a1"}]}', digest: 'e'.repeat(64),
  send: 'shape', routeId: 'route-1', endpoint: 'https://models.example.invalid/v1', approvalRequired: true, approve: { method: 'models.approve', id: 'model_preview_1' } };

const BASE: Record<string, Handler> = {
  'learningx.edits': payload => ({ items: payload['status'] === 'awaiting-review' ? [edit()] : [edit(), failedEdit], total: 2, dictionaryHash: 'h1' }),
  'learningx.editApprove': () => ({ published: true, status: 'accepted', failing: [], dictionaryHash: 'h2' }),
  'learningx.editReject': () => ({ status: 'rejected' }),
  'learningx.editsPropose': () => ({ items: [edit({ id: 'dictedit_3' })], refused: [], dictionaryHash: 'h1' }),
  'learningx.dictionaryProposals': () => ({ items: [proposal], total: 1 }),
  'learningx.dictionaryBuild': () => proposal,
  'learningx.dictionaryAdopt': () => ({ published: true, status: 'adopted', cases: cases(true), failing: [], dictionary: { version: 1, hash: 'h9', pack: 'retail' } }),
  'learningx.answerKey': payload => ({ ...key('kind,date\ninvoice,2026-09-01\n'), ...(payload['run'] ? { run: { keyDigest: 'k', passed: false, cases: cases(false), failing: ['margin'] }, dictionaryHash: 'h1' } : {}) }),
  'learningx.answerKeySet': () => ({ ...key('rows'), default: false, run: { keyDigest: 'k', passed: true, cases: cases(true), failing: [] } }),
  'learningx.modelRoute': () => ({ route: { routeId: 'route-1', revision: 1, endpoint: 'https://models.example.invalid/v1', kind: 'openai-compatible', model: 'fixture-model', at: AT, by: 'm1' }, ready: true, send: 'shape' }),
  'models.list': () => [{ id: 'route-1', kind: 'openai-compatible', model: 'fixture-model', endpoint: 'https://models.example.invalid/v1', enabled: true, revision: 1 }],
  'learningx.modelRouteSet': () => ({ route: null, ready: false, send: 'shape' }),
  'learningx.accountsList': () => ({ sets: [accountSet] }),
  'learningx.accountsAsk': () => previewReply,
  'models.approve': () => ({ id: 'outbound_approval_1', kind: 'outbound-approval', previewId: 'model_preview_1', expiresAt: AT }),
  'learningx.accountsAskRun': () => ({ state: 'done', receiptId: 'model_preview_1', set: { ...accountSet, id: 'acctset_2', basedOn: 'acctset_1', modelReceiptId: 'model_preview_1' }, modelProposals: 2 }),
  'learningx.editsAsk': () => ({ state: 'not-yet', code: 'DICTIONARY_REQUIRED', reason: 'Publish business meanings before asking for dictionary edits.' }),
  'learningx.editsAskRun': () => ({ state: 'not-yet', code: 'MODEL_FAILED', reason: 'x' }),
};

function setup({ role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: {
  role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler>;
} = {}) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  render(<TextProvider language={language}>{learningPlace.render({ address: { place: 'books', sub: 'learning' }, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt: vi.fn(), navigate: vi.fn() })}</TextProvider>);
  return { calls, called: (method: string) => calls.filter(c => c.method === method) };
}
const section = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in this fixture suite')); });
afterEach(() => cleanup());

test('the module draws exactly Books, Learning, and the registry routes that sub-place to it before the Books module', () => {
  expect(learningPlace.handles({ place: 'books', sub: 'learning' })).toBe(true);
  expect(learningPlace.handles({ place: 'books', sub: 'sources' })).toBe(false);
  expect(learningPlace.handles({ place: 'books' })).toBe(false);
  expect(placeModuleFor({ place: 'books', sub: 'learning' })).toBe(learningPlace);
  expect(placeModuleFor({ place: 'books', sub: 'sources' })).not.toBe(learningPlace);
});

test('edits: approve sends exactly {id, digest}, and only after the sheet naming the change is confirmed', async () => {
  const { called } = setup();
  expect(await screen.findByText('Add the field narration (text)')).toBeTruthy();
  expect(called('learningx.edits')[0]!.payload).toEqual({ status: 'awaiting-review' });
  expect(screen.getByText('Answer key: 1 of 2 cases passed before, 2 of 2 after.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
  const sheet = screen.getByRole('region', { name: 'Approve this dictionary edit' });
  expect(within(sheet).getByText('Add the field narration (text)')).toBeTruthy();
  expect(called('learningx.editApprove')).toHaveLength(0);
  fireEvent.click(within(sheet).getByRole('button', { name: 'Approve this edit' }));
  await screen.findByText('Approved. The answer key passed and the new dictionary is published.');
  expect(called('learningx.editApprove').map(c => c.payload)).toEqual([{ id: 'dictedit_1', digest: 'a'.repeat(64) }]);
});

test('edits: Not now sends nothing; reject sends {id, digest}; all shows failed edits as never approvable; look for edits', async () => {
  const { called } = setup();
  await screen.findByText('Add the field narration (text)');
  fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('region', { name: 'Approve this dictionary edit' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reject this edit' }));
  await screen.findByText('Rejected. The dictionary is unchanged.');
  expect(called('learningx.editReject').map(c => c.payload)).toEqual([{ id: 'dictedit_1', digest: 'a'.repeat(64) }]);
  expect(called('learningx.editApprove')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(await screen.findByText('Remove the meaning margin')).toBeTruthy();
  expect(called('learningx.edits').at(-1)!.payload).toEqual({});
  const failed = screen.getByText('Remove the meaning margin').closest('li')!;
  expect(within(failed).getByText('This edit failed the answer key. It can never be approved.')).toBeTruthy();
  expect(within(failed).getByText('Cases this edit would break: margin')).toBeTruthy();
  expect(within(failed).queryByRole('button')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Look for edits' }));
  await screen.findByText('Looked for edits: 1 wait for review, 0 failed the answer key.');
  expect(called('learningx.editsPropose').map(c => c.payload)).toEqual([{}]);
});

test('a stale edit is marked and cannot be approved; a refusal is words', async () => {
  setup({ handlers: { 'learningx.edits': () => ({ items: [edit({ stale: true })], total: 1, dictionaryHash: 'h2' }), 'learningx.editReject': () => { throw Object.assign(new Error('x'), { code: 'EDIT_STALE' }); } } });
  await screen.findByText('Stale');
  expect(screen.queryByRole('button', { name: 'Review and approve' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reject this edit' }));
  expect((await screen.findByRole('alert')).textContent).toBe('The dictionary changed after this edit was checked. Look for edits again.');
});

test('a viewer sees the edits, words that the seat is read only, and no control that changes anything', async () => {
  const { called } = setup({ role: 'viewer', viewer: true });
  await screen.findByText('Add the field narration (text)');
  expect(screen.getByText('Your seat can read this page. It cannot change anything here.')).toBeTruthy();
  for (const name of ['Review and approve', 'Reject', 'Look for edits']) expect(screen.queryByRole('button', { name })).toBeNull();
  section('First dictionary');
  await screen.findByText('“Fixture shop”, from the shop pack');
  expect(screen.queryByRole('button', { name: 'Adopt this dictionary' })).toBeNull();
  expect(screen.queryByLabelText('Choose a CSV file')).toBeNull();
  section('Answer key');
  await screen.findByText('Hand-worked cases');
  expect(screen.queryByRole('button', { name: 'Run the key' })).toBeNull();
  expect(screen.queryByLabelText('Replace with a key file (JSON)')).toBeNull();
  section('Model asks');
  await screen.findByText(/Chosen: fixture-model/);
  expect(screen.queryByRole('button', { name: 'Ask the model' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull();
  expect(called('models.list')).toHaveLength(0);
});

test('an accountant prepares but the owner decides', async () => {
  setup({ role: 'accountant' });
  await screen.findByText('Add the field narration (text)');
  expect(screen.queryByRole('button', { name: 'Review and approve' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Look for edits' })).toBeTruthy();
  expect(screen.getByText('The owner approves or rejects each edit.')).toBeTruthy();
});

test('UNKNOWN_METHOD draws not built yet; an unexpected reply shape draws the error state', async () => {
  setup({ handlers: { 'learningx.edits': () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); }, 'learningx.dictionaryProposals': () => ({ items: [{ id: 'x' }], total: 1 }) } });
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
  section('First dictionary');
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
});

test('first dictionary: a picked CSV is read in the browser and proposed; adopt goes through the sheet and shows the key outcome', async () => {
  const { called } = setup();
  section('First dictionary');
  const row = (await screen.findByText('“Fixture shop”, from the shop pack')).closest('li')!;
  expect(within(row).getByText(/billAmount \(money\) from the column “Bill Amount”: 10 of 10 rows filled, high confidence\./)).toBeTruthy();
  expect(within(row).getByText(/values with paise, the title names an amount/)).toBeTruthy();

  const csv = new File(['date,Bill Amount\n2026-09-01,100.00\n'], 'bills.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Choose a CSV file'), { target: { files: [csv] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Propose a dictionary from this file' }));
  await waitFor(() => expect(called('learningx.dictionaryBuild')).toHaveLength(1));
  expect(called('learningx.dictionaryBuild')[0]!.payload).toEqual({ files: [{ content: 'date,Bill Amount\n2026-09-01,100.00\n' }] });

  fireEvent.click(screen.getByRole('button', { name: 'Adopt this dictionary' }));
  const sheet = screen.getByRole('region', { name: 'Adopt this first dictionary' });
  expect(within(sheet).getByText('Publish “Fixture shop” from the shop pack, with 1 inferred fields.')).toBeTruthy();
  expect(called('learningx.dictionaryAdopt')).toHaveLength(0);
  fireEvent.click(within(sheet).getByRole('button', { name: 'Adopt and publish' }));
  await screen.findByText('Adopted. The answer key passed and dictionary version 1 is published.');
  expect(called('learningx.dictionaryAdopt').map(c => c.payload)).toEqual([{ id: 'dictproposal_1', digest: 'p'.repeat(64) }]);
});

test('first dictionary: PROPOSAL_STALE and a failing key are words', async () => {
  let attempt = 0;
  setup({ handlers: { 'learningx.dictionaryAdopt': () => {
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error('x'), { code: 'PROPOSAL_STALE' });
    return { published: false, status: 'failed-answer-key', cases: cases(false), failing: ['margin'], dictionary: null };
  } } });
  section('First dictionary');
  await screen.findByText('“Fixture shop”, from the shop pack');
  fireEvent.click(screen.getByRole('button', { name: 'Adopt this dictionary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adopt and publish' }));
  expect((await screen.findByRole('alert')).textContent).toBe('The dictionary changed after this proposal was made. Propose again from the file.');
  fireEvent.click(screen.getByRole('button', { name: 'Adopt this dictionary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adopt and publish' }));
  expect(await screen.findByText('Not published: the answer key failed on margin.')).toBeTruthy();
  expect(screen.getByText('margin: failed (CALC_FAILED)')).toBeTruthy();
});

test('answer key: hand-worked values formatted as money, run shows pass and fail, reset goes through the sheet', async () => {
  const { called } = setup({ handlers: { 'learningx.answerKey': payload => ({ ...key('kind\n'), default: false, ...(payload['run'] ? { run: { keyDigest: 'k', passed: false, cases: cases(false), failing: ['margin'] } } : {}) }) } });
  section('Answer key');
  expect(await screen.findByText('₹3,000')).toBeTruthy();
  expect(screen.getAllByText('worked by hand by the owner').length).toBeGreaterThan(0);
  expect(screen.getByText('Source totals: 10 rows, ₹12,300', { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run the key' }));
  expect(await screen.findByText('Failing cases: margin')).toBeTruthy();
  expect(screen.getByText('billed: passed')).toBeTruthy();
  expect(called('learningx.answerKey').at(-1)!.payload).toEqual({ run: true });
  fireEvent.click(screen.getByRole('button', { name: 'Reset to the default key' }));
  expect(called('learningx.answerKeySet')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to the default' }));
  await waitFor(() => expect(called('learningx.answerKeySet').map(c => c.payload)).toEqual([{ reset: true }]));
});

test('answer key: a key file is parsed in the browser and named before it replaces the key', async () => {
  const { called } = setup();
  section('Answer key');
  await screen.findByText('Hand-worked cases');
  const file = { id: 'mine', label: 'My shop, worked by hand', rows: 'kind\n', cases: [{ id: 'billed', operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, expectedMinor: '100' }] };
  fireEvent.change(screen.getByLabelText('Replace with a key file (JSON)'), { target: { files: [new File([JSON.stringify(file)], 'key.json', { type: 'application/json' })] } });
  const sheet = await screen.findByRole('region', { name: 'Replace the answer key' });
  expect(within(sheet).getByText('Use “My shop, worked by hand” from key.json, with 1 hand-worked cases, in place of the current key.')).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Replace the key' }));
  await waitFor(() => expect(called('learningx.answerKeySet').map(c => c.payload)).toEqual([{ key: file }]));
});

test('answer key: a non-owner sees the rows withheld as words', async () => {
  setup({ role: 'cofounder', handlers: { 'learningx.answerKey': () => key({ state: 'withheld' }) } });
  section('Answer key');
  expect(await screen.findByText('The rows behind this key are withheld from your seat. Only the owner sees them.')).toBeTruthy();
  expect(screen.queryByText('Show the hand-worked rows')).toBeNull();
  expect(screen.getByRole('button', { name: 'Run the key' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reset to the default key' })).toBeNull();
});

test('model asks: ask, see the exact bytes, approve them, then send once; new proposals are drawn', async () => {
  const { called } = setup();
  section('Model asks');
  await screen.findByText('Chosen: fixture-model (openai-compatible), sending to https://models.example.invalid/v1');
  fireEvent.change(await screen.findByLabelText('Choose a proposal set'), { target: { value: 'acctset_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the model' }));
  expect((await screen.findByText(/learning_accounts_sort/)).textContent).toBe(previewReply.payload);
  expect(called('learningx.accountsAsk').map(c => c.payload)).toEqual([{ setId: 'acctset_1' }]);
  expect(screen.getByText('shape only')).toBeTruthy();
  expect(called('models.approve')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Approve sending exactly these bytes' }));
  await screen.findByText('Approved. Nothing has been sent yet.');
  expect(called('models.approve').map(c => c.payload)).toEqual([{ id: 'model_preview_1' }]);
  expect(called('learningx.accountsAskRun')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Send it once' }));
  await screen.findByText('The model proposed 2 classes. They are evidence only: you or the accountant decide each account.');
  expect(called('learningx.accountsAskRun').map(c => c.payload)).toEqual([{ previewId: 'model_preview_1', approvalId: 'outbound_approval_1' }]);
  expect(screen.getByText('HDFC Current: Bank, high confidence')).toBeTruthy();
});

test('model asks: not-yet codes from Ask and AskRun are plain words', async () => {
  setup({ handlers: {
    'learningx.accountsAsk': () => ({ state: 'not-yet', code: 'SEND_LEVEL_WITHHELD', reason: 'The send level is "nothing".' }),
  } });
  section('Model asks');
  fireEvent.change(await screen.findByLabelText('Choose a proposal set'), { target: { value: 'acctset_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the model' }));
  expect(await screen.findByText('Not yet: the send level keeps this on this computer. Nothing was sent.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ask the model for edits' }));
  expect(await screen.findByText('Not yet: publish business meanings before asking for edits.')).toBeTruthy();
});

test('model asks: a not-yet from the run is words, and an unknown code is named', async () => {
  setup({ handlers: { 'learningx.editsAsk': () => ({ ...previewReply, payload: '{"task":"learning_dictionary_edits"}' }), 'learningx.editsAskRun': () => ({ state: 'not-yet', code: 'MODEL_FAILED', reason: 'x', receiptId: 'model_preview_1' }),
    'learningx.accountsAsk': () => ({ state: 'not-yet', code: 'SOMETHING_NEW' }) } });
  section('Model asks');
  fireEvent.click(await screen.findByRole('button', { name: 'Ask the model for edits' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve sending exactly these bytes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Send it once' }));
  expect(await screen.findByText('Not yet: the model did not answer. It was not tried again.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Choose a proposal set'), { target: { value: 'acctset_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the model' }));
  expect(await screen.findByText('Not yet. Nothing was sent. Code SOMETHING_NEW.')).toBeTruthy();
});

test('model asks: the owner chooses a route from models.list with exactly its id', async () => {
  const { called } = setup({ handlers: { 'learningx.modelRoute': () => ({ route: null, ready: false, notYet: { state: 'not-yet', code: 'MODEL_ROUTE_UNAVAILABLE', reason: 'x' }, send: 'samples' }) } });
  section('Model asks');
  await screen.findByText('No model route is chosen for sorting accounts and dictionary edits.');
  expect(screen.getByText('Not yet: the chosen model route is not available now. Nothing was sent.')).toBeTruthy();
  fireEvent.change(await screen.findByLabelText('Choose a route'), { target: { value: 'route-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this route' }));
  await waitFor(() => expect(called('learningx.modelRouteSet').map(c => c.payload)).toEqual([{ routeId: 'route-1' }]));
});

test('Hindi renders the place, its sections and its words', async () => {
  setup({ language: 'hi', view: 'books' });
  expect(await screen.findByText('फ़ील्ड narration जोड़ें (टेक्स्ट)')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('सीखना');
  expect(screen.getByText('उत्तर कुंजी: पहले 2 में से 1 केस पास, बाद में 2 में से 2।')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'उत्तर कुंजी' }));
  expect(await screen.findByText('₹3,000')).toBeTruthy();
  expect(screen.getByText('बिल किया')).toBeTruthy();
});

test('a lost reply on approve says the outcome is unknown and reads the list again', async () => {
  const { called } = setup({ handlers: { 'learningx.editApprove': () => { throw Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' }); } } });
  await screen.findByText('Add the field narration (text)');
  const before = called('learningx.edits').length;
  fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Approve this dictionary edit' })).getByRole('button', { name: 'Approve this edit' }));
  expect(await screen.findByText(/the outcome is not known/)).toBeTruthy();
  await waitFor(() => expect(called('learningx.edits').length).toBeGreaterThan(before));
});

test('an oversized file is never read or sent', async () => {
  const { called } = setup();
  section('First dictionary');
  const big = new File(['x'], 'big.csv', { type: 'text/csv' }); Object.defineProperty(big, 'size', { value: 6_000_000 });
  fireEvent.change(await screen.findByLabelText(/CSV/i), { target: { files: [big] } });
  expect(await screen.findByText('This file is too large to read here. Nothing was read or sent.')).toBeTruthy();
  expect(called('learningx.dictionaryBuild')).toHaveLength(0);
});

test('an unreadable answer key still leaves the owner reset and a key file', async () => {
  setup({ handlers: { 'learningx.answerKey': () => ({ unexpected: true }) } });
  section('Answer key');
  expect(await screen.findByText(/The answer key could not be read/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset to the default key' })).toBeTruthy();
  expect(screen.getByLabelText('Replace with a key file (JSON)')).toBeTruthy();
});

test('a co-founder can ask and approve; an accountant is not offered an ask it could never send', async () => {
  setup({ role: 'cofounder' });
  section('Model asks');
  fireEvent.change(await screen.findByLabelText('Choose a proposal set'), { target: { value: 'acctset_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask the model' }));
  expect(await screen.findByRole('button', { name: 'Approve sending exactly these bytes' })).toBeTruthy();
  cleanup(); setup({ role: 'accountant' });
  section('Model asks');
  await screen.findByLabelText('Choose a proposal set');
  expect(screen.queryByRole('button', { name: 'Ask the model' })).toBeNull();
});
