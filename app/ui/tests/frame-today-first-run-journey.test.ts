import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  blockedOf, createJourneyStore, elapsedSeconds, initialJourney, isDone, journeySteps, leftOf, reduceJourney, resumeScreen, stepOf,
} from '../src/screens/first-run/journey.ts';
import type { JourneyEvent, JourneyState } from '../src/screens/first-run/journey.ts';
import {
  failureOf, fileProblems, firstRows, groupsOfFour, pickedRecipe, problemsByCode, rupeesToPaise, sourceIdFor, splitCsvLine, typedRecoveryCode, unknownLayout,
  validateCalculationId, validateImport, validatePreview,
} from '../src/screens/first-run/journey-contracts.ts';
import type { FirstRunStatusReply } from '../src/bridge/todayx-contract.ts';
import { ReplyValidationError } from '../src/bridge/validate.ts';

const run = (events: readonly JourneyEvent[], start: JourneyState = initialJourney(1000)) => events.reduce(reduceJourney, start);
const status = (done: readonly string[], blocked: FirstRunStatusReply['blocked'] = 'no-source', left: FirstRunStatusReply['leftThisComputer'] = 'nothing'): FirstRunStatusReply => ({
  steps: { you: 'not-done', vault: 'not-done', model: 'not-done', books: 'not-done', meanings: 'not-done', answer: 'not-done', ...Object.fromEntries(done.map(step => [step, 'done'])) } as FirstRunStatusReply['steps'],
  blocked, leftThisComputer: left,
});
const states = (state: JourneyState) => journeySteps(state).map(item => item.state);

test('a business walks You, Vault, Model, Your books, Meanings and First answer in order', () => {
  let state = initialJourney(1000);
  assert.equal(state.screen, 'welcome');
  assert.deepEqual(states(state), ['waiting-for-you', 'not-reached', 'not-reached', 'not-reached', 'not-reached', 'not-reached']);
  assert.equal(blockedOf(state), 'no-vault');
  assert.equal(leftOf(state), null, 'what left this computer is never fixed text');
  state = reduceJourney(state, { type: 'begin', path: 'business' });
  assert.equal(state.screen, 'identity');
  state = reduceJourney(state, { type: 'identity-held', identity: { fields: { gstin: '27AAAAA0000A1Z5' }, gstMode: 'regular' } });
  assert.equal(state.screen, 'vault');
  assert.deepEqual(state.identity, { fields: { gstin: '27AAAAA0000A1Z5' }, gstMode: 'regular' });
  assert.equal(state.identityWritten, 'held');
  assert.equal(stepOf(state.screen), 'vault');
  state = reduceJourney(state, { type: 'vault-open' });
  assert.equal(state.screen, 'model');
  assert.equal(blockedOf(state), null, 'reading the engine status');
  state = reduceJourney(state, { type: 'status', reply: status(['you', 'vault'], 'no-source', 'nothing') });
  assert.equal(blockedOf(state), 'no-source');
  assert.equal(leftOf(state), 'nothing');
  state = reduceJourney(state, { type: 'identity-written', outcome: 'saved' });
  assert.equal(state.identityWritten, 'saved');
  assert.deepEqual(state.identity.fields, {}, 'the held card is let go once written');
  state = reduceJourney(state, { type: 'model-done', outcome: 'skipped' });
  assert.equal(state.model, 'skipped');
  assert.equal(state.screen, 'file');
  state = reduceJourney(state, { type: 'file-taken' });
  assert.equal(state.screen, 'meanings');
  state = reduceJourney(state, { type: 'meanings-agreed' });
  assert.equal(state.screen, 'answer');
  assert.deepEqual(states(state), ['done', 'done', 'done', 'done', 'done', 'waiting-for-you']);
  assert.equal(elapsedSeconds(state), null);
  state = reduceJourney(state, { type: 'answered', at: 1000 + 125_400 });
  assert.equal(elapsedSeconds(state), 125);
  assert.ok(journeySteps(state).every(item => item.state === 'done'));
  assert.equal(reduceJourney(state, { type: 'answered', at: 999_999 }), state, 'the first receipt is timed once');
});

test('leaving before the vault stores nothing: the card is only in memory and Back clears the path', () => {
  const state = run([{ type: 'begin', path: 'business' }, { type: 'identity-held', identity: { fields: { pan: 'ABCDE1234F' }, gstMode: null } }, { type: 'back' }]);
  assert.equal(state.screen, 'identity');
  assert.equal(state.identity.fields.pan, 'ABCDE1234F');
  assert.equal(state.status.kind, 'no-vault');
  const back = reduceJourney(state, { type: 'back' });
  assert.equal(back.screen, 'welcome');
  assert.equal(back.path, null);
  // Events for later steps do nothing before their step.
  assert.equal(reduceJourney(back, { type: 'model-done', outcome: 'connected' }), back);
  assert.equal(reduceJourney(back, { type: 'status', reply: status([]) }), back, 'no engine status before a vault');
  assert.equal(reduceJourney(back, { type: 'identity-written', outcome: 'saved' }), back);
});

test('an empty identity card is not written', () => {
  const state = run([{ type: 'begin', path: 'business' }, { type: 'identity-held', identity: { fields: {}, gstMode: null } }, { type: 'vault-open' }]);
  assert.equal(state.identityWritten, 'empty');
});

test('an idea skips the identity card and the books and ends on the setup checklist', () => {
  let state = run([{ type: 'begin', path: 'idea' }]);
  assert.equal(state.screen, 'vault');
  assert.equal(isDone(state, 'you'), true);
  state = run([{ type: 'vault-open' }, { type: 'model-done', outcome: 'skipped' }], state);
  assert.equal(state.screen, 'idea');
  state = reduceJourney(state, { type: 'idea-done' });
  assert.equal(state.screen, 'finished');
  assert.equal(run([{ type: 'back' }], run([{ type: 'begin', path: 'idea' }])).screen, 'welcome');
});

test('a file the engine cannot read before the meanings waits, then is read right after they are agreed', () => {
  let state = run([{ type: 'begin', path: 'business' }, { type: 'identity-held', identity: { fields: {}, gstMode: null } }, { type: 'vault-open' }, { type: 'model-done', outcome: 'connected' }]);
  assert.equal(state.screen, 'file');
  state = reduceJourney(state, { type: 'file-waits' });
  assert.equal(state.screen, 'meanings');
  assert.equal(state.fileWaiting, true);
  assert.equal(journeySteps(state)[3]?.state, 'waiting-for-you', 'Your books still waits while the file is held');
  state = reduceJourney(state, { type: 'meanings-agreed' });
  assert.equal(state.screen, 'file');
  state = reduceJourney(state, { type: 'file-taken' });
  assert.equal(state.fileWaiting, false);
  assert.equal(state.screen, 'answer');
});

test('an open workspace resumes at the first step the engine says is not done, and the welcome offers it first', () => {
  let state = reduceJourney(initialJourney(0), { type: 'resume' });
  assert.equal(state.screen, 'model', 'without a status the model step is next');
  assert.equal(state.status.kind, 'reading');
  state = reduceJourney(state, { type: 'status', reply: status(['you', 'vault', 'model', 'books'], 'meanings-unpublished', 'unknown') });
  assert.equal(resumeScreen(state), 'meanings');
  assert.equal(blockedOf(state), 'meanings-unpublished');
  assert.equal(leftOf(state), 'unknown');
  state = reduceJourney(state, { type: 'status', reply: status(['you', 'vault', 'model', 'books', 'meanings', 'answer'], 'nothing') });
  assert.equal(resumeScreen(state), 'finished');
  const notBuilt = reduceJourney(reduceJourney(initialJourney(0), { type: 'resume' }), { type: 'status-not-built' });
  assert.equal(blockedOf(notBuilt), 'not-built');
  assert.equal(leftOf(notBuilt), null);
});

test('the recovery-kit screen opens only from the welcome before a vault exists', () => {
  const state = reduceJourney(initialJourney(0), { type: 'open-recover' });
  assert.equal(state.screen, 'recover');
  assert.equal(stepOf(state.screen), 'you');
  assert.equal(reduceJourney(state, { type: 'close-recover' }).screen, 'welcome');
  const opened = reduceJourney(initialJourney(0), { type: 'resume' });
  assert.equal(reduceJourney(opened, { type: 'open-recover' }), opened);
});

test('the store notifies only on a real change', () => {
  const store = createJourneyStore(5);
  let calls = 0;
  const stop = store.subscribe(() => { calls++; });
  store.dispatch({ type: 'file-taken' });
  assert.equal(calls, 0);
  store.dispatch({ type: 'begin', path: 'business' });
  assert.equal(calls, 1);
  stop();
  store.dispatch({ type: 'back' });
  assert.equal(calls, 1);
  assert.equal(store.snapshot().screen, 'welcome');
});

test('replies are validated before drawing and failures become fixed codes', () => {
  const preview = {
    accepted: false, errors: [{ row: 0, code: 'SOURCE_TOTALS_REQUIRED', message: 'engine prose is never shown' }, { row: 3, code: 'MISSING_VALUE', message: 'x' }, { row: 4, code: 'MISSING_VALUE', message: 'x' }],
    unmappedFields: ['Party name'], facts: [], totalsMinor: '0', coverage: { sourceRows: 2, importedRows: 0, rejectedRows: 2, expectedRows: null, reconciled: false },
    sourceId: 'file-sales', contentHash: 'a'.repeat(64), recipeHash: 'b'.repeat(64), format: 'csv', qualification: 'experimental', question: 'Confirm.',
  };
  const checked = validatePreview(preview);
  assert.deepEqual(fileProblems(checked.problems), ['SOURCE_TOTALS_REQUIRED']);
  assert.deepEqual(problemsByCode(checked.problems), [{ code: 'MISSING_VALUE', rows: [3, 4] }]);
  assert.equal(unknownLayout(checked), true);
  assert.equal(JSON.stringify(checked).includes('engine prose'), false);
  assert.throws(() => validatePreview({ ...preview, coverage: { ...preview.coverage, importedRows: 1 } }), ReplyValidationError);
  assert.throws(() => validatePreview({ ...preview, accepted: true }), ReplyValidationError);
  assert.throws(() => validatePreview({ ...preview, totalsMinor: 12.5 }), ReplyValidationError);
  assert.deepEqual(validateImport({ id: 'import_1', coverage: { sourceRows: 2, importedRows: 2, rejectedRows: 0, expectedRows: 2, reconciled: true }, totalsMinor: '300000', rowIds: [] }).coverage.importedRows, 2);
  assert.throws(() => validateImport({ id: '../x', coverage: {}, totalsMinor: '1' }), ReplyValidationError);
  assert.equal(validateCalculationId({ id: 'receipt_1', explanation: 'x' }), 'receipt_1');
  assert.throws(() => validateCalculationId({ id: 'a b' }), ReplyValidationError);
  assert.deepEqual(failureOf(Object.assign(new Error('Unknown request: todayx.x'), { code: 'UNKNOWN_METHOD' })), { kind: 'not-built' });
  assert.deepEqual(failureOf(Object.assign(new Error('x'), { code: 'METHOD_UNAVAILABLE' })), { kind: 'not-built' });
  assert.deepEqual(failureOf(Object.assign(new Error('secret words'), { code: 'DICTIONARY_REQUIRED' })), { kind: 'refused', code: 'DICTIONARY_REQUIRED' });
  assert.deepEqual(failureOf(Object.assign(new Error('x'), { code: 'lower case' })), { kind: 'refused', code: 'REQUEST_FAILED' });
  assert.deepEqual(failureOf(new ReplyValidationError('x')), { kind: 'refused', code: 'INVALID_REPLY' });
});

test('local helpers treat file text as data and money as exact digits', () => {
  assert.deepEqual(splitCsvLine('a,"b, c","say ""hi"""'), ['a', 'b, c', 'say "hi"']);
  assert.deepEqual(firstRows('﻿h1,h2\r\n\r\n1,=cmd()\n', 6), [['h1', 'h2'], ['1', '=cmd()']]);
  assert.equal(rupeesToPaise('12,300'), '1230000');
  assert.equal(rupeesToPaise('₹ 1,23,456.5'), '12345650');
  assert.equal(rupeesToPaise('0.05'), '5');
  assert.equal(rupeesToPaise('0'), '0');
  assert.equal(rupeesToPaise('12.345'), null);
  assert.equal(rupeesToPaise('-5'), null);
  assert.equal(rupeesToPaise('1e5'), null);
  assert.equal(sourceIdFor('Sales Sept 2026.csv'), 'file-Sales-Sept-2026');
  assert.equal(sourceIdFor('...csv'), 'file-sheet');
  assert.deepEqual(groupsOfFour('CHR-abcdefgh_ij'), ['CHR-', 'abcd', 'efgh', '_ij']);
  assert.equal(typedRecoveryCode(' CHR- abcd\nefgh '), 'CHR-abcdefgh');
  const columns = ['Bill no', 'Bill date', 'Party', 'Value', 'Note'];
  assert.equal(pickedRecipe(columns, { 'Bill date': 'date', Value: 'amount' }, 'DMY', 'Shop'), null, 'an invoice column is needed');
  const recipe = pickedRecipe(columns, { 'Bill no': 'invoice', 'Bill date': 'date', Party: 'customer', Value: 'amount', Note: 'ignore' }, 'DMY', 'Shop');
  assert.ok(recipe);
  assert.deepEqual(recipe.ignoredFields, ['Note']);
  assert.deepEqual(recipe.bindings.map(binding => binding.target), ['entityId', 'kind', 'validFrom', 'amountMinor', 'currency', 'invoiceId', 'customerId']);
  assert.equal(recipe.bindings.find(binding => binding.target === 'validFrom')?.dateFormat, 'DMY');
  assert.equal(JSON.stringify(recipe).includes('function'), false);
});

test('the journey words exist in both languages, never collide with the shared catalogue, and buttons stay short', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, string>;
  const local = { en: read('../src/screens/first-run/text/en.json'), hi: read('../src/screens/first-run/text/hi.json') };
  const shared = { en: read('../src/text/en.json'), hi: read('../src/text/hi.json') };
  assert.deepEqual(Object.keys(local.en).filter(key => !(key in local.hi)), []);
  assert.deepEqual(Object.keys(local.hi).filter(key => !(key in local.en)), []);
  assert.deepEqual(Object.keys(local.en).filter(key => key in shared.en), []);
  for (const language of ['en', 'hi'] as const) {
    for (const [key, value] of Object.entries(local[language])) {
      assert.equal(/[—!]/u.test(value), false, `${language} ${key}`);
      if (key.endsWith('.btn') && !/[{}]/.test(value)) assert.ok([...value].length <= 22, `${language} ${key} is ${[...value].length} long`);
    }
    for (const key of Object.keys(shared.en).filter(item => item.startsWith('FRSTEP.'))) assert.ok(shared[language][key], `${language} ${key}`);
  }
  for (const key of ['FR-01.title', 'FR-02.problem.length', 'FR-03.title', 'FR-04.kept', 'FR-05.skipped', 'FR-07.password.note', 'FR-09.elapsed', 'FR-12.rule', 'FR-13.title']) assert.ok(local.en[key] && local.hi[key], key);
  assert.equal(local.en['FR-05.skipped'], 'No model yet. Importing, the menu of calculations, receipts and backup work without one.');
  assert.equal(local.en['FR-07.password.note'], 'Used once, on this computer. Not kept.');
  assert.equal(local.en['FR-05.note.managed'], 'planned, not available yet');
});
