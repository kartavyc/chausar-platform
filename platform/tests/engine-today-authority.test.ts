import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Engine, type EngineTodayHostOptions } from '../runtime/engine.ts';
import type { Context, State } from '../runtime/contracts.ts';
import type { ActionService } from '../runtime/actions.ts';
import type { CalculatorService } from '../runtime/calculator.ts';
import type { ReadClock } from '../runtime/connector-framework/index.ts';
import type { EngineTodayResponse } from '../runtime/engine-today-contracts.ts';

// Real experimental-file Engine custody with synthetic local records only.
// These tests start no native process, browser, provider, source read or model.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const display = { date: '2026-09-30', timeZone: 'Asia/Kolkata' };

async function fixture(t: TestContext, selection?: EngineTodayHostOptions['selection']) {
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, 'chausar-today-authority-')));
  let externalReads = 0, externalGeneration = 'synthetic-today-grant-1';
  let targetExternalRead: number | undefined, lateChange: (() => void) | undefined;
  const clockPositions: number[] = [];
  let withdrawals = 0;
  const clock: ReadClock = {
    nowMs() {
      clockPositions.push(externalReads);
      if (lateChange && externalReads === targetExternalRead) {
        const change = lateChange; lateChange = undefined;
        withdrawals++; change();
      }
      return Date.parse('2026-09-30T12:00:00.000Z');
    },
    sleep: async () => { throw new Error('Synthetic Today reads must not sleep or acquire a source.'); },
    setTimer: () => { throw new Error('Synthetic Today reads must not schedule an acquisition timer.'); },
  };
  const today: EngineTodayHostOptions = {
    // An actual installed outside-State read port requires the live generation.
    calendar: () => ({ state: 'unavailable' }),
    authorityRevision: () => { externalReads++; return externalGeneration; },
    ...(selection ? { selection } : {}),
  };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', today,
    connectorRuntime: { profiles: [], clock, readinessRevision: () => 'synthetic-empty-connector-1' } });
  t.after(async () => {
    await engine.shutdown();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-today-authority-'),
      'Remove only the exact synthetic test directory created beneath the owned temporary root.');
    await rm(actual, { recursive: true, force: true });
  });
  await engine.requestAs(owner, 'workspace.create', {
    name: 'Synthetic Today authority fence workspace', demo: false,
    passphrase: 'Synthetic Today authority fence passphrase',
  });
  const action = await engine.requestAs(owner, 'actions.prepare', {
    connector: 'local', operation: 'reminder-draft', sourceIds: [],
    idempotencyKey: 'synthetic-today-authority-reminder',
    payload: { invoiceId: 'synthetic-unexecuted-invoice', text: 'Synthetic unexecuted reminder' },
  });
  const vault = engine.vault!;
  let writes = 0, calculations = 0, effects = 0, reconciliations = 0;
  const update = vault.update.bind(vault);
  vault.update = async <T>(change: (state: State) => T | Promise<T>): Promise<T> => { writes++; return update(change); };
  const calculator = engine.services.calculator as CalculatorService, calculate = calculator.calculate.bind(calculator);
  calculator.calculate = async (...args) => { calculations++; return calculate(...args); };
  const actions = engine.services.actions as ActionService;
  const operation = actions.operation('local', 'reminder-draft'), execute = operation.execute, reconcile = operation.reconcile;
  operation.execute = async (...args) => { effects++; return execute(...args); };
  operation.reconcile = async (...args) => { reconciliations++; return reconcile(...args); };
  const ciphertextHash = async () => createHash('sha256')
    .update(await readFile(join(directory, 'main', 'authority.encrypted.json'))).digest('hex');
  async function armFinalConnectorStamp(change: () => void) {
    externalReads = 0; clockPositions.length = 0;
    const first: EngineTodayResponse = await engine.requestAs(owner, 'today.get', display);
    assert.equal(first.review.state, 'available');
    if (first.review.state !== 'available') assert.fail('The real review producer must release the synthetic action.');
    assert.ok(first.review.value.rows.some(row => row.reference.id === action.id));
    targetExternalRead = clockPositions.at(-1);
    assert.ok(targetExternalRead && targetExternalRead > 1,
      'Calibrate the last connector stamp after earlier domain authority reads.');
    // Use the getter position actually observed by the last connector stamp.
    // A repaired bracket may also read the external token after that stamp.
    externalReads = 0; clockPositions.length = 0; lateChange = change;
  }
  return { engine, today, ciphertextHash, armFinalConnectorStamp,
    withdraw: () => { externalGeneration = 'synthetic-today-grant-2'; },
    withdrawals: () => withdrawals,
    effects: () => ({ writes, calculations, effects, reconciliations }) };
}

test('final Today connector stamp cannot release metadata after a later outside-State authority withdrawal', async t => {
  const f = await fixture(t);
  await f.armFinalConnectorStamp(f.withdraw);
  const before = f.engine.vault!.read(), ciphertext = await f.ciphertextHash();
  let released: EngineTodayResponse | undefined;
  await assert.rejects(f.engine.requestAs(owner, 'today.get', display).then(value => { released = value; return value; }),
    { code: 'TODAY_AUTHORITY_UNAVAILABLE' });
  assert.equal(f.withdrawals(), 1, 'The final connector stamp must exercise the later external withdrawal.');
  assert.equal(released, undefined, 'No held Today metadata may escape the changed live authority.');
  assert.deepEqual(f.engine.vault!.read(), before);
  assert.equal(await f.ciphertextHash(), ciphertext);
  assert.deepEqual(f.effects(), { writes: 0, calculations: 0, effects: 0, reconciliations: 0 });
});

test('final Today connector stamp cannot release metadata after an installed calendar port is replaced', async t => {
  const f = await fixture(t);
  const originalCalendar = f.today.calendar;
  await f.armFinalConnectorStamp(() => { f.today.calendar = () => ({ state: 'unavailable' }); });
  const before = f.engine.vault!.read(), ciphertext = await f.ciphertextHash();
  let released: EngineTodayResponse | undefined;
  await assert.rejects(f.engine.requestAs(owner, 'today.get', display).then(value => { released = value; return value; }),
    { code: 'TODAY_AUTHORITY_UNAVAILABLE' });
  assert.equal(f.withdrawals(), 1, 'The final connector stamp must exercise the installed port replacement.');
  assert.notEqual(f.today.calendar, originalCalendar);
  assert.equal(released, undefined, 'No held Today metadata may escape an installed authority identity change.');
  assert.deepEqual(f.engine.vault!.read(), before);
  assert.equal(await f.ciphertextHash(), ciphertext);
  assert.deepEqual(f.effects(), { writes: 0, calculations: 0, effects: 0, reconciliations: 0 });
});

test('final Today connector stamp cannot release metadata after the installed selection authority changes', async t => {
  let selectionRevision = 'synthetic-today-selection-1';
  const f = await fixture(t, {
    id: 'synthetic-today-selection', revision: () => selectionRevision, select: () => [],
  });
  await f.armFinalConnectorStamp(() => { selectionRevision = 'synthetic-today-selection-2'; });
  const before = f.engine.vault!.read(), ciphertext = await f.ciphertextHash();
  let released: EngineTodayResponse | undefined;
  await assert.rejects(f.engine.requestAs(owner, 'today.get', display).then(value => { released = value; return value; }),
    (error: unknown) => error instanceof Error && 'code' in error
      && (error.code === 'TODAY_AUTHORITY_UNAVAILABLE' || error.code === 'TODAY_AUTHORITY_CHANGED'));
  assert.equal(f.withdrawals(), 1, 'The final connector stamp must exercise the later selection authority change.');
  assert.equal(selectionRevision, 'synthetic-today-selection-2');
  assert.equal(released, undefined, 'No held Today metadata may escape the changed selection authority.');
  assert.deepEqual(f.engine.vault!.read(), before);
  assert.equal(await f.ciphertextHash(), ciphertext);
  assert.deepEqual(f.effects(), { writes: 0, calculations: 0, effects: 0, reconciliations: 0 });
});

test('Engine Today preserves the installed selection revision method receiver', async t => {
  const f = await fixture(t, {
    id: 'synthetic-today-selection-receiver',
    revision() { return this.id; },
    select() { return []; },
  });
  const before = f.engine.vault!.read(), ciphertext = await f.ciphertextHash();
  const value: EngineTodayResponse = await f.engine.requestAs(owner, 'today.get', display);
  assert.equal(value.attention.state, 'available');
  if (value.attention.state !== 'available') assert.fail('The real guarded attention producer must be available.');
  assert.deepEqual(value.attention.selection, {
    state: 'configured', policyId: 'synthetic-today-selection-receiver',
    policyRevision: 'synthetic-today-selection-receiver', eligibleCount: 0, rows: [],
  });
  assert.equal(value.review.state, 'available');
  assert.equal(f.withdrawals(), 0);
  assert.deepEqual(f.engine.vault!.read(), before);
  assert.equal(await f.ciphertextHash(), ciphertext);
  assert.deepEqual(f.effects(), { writes: 0, calculations: 0, effects: 0, reconciliations: 0 });
});
