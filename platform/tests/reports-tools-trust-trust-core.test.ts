import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context, Fact } from '../runtime/contracts.ts';
import { markingsForSources } from '../runtime/trust-ext/methods-core.ts';

// Synthetic people, phones and GSTINs only.
const names = ['Asha Traders', 'Bharat Stores', 'Ravi Kumar'];
const passphrase = 'Synthetic-trust-core-fixture';
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
function fact(id: string, sourceId: string, fields: Record<string, unknown>): Fact {
  return { id, entityId: id, sourceId, sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: new Date().toISOString(), supersededAt: null, fields, branch: 'main' };
}

async function fixture(t: any, data = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-trust-core-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function call(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: any = {}) { const r = await call(method, payload); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  await rpc('workspace.create', { name: 'Synthetic trust core', passphrase, demo: false });
  const store = engine.vault!;
  if (data) await store.update(state => {
    state.facts.push(
      fact('f1', 'synthetic-sales', { customerName: names[0], phone: '+91 98765 43210', email: 'asha@example.in', gstin: '27ABCDE1234F1Z5', amountMinor: '12345', date: '2026-09-01', note: `Paid by ${names[2]}` }),
      fact('f2', 'synthetic-sales', { customerName: names[1], phone: '+91 91234 56780', email: 'bharat@example.in', gstin: '29ABCDE1234F1Z5', amountMinor: '67890', date: '2026-09-02', note: 'cash' }),
      { ...fact('f3', 'synthetic-bank-statement', { narration: 'NEFT', amountMinor: '5000', date: '2026-09-03' }), kind: 'bank-line', learnedAt: new Date(Date.now() - 60000).toISOString() });
  });
  async function member(name: string, role: string): Promise<Context> {
    const invite = await rpc('auth.invite', { name, role }); const accepted = await rpc('auth.accept', { token: invite.token }); return { ...accepted.context, channel: 'desktop' };
  }
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  return { engine, store, rpc, call, member, as, directory };
}

test('rules summarise the four rows and count what left today by destination', async t => {
  const f = await fixture(t); const at = new Date().toISOString();
  await f.store.update(state => {
    state.modelReceipts.push({ id: 'm1', kind: 'model-preview', status: 'completed', endpoint: 'https://model.example.test/v1', payload: 'abcd', createdAt: at, dispatchedAt: at },
      { id: 'm2', kind: 'model-preview', status: 'refused', endpoint: 'https://model.example.test/v1', createdAt: at },
      { id: 'm3', kind: 'model-preview', status: 'preview', endpoint: 'https://model.example.test/v1', createdAt: at },
      { id: 'm4', kind: 'model-preview', status: 'completed', endpoint: 'https://model.example.test/v1', payload: 'x', createdAt: '2020-01-01T00:00:00.000Z' });
    state.imports.push({ type: 'connector-capture-v1', id: 'c1', sourceId: 'synthetic-shop', operationKey: 'shop:orders', createdAt: at, totalBytes: 100 });
  });
  const rules = await f.rpc('trustx.rules');
  assert.deepEqual(rules.see, { allSources: true, allowed: 3, refused: 0 });
  assert.deepEqual(rules.send, { level: 'nothing', localOnly: false }); assert.deepEqual(rules.keep, { days: 90 }); assert.deepEqual(rules.do, { preset: null });
  assert.equal(rules.canChange, true); assert.deepEqual(rules.ownerOnly, ['send', 'sharing', 'seats']);
  assert.equal(rules.leftToday.date, at.slice(0, 10));
  assert.deepEqual(rules.leftToday.items, [
    { destination: 'https://model.example.test/v1', kind: 'model', count: 1, bytes: 4, stopped: 1 },
    { destination: 'shop:orders', kind: 'connector', count: 1, bytes: 100, stopped: 0 }]);
});

test('bank sources are marked financial from the start; marks and seat visibility change and follow the data', async t => {
  const f = await fixture(t);
  let m = await f.rpc('trustx.markings');
  assert.deepEqual(m.kinds, ['personal', 'financial', 'confidential']);
  assert.equal(m.marks.length, 1); assert.equal(m.marks[0].auto, true); assert.equal(m.marks[0].kind, 'financial'); assert.equal(m.marks[0].target.sourceId, 'synthetic-bank-statement');
  assert.deepEqual(m.seats.find((s: any) => s.seat === 'accountant').sees, { personal: false, financial: true, confidential: false });
  assert.deepEqual(m.seats.find((s: any) => s.seat === 'ca').sees, { personal: false, financial: true, confidential: false });
  assert.deepEqual(m.seats.find((s: any) => s.seat === 'cofounder').sees, { personal: true, financial: true, confidential: true });
  assert.deepEqual(m.seats.find((s: any) => s.seat === 'staff').sees, { personal: false, financial: false, confidential: false });
  assert.deepEqual(m.where, { source: 'books/sources', record: 'books/customers', field: 'books/meanings' });
  m = await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'field', sourceId: 'synthetic-sales', recordId: 'f1', field: 'phone' }, on: true });
  assert.equal(m.marks.length, 2);
  assert.deepEqual(markingsForSources(f.store.read(), ['synthetic-sales', 'synthetic-bank-statement']), ['personal', 'financial']);
  assert.deepEqual(markingsForSources(f.store.read(), ['synthetic-sales']), ['personal']);
  m = await f.rpc('trustx.setMarking', { kind: 'financial', target: { type: 'source', sourceId: 'synthetic-bank-statement' }, on: false });
  assert.equal(m.marks.some((x: any) => x.auto), false);
  m = await f.rpc('trustx.setMarking', { kind: 'financial', target: { type: 'source', sourceId: 'synthetic-bank-statement' }, on: true });
  assert.equal(m.marks.some((x: any) => x.auto), true);
  const missing = await f.call('trustx.setMarking', { kind: 'personal', target: { type: 'source', sourceId: 'not-a-source' }, on: true });
  assert.equal(missing.body.error.code, 'SOURCE_NOT_FOUND');
  m = await f.rpc('trustx.setSeatMarking', { seat: 'accountant', kind: 'personal', sees: true });
  assert.equal(m.seats.find((s: any) => s.seat === 'accountant').sees.personal, true);
  assert.equal((await f.call('trustx.setSeatMarking', { seat: 'owner', kind: 'personal', sees: false })).body.error.code, 'SEAT_FIXED');
  // Deleting the source removes its marks.
  await f.rpc('trustx.setMarking', { kind: 'confidential', target: { type: 'source', sourceId: 'synthetic-sales' }, on: true });
  await f.rpc('sources.delete', { id: 'synthetic-sales' });
  assert.deepEqual(markingsForSources(f.store.read(), ['synthetic-sales']), []);
});

test('send levels draw the person\'s own data with stand-ins and no real identity', async t => {
  const f = await fixture(t); const levels = await f.rpc('trustx.sendLevels');
  assert.equal(levels.current, 'nothing'); assert.equal(levels.synthetic, false); assert.equal(levels.voice.on, false);
  assert.deepEqual(levels.levels.map((l: any) => l.id), ['nothing', 'shape', 'samples']);
  const [nothing, shape, samples] = levels.levels;
  assert.ok(nothing.headings.every((h: string) => h === '—')); assert.deepEqual(nothing.rows, []);
  assert.equal(shape.rows.length, 1); assert.ok(shape.rows[0].includes('money'));
  assert.equal(samples.rows.length, 2);
  const text = JSON.stringify(levels);
  for (const secret of [...names, '98765', '91234', 'asha@example.in', '27ABCDE1234F1Z5']) assert.equal(text.includes(secret), false, secret);
  for (const standIn of ['CUSTOMER_1', 'CUSTOMER_2', 'PHONE_1', 'EMAIL_1', 'GSTIN_1']) assert.ok(text.includes(standIn), standIn);
  assert.ok(levels.levels.every((l: any) => l.memory && l.question));
  const empty = await fixture(t, false); const example = await empty.rpc('trustx.sendLevels');
  assert.equal(example.synthetic, true); assert.ok(JSON.stringify(example).includes('CUSTOMER_1'));
});

test('dual control: owner alone applies; with a cofounder each waits for the other', async t => {
  const f = await fixture(t);
  const alone = await f.rpc('trustx.setSend', { level: 'shape', localOnly: true, financialRoutes: ['local-model'] });
  assert.equal(alone.state, 'applied'); assert.equal(f.store.read().policy.send, 'shape');
  let levels = await f.rpc('trustx.sendLevels'); assert.equal(levels.localOnly, true); assert.deepEqual(levels.financialRoutes, ['local-model']);

  const invited = await f.rpc('trustx.invite', { seat: 'cofounder', name: 'Synthetic partner' }); assert.equal(invited.state, 'applied');
  const accepted = await f.rpc('auth.accept', { token: invited.invite.token }); const partner: Context = { ...accepted.context, channel: 'desktop' };
  const accountant = await f.member('Synthetic books', 'accountant');

  const waiting = await f.rpc('trustx.setSend', { level: 'samples' });
  assert.equal(waiting.state, 'waiting-for-second'); assert.equal(waiting.change.needs, 'cofounder'); assert.equal(waiting.change.what, 'send');
  assert.equal(f.store.read().policy.send, 'shape');
  assert.equal((await f.rpc('trustx.pendingChanges')).items.length, 1);
  assert.equal((await f.call('trustx.confirmChange', { id: waiting.change.id })).body.error.code, 'SELF_CONFIRM');
  await assert.rejects(f.as(accountant, 'trustx.confirmChange', { id: waiting.change.id }), code('FORBIDDEN'));
  await assert.rejects(f.as(accountant, 'trustx.setSend', { level: 'nothing' }), code('FORBIDDEN'));
  const done = await f.as(partner, 'trustx.confirmChange', { id: waiting.change.id });
  assert.equal(done.state, 'applied'); assert.equal(f.store.read().policy.send, 'samples');
  assert.equal((await f.rpc('trustx.pendingChanges')).items.length, 0);

  const fromPartner = await f.as(partner, 'trustx.setSend', { level: 'nothing' });
  assert.equal(fromPartner.state, 'waiting-for-second'); assert.equal(fromPartner.change.needs, 'owner');
  await assert.rejects(f.as(partner, 'trustx.confirmChange', { id: fromPartner.change.id }), code('SELF_CONFIRM'));
  assert.equal((await f.rpc('trustx.confirmChange', { id: fromPartner.change.id })).state, 'applied'); assert.equal(f.store.read().policy.send, 'nothing');

  // Seat changes wait too, and the confirmer receives the one-time code.
  const seat = await f.rpc('trustx.invite', { seat: 'accountant', name: 'Synthetic accountant' }); assert.equal(seat.state, 'waiting-for-second'); assert.equal(seat.invite, undefined);
  const confirmed = await f.as(partner, 'trustx.confirmChange', { id: seat.change.id });
  assert.equal(typeof confirmed.invite.token, 'string'); assert.ok(confirmed.guide.html.includes('arrives separately'));

  // Changes expire after seven days.
  const late = await f.rpc('trustx.setSend', { level: 'shape' });
  await f.store.update(state => { (state.extensions as any)['reports-tools-trust'].trust.core.pending[0].expiresAt = '2020-01-01T00:00:00.000Z'; });
  assert.equal((await f.rpc('trustx.pendingChanges')).items.length, 0);
  await assert.rejects(f.as(partner, 'trustx.confirmChange', { id: late.change.id }), code('CHANGE_EXPIRED'));
  // The person a change removes is never the second person: the owner removes the only cofounder at once.
  const removal = await f.rpc('trustx.removeSeat', { memberId: partner.memberId });
  assert.equal(removal.state, 'applied'); assert.equal(f.store.read().members.find(m => m.id === partner.memberId)!.active, false);
});

test('keep lists kinds and the files the app writes, including the vault', async t => {
  const f = await fixture(t); let keep = await f.rpc('trustx.keep');
  assert.deepEqual(keep.kinds.map((k: any) => k.kind), ['facts', 'modelReceipts', 'activity', 'briefs', 'exports', 'learning']);
  assert.equal(keep.kinds[0].days, 90); assert.equal(keep.kinds[1].days, null); assert.match(keep.kinds[1].note, /until you delete it/);
  const vault = keep.inventory.find((i: any) => i.path.endsWith('authority.encrypted.json'));
  assert.ok(vault, JSON.stringify(keep.inventory)); assert.ok(vault.bytes > 0); assert.match(vault.what, /vault/);
  assert.ok(keep.inventory.every((i: any) => !i.path.startsWith('/') && !i.path.includes('..')));
  keep = await f.rpc('trustx.setKeep', { kind: 'facts', days: 30 }); assert.equal(keep.kinds[0].days, 30); assert.equal(f.store.read().policy.retentionDays, 30);
  keep = await f.rpc('trustx.setKeep', { kind: 'exports', days: 14 }); assert.equal(keep.kinds.find((k: any) => k.kind === 'exports').days, 14);
  assert.equal((await f.call('trustx.setKeep', { kind: 'facts', days: null })).body.error.code, 'INVALID_KEEP');
});

test('do: what may run on its own is jobs-ext\'s; this lane keeps no autonomy engine', async t => {
  const f = await fixture(t);
  for (const method of ['trustx.autonomy', 'trustx.setAutonomy']) assert.equal((await f.call(method, {})).body.error.code, 'UNKNOWN_METHOD', method);
  // jobs-ext is not installed here, so the Do row has no preset to show.
  assert.deepEqual((await f.rpc('trustx.rules')).do, { preset: null });
});

test('seats: invite with a one-time code, CA end date, removal and the last owner', async t => {
  const f = await fixture(t);
  const acc = await f.rpc('trustx.invite', { seat: 'accountant', name: 'Synthetic <b>accountant</b>' });
  assert.equal(acc.state, 'applied'); assert.match(acc.invite.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(acc.guide.html.includes('&lt;b&gt;')); assert.equal(acc.guide.html.includes(acc.invite.token), false); assert.match(acc.guide.html, /arrives separately/);
  const accepted = await f.rpc('auth.accept', { token: acc.invite.token });
  let seats = await f.rpc('trustx.seats');
  const row = seats.seats.find((s: any) => s.memberId === accepted.member.id);
  assert.equal(row.seat, 'accountant'); assert.deepEqual(row.limits.length, 4); assert.ok(row.limits.includes('Cannot approve money.'));
  assert.equal(seats.seats.find((s: any) => s.memberId === 'owner').you, true);
  assert.ok(seats.templates.find((s: any) => s.seat === 'staff').limits.some((l: string) => /not yet enforced/.test(l)));

  assert.equal((await f.call('trustx.invite', { seat: 'ca', name: 'Synthetic CA' })).body.error.code, 'INVALID_END_DATE');
  const day = new Date().toISOString().slice(0, 10);
  const ca = await f.rpc('trustx.invite', { seat: 'ca', name: 'Synthetic CA', endsOn: day }); assert.equal(ca.guide, undefined);
  const caMember = await f.rpc('auth.accept', { token: ca.invite.token }); const caCtx: Context = { ...caMember.context, channel: 'desktop' };
  assert.equal(caMember.member.role, 'viewer');
  seats = await f.as(caCtx, 'trustx.seats'); assert.equal(seats.seats.find((s: any) => s.you).seat, 'ca'); assert.equal(seats.seats.find((s: any) => s.you).ended, false);
  await assert.rejects(f.as(caCtx, 'trustx.setSend', { level: 'samples' }), code('FORBIDDEN'));
  await f.store.update(state => { const core = (state.extensions as any)['reports-tools-trust'].trust.core; core.seats[ca.invite.id].endsOn = '2020-01-01'; });
  seats = await f.rpc('trustx.seats'); const ended = seats.seats.find((s: any) => s.memberId === caMember.member.id);
  assert.equal(ended.ended, true); assert.equal(ended.active, false); assert.equal(ended.endsOn, '2020-01-01');
  await assert.rejects(f.as(caCtx, 'trustx.rules'), code('ACCESS_REVOKED'));

  const removed = await f.rpc('trustx.removeSeat', { memberId: accepted.member.id });
  assert.equal(removed.state, 'applied'); assert.equal(removed.removedOn, day); assert.match(removed.kept, /stays with that person/);
  seats = await f.rpc('trustx.seats'); const gone = seats.seats.find((s: any) => s.memberId === accepted.member.id);
  assert.equal(gone.removedOn, day); assert.equal(gone.active, false);
  assert.equal((await f.call('trustx.removeSeat', { memberId: 'owner' })).body.error.code, 'LAST_OWNER');
  assert.equal((await f.call('trustx.invite', { seat: 'owner', name: 'Another owner' })).body.error.code, 'SEAT_NOT_INVITABLE');
});

test('a viewer reads the rules but is refused on every admin method', async t => {
  const f = await fixture(t); const viewer = await f.member('Synthetic viewer', 'viewer');
  assert.equal((await f.as(viewer, 'trustx.rules')).canChange, false);
  for (const [method, payload] of [['trustx.setMarking', { kind: 'personal', target: { type: 'source', sourceId: 'synthetic-sales' }, on: true }],
    ['trustx.setSeatMarking', { seat: 'staff', kind: 'personal', sees: true }], ['trustx.setSend', { level: 'samples' }], ['trustx.confirmChange', { id: 'x' }],
    ['trustx.setKeep', { kind: 'exports', days: 5 }], ['trustx.invite', { seat: 'staff', name: 'X' }], ['trustx.removeSeat', { memberId: 'owner' }]] as const)
    await assert.rejects(f.as(viewer, method, payload), code('FORBIDDEN'), method);
});

test('the scheduled tick ends dated seats', async t => {
  const f = await fixture(t);
  const ca = await f.rpc('trustx.invite', { seat: 'ca', name: 'Synthetic CA', endsOn: new Date().toISOString().slice(0, 10) });
  const member = await f.rpc('auth.accept', { token: ca.invite.token });
  await f.store.update(state => { (state.extensions as any)['reports-tools-trust'].trust.core.seats[ca.invite.id].endsOn = '2020-01-01'; });
  await f.rpc('trust.update', { autonomy: true });
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const results = await f.engine.tick();
  assert.ok(results.some((r: any) => r.module === 'trustx.core' && r.endedSeats === 1), JSON.stringify(results));
  assert.equal(f.store.read().members.find(m => m.id === member.member.id)!.active, false);
});

test('a dated seat ends before any request of this lane, with the scheduler off', async t => {
  const f = await fixture(t);
  const ca = await f.rpc('trustx.invite', { seat: 'ca', name: 'Synthetic CA', endsOn: new Date().toISOString().slice(0, 10) });
  const member = await f.rpc('auth.accept', { token: ca.invite.token }); const seat: Context = { ...member.context, channel: 'desktop' };
  assert.equal((await f.as(seat, 'trustx.rules')).canChange, false);
  await f.store.update(state => { (state.extensions as any)['reports-tools-trust'].trust.core.seats[ca.invite.id].endsOn = '2020-01-01'; });
  assert.equal(f.store.read().policy.autonomy, false);
  await assert.rejects(f.as({ ...seat }, 'reportsx.packs'), code('ACCESS_REVOKED'));
  assert.equal(f.store.read().members.find(m => m.id === member.member.id)!.active, false);
});
