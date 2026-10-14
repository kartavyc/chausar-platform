/**
 * Practice: run any catalogue action, a prepared action, or a whole job's list of actions against
 * fresh stateful fakes, and show exactly what would happen: the preview, every request that would
 * leave (credentials removed), what the system would hold afterwards, and the read-back. Nothing
 * is sent, nothing enters the actions record, and no real system or credential is touched.
 */
import { canonical, current } from '../actions.ts';
import type { PreparedAction } from '../actions.ts';
import { audit, check, ChausarError, newId } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { catalogueReadback } from '../connector-framework/write.ts';
import { moduleState } from '../modules/types.ts';
import { entry } from './catalogue.ts';
import { initState, MODULE_ID, type Envelope, type WritebackService } from './service.ts';
import type { AdapterContext, Connection, FakeSystem, Secret, SystemId, WireObject } from './types.ts';
import { record, text } from './validate.ts';

export type FakeBundle = { fake: FakeSystem; account: Record<string, string>; secret: Secret };
export type FakeFactory = (system: SystemId, clock: () => string) => FakeBundle;
type Step = { system: SystemId; action: string; payload: unknown; intentId: string; fault: 'drop-after-commit' | 'fail-before-commit' | 'none'; prime: { payload: WireObject; before: WireObject | null } | null };

function diff(before: WireObject, after: WireObject) {
  const changes: { collection: string; added: unknown[]; removed: unknown[] }[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key], b = after[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      const left = new Set((Array.isArray(a) ? a : []).map(item => canonical(item))), right = new Set((Array.isArray(b) ? b : []).map(item => canonical(item)));
      const added = [...right].filter(item => !left.has(item)).map(item => JSON.parse(item)), removed = [...left].filter(item => !right.has(item)).map(item => JSON.parse(item));
      if (added.length || removed.length) changes.push({ collection: key, added, removed });
    } else if (canonical(a ?? null) !== canonical(b ?? null)) changes.push({ collection: key, added: [b ?? null], removed: [a ?? null] });
  }
  return changes;
}

export function practiceConnection(system: SystemId, account: Record<string, string>): Connection {
  return { id: `practice-${system}`, system, label: `Practice ${system}`, environment: 'practice', account, read: true, write: ['*'], link: null, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'practice', revokedAt: null };
}

export async function runPractice(service: WritebackService, context: Context, input: Record<string, unknown>, factory: FakeFactory) {
  current(service.store.read(), context, 'prepare');
  const p = record(input, [], ['steps', 'actionId', 'label']);
  check((p.steps === undefined) !== (p.actionId === undefined), 'INVALID_REQUEST', 'Practise either a list of steps or one prepared action.');
  let steps: Step[], actionId: string | null = null;
  if (p.actionId !== undefined) {
    const action: PreparedAction = service.find(service.store.read(), p.actionId); service.visible(context, action); actionId = action.id;
    const e = service.envelope(action.payload) as Envelope;
    steps = [{ system: e.system, action: e.action, payload: e.payload, intentId: e.intentId, fault: 'none', prime: { payload: e.payload, before: e.preparation.before } }];
  } else {
    check(Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 20, 'INVALID_REQUEST', 'Practise one to twenty steps.');
    steps = p.steps.map((raw, index) => {
      const s = record(raw, ['system', 'action', 'payload'], ['intentId', 'fault']);
      const row = entry(String(s.system), String(s.action));
      if (!row) throw new ChausarError('NOT_IN_CATALOGUE', 'Not in the list yet. It is on the wanted list.');
      return { system: row.system, action: row.action, payload: s.payload, intentId: s.intentId === undefined ? `practice-step-${index + 1}` : text(s.intentId, 200),
        fault: s.fault === undefined ? 'none' : (check(['drop-after-commit', 'fail-before-commit', 'none'].includes(String(s.fault)), 'INVALID_REQUEST', 'Choose a known practice fault.'), s.fault as Step['fault']), prime: null };
    });
  }
  const world = new Map<SystemId, FakeBundle>(); const runId = newId('practice'); const results: Record<string, unknown>[] = [];
  for (const step of steps) {
    const row = entry(step.system, step.action)!; const adapter = service.adapter(step.system, step.action);
    if (!world.has(step.system)) world.set(step.system, factory(step.system, service.ports.clock));
    const bundle = world.get(step.system)!; const connection = practiceConnection(step.system, bundle.account);
    const ctx: AdapterContext = { connection, clock: service.ports.clock, credentials: async () => bundle.secret,
      http: bundle.fake.transport ?? (async () => { throw new ChausarError('PRACTICE_NO_HTTP', 'This practice system has no web interface.'); }),
      dial: bundle.fake.dial ?? (async () => { throw new ChausarError('PRACTICE_NO_MAIL', 'This practice system has no mail interface.'); }) };
    if (step.prime) bundle.fake.prime(step.prime.payload, step.prime.before);
    const key = `practice-${runId}-${step.intentId}`; const first = bundle.fake.log.length; const before = bundle.fake.snapshot();
    const result: Record<string, unknown> = { system: step.system, action: step.action, title: row.title, kind: row.kind, tier: row.tier, alwaysWaits: row.alwaysWaits, practice: true };
    try {
      const payload = adapter.validate(JSON.parse(canonical(step.payload)));
      const preparation = await adapter.prepare(ctx, payload, key);
      Object.assign(result, { preview: preparation.preview, target: preparation.target });
      if (row.tier === 'prepare-only') Object.assign(result, { outcome: 'prepare-only', message: 'Prepared only. Nothing would be sent.' });
      else if (preparation.alreadyApplied) Object.assign(result, { outcome: 'already-done', message: 'This is already in the system. Nothing would be sent.' });
      else {
        bundle.fake.fault(step.fault); let doError: string | null = null, receipt = null;
        try { receipt = await adapter.do(ctx, payload, preparation, key); } catch (error) { doError = error instanceof ChausarError ? error.code : 'PROVIDER_OUTCOME_UNKNOWN'; }
        bundle.fake.fault('none');
        const back = catalogueReadback(await adapter.readBack(ctx, payload, preparation, key, receipt), preparation.postconditions as any);
        const observed = (back.data as any)?.observed as Record<string, unknown> | undefined;
        Object.assign(result, { outcome: back.verified ? 'would-be-done' : back.absent ? 'would-not-happen' : 'would-be-not-sure', lostReply: doError !== null, receipt,
          readBack: { outcome: (back.data as any)?.outcome ?? null, comparison: observed ? Object.entries(preparation.postconditions).map(([name, expected]) => ({ name, expected, observed: observed[name] ?? null, match: canonical(observed[name] ?? null) === canonical(expected) })) : null } });
      }
    } catch (error) {
      Object.assign(result, { outcome: 'refused', code: error instanceof ChausarError ? error.code : 'PRACTICE_FAILED' });
    }
    result.requests = bundle.fake.log.slice(first); result.changes = diff(before, bundle.fake.snapshot());
    result.steps = ['prepared', 'approved', 'done', 'read-back', 'recorded'].map(name => ({ name, state: 'practice' }));
    results.push(result);
  }
  await service.store.update(state => {
    current(state, context, 'prepare'); const wb = moduleState(state, MODULE_ID, initState);
    wb.practiceRuns.push({ id: runId, at: service.ports.clock(), by: context.memberId, actionId, steps: results.map(r => ({ system: String(r.system), action: String(r.action), outcome: String(r.outcome) })) });
    if (wb.practiceRuns.length > 50) wb.practiceRuns.splice(0, wb.practiceRuns.length - 50);
    audit(state, 'writeback.practice', { runId, steps: results.length });
  });
  return { id: runId, practice: true, label: 'practice', sent: 0, steps: results, message: 'Practice: nothing was sent and nothing changed outside this app.' };
}

export type QualificationCase = { system: SystemId; action: string; payload: WireObject };
/**
 * The write-back recipe test: for each case, against fresh fakes, (1) the change is applied once
 * and read back, (2) the same effect key again sends nothing, (3) a reply lost after the system
 * applied it is settled by reading back, with exactly one effect. The score is kept apart from the
 * read score. A sandbox run uses a person's sandbox connection instead and is recorded as such.
 */
export async function qualify(service: WritebackService, context: Context, cases: readonly QualificationCase[], factory: FakeFactory) {
  current(service.store.read(), context, 'admin');
  const results: { system: SystemId; action: string; checks: { name: string; passed: boolean }[]; score: string }[] = [];
  for (const item of cases) {
    const row = entry(item.system, item.action); if (!row || row.tier === 'prepare-only' || !service.ports.adapters[item.system]?.[item.action]) continue;
    const adapter = service.adapter(item.system, item.action); const checks: { name: string; passed: boolean }[] = [];
    const run = async (name: string, body: (ctx: AdapterContext, fake: FakeSystem) => Promise<boolean>) => {
      const bundle = factory(item.system, service.ports.clock);
      const ctx: AdapterContext = { connection: practiceConnection(item.system, bundle.account), clock: service.ports.clock, credentials: async () => bundle.secret,
        http: bundle.fake.transport ?? (async () => { throw new ChausarError('PRACTICE_NO_HTTP', 'No web interface.'); }), dial: bundle.fake.dial ?? (async () => { throw new ChausarError('PRACTICE_NO_MAIL', 'No mail interface.'); }) };
      let passed = false; try { passed = await body(ctx, bundle.fake); } catch { passed = false; } checks.push({ name, passed });
    };
    const once = async (ctx: AdapterContext, fake: FakeSystem, key: string, fault: 'drop-after-commit' | 'none') => {
      const payload = adapter.validate(structuredClone(item.payload)); const preparation = await adapter.prepare(ctx, payload, key);
      if (preparation.alreadyApplied) return { applied: true, sent: false };
      fake.fault(fault); let receipt = null; try { receipt = await adapter.do(ctx, payload, preparation, key); } catch { receipt = null; } fake.fault('none');
      const back = catalogueReadback(await adapter.readBack(ctx, payload, preparation, key, receipt), preparation.postconditions as any);
      return { applied: back.verified, sent: true };
    };
    await run('applied-once-and-read-back', async (ctx, fake) => (await once(ctx, fake, 'qualify-once', 'none')).applied);
    await run('same-key-sends-nothing', async (ctx, fake) => { const first = await once(ctx, fake, 'qualify-repeat', 'none'); const second = await once(ctx, fake, 'qualify-repeat', 'none'); return first.applied && second.applied && !second.sent; });
    await run('lost-reply-settled-by-read-back', async (ctx, fake) => (await once(ctx, fake, 'qualify-lost', 'drop-after-commit')).applied);
    results.push({ system: item.system, action: item.action, checks, score: `${checks.filter(c => c.passed).length}/${checks.length}` });
  }
  await service.store.update(state => {
    current(state, context, 'admin'); const wb = moduleState(state, MODULE_ID, initState);
    for (const result of results) wb.qualifications = [...wb.qualifications.filter(q => !(q.system === result.system && q.action === result.action && q.level === 'synthetic-tested')),
      { system: result.system, action: result.action, level: 'synthetic-tested', connectionId: null, checks: result.checks, score: result.score, at: service.ports.clock(), evidence: canonical(result.checks) }];
    audit(state, 'writeback.qualified', { rows: results.length });
  });
  return { level: 'synthetic-tested', rows: results };
}

/**
 * The same recipe test on a person's sandbox connection (a trial organisation, a test sheet, a
 * test mailbox): applied once and read back, then the same key again sends nothing. A lost reply
 * cannot be staged on a real system, so that check stays with the fakes. Only a sandbox connection
 * with the action granted can run it, and only a full pass is recorded as sandbox-verified.
 */
export async function qualifySandbox(service: WritebackService, context: Context, input: Record<string, unknown>) {
  current(service.store.read(), context, 'admin');
  const p = record(input, ['connectionId', 'cases']);
  const connection = service.connections(context).find(c => c.id === p.connectionId && !c.revokedAt);
  check(connection && connection.environment === 'sandbox', 'SANDBOX_CONNECTION_REQUIRED', 'Run the recipe test on a sandbox connection.');
  check(Array.isArray(p.cases) && p.cases.length > 0 && p.cases.length <= 20, 'INVALID_REQUEST', 'Give one to twenty test cases.');
  const runId = newId('qualify'); const results: { action: string; checks: { name: string; passed: boolean }[]; score: string }[] = [];
  for (const raw of p.cases) {
    const c = record(raw, ['action', 'payload']); const row = entry(connection.system, String(c.action));
    check(row && row.tier !== 'prepare-only' && connection.write.includes(row.action), 'WRITE_NOT_GRANTED', 'The sandbox connection must be granted each action it tests.');
    const adapter = service.adapter(connection.system, row.action); const ctx = service.adapterContext(context, connection);
    const key = `qualify-sandbox-${runId}-${row.action}`; const checks: { name: string; passed: boolean }[] = [];
    try {
      const payload = adapter.validate(JSON.parse(canonical(c.payload))); const preparation = await adapter.prepare(ctx, payload, key);
      check(!preparation.alreadyApplied, 'WRITE_ALREADY_APPLIED', 'The test effect already exists.');
      const receipt = await adapter.do(ctx, payload, preparation, key);
      checks.push({ name: 'applied-once-and-read-back', passed: catalogueReadback(await adapter.readBack(ctx, payload, preparation, key, receipt), preparation.postconditions as any).verified });
      checks.push({ name: 'same-key-sends-nothing', passed: Boolean((await adapter.prepare(ctx, payload, key)).alreadyApplied) });
    } catch { checks.push({ name: 'applied-once-and-read-back', passed: false }); }
    results.push({ action: row.action, checks, score: `${checks.filter(x => x.passed).length}/2` });
  }
  await service.store.update(state => {
    current(state, context, 'admin'); const wb = moduleState(state, MODULE_ID, initState);
    for (const result of results) if (result.checks.length === 2 && result.checks.every(x => x.passed)) wb.qualifications.push({ system: connection.system, action: result.action, level: 'sandbox-verified', connectionId: connection.id, checks: result.checks, score: result.score, at: service.ports.clock(), evidence: canonical({ runId, checks: result.checks }) });
    audit(state, 'writeback.qualified-sandbox', { connectionId: connection.id, rows: results.length });
  });
  return { level: 'sandbox-verified', connectionId: connection.id, rows: results };
}
