import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { registerCoreHook } from '../runtime/contracts.ts';
import type { Context } from '../runtime/contracts.ts';
import { visibleFacts } from '../runtime/trust.ts';
import '../runtime/trust-ext/core-hooks.ts';
import { setPolicy } from '../runtime/trust-ext/core-hooks.ts';
import { assistants } from '../runtime/trust-ext/tools-assistants.ts';
import { tickLane } from '../runtime/trust-ext/lifecycle.ts';

// Synthetic people and sources only. The trust boundary: sessions, pairing, dual control, the change guard, markings and deletion.
const LANE = 'reports-tools-trust';
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
const csv = (rows: string) => `id,kind,date,amount,currency,branch\n${rows}`;
const recipe = (id: string) => ({ version: 1, id, system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic boundary', branches: ['main'] },
  bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
  allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' });

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-boundary-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.shutdown?.(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic boundary', passphrase: 'Synthetic-boundary-fixture', demo: false });
  const owner = engine.bootstrapContext();
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  const load = (sourceId: string, rows: string, rowCount: number, amountMinor: string) =>
    as(owner, 'sources.import', { sourceId, format: 'csv', content: csv(rows), expectedTotals: { rowCount, amountMinor }, recipe: recipe(`${sourceId}-v1`) });
  const ctxOf = (id: string, role: Context['role']): Context => ({ memberId: id, role, epoch: 1, channel: 'desktop' });
  return { engine, owner, as, load, ctxOf, vault: () => engine.vault! };
}

test('an owner cannot issue a session for another owner or a cofounder, so cannot confirm their own Send change', async t => {
  const f = await fixture(t);
  await f.as(f.owner, 'members.add', { id: 'owner-2', name: 'Synthetic second owner', role: 'owner' });
  await f.as(f.owner, 'members.add', { id: 'acc', name: 'Synthetic accountant', role: 'accountant' });
  await f.as(f.owner, 'members.add', { id: 'cof', name: 'Synthetic cofounder', role: 'cofounder' });
  const waiting = await f.as(f.owner, 'trustx.setSend', { level: 'samples' }); assert.equal(waiting.state, 'waiting-for-second');
  for (const memberId of ['cof', 'owner-2']) await assert.rejects(f.as(f.owner, 'auth.session', { memberId }), code('SESSION_SCOPE_FORBIDDEN'), memberId);
  assert.equal(f.vault().read().policy.send, 'nothing');
  // Sessions for the owner themself and for a lower seat still work.
  assert.equal(typeof (await f.as(f.owner, 'auth.session', {})).token, 'string');
  const accountant = await f.as(f.owner, 'auth.session', { memberId: 'acc' }); assert.equal(f.engine.contextForSession(accountant.token).memberId, 'acc');
});

test('a paired assistant is a numbers-only member: no desktop session, re-pairing replaces it, and its day ends it', async t => {
  const f = await fixture(t);
  await f.as(f.owner, 'trustx.setAssistants', { on: true });
  const first = await f.as(f.owner, 'trustx.pairAssistant', { name: 'Synthetic bot' });
  assert.equal(f.vault().read().members.find(m => m.id === first.id)!.scope, 'mcp');
  // The owner cannot issue an unscoped session for it, and a scoped one is still refused off the numbers server.
  await assert.rejects(f.as(f.owner, 'auth.session', { memberId: first.id }), code('SESSION_SCOPE_FORBIDDEN'));
  const scoped = await f.engine.withContext(f.owner, () => f.engine.services.auth.issueSession(f.owner, first.id, 3600000, { scope: 'mcp' }));
  assert.throws(() => f.engine.contextForSession(scoped.token), code('SESSION_SCOPE_FORBIDDEN'));
  // Pairing the same name again revokes the assistant paired before under it.
  const second = await f.as(f.owner, 'trustx.pairAssistant', { name: 'synthetic BOT' });
  const members = f.vault().read().members;
  assert.equal(members.find(m => m.id === first.id)!.active, false); assert.equal(members.find(m => m.id === second.id)!.active, true);
  // Once its day is over it shows as inactive and is revoked lazily, on the view and by the lane tick.
  const age = async (id: string) => f.vault().update(state => { (state.extensions as any)[LANE].tools.assistants.paired.find((p: any) => p.id === id).pairedAt = '2020-01-01T00:00:00.000Z'; });
  await age(second.id);
  const host = f.engine.moduleHost(LANE, f.owner);
  const view = await f.engine.withContext(f.owner, () => assistants(f.owner, {}, host));
  assert.equal(view.assistants.find((a: any) => a.id === second.id)!.active, false);
  assert.equal(f.vault().read().members.find(m => m.id === second.id)!.active, false);
  const third = await f.as(f.owner, 'trustx.pairAssistant', { name: 'Synthetic other' }); await age(third.id);
  const ticked = await f.engine.withContext(f.owner, () => tickLane(f.owner, host, { awake: true, windowOpen: true, backgroundEnabled: false }));
  assert.ok(ticked.some((r: any) => r.part === 'trust-assistants' && r.revoked === 1), JSON.stringify(ticked));
  assert.equal(f.vault().read().members.find(m => m.id === third.id)!.active, false);
});

test('widening what a seat sees waits for both people; narrowing applies at once', async t => {
  const f = await fixture(t);
  await f.load('synthetic-boundary-ledger', 'inv-a,invoice,2026-09-02,100.00,INR,main\n', 1, '10000');
  await f.as(f.owner, 'members.add', { id: 'cof', name: 'Synthetic cofounder', role: 'cofounder' });
  const cof = f.ctxOf('cof', 'cofounder'); const target = { type: 'source', sourceId: 'synthetic-boundary-ledger' };
  // Narrowing: a marking on, a seat not seeing a kind. Each applies at once and returns the markings.
  assert.ok(Array.isArray((await f.as(cof, 'trustx.setMarking', { kind: 'confidential', target, on: true })).marks));
  assert.equal((await f.as(cof, 'trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: false })).seats.find((s: any) => s.seat === 'accountant').sees.financial, false);
  // Widening: a cofounder alone does not.
  const seeing = await f.as(cof, 'trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: true });
  assert.equal(seeing.state, 'waiting-for-second'); assert.equal(seeing.change.needs, 'owner');
  const unmark = await f.as(cof, 'trustx.setMarking', { kind: 'confidential', target, on: false });
  assert.equal(unmark.state, 'waiting-for-second');
  const markings = await f.as(f.owner, 'trustx.markings');
  assert.equal(markings.seats.find((s: any) => s.seat === 'accountant').sees.financial, false); assert.ok(markings.marks.some((m: any) => m.kind === 'confidential'));
  assert.equal((await f.as(f.owner, 'trustx.confirmChange', { id: seeing.change.id })).state, 'applied');
  assert.equal((await f.as(f.owner, 'trustx.confirmChange', { id: unmark.change.id })).state, 'applied');
  const after = await f.as(f.owner, 'trustx.markings');
  assert.equal(after.seats.find((s: any) => s.seat === 'accountant').sees.financial, true); assert.ok(!after.marks.some((m: any) => m.kind === 'confidential'));
});

test('loosening and seat-adding changes are made in the app; allowed sources and autonomy are under dual control', async t => {
  const f = await fixture(t);
  const tainted: Context = { ...f.owner, sourceTainted: true }; const numbers: Context = { ...f.owner, channel: 'mcp' };
  // Owner alone, but from outside text or another channel: refused.
  for (const ctx of [tainted, numbers]) {
    for (const [method, payload] of [['trust.update', { send: 'samples' }], ['trust.update', { autonomy: true }], ['trust.update', { allowedSources: ['synthetic-only'] }],
      ['members.add', { id: 'x', name: 'Synthetic', role: 'viewer' }], ['auth.invite', { name: 'Synthetic', role: 'viewer' }], ['trustx.setSend', { level: 'shape' }]] as const)
      await assert.rejects(f.as(ctx, method, payload), code('APP_CONSENT_REQUIRED'), `${ctx.channel} ${method}`);
  }
  // Narrowing from a tainted request still works.
  assert.equal((await f.as(tainted, 'trust.update', { autonomy: false })).autonomy, false);
  // In the app the owner alone applies; with a cofounder, allowed sources and autonomy on need both.
  assert.equal((await f.as(f.owner, 'trust.update', { autonomy: true })).autonomy, true);
  await f.as(f.owner, 'trust.update', { autonomy: false });
  await f.as(f.owner, 'members.add', { id: 'cof', name: 'Synthetic cofounder', role: 'cofounder' });
  const cof = f.ctxOf('cof', 'cofounder');
  for (const ctx of [f.owner, cof]) for (const patch of [{ autonomy: true }, { allowedSources: ['synthetic-only'] }, { allowedSources: ['*', 'synthetic-only'] }])
    await assert.rejects(f.as(ctx, 'trust.update', patch), code('SECOND_PERSON_REQUIRED'), `${ctx.role} ${JSON.stringify(patch)}`);
  assert.deepEqual(f.vault().read().policy.allowedSources, ['*']);
  // The same list in another order is no change.
  assert.deepEqual((await f.as(cof, 'trust.update', { allowedSources: ['*'] })).allowedSources, ['*']);
  // Through Trust it waits, and applies once the other person confirms; confirming from a tainted request is refused.
  const host = f.engine.moduleHost(LANE, cof);
  const waiting = await f.engine.withContext(cof, () => setPolicy(cof, { allowedSources: ['synthetic-only'] }, host)) as any;
  assert.equal(waiting.state, 'waiting-for-second');
  await assert.rejects(f.as(tainted, 'trustx.confirmChange', { id: waiting.change.id }), code('APP_CONSENT_REQUIRED'));
  assert.equal((await f.as(f.owner, 'trustx.confirmChange', { id: waiting.change.id })).state, 'applied');
  assert.deepEqual(f.vault().read().policy.allowedSources, ['synthetic-only']);
});

test('a fact read asks whether a source is hidden once per source, not once per fact', async t => {
  const f = await fixture(t);
  const rows = (prefix: string) => Array.from({ length: 40 }, (_, i) => `${prefix}-${i},invoice,2026-09-02,1.00,INR,main`).join('\n') + '\n';
  await f.load('synthetic-boundary-shop', rows('s'), 40, '4000');
  await f.load('synthetic-boundary-ledger', rows('l'), 40, '4000');
  await f.as(f.owner, 'members.add', { id: 'acc', name: 'Synthetic accountant', role: 'accountant' });
  let asked = 0; let counting = false;
  registerCoreHook('sourceHidden', () => { if (counting) asked++; return false; });
  counting = true; const facts = visibleFacts(f.vault(), f.ctxOf('acc', 'accountant')); counting = false;
  assert.equal(facts.length, 80); assert.equal(asked, 2);
});

test('the module source deletion needs the owner, the source typed again, and the calling request in flight', async t => {
  const f = await fixture(t);
  await f.load('synthetic-boundary-shop', 'inv-a,invoice,2026-09-02,100.00,INR,main\n', 1, '10000');
  await f.as(f.owner, 'members.add', { id: 'cof', name: 'Synthetic cofounder', role: 'cofounder' });
  const deletion = (ctx: Context) => f.engine.moduleHost(LANE, ctx).services.sourceDeletion;
  await assert.rejects(deletion(f.ctxOf('cof', 'cofounder')).delete('synthetic-boundary-shop', 'synthetic-boundary-shop'), code('OWNER_REQUIRED'));
  await assert.rejects(deletion(f.owner).delete('synthetic-boundary-shop'), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(deletion(f.owner).delete('synthetic-boundary-shop', 'other'), code('CONFIRMATION_REQUIRED'));
  // Outside any request (a host kept after its request ended): refused, and nothing is deleted.
  await assert.rejects(deletion(f.owner).delete('synthetic-boundary-shop', 'synthetic-boundary-shop'), code('VAULT_BUSY'));
  assert.equal(f.vault().read().facts.filter(fact => fact.sourceId === 'synthetic-boundary-shop').length, 1);
  // The lane's own request still deletes, and the fence is released afterwards.
  await f.as(f.owner, 'trustx.deleteSource', { sourceId: 'synthetic-boundary-shop', confirmation: 'synthetic-boundary-shop' });
  assert.equal(f.vault().read().facts.length, 0);
  assert.equal((await f.as(f.owner, 'trustx.deletions')).items.length, 1);
});
