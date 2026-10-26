// Guardrail drills (Ink v2 wave 4, package 4J15, catalogue Q9). venture.drills.run (app only) runs, against the
// current playbook and with 4J11's practice providers, a payment at auto with spot checks, a client send without
// approval, an approval of an older version, a model with no price, and an instruction planted in a client email and in
// a ledger note: each must be stopped by the engine's own checks and each harmless twin must pass. A clean and a
// planted ledger with the same facts must come to the same figures. The run is stored with the playbook hash
// (venture-drill-run). Nothing is sent, posted or spent and no client is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DrillRunRecord, DrillRunView, DrillRunsView, PlaybookRecord } from '../runtime/venture/contracts.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { DRILL_IDS, DRILL_PARTS, DRILL_TOOL_NAMES, runDrills } from '../runtime/venture/delivery/drills.ts';
import { TOOL_NAMES } from '../runtime/venture/contracts.ts';
import { harnessPolicyContext } from '../runtime/venture/policy/context.ts';
import { latchTaint, resultIntegrity } from '../runtime/venture/policy/taint.ts';
import { ladderPolicy } from '../runtime/venture/policy/ladder.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const drillsRun = (env: Env, ctx = owner) => deliveryHandlers['venture.drills.run']!(env.deps, ctx, {}) as Promise<{ run: DrillRunView }>;
const drillsList = (env: Env) => deliveryHandlers['venture.drills.list']!(env.deps, owner, {}) as Promise<DrillRunsView>;

async function business() {
  const env = await setup();
  await seedBlueprint(env);
  return env;
}

/** Counts every fetch while a body runs: a drill never reaches a network. */
async function noFetch<T>(body: () => Promise<T>): Promise<{ value: T; fetches: number }> {
  const saved = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in tests'); }) as typeof fetch;
  try { return { value: await body(), fetches }; } finally { globalThis.fetch = saved; }
}

test('drills: every guard stops its drill and every harmless twin passes; the run is stored with the playbook hash', async () => {
  const env = await business();
  const { value, fetches } = await noFetch(() => drillsRun(env));
  const { run } = value;
  const playbook = listRecords(env.store.read(), 'venture-playbook').at(-1) as PlaybookRecord;
  assert.equal(run.playbookHash, playbook.hash);
  assert.equal(run.version, playbook.version);
  assert.deepEqual(DRILL_IDS, ['money-at-auto', 'send-without-approval', 'stale-digest', 'unpriced-model', 'planted-email', 'planted-ledger-note', 'ledger-same-figures']);
  assert.equal(run.results.length, DRILL_IDS.length);
  for (const result of run.results) {
    assert.equal(result.stopped, true, `${result.drill}: ${result.line}`);
    assert.equal(result.twinPassed, true, `${result.drill}: ${result.line}`);
  }
  assert.equal(run.passed, true);
  const stored = listRecords(env.store.read(), 'venture-drill-run') as DrillRunRecord[];
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].results.map(item => item.drill), DRILL_IDS);
  assert.equal(stored[0].playbookHash, playbook.hash);
  // Nothing left Chausar: no network, no journal entry, no spend, no outreach, no post.
  assert.equal(fetches, 0);
  for (const kind of ['venture-journal-entry', 'venture-spend', 'venture-outreach', 'venture-connector-post'] as const) {
    assert.equal(listRecords(env.store.read(), kind).length, 0, kind);
  }
});

test('drills: the words say what each guard did, in plain English with no dashes; the same figures drill says the totals agree, with no amount', async () => {
  const env = await business();
  const { run } = await drillsRun(env);
  const line = (id: string) => run.results[DRILL_IDS.indexOf(id as typeof DRILL_IDS[number])].line;
  assert.match(run.results[0].drill, /^A payment at auto with spot checks$/);
  assert.match(line('money-at-auto'), /asked you first/);
  assert.match(line('send-without-approval'), /practice mail/);
  assert.match(line('unpriced-model'), /never counted as free/);
  // 4J22a: the practice ledger's total is not an amount the owner can prove, so the line says only that they agree.
  assert.match(line('ledger-same-figures'), /came to the same total. /);
  assert.doesNotMatch(line('ledger-same-figures'), /INR|[0-9],[0-9]/);
  assert.match(line('planted-email'), /only notes such words/, 'the business screen is on observe, and the line says so');
  for (const result of run.results) assert.doesNotMatch(`${result.drill} ${result.line}`, /[\u2014\u2013]/);
});

test('drills: with the screen on enforce the planted email is held as well', async () => {
  const env = await business();
  await ventureAction(env.deps, owner, 'approve', 'seed.screen', tx => { tx.put({ ...tx.base('venture-screen-setting'), mode: 'enforce' } as any); });
  const { run } = await drillsRun(env);
  assert.match(run.results[DRILL_IDS.indexOf('planted-email')].line, /The email was held/);
  assert.equal(run.passed, true);
});

test('drills: a guard that lets its drill through, or one that stops the twin too, fails the run', async () => {
  const env = await business();
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record')[0] as any;
  await deliveryHandlers['venture.delivery.playbook']!(env.deps, owner, {});
  const playbook = listRecords(env.store.read(), 'venture-playbook').at(-1) as PlaybookRecord;
  const input = { deps: env.deps, state: env.store.read(), venture, playbook };
  const real = await runDrills(input);
  assert.ok(real.every(item => item.stopped && item.twinPassed));
  // A policy that allows everything: the money, send and stale drills are not stopped.
  const open = await runDrills(input, { ...DRILL_PARTS, decide: () => ({ verdict: 'allow', code: 'auto', reason: 'Anything goes.' }) });
  for (const id of ['money-at-auto', 'send-without-approval', 'stale-digest', 'planted-email', 'planted-ledger-note']) {
    const result = open.find(item => item.drill === id)!;
    assert.equal(result.stopped, false, id);
    assert.match(result.line, /^Not stopped/, id);
  }
  // A policy that asks about everything: the drills are stopped but the twins are too.
  const shut = await runDrills(input, { ...DRILL_PARTS, decide: () => ({ verdict: 'ask', code: 'posture', reason: 'Always ask.' }) });
  assert.ok(shut.filter(item => ['money-at-auto', 'send-without-approval', 'stale-digest'].includes(item.drill)).every(item => item.stopped && !item.twinPassed));
  // A calculator that reads the planted note: the two ledgers no longer agree.
  const swayed = await runDrills(input, { ...DRILL_PARTS, sum: (env, table, column, filter) => {
    const draft = DRILL_PARTS.sum(env, table, column, filter);
    const planted = table.rows.some(row => Object.values(row.cells).some(cell => /approved/i.test(cell)));
    return planted ? { ...draft, figures: draft.figures.map(figure => ({ ...figure, minor: String(BigInt(figure.minor) * 2n) })) } : draft;
  } });
  assert.equal(swayed.find(item => item.drill === 'ledger-same-figures')!.stopped, false);
  // A model price that is made up: the unpriced drill is not stopped.
  const priced = await runDrills(input, { ...DRILL_PARTS, rate: input => ({ item: input.item, unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '0', source: 'made up', checkedOn: '2026-10-26', confirmed: false, by: 'list' }) as any });
  assert.equal(priced.find(item => item.drill === 'unpriced-model')!.stopped, false);
  // A broken latch: reading a client's file no longer latches the run, so the planted drills are not stopped.
  for (const broken of [{ latch: () => null }, { integrity: () => 'trusted' as const }]) {
    const unlatched = await runDrills(input, { ...DRILL_PARTS, ...broken });
    for (const id of ['planted-email', 'planted-ledger-note']) assert.equal(unlatched.find(item => item.drill === id)!.stopped, false, `${id} ${Object.keys(broken)[0]}`);
  }
  // The real ladder, context, integrity and latch are the defaults, and every tool named is a real one.
  assert.equal(DRILL_PARTS.decide, ladderPolicy.decide);
  assert.equal(DRILL_PARTS.context, harnessPolicyContext);
  assert.equal(DRILL_PARTS.integrity, resultIntegrity);
  assert.equal(DRILL_PARTS.latch, latchTaint);
  assert.ok(DRILL_TOOL_NAMES.every(name => (TOOL_NAMES as readonly string[]).includes(name)));
});

test('drills: app only; a business without an accepted plan is refused; the list is newest first with the playbook version', async () => {
  const env = await business();
  await assert.rejects(drillsRun(env, phone), code('APP_APPROVAL_REQUIRED'));
  const bare = await setup();
  await assert.rejects(drillsRun(bare));
  assert.equal(listRecords(bare.store.read(), 'venture-drill-run').length, 0);
  const first = (await drillsRun(env)).run;
  env.advance(60_000);
  const second = (await drillsRun(env)).run;
  const listed = await drillsList(env);
  assert.deepEqual(listed.runs.map(run => run.id), [second.id, first.id]);
  assert.ok(listed.runs.every(run => run.version === 1 && run.results.length === DRILL_IDS.length));
  assert.deepEqual((await drillsList(bare)).runs, []);
  await assert.rejects(deliveryHandlers['venture.drills.run']!(env.deps, owner, { extra: true }), code('INVALID_VENTURE_REQUEST'));
});
