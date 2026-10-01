import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, legacy, INITIAL, CURRENT, SEPTEMBER, OCTOBER, scope, sha256 } from './fixtures/answer-recovery-independent-acceptance.ts';
import { ExperimentalFileSnapshotAdapter, Vault } from '../runtime/vault.ts';
import { ChausarError } from '../runtime/contracts.ts';
import { descendants, dialogFor, find, hasText, namedButton } from './fixtures/conversation-acceptance-renderer.ts';

const ordinaryAnswers = (state: any) => state.answers.filter((answer: any) => answer.request && answer.receiptId);
const originalId = (name = 'billed') => legacy.originals[name].answer.id;
const expectedScopeFilters = { sourceIds: [legacy.sourceId], branch: 'main', customerId: 'C-A' };
const withoutStaleness = (value: any) => { const copy = structuredClone(value); delete copy.stale; delete copy.staleReason; return copy; };

test('actual pre-repair legacy answers recover under independently chosen old and new knowledge cuts with current meaning and unchanged originals', async t => {
  const f = await fixture(t);
  await f.correct(); const dictionary = await f.publishTax(), baseline = await f.snapshot(), originalBytes = JSON.stringify(f.originals(baseline));
  const review = await f.review();
  assert.equal(review.status, 'new-time-scope-required'); assert.equal(review.historicalReplay, false);
  assert.equal(review.grantsAuthority, false); assert.deepEqual(review.originalRequest, legacy.originals.billed.answer.request);
  assert.equal(Object.hasOwn(review.originalRequest, 'asOf'), false); assert.equal(Object.hasOwn(review, 'asOf'), false);
  assert.deepEqual(review.requiredTimeFields, ['asOf', 'period', 'comparePeriod', 'onDate']);
  assert.equal(review.dictionary.hash, dictionary.hash);
  const older = await f.prepare('billed', scope({ asOf: '2026-10-02T17:30:00+05:30' }));
  assert.deepEqual(older.preparation.request, { operation: 'billed', ...expectedScopeFilters, period: SEPTEMBER, asOf: INITIAL });
  const oldResult = await f.request('answers.recovery.execute', f.executePayload(older));
  assert.equal(oldResult.receipt.totalMinor, '3000'); assert.equal(oldResult.receipt.asOf, INITIAL);
  assert.equal(oldResult.receipt.dictionaryHash, dictionary.hash); assert.equal(oldResult.receipt.restatement, undefined);
  assert.deepEqual(oldResult.receipt.rows.map((row: any) => row.entityId).sort(), ['A1', 'A2']);
  const newer = await f.prepare('billed', scope({ period: null }));
  assert.deepEqual(newer.preparation.request, { operation: 'billed', ...expectedScopeFilters, asOf: CURRENT });
  const before = await f.snapshot(), result = await f.request('answers.recovery.execute', f.executePayload(newer)), after = await f.snapshot();
  assert.equal(result.status, 'completed'); assert.equal(result.receipt.totalMinor, '9000');
  assert.equal(result.receipt.asOf, CURRENT); assert.equal(result.receipt.period, null);
  assert.deepEqual(result.receipt.rows.map((row: any) => row.entityId).sort(), ['A1', 'A2', 'A3']);
  assert.ok(result.receipt.rows.every((row: any) => row.sourceId === legacy.sourceId));
  assert.equal(after.revision, before.revision + 1); assert.equal(after.receipts.length, before.receipts.length + 1);
  assert.equal(ordinaryAnswers(after).length, ordinaryAnswers(before).length + 1);
  assert.equal(result.lineage.historicalReplay, false); assert.equal(result.lineage.grantsAuthority, false);
  assert.equal(result.lineage.source.originalAnswerId, originalId()); assert.notEqual(result.answer.id, originalId());
  assert.equal(JSON.stringify(f.originals(after)), originalBytes);
  await f.restart();
  assert.deepEqual(await f.request('answers.recovery.get', { newRequestId: newer.newRequestId }), result);
  assert.deepEqual(await f.request('answers.recovery.get', { newRequestId: older.newRequestId }), oldResult);
  assert.equal(JSON.stringify(f.originals(await f.snapshot())), originalBytes);
  const beforeTrial = await f.evidence();
  const replacement = { ...dictionary.definitions.find((value: any) => value.name === 'billed'), field: 'amountMinor', meaning: 'Independent prospective trial: explicitly reported invoice net amounts.' };
  const trial = await f.request('trials.create', { version: 1, savedAnswerIds: [result.answer.id], change: { type: 'definition', name: 'billed', replacement } });
  await f.request('trials.evaluate', { trialId: trial.trialId });
  await f.refusal('trials.impact', { trialId: trial.trialId, strategy: 'retrospective' }, ['TRIAL_REBUILD_REQUIRED']);
  assert.deepEqual(await f.evidence(), beforeTrial);
});

test('explicit scope refusals cannot choose a cutoff, infer an event period or issue partial recovery authority', async t => {
  const f = await fixture(t), review = await f.review(), baseline = await f.snapshot(), declaration = f.declaration(review);
  const missing = { ...scope() } as any; delete missing.asOf;
  const missingPeriod = { ...scope() } as any; delete missingPeriod.period;
  const missingOnDate = { ...scope() } as any; delete missingOnDate.onDate;
  const missingComparison = { ...scope() } as any; delete missingComparison.comparePeriod;
  for (const timeScope of [missing, missingPeriod, missingOnDate, missingComparison,
    scope({ asOf: '2026-10-11' }), scope({ asOf: '2026-02-30T00:00:00Z' }), scope({ asOf: '2026-10-11T12:00:00' }),
    scope({ chooseNow: true }), scope({ period: { from: '2026-10-31', to: '2026-10-01' } }), scope({ onDate: '2026-11-01' })]) {
    await f.refusal('answers.recovery.prepare', { ...declaration, timeScope }, ['INVALID_ANSWER_RECOVERY', 'INVALID_ASOF', 'INVALID_PERIOD', 'INVALID_CALCULATION']);
    assert.deepEqual(await f.snapshot(), baseline);
  }
  await f.refusal('answers.recovery.prepare', { ...declaration, source: { ...review.source, originalReceiptDigest: '0'.repeat(64) } }, ['ANSWER_RECOVERY_SOURCE_CHANGED']);
  await f.refusal('answers.recovery.prepare', { ...declaration, newRequestId: 'caller-issued-recovery' }, ['INVALID_ANSWER_RECOVERY']);
  await f.refusal('answers.recovery.prepare', { ...declaration, confirmedNewCalculation: false }, ['ANSWER_RECOVERY_CONFIRMATION_REQUIRED']);
  assert.deepEqual(await f.snapshot(), baseline);
  const pinned = await f.request('calculation.run', { operation: 'billed', ...expectedScopeFilters, asOf: INITIAL });
  const answer = (await f.request('trials.savedQuestions')).find((value: any) => value.receiptId === pinned.id);
  await f.refusal('answers.recovery.review', { answerId: answer.id }, ['ANSWER_RECOVERY_NOT_UNPINNED']);
});

test('legacy textual scenario assumptions survive a new declared time scope and exact retries do not add records', async t => {
  const f = await fixture(t), baseline = await f.snapshot(), originalBytes = JSON.stringify(f.originals(baseline));
  const issued = await f.prepare('scenario', scope()), before = await f.snapshot();
  assert.equal(issued.preparation.request.assumptions.priceChangeBps, '00500');
  const result = await f.request('answers.recovery.execute', f.executePayload(issued));
  assert.equal(result.receipt.totalMinor, '12600'); assert.equal(result.receipt.assumptions.priceChangeBps, '500');
  assert.equal(result.answer.request.assumptions.priceChangeBps, '00500');
  assert.deepEqual(result.receipt.figures.map((figure: any) => [figure.key, figure.minor]), [['baseline', '12000'], ['scenario', '12600'], ['change', '600'], ['priceChangeBps', '500']]);
  const after = await f.snapshot(); assert.equal(after.revision, before.revision + 1);
  assert.equal(JSON.stringify(f.originals(after)), originalBytes);
  assert.deepEqual(await f.request('answers.recovery.execute', f.executePayload(issued)), result);
  assert.deepEqual(await f.snapshot(), after);
});

test('new comparison periods replace both legacy periods and missing comparison dates are refused', async t => {
  const f = await fixture(t), baseline = await f.snapshot(), review = await f.review('change');
  await f.refusal('answers.recovery.prepare', f.declaration(review, scope()), ['COMPARISON_REQUIRED']);
  assert.deepEqual(await f.snapshot(), baseline);
  const issued = await f.prepare('change', scope({ period: OCTOBER, comparePeriod: SEPTEMBER }));
  assert.deepEqual(issued.preparation.request, { operation: 'change', ...expectedScopeFilters, period: OCTOBER, comparePeriod: SEPTEMBER, asOf: CURRENT });
  const result = await f.request('answers.recovery.execute', f.executePayload(issued));
  assert.equal(result.receipt.totalMinor, '-12000');
  assert.deepEqual(result.receipt.figures.map((figure: any) => [figure.key, figure.minor]), [['current', '0'], ['previous', '12000'], ['change', '-12000'], ['changeBps', '-10000']]);
  assert.deepEqual(f.originals(await f.snapshot()), f.originals(baseline));
});

test('aging recovery requires a new onDate and honestly chosen all-event-date scope retains invoice links and bucket arithmetic', async t => {
  const f = await fixture(t), review = await f.review('aging'), baseline = await f.snapshot();
  await f.refusal('answers.recovery.prepare', f.declaration(review, scope({ period: null })), ['INVALID_AGING_DATE']);
  assert.deepEqual(await f.snapshot(), baseline);
  const issued = await f.prepare('aging', scope({ period: null, asOf: INITIAL, onDate: '2026-11-01' }));
  const result = await f.request('answers.recovery.execute', f.executePayload(issued));
  assert.equal(result.receipt.totalMinor, '60000'); assert.equal(result.receipt.period, null);
  assert.equal(result.receipt.assumptions.onDate, '2026-11-01');
  const figures = new Map(result.receipt.figures.map((figure: any) => [figure.key, figure.minor]));
  assert.equal(figures.get('days1to30'), '30000'); assert.equal(figures.get('days31to60'), '30000');
  assert.deepEqual(result.receipt.rows.map((row: any) => row.entityId).sort(), ['A1', 'A2', 'A3']);
  assert.deepEqual(f.originals(await f.snapshot()), f.originals(baseline));
});

test('renderer-selected September aging scope excludes October invoices as its declared inclusive event period promises', async t => {
  const f = await fixture(t), originalBytes = JSON.stringify(f.originals(await f.snapshot()));
  await namedButton(f.h.app, 'Older calculations').dispatch('click');
  const older = dialogFor(f.h.body, 'Older calculations');
  const section = descendants(older).find(node => node.tagName === 'section' && hasText(node, originalId('aging')));
  assert.ok(section); await namedButton(section, 'Review fresh calculation').dispatch('click');
  const dialog = dialogFor(f.h.body, 'Fresh calculation from an older answer');
  const timestamp = find(dialog, node => node.tagName === 'input' && node.attributes.type === 'text');
  const dates = descendants(dialog).filter(node => node.tagName === 'input' && node.attributes.type === 'date');
  assert.equal(timestamp.value, ''); assert.ok(dates.every(node => node.value === ''));
  timestamp.value = INITIAL; find(dialog, node => node.tagName === 'select').value = 'period';
  dates[0].value = SEPTEMBER.from; dates[1].value = SEPTEMBER.to; dates[2].value = '2026-11-01';
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  await find(dialog, node => node.tagName === 'form').dispatch('submit');
  const prepared = f.h.calls.find(call => call.method === 'answers.recovery.prepare');
  assert.deepEqual(prepared.payload.timeScope, scope({ asOf: INITIAL, onDate: '2026-11-01' }));
  await namedButton(dialog, 'Create this fresh calculation').dispatch('click');
  const execution = f.h.calls.find(call => call.method === 'answers.recovery.execute');
  const result = await f.request('answers.recovery.get', { newRequestId: execution.payload.newRequestId });
  assert.equal(result.status, 'completed'); assert.deepEqual(result.receipt.period, SEPTEMBER);
  assert.equal(JSON.stringify(f.originals(await f.snapshot())), originalBytes);
  t.diagnostic(JSON.stringify({ qualification: 'actual-renderer-preload-IPC-HTTP-Engine', declaredPeriod: result.receipt.period,
    onDate: result.receipt.assumptions.onDate, actualTotalMinor: result.receipt.totalMinor,
    includedEntities: result.receipt.rows.map((row: any) => row.entityId), expectedSeptemberTotalMinor: '30000' }));
  assert.equal(result.receipt.totalMinor, '30000', 'The UI declares an inclusive September event period; October invoice A3 must not be counted.');
  assert.deepEqual(result.receipt.rows.map((row: any) => row.entityId).sort(), ['A1', 'A2']);
});

test('current source revocation withholds all recovery stages and access restoration cannot execute the old reviewed preparation', async t => {
  const f = await fixture(t), issued = await f.prepare();
  await f.request('trust.update', { allowedSources: [legacy.excludedSourceId] });
  const baseline = await f.snapshot();
  for (const [method, payload] of [ ['answers.recovery.review', { answerId: originalId() }],
    ['answers.recovery.get', { newRequestId: issued.newRequestId }], ['answers.recovery.list', { answerId: originalId() }],
    ['answers.recovery.execute', f.executePayload(issued)] ] as const) await f.refusal(method, payload, ['SOURCE_REVOKED']);
  assert.deepEqual(await f.snapshot(), baseline);
  await f.request('trust.update', { allowedSources: ['*'] });
  const restored = await f.snapshot();
  // Restoring the identical policy can legitimately restore an exact pin. An
  // intervening genuine correction makes the old preparation definitively stale.
  await f.correct(); const changed = await f.snapshot();
  await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_SOURCE_CHANGED', 'ANSWER_RECOVERY_EVIDENCE_CHANGED']);
  assert.equal(changed.receipts.length, restored.receipts.length); assert.deepEqual(await f.snapshot(), changed);
  const next = await f.prepare(), result = await f.request('answers.recovery.execute', f.executePayload(next));
  assert.equal(result.receipt.totalMinor, '60000'); assert.notEqual(next.newRequestId, issued.newRequestId);
});

test('actual owner revocation changes the issuing epoch and another current owner cannot inherit the private request', async t => {
  const f = await fixture(t), owner = await f.request('members.add', { name: 'Independent second owner', role: 'owner', branches: ['*'] });
  const session = await f.request('auth.session', { memberId: owner.id }), issued = await f.prepare();
  const oldOwner = (await f.snapshot()).members.find((member: any) => member.id === 'owner');
  const revoked = await f.raw('members.revoke', { id: 'owner' }, session.token);
  assert.equal(revoked.status, 200); assert.equal(revoked.body.result.epoch, oldOwner.epoch + 1);
  assert.equal(revoked.body.result.active, false);
  for (const [method, payload] of [ ['answers.recovery.review', { answerId: originalId() }],
    ['answers.recovery.get', { newRequestId: issued.newRequestId }], ['answers.recovery.execute', f.executePayload(issued)] ] as const)
    await f.refusal(method, payload, ['ACCESS_REVOKED', 'OWNER_REQUIRED']);
  f.setBearer(session.token); const baseline = await f.snapshot();
  await f.refusal('answers.recovery.get', { newRequestId: issued.newRequestId }, ['ANSWER_RECOVERY_REQUEST_UNAVAILABLE']);
  await f.refusal('answers.recovery.review', { answerId: originalId() }, ['RECEIPT_FORBIDDEN']);
  assert.deepEqual(await f.snapshot(), baseline);
});

test('a real prospective trial promotion entering before the actual recovery transaction invalidates the issued current-meaning pin', async t => {
  const f = await fixture(t), seed = await f.prepare(), completed = await f.request('answers.recovery.execute', f.executePayload(seed));
  // Issue before trial review so its control record is included in the genuine
  // complete promotion impact; the race changes meaning, not the acknowledgment.
  const issued = await f.prepare();
  const dictionary = (await f.request('ontology.get')).current;
  const replacement = { ...dictionary.definitions.find((value: any) => value.name === 'billed'), field: 'taxMinor', meaning: 'Independent race: current invoice tax meaning.' };
  const trial = await f.request('trials.create', { version: 1, savedAnswerIds: [completed.answer.id], change: { type: 'definition', name: 'billed', replacement } });
  const evaluated = await f.request('trials.evaluate', { trialId: trial.trialId });
  const impact = await f.request('trials.impact', { trialId: trial.trialId, strategy: 'prospective' });
  const before = await f.evidence();
  const original = Vault.prototype.update; let interposed = false, enteredActualTransaction = false, promoted: any, postPromotion: any, postPromotionCiphertext: Buffer | undefined;
  const hook = t.mock.method(Vault.prototype, 'update', async function (this: Vault, change: any) {
    if (this !== f.engine.vault || interposed) return original.call(this, change);
    interposed = true; f.advance();
    promoted = await f.request('trials.promote', { trialId: trial.trialId, evaluationDigest: evaluated.evaluationDigest,
      strategy: 'prospective', acknowledgedImpactDigest: impact.digest });
    postPromotion = await f.evidence(); postPromotionCiphertext = await readFile(f.authorityPath);
    return original.call(this, async state => {
      enteredActualTransaction = true;
      assert.equal(state.ontology.current.hash, postPromotion.ontology.current.hash);
      return change(state);
    });
  });
  try { await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_EVIDENCE_CHANGED', 'ANSWER_RECOVERY_SOURCE_CHANGED']); }
  finally { hook.mock.restore(); }
  assert.equal(interposed, true); assert.equal(enteredActualTransaction, true); assert.equal(promoted.status, 'promoted');
  assert.equal(postPromotion.receipts.length, before.receipts.length); assert.deepEqual(await f.evidence(), postPromotion);
  assert.deepEqual(await readFile(f.authorityPath), postPromotionCiphertext);
  assert.equal((await f.history()).billed.request.asOf, undefined);
  t.diagnostic('Real public trial promotion plus the original recovery callback on the actual subsequently committed Vault draft; no fabricated State.');
});

test('completed real encrypted write followed by lost acknowledgement fences overlapping retries and a new Engine reads one exact durable result', async t => {
  const f = await fixture(t), issued = await f.prepare(), before = await f.snapshot(), originalBytes = JSON.stringify(f.originals(before));
  const initialCiphertext = await readFile(f.authorityPath), original = ExperimentalFileSnapshotAdapter.prototype.commit;
  let reached!: () => void, release!: () => void;
  const reachedCommit = new Promise<void>(resolve => { reached = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  const hook = t.mock.method(ExperimentalFileSnapshotAdapter.prototype, 'commit', async function (this: ExperimentalFileSnapshotAdapter, ...args: Parameters<typeof original>) {
    if (this.file !== f.authorityPath || args[1] !== before.revision) return original.apply(this, args);
    writes++; await original.apply(this, args); reached(); await barrier;
    throw new ChausarError('SYNTHETIC_LOST_COMMIT_ACK', 'Synthetic ACK lost after actual encrypted adapter commit.');
  });
  const first = f.request('answers.recovery.execute', f.executePayload(issued));
  void first.catch(() => {});
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([reachedCommit, first.then(() => { throw new Error('Execution completed without reaching the physical barrier.'); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The physical commit barrier was not reached within ten seconds.')), 10_000); })]); }
    finally { if (timer) clearTimeout(timer); }
    const physical = await readFile(f.authorityPath);
    assert.notEqual(sha256(physical), sha256(initialCiphertext)); assert.equal(physical.includes(Buffer.from('fresh-answer-recovery-lineage-v1')), false);
    const second = f.request('answers.recovery.execute', f.executePayload(issued)), third = f.request('answers.recovery.execute', f.executePayload(issued));
    void second.catch(() => {}); void third.catch(() => {});
    await f.refusal('answers.recovery.execute', { ...f.executePayload(issued), preparationDigest: '0'.repeat(64) }, ['ANSWER_RECOVERY_PREPARATION_CHANGED']);
    assert.equal((await f.request('answers.recovery.get', { newRequestId: issued.newRequestId })).status, 'prepared');
    release();
    const results = await Promise.allSettled([first, second, third]);
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'ANSWER_RECOVERY_OUTCOME_UNKNOWN'));
    assert.equal(writes, 1);
    const unknown = await f.request('answers.recovery.get', { newRequestId: issued.newRequestId });
    assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.requiresReopen, true);
    await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_OUTCOME_UNKNOWN']);
  } finally { release(); hook.mock.restore(); }
  await f.restart();
  const result = await f.request('answers.recovery.get', { newRequestId: issued.newRequestId }), after = await f.snapshot();
  assert.equal(result.status, 'completed'); assert.equal(result.receipt.totalMinor, '30000');
  assert.equal(after.revision, before.revision + 1); assert.equal(after.receipts.length, before.receipts.length + 1);
  assert.equal(ordinaryAnswers(after).length, ordinaryAnswers(before).length + 1); assert.equal(JSON.stringify(f.originals(after)), originalBytes);
  assert.deepEqual((await f.request('answers.recovery.list', { answerId: originalId() })).items, [result]);
  const retainedCiphertext = await readFile(f.authorityPath);
  assert.deepEqual(await f.request('answers.recovery.execute', f.executePayload(issued)), result);
  assert.deepEqual(await f.snapshot(), after); assert.equal(sha256(await readFile(f.authorityPath)), sha256(retainedCiphertext));
  t.diagnostic(JSON.stringify({ qualification: 'synthetic-lost-ack-after-real-encrypted-write-new-Engine-reopen', writes,
    originalCiphertextBytes: initialCiphertext.length, completedCiphertextBytes: retainedCiphertext.length, overlappingExactRequests: 3 }));
});

test('unrelated outputs retain exact completed readback while later ordinary stale labels expose the conservative availability limitation', async t => {
  const f = await fixture(t), issued = await f.prepare(), result = await f.request('answers.recovery.execute', f.executePayload(issued));
  await f.request('calculation.run', { operation: 'received', ...expectedScopeFilters, asOf: INITIAL });
  assert.deepEqual(await f.request('answers.recovery.get', { newRequestId: issued.newRequestId }), result);
  const before = await f.snapshot(); await f.correct();
  const after = await f.snapshot(), code = await f.refusal('answers.recovery.get', { newRequestId: issued.newRequestId }, ['ANSWER_RECOVERY_SOURCE_CHANGED', 'ANSWER_RECOVERY_RESULT_CHANGED']);
  const listed = await f.request('answers.recovery.list', { answerId: originalId() });
  assert.deepEqual(listed.items.map((item: any) => ({ id: item.newRequestId, status: item.status, code: item.code })), [{ id: issued.newRequestId, status: 'unavailable', code }]);
  const oldOriginals = f.originals(before), changedOriginals = f.originals(after);
  for (const name of Object.keys(legacy.originals)) {
    assert.deepEqual(withoutStaleness(changedOriginals[name].answer), withoutStaleness(oldOriginals[name].answer));
    assert.deepEqual(withoutStaleness(changedOriginals[name].receipt), withoutStaleness(oldOriginals[name].receipt));
  }
  const retained = await f.request('receipts.get', { id: result.receipt.id });
  assert.deepEqual(withoutStaleness(retained), withoutStaleness(result.receipt));
  assert.deepEqual(await f.snapshot(), after);
  t.diagnostic(JSON.stringify({ qualification: 'current-source-readback-conservative-refusal', code, freshReceiptStillRetained: true,
    note: 'Exact lineage becomes unavailable after legitimate mutable staleness metadata; no digest checks were weakened.' }));
});
