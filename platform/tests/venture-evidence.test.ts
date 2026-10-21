// P2-evidence tests: the evidence ledger (fixed weights, strength bands, only verified overwrites, claims checked
// against the run's real tool results), venture.evidence.list and venture.evidence.apply, the hooks where owners and
// agents write client and business fields, and the number guard's new rule: a model number is a labelled estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_ERRORS, VENTURE_METHODS, VENTURE_RECORD_KINDS } from '../runtime/venture/contracts.ts';
import type { ClientRecord, EvidenceItem, EvidenceRecord, ToolCallRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { EVIDENCE_TYPES, scoreEvidence } from '../runtime/venture/evidence/types.ts';
import { evidenceQuestions, recordEvidence, recordPlanEvidence } from '../runtime/venture/evidence/ledger.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { modelLine } from '../runtime/venture/core/words.ts';
import { validateJudge } from '../runtime/venture/delivery/judge.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { ...owner, channel: 'phone' };
const clock = () => new Date('2026-10-21T10:00:00.000Z');
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

async function setup() {
  const store = new VentureTestStore();
  const deps = { store, clock, host: 'test', storage: 'experimental-file' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview',
    launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const call = async <T>(method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> => {
    const table = { ...coreHandlers, ...moneyHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>;
    return await table[method](deps, ctx, payload) as T;
  };
  return { store, deps, call };
}

function toolCall(id: string, tool: string, ok = true): ToolCallRecord {
  return {
    id, turn: 1, tool, input: {}, inputDigest: 'digest', envelope: ok ? { ok: true, result: {} } : { ok: false, error: { code: 'TOOL_FAILED', name: 'failed', message: 'It failed.' } },
    outcome: ok ? 'succeeded' : 'failed', effect: tool.startsWith('calc.') ? 'compute' : 'read', tier: 'code', receiptIds: [], tableIds: [],
  };
}

/** A delivery run whose agent read one file and ran the calculator, and whose one other call failed. */
async function seedRun(deps: VentureDeps): Promise<string> {
  return ventureAction(deps, owner, 'prepare', 'seed.run', tx => tx.put({
    ...tx.base('venture-delivery-run'), orderId: 'order_1', playbookId: 'playbook_1', playbookHash: 'hash', status: 'ready-for-review',
    servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
    harness: { toolCalls: [toolCall('t1.1', 'files.read'), toolCall('t1.2', 'calc.totals'), toolCall('t1.3', 'files.read', false)] },
  } as any).id);
}

const record = (deps: VentureDeps, input: Parameters<typeof recordEvidence>[1]) => ventureAction(deps, owner, 'prepare', 'test.evidence', tx => recordEvidence(tx, input));

// ---------------------------------------------------------------------------
// 1. Fixed weights and strength bands
// ---------------------------------------------------------------------------

test('weights are fixed per evidence type, and code turns them into verified, strong or weak', () => {
  assert.deepEqual(Object.keys(EVIDENCE_TYPES), ['owner-entered', 'tool-verified', 'document', 'web-page', 'model-inferred']);
  const band = (...types: (keyof typeof EVIDENCE_TYPES)[]) => scoreEvidence(types.map((type, index) => ({ type, ref: `r${index}` }))).strength;
  assert.equal(band('owner-entered'), 'verified');
  assert.equal(band('tool-verified'), 'verified');
  assert.equal(band('document'), 'strong', 'one file is strong, not verified');
  assert.equal(band('document', 'document'), 'verified', 'two files agree');
  assert.equal(band('web-page'), 'weak');
  assert.equal(band('web-page', 'web-page'), 'strong');
  assert.equal(band('web-page', 'web-page', 'web-page', 'web-page', 'web-page'), 'strong', 'web pages alone never verify: no primary source');
  assert.equal(band('model-inferred'), 'weak');
  assert.equal(band('model-inferred', 'model-inferred', 'model-inferred', 'model-inferred', 'model-inferred'), 'weak', 'the AI repeating itself adds nothing');
  assert.equal(scoreEvidence([{ type: 'model-inferred', ref: 'a' }, { type: 'model-inferred', ref: 'b' }]).scoreBp, 2000);
  // The same source counted twice is counted once.
  assert.equal(scoreEvidence([{ type: 'document', ref: 't1.1' }, { type: 'document', ref: 't1.1' }]).strength, 'strong');
  assert.equal(scoreEvidence([]).strength, 'weak');
});

// ---------------------------------------------------------------------------
// 2. Claims are checked against the run's real tool results
// ---------------------------------------------------------------------------

test('a claimed evidence type must match a real tool result in the run; otherwise it is weak, inferred and flagged', async () => {
  const { deps, store } = await setup();
  const runId = await seedRun(deps);
  const read = await record(deps, { subject: 'client:client_x', field: 'email', value: 'books@cafe.example', type: 'document', by: 'agent', runId, toolCallId: 't1.1', source: 'statement.csv' });
  assert.deepEqual([read.type, read.strength, read.claim, read.flag], ['document', 'strong', 'observed', null]);
  assert.match(read.source, /statement\.csv/);
  const checked = await record(deps, { subject: 'business', field: 'monthlyBills', value: '42', type: 'tool-verified', by: 'agent', runId, toolCallId: 't1.2' });
  assert.deepEqual([checked.type, checked.strength, checked.claim], ['tool-verified', 'verified', 'observed']);

  const faked: [string, Parameters<typeof recordEvidence>[1]][] = [
    ['no such call', { subject: 'business', field: 'city', value: 'Pune', type: 'document', by: 'agent', runId, toolCallId: 't9.9' }],
    ['a failed call', { subject: 'business', field: 'city', value: 'Pune', type: 'document', by: 'agent', runId, toolCallId: 't1.3' }],
    ['the wrong tool', { subject: 'business', field: 'city', value: 'Pune', type: 'document', by: 'agent', runId, toolCallId: 't1.2' }],
    ['no run at all', { subject: 'business', field: 'city', value: 'Pune', type: 'tool-verified', by: 'agent', toolCallId: 't1.2' }],
    ['no web tool in this build', { subject: 'business', field: 'city', value: 'Pune', type: 'web-page', by: 'agent', runId, toolCallId: 't1.1' }],
    ['an agent saying the owner typed it', { subject: 'business', field: 'city', value: 'Pune', type: 'owner-entered', by: 'agent', runId }],
  ];
  for (const [label, input] of faked) {
    const item = await record(deps, input);
    assert.deepEqual([item.type, item.claimedType, item.strength, item.claim], ['model-inferred', input.type, 'weak', 'inferred'], label);
    assert.ok(item.flag && item.flag.length > 0, label);
    assert.match(item.source, /^Unchecked: /, label);
    assert.equal(item.applied, false, label);
  }
  // An inferred value can never be observed, whatever the agent says.
  const said = await record(deps, { subject: 'business', field: 'area', value: 'Pune', type: 'model-inferred', claim: 'observed', by: 'agent' });
  assert.deepEqual([said.claim, said.strength], ['inferred', 'weak']);
  assert.equal(listRecords(store.read(), 'venture-evidence').length, 2 + faked.length + 1);
});

// ---------------------------------------------------------------------------
// 3. Only verified evidence overwrites; weaker evidence is a suggestion
// ---------------------------------------------------------------------------

test('only verified evidence overwrites a stored value; weaker evidence waits as a suggestion', async () => {
  const { deps, store, call } = await setup();
  const runId = await seedRun(deps);
  const client = await call<ClientRecord>('venture.client.add', { name: 'Cafe Aroma', email: 'owner@aroma.example' });
  const subject = `client:${client.id}`;
  const stored = (await call<{ items: EvidenceItem[] }>('venture.evidence.list', { subject })).items;
  assert.deepEqual(stored.map(item => [item.field, item.value, item.type, item.strength, item.claim, item.applied]).sort(), [
    ['email', 'owner@aroma.example', 'owner-entered', 'verified', 'observed', true],
    ['name', 'Cafe Aroma', 'owner-entered', 'verified', 'observed', true],
  ]);

  // A file the agent really read is strong, not verified: it waits for the owner and the client record is unchanged.
  const suggestion = await record(deps, { subject, field: 'email', value: 'accounts@aroma.example', type: 'document', by: 'agent', runId, toolCallId: 't1.1' });
  assert.deepEqual([suggestion.strength, suggestion.applied], ['strong', false]);
  assert.equal(listRecords(store.read(), 'venture-client')[0].email, 'owner@aroma.example');
  assert.deepEqual(evidenceQuestions(store.read(), client.ventureId).map(item => [item.field, item.value]), [['email', 'accounts@aroma.example']]);

  // The owner cannot apply weaker evidence over a verified value.
  await assert.rejects(call('venture.evidence.apply', { id: suggestion.id }), code('EVIDENCE_WEAK'));
  // A tool result the run really produced is verified: it overwrites the stored value and the client record.
  const verified = await record(deps, { subject, field: 'email', value: 'ledger@aroma.example', type: 'tool-verified', by: 'agent', runId, toolCallId: 't1.2' });
  assert.deepEqual([verified.strength, verified.applied], ['verified', true]);
  assert.equal(listRecords(store.read(), 'venture-client')[0].email, 'ledger@aroma.example');
  const emails = (await call<{ items: EvidenceItem[] }>('venture.evidence.list', { subject })).items.filter(item => item.field === 'email');
  assert.deepEqual(emails.filter(item => item.applied).map(item => item.value), ['ledger@aroma.example'], 'one stored value per field');
});

test('a weak suggestion over a field with no verified value can be applied by the owner, inside the app only', async () => {
  const { deps, store, call } = await setup();
  const weak = await record(deps, { subject: 'business', field: 'customer', value: 'Cafes near the station', type: 'model-inferred', by: 'agent' });
  assert.equal(weak.applied, false);
  await assert.rejects(call('venture.evidence.apply', { id: weak.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const { item } = await call<{ item: EvidenceItem }>('venture.evidence.apply', { id: weak.id });
  assert.deepEqual(Object.keys(item).sort(), ['applied', 'claim', 'field', 'id', 'source', 'strength', 'subject', 'type', 'value']);
  assert.deepEqual([item.applied, item.strength, item.claim], [true, 'weak', 'inferred']);
  assert.deepEqual((await call<{ item: EvidenceItem }>('venture.evidence.apply', { id: weak.id })).item, item, 'applying twice changes nothing');
  assert.equal(listRecords(store.read(), 'venture-evidence').find(entry => entry.id === weak.id)!.appliedAt, clock().toISOString());
  await assert.rejects(call('venture.evidence.apply', { id: 'evidence_missing' }), code('EVIDENCE_NOT_FOUND'));
  await assert.rejects(call('venture.evidence.apply', { id: weak.id, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('needs-your-data: Chausar cannot see the value, so it asks and never fills it', async () => {
  const { deps, store, call } = await setup();
  const ask = await record(deps, { subject: 'business', field: 'averageBill', value: 'about forty', type: 'model-inferred', claim: 'needs-your-data', by: 'agent', source: 'Only your till reports show this' });
  assert.deepEqual([ask.value, ask.strength, ask.claim, ask.applied], ['', 'weak', 'needs-your-data', false]);
  await assert.rejects(call('venture.evidence.apply', { id: ask.id }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual(evidenceQuestions(store.read(), ask.ventureId).map(item => [item.field, item.claim]), [['averageBill', 'needs-your-data']]);
});

// ---------------------------------------------------------------------------
// 4. venture.evidence.list
// ---------------------------------------------------------------------------

test('venture.evidence.list: every item or one subject, newest first, in the shared EvidenceItem shape', async () => {
  const { deps, call } = await setup();
  await record(deps, { subject: 'business', field: 'customer', value: 'Cafes', type: 'model-inferred', by: 'agent' });
  await call('venture.client.add', { name: 'Cafe Aroma' });
  const all = (await call<{ items: EvidenceItem[] }>('venture.evidence.list')).items;
  assert.deepEqual(all.map(item => item.field), ['name', 'customer']);
  assert.deepEqual((await call<{ items: EvidenceItem[] }>('venture.evidence.list', { subject: 'business' })).items.map(item => item.value), ['Cafes']);
  assert.deepEqual((await call<{ items: EvidenceItem[] }>('venture.evidence.list', { subject: 'client:nobody' })).items, []);
  await assert.rejects(call('venture.evidence.list', { subject: 7 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call('venture.evidence.list', { other: true }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 5. The hooks: a kept plan's AI-written business fields
// ---------------------------------------------------------------------------

test('a kept plan records its AI-written business fields as inferred evidence the owner applied by keeping the plan', async () => {
  const { deps, store } = await setup();
  const plan = {
    name: modelLine('Night Shift Walkers', []), oneLiner: modelLine('Dog walks for nurses in Leeds.', []), customer: { value: 'Nurses in Leeds', label: 'told-by-you' as const, by: 'owner' as const },
    offers: [{ id: 'offer_1', name: modelLine('Walks for 2 dogs', []), description: modelLine('Regular walks on long shifts.', []) }],
  };
  await ventureAction(deps, owner, 'admin', 'test.plan', tx => recordPlanEvidence(tx, plan));
  const items = listRecords(store.read(), 'venture-evidence') as EvidenceRecord[];
  assert.deepEqual(items.map(item => [item.field, item.type, item.claim, item.strength, item.applied]), [
    ['name', 'model-inferred', 'inferred', 'weak', true],
    ['oneLiner', 'model-inferred', 'inferred', 'weak', true],
    ['customer', 'owner-entered', 'observed', 'verified', true],
    ['offer_1.name', 'model-inferred', 'inferred', 'weak', true],
    ['offer_1.description', 'model-inferred', 'inferred', 'weak', true],
  ]);
  assert.ok(items.every(item => item.subject === 'business'));
  assert.match(items[0].source, /you kept/);
});

// ---------------------------------------------------------------------------
// 6. Registration
// ---------------------------------------------------------------------------

test('the two evidence methods are registered everywhere a venture method must be', async () => {
  for (const method of ['venture.evidence.list', 'venture.evidence.apply'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'core', method);
    assert.equal(typeof (coreHandlers as Record<string, unknown>)[method], 'function', method);
  }
  assert.ok(APP_ONLY_METHODS.includes('venture.evidence.apply'));
  assert.equal(APP_ONLY_METHODS.includes('venture.evidence.list'), false);
  for (const error of ['EVIDENCE_WEAK', 'EVIDENCE_NOT_FOUND']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(error), error);
  assert.ok((VENTURE_RECORD_KINDS as readonly string[]).includes('venture-evidence'));
  const ipc = await readFile(new URL('../../app/desktop/ipc-contract.cjs', import.meta.url), 'utf8');
  const types = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const engine = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  for (const method of ['venture.evidence.list', 'venture.evidence.apply']) {
    assert.ok(ipc.includes(`'${method}'`), `ipc allowlist: ${method}`);
    assert.ok(types.includes(`"${method}"`), `ipc types: ${method}`);
    assert.ok(engine.includes(`case '${method}':`), `engine routing: ${method}`);
  }
});

// ---------------------------------------------------------------------------
// 7. The number guard labels instead of refusing
// ---------------------------------------------------------------------------

test('model numbers are labelled estimates on plan lines and judge reasons, never given a receipt', () => {
  assert.deepEqual(modelLine('Walks for 2 dogs', []), { value: 'Walks for 2 dogs', label: 'assumption', by: 'model', estimate: true });
  assert.deepEqual(modelLine('Walks for B2B teams', ['b2b']), { value: 'Walks for B2B teams', label: 'assumption', by: 'model' });
  const answers = (reason: string) => ({ answers: ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'].map(question => ({ question, answer: 'yes', reason })) });
  const counted = validateJudge(answers('It answers all 3 questions the client asked.'));
  assert.ok(counted.every(answer => answer.estimate === true && !('receiptId' in answer)));
  assert.ok(validateJudge(answers('It answers the client.')).every(answer => answer.estimate === undefined));
  assert.throws(() => validateJudge(answers('It quotes INR 500 a month.')), code('MODEL_OUTPUT_REJECTED'));
});
