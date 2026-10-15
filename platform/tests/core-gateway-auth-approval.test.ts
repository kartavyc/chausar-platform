import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService, type Connector } from '../runtime/actions.ts';
import { GRANT_MS, LOCK_MS, memberSecret, newMemberSecret, recordGrant, secondAskGate, verifySecondAskSecret } from '../runtime/gateway-auth/second-ask.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Synthetic only: a money connector that never runs, a local vault in a temp directory, no network.
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const passphrase = 'Synthetic second ask passphrase 42';
const money = (impact: 'money' | 'reversible' = 'money') => ({
  title: 'Pay a supplier', description: 'Synthetic payment; never executed here.', impact, idempotency: 'One key names one payment.', readback: 'Reads the payment by key.',
  validate: (payload: any) => payload, execute: async () => ({ businessSuccess: true }), reconcile: async () => ({ verified: true, businessSuccess: true }),
});
const connector = (): Connector => ({ id: 'synthetic-pay', title: 'Synthetic payments', operations: { pay: money(), note: money('reversible') } as any });

class TestStore implements StateStore {
  state: State; passphraseChecks = 0;
  constructor() { this.state = initialState('Synthetic second ask'); this.state.members.push({ id: 'cofounder', name: 'Cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
  async verifyPassphrase(secret: string) { this.passphraseChecks++; return secret === passphrase; }
}

test('the money gate is consumed once, for exactly this member, epoch, action and digest; other services keep their own rules', async t => {
  const store = new TestStore(); const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
  const plain = new ActionService(store, [connector()]);
  const unguarded = await plain.prepare(owner, { connector: 'synthetic-pay', operation: 'pay', payload: { amountMinor: '100' }, idempotencyKey: 'pay-plain-1' });
  assert.equal((await plain.approve(owner, unguarded.id, unguarded.digest)).status, 'approved', 'A service built without the gate keeps its own rules.');

  const gated = new ActionService(store, [connector()], { secondAsk: secondAskGate });
  const pay = await gated.prepare(owner, { connector: 'synthetic-pay', operation: 'pay', payload: { amountMinor: '250000' }, idempotencyKey: 'pay-gated-1' });
  await assert.rejects(gated.approve(owner, pay.id, pay.digest), code('SECOND_ASK_REQUIRED'));
  // A grant for another digest, another member, another action or an older epoch does not count.
  recordGrant(store.read(), owner, { kind: 'action', id: pay.id, digest: 'f'.repeat(64) });
  await assert.rejects(gated.approve(owner, pay.id, pay.digest), code('SECOND_ASK_REQUIRED'));
  recordGrant(store.read(), cofounder, { kind: 'action', id: pay.id, digest: pay.digest });
  await assert.rejects(gated.approve(owner, pay.id, pay.digest), code('SECOND_ASK_REQUIRED'));
  recordGrant(store.read(), { ...owner, epoch: 0 }, { kind: 'action', id: pay.id, digest: pay.digest });
  await assert.rejects(gated.approve(owner, pay.id, pay.digest), code('SECOND_ASK_REQUIRED'));
  recordGrant(store.read(), owner, { kind: 'action', id: pay.id, digest: pay.digest });
  // Every other check runs first: a changed preview is refused and the grant stays unspent.
  await assert.rejects(gated.approve(owner, pay.id, '0'.repeat(64)), code('PREVIEW_CHANGED'));
  assert.equal((await gated.approve(owner, pay.id, pay.digest)).status, 'approved');
  const second = await gated.prepare(owner, { connector: 'synthetic-pay', operation: 'pay', payload: { amountMinor: '250000' }, idempotencyKey: 'pay-gated-2' });
  await assert.rejects(gated.approve(owner, second.id, second.digest), code('SECOND_ASK_REQUIRED'), 'A grant names one action.');
  // The cofounder's grant for the first action was never theirs to use on another; it is still single use for its own.
  const theirs = await gated.prepare(cofounder, { connector: 'synthetic-pay', operation: 'pay', payload: { amountMinor: '7' }, idempotencyKey: 'pay-gated-3' });
  recordGrant(store.read(), cofounder, { kind: 'action', id: theirs.id, digest: theirs.digest });
  assert.equal((await gated.approve(cofounder, theirs.id, theirs.digest)).approval!.memberId, 'cofounder');
  // Grants expire after five minutes.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  recordGrant(store.read(), owner, { kind: 'action', id: second.id, digest: second.digest });
  t.mock.timers.tick(GRANT_MS + 1);
  await assert.rejects(gated.approve(owner, second.id, second.digest), code('SECOND_ASK_REQUIRED'));
  t.mock.timers.reset();
  // Anything that is not money is not asked again.
  const note = await gated.prepare(owner, { connector: 'synthetic-pay', operation: 'note', payload: { text: 'x' }, idempotencyKey: 'note-gated-1' });
  assert.equal((await gated.approve(owner, note.id, note.digest)).status, 'approved');
});

test('the secret check counts failures before answering, locks for fifteen minutes and refuses the wrong seat or channel', async t => {
  const store = new TestStore();
  assert.equal(await verifySecondAskSecret(store, owner, passphrase), true);
  await assert.rejects(verifySecondAskSecret(store, { ...owner, sourceTainted: true }, passphrase), code('TAINTED_APPROVAL'));
  await assert.rejects(verifySecondAskSecret(store, { ...owner, channel: 'phone' }, passphrase), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(verifySecondAskSecret(store, { ...owner, channel: 'mcp' }, passphrase), code('APP_APPROVAL_REQUIRED'));
  store.state.members.push({ id: 'acct', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  await assert.rejects(verifySecondAskSecret(store, { memberId: 'acct', role: 'accountant', epoch: 1 }, passphrase), code('FORBIDDEN'));
  await assert.rejects(verifySecondAskSecret(store, { memberId: 'cofounder', role: 'cofounder', epoch: 1 }, passphrase), code('SECOND_ASK_SECRET_NOT_SET'), 'The owner’s passphrase is never a cofounder’s answer.');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  // Five wrong answers in parallel: all are counted before any is answered, so a sixth is locked even with the right one.
  const wrong = await Promise.all([1, 2, 3, 4, 5].map(n => verifySecondAskSecret(store, owner, `wrong ${n}`)));
  assert.deepEqual(wrong, [false, false, false, false, false]);
  const checks = store.passphraseChecks;
  await assert.rejects(verifySecondAskSecret(store, owner, passphrase), code('SECOND_ASK_LOCKED'));
  assert.equal(store.passphraseChecks, checks, 'A locked ask never checks the passphrase.');
  assert.equal(store.state.activity.filter(a => a.event === 'secondAsk.locked').length, 1);
  assert.doesNotMatch(JSON.stringify(store.state), /wrong \d|Synthetic second ask passphrase/);
  t.mock.timers.tick(LOCK_MS - 1);
  await assert.rejects(verifySecondAskSecret(store, owner, passphrase), code('SECOND_ASK_LOCKED'));
  t.mock.timers.tick(1);
  assert.equal(await verifySecondAskSecret(store, owner, passphrase), true);
  t.mock.timers.reset();
  const bare: StateStore = { read: () => store.read(), update: change => store.update(change) };
  await assert.rejects(verifySecondAskSecret(bare, owner, passphrase), code('SECOND_ASK_UNAVAILABLE'));
});

test('a member secret is an scrypt hash bound to the member’s epoch', async () => {
  const store = new TestStore();
  const record = await newMemberSecret('cofounder approval words', 1, '2026-10-15T00:00:00.000Z');
  assert.match(record.salt, /^[a-f0-9]{32}$/); assert.match(record.hash, /^[a-f0-9]{64}$/); assert.ok(record.N >= 2 ** 15);
  store.state.extensions = { 'core-gateway-auth': { secrets: { cofounder: record } } };
  const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
  assert.equal(await verifySecondAskSecret(store, cofounder, 'cofounder approval words'), true);
  assert.equal(await verifySecondAskSecret(store, cofounder, 'cofounder approval word'), false);
  assert.doesNotMatch(JSON.stringify(store.state), /cofounder approval words/);
  // A changed epoch (a seat re-issued) voids the secret.
  store.state.members.find(m => m.id === 'cofounder')!.epoch = 2;
  assert.equal(memberSecret(store.state, 'cofounder', 2), null);
  await assert.rejects(verifySecondAskSecret(store, { ...cofounder, epoch: 2 }, 'cofounder approval words'), code('SECOND_ASK_SECRET_NOT_SET'));
});

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-second-ask-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock) });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await rm(directory, { recursive: true, force: true }); });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Second Ask Shop', passphrase, demo: false, pack: 'services' });
  // A synthetic money connector installed in the core actions service, as an installed payment connector would be.
  (engine.services.actions as ActionService).registry.set('synthetic-pay', connector());
  const rpc = (method: string, payload: Record<string, unknown> = {}, as: Context = owner) => engine.requestAs(as, method, payload);
  const prepare = (key: string, as: Context = owner, operation = 'pay') => rpc('actions.prepare', { connector: 'synthetic-pay', operation, payload: { amountMinor: '250000', to: 'Synthetic supplier' }, idempotencyKey: key }, as);
  return { directory, engine, rpc, prepare };
}
const grant = (action: { id: string; digest: string }, secret: string) => ({ target: { kind: 'action', id: action.id, digest: action.digest }, secret });

test('core money approval through the engine needs secondAsk.grant with the owner passphrase', async t => {
  const f = await workspace(t);
  const pay = await f.prepare('engine-pay-1');
  await assert.rejects(f.rpc('actions.approve', { id: pay.id, digest: pay.digest }), code('SECOND_ASK_REQUIRED'));
  assert.deepEqual(await f.rpc('secondAsk.status'), { by: 'passphrase', expects: 'passphrase', secretSet: false, lockedUntil: null });
  // Shape, channel, outside text and the exact preview are checked before the passphrase is.
  await assert.rejects(f.rpc('secondAsk.grant', { ...grant(pay, passphrase), extra: true }), code('INVALID_REQUEST'));
  await assert.rejects(f.rpc('secondAsk.grant', { target: { kind: 'job', id: pay.id, digest: pay.digest }, secret: passphrase }), code('INVALID_REQUEST'));
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, passphrase), { ...owner, sourceTainted: true }), code('TAINTED_APPROVAL'));
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, passphrase), { ...owner, channel: 'phone' }), code('OPEN_DESKTOP'));
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, passphrase), { ...owner, channel: 'mcp' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.rpc('secondAsk.grant', grant({ id: pay.id, digest: '0'.repeat(64) }, passphrase)), code('PREVIEW_CHANGED'));
  await assert.rejects(f.rpc('secondAsk.grant', grant({ id: 'action_missing', digest: pay.digest }, passphrase)), code('NOT_FOUND'));
  const note = await f.prepare('engine-note-1', owner, 'note');
  await assert.rejects(f.rpc('secondAsk.grant', grant(note, passphrase)), code('SECOND_ASK_NOT_NEEDED'));
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, 'not the passphrase')), code('SECOND_ASK_FAILED'));
  const granted = await f.rpc('secondAsk.grant', grant(pay, passphrase));
  assert.equal(granted.granted, true); assert.ok(Date.parse(granted.expiresAt) > Date.now());
  assert.deepEqual(Object.keys(granted).sort(), ['expiresAt', 'granted']);
  const approved = await f.rpc('actions.approve', { id: pay.id, digest: pay.digest });
  assert.equal(approved.status, 'approved');
  // Single use: a second approval of a re-prepared payment needs a new answer.
  const again = await f.prepare('engine-pay-2');
  await assert.rejects(f.rpc('actions.approve', { id: again.id, digest: again.digest }), code('SECOND_ASK_REQUIRED'));
  assert.equal((await f.rpc('actions.approve', { id: note.id, digest: note.digest })).status, 'approved', 'Reversible actions are not asked again.');
  const events = f.engine.vault!.read().activity.filter((a: any) => a.event.startsWith('secondAsk.'));
  assert.deepEqual(events.map((e: any) => e.event), ['secondAsk.granted']);
  assert.deepEqual(events[0].details, { kind: 'action', actionId: pay.id, digest: pay.digest, memberId: 'owner' });
  assert.doesNotMatch(JSON.stringify(f.engine.vault!.read()), /Synthetic second ask passphrase|not the passphrase/);
});

test('a cofounder answers with their own approval secret; the owner can clear it', async t => {
  const f = await workspace(t);
  // The accountant first: once a cofounder holds a seat, adding seats needs both people.
  const accountantSeat = await f.rpc('members.add', { name: 'Synthetic accountant', role: 'accountant', branches: ['*'] });
  const accountant: Context = { memberId: accountantSeat.id, role: 'accountant', epoch: accountantSeat.epoch, channel: 'desktop' };
  const added = await f.rpc('members.add', { name: 'Synthetic cofounder', role: 'cofounder', branches: ['*'] });
  const cofounder: Context = { memberId: added.id, role: 'cofounder', epoch: added.epoch, channel: 'desktop' };
  // A payment with no source is private to the person who prepared it (and the owner), so the cofounder prepares their own.
  const pay = await f.prepare('cofounder-pay-1', cofounder);
  assert.deepEqual(await f.rpc('secondAsk.status', {}, cofounder), { by: 'none', expects: 'none', secretSet: false, lockedUntil: null });
  assert.deepEqual(await f.rpc('secondAsk.status', {}, accountant), { by: 'none', expects: 'none', secretSet: false, lockedUntil: null });
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, passphrase), cofounder), code('SECOND_ASK_SECRET_NOT_SET'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'owner approval words' }), code('SECOND_ASK_OWNER_USES_PASSPHRASE'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'too short' }, cofounder), code('SECOND_ASK_SECRET_INVALID'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'x'.repeat(1025) }, cofounder), code('SECOND_ASK_SECRET_INVALID'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'accountant words here' }, accountant), code('FORBIDDEN'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'cofounder words here' }, { ...cofounder, sourceTainted: true }), code('TAINTED_APPROVAL'));
  assert.deepEqual(Object.keys(await f.rpc('secondAsk.setSecret', { secret: 'cofounder words here' }, cofounder)).sort(), ['at', 'set']);
  assert.deepEqual(await f.rpc('secondAsk.status', {}, cofounder), { by: 'member-secret', expects: 'member-secret', secretSet: true, lockedUntil: null });
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'cofounder new words' }, cofounder), code('SECOND_ASK_CURRENT_REQUIRED'));
  await assert.rejects(f.rpc('secondAsk.setSecret', { secret: 'cofounder new words', current: 'not my words' }, cofounder), code('SECOND_ASK_FAILED'));
  await f.rpc('secondAsk.setSecret', { secret: 'cofounder new words', current: 'cofounder words here' }, cofounder);
  // The vault holds a salted hash only.
  const stored = (f.engine.vault!.read().extensions as any)['core-gateway-auth'].secrets[added.id];
  assert.deepEqual(Object.keys(stored).sort(), ['N', 'at', 'epoch', 'hash', 'p', 'r', 'salt']);
  assert.doesNotMatch(JSON.stringify(f.engine.vault!.read()), /cofounder (new )?words|not my words/);
  for (const file of await readdir(f.directory, { recursive: true }).catch(() => [] as string[])) {
    const bytes = await readFile(join(f.directory, String(file))).catch(() => null);
    if (bytes) assert.equal(bytes.includes('cofounder new words'), false, String(file));
  }
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, passphrase), cofounder), code('SECOND_ASK_FAILED'), 'The owner passphrase is not the cofounder’s answer.');
  await assert.rejects(f.rpc('secondAsk.grant', grant(pay, 'cofounder words here'), cofounder), code('SECOND_ASK_FAILED'), 'A replaced secret no longer answers.');
  await f.rpc('secondAsk.grant', grant(pay, 'cofounder new words'), cofounder);
  await assert.rejects(f.rpc('actions.approve', { id: pay.id, digest: pay.digest }), code('SECOND_ASK_REQUIRED'), 'The cofounder’s answer is not the owner’s.');
  assert.equal((await f.rpc('actions.approve', { id: pay.id, digest: pay.digest }, cofounder)).approval.memberId, added.id);

  // Clearing: a cofounder clears only their own; the owner clears anyone's, and an unspent grant goes with it.
  const next = await f.prepare('cofounder-pay-2', cofounder);
  await f.rpc('secondAsk.grant', grant(next, 'cofounder new words'), cofounder);
  await assert.rejects(f.rpc('secondAsk.clearSecret', { memberId: 'owner' }, cofounder), code('FORBIDDEN'));
  await assert.rejects(f.rpc('secondAsk.clearSecret', { memberId: added.id }, accountant), code('FORBIDDEN'));
  assert.deepEqual(await f.rpc('secondAsk.clearSecret', { memberId: added.id }), { cleared: true });
  assert.deepEqual(await f.rpc('secondAsk.clearSecret', { memberId: added.id }), { cleared: false });
  await assert.rejects(f.rpc('actions.approve', { id: next.id, digest: next.digest }, cofounder), code('SECOND_ASK_REQUIRED'));
  assert.deepEqual(await f.rpc('secondAsk.status', {}, cofounder), { by: 'none', expects: 'none', secretSet: false, lockedUntil: null });
  const events = f.engine.vault!.read().activity.filter((a: any) => a.event.startsWith('secondAsk.')).map((a: any) => [a.event, a.details.memberId]);
  assert.deepEqual(events, [['secondAsk.secretSet', added.id], ['secondAsk.secretSet', added.id], ['secondAsk.granted', added.id], ['secondAsk.granted', added.id], ['secondAsk.secretCleared', added.id], ['secondAsk.secretCleared', added.id]]);

  // Five wrong answers lock the cofounder's ask; the lock shows in their status and is audited by id only.
  await f.rpc('secondAsk.setSecret', { secret: 'cofounder third words' }, cofounder);
  for (let n = 0; n < 5; n++) await assert.rejects(f.rpc('secondAsk.grant', grant(next, `guess ${n}`), cofounder), code('SECOND_ASK_FAILED'));
  await assert.rejects(f.rpc('secondAsk.grant', grant(next, 'cofounder third words'), cofounder), code('SECOND_ASK_LOCKED'));
  const status = await f.rpc('secondAsk.status', {}, cofounder);
  assert.equal(status.by, 'member-secret'); assert.equal(status.expects, 'member-secret'); assert.ok(Date.parse(status.lockedUntil) > Date.now());
  assert.deepEqual(await f.rpc('secondAsk.status'), { by: 'passphrase', expects: 'passphrase', secretSet: false, lockedUntil: null }, 'One member’s lock is theirs alone.');
  const locked = f.engine.vault!.read().activity.filter((a: any) => a.event === 'secondAsk.locked');
  assert.equal(locked.length, 1); assert.deepEqual(Object.keys(locked[0].details).sort(), ['memberId', 'until']);
});

test('auth.verifyApprovalSecret checks the caller’s own secret for another lane and changes nothing else', async t => {
  const f = await workspace(t);
  const before = f.engine.vault!.read().revision;
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: passphrase }), { verified: true });
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: 'not the passphrase' }), { verified: false });
  assert.equal(f.engine.vault!.read().revision, before, 'Nothing is written for a right or a wrong answer.');
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase, extra: 1 }), code('INVALID_REQUEST'));
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: '' }), code('INVALID_REQUEST'));
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, { ...owner, sourceTainted: true }), code('TAINTED_APPROVAL'));
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, { ...owner, channel: 'phone' }), code('OPEN_DESKTOP'));
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, { ...owner, channel: 'mcp' }), code('APP_APPROVAL_REQUIRED'));
  const seat = await f.rpc('members.add', { name: 'Synthetic accountant', role: 'accountant', branches: ['*'] });
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, { memberId: seat.id, role: 'accountant', epoch: seat.epoch, channel: 'desktop' }), code('FORBIDDEN'));
  const added = await f.rpc('members.add', { name: 'Synthetic cofounder', role: 'cofounder', branches: ['*'] });
  const cofounder: Context = { memberId: added.id, role: 'cofounder', epoch: added.epoch, channel: 'desktop' };
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, cofounder), code('SECOND_ASK_SECRET_NOT_SET'));
  await f.rpc('secondAsk.setSecret', { secret: 'cofounder own words' }, cofounder);
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: passphrase }, cofounder), { verified: false }, 'The owner passphrase is not the cofounder’s answer.');
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: 'cofounder own words' }, cofounder), { verified: true });
  // A right answer clears the owner's earlier wrong one; five wrong answers then lock the owner's ask.
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: passphrase }), { verified: true });
  for (let n = 0; n < 5; n++) assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: `guess ${n}` }), { verified: false });
  await assert.rejects(f.rpc('auth.verifyApprovalSecret', { secret: passphrase }), code('SECOND_ASK_LOCKED'));
  assert.ok(Date.parse((await f.rpc('secondAsk.status')).lockedUntil) > Date.now());
  assert.deepEqual(await f.rpc('auth.verifyApprovalSecret', { secret: 'cofounder own words' }, cofounder), { verified: true }, 'The owner’s lock is the owner’s alone.');
});

test('a member on the staff seat sees and acts on only the actions they prepared (TR-06), and a hidden one answers like a missing one', async () => {
  await import('../runtime/gateway-auth/action-rules.ts');
  const { coreState } = await import('../runtime/trust-ext/core-state.ts');
  const store = new TestStore();
  store.state.members.push({ id: 'staff-1', name: 'Staff', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'acct', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  coreState(store.state).memberSeats['staff-1'] = 'staff';
  const staff: Context = { memberId: 'staff-1', role: 'accountant', epoch: 1, channel: 'desktop' };
  const accountant: Context = { memberId: 'acct', role: 'accountant', epoch: 1, channel: 'desktop' };
  const actions = new ActionService(store, [connector()]);
  const ownerNote = await actions.prepare(owner, { connector: 'synthetic-pay', operation: 'note', payload: { text: 'owner' }, idempotencyKey: 'note-owner-1', sourceIds: ['synthetic-sales'] });
  const staffNote = await actions.prepare(staff, { connector: 'synthetic-pay', operation: 'note', payload: { text: 'staff' }, idempotencyKey: 'note-staff-1', sourceIds: ['synthetic-sales'] });
  assert.deepEqual(actions.list(staff).map(a => a.id), [staffNote.id]);
  assert.deepEqual(actions.list(accountant).map(a => a.id).sort(), [ownerNote.id, staffNote.id].sort(), 'The accountant seat is not limited to its own.');
  assert.deepEqual(actions.list(owner).map(a => a.id).sort(), [ownerNote.id, staffNote.id].sort());
  await assert.rejects(actions.revise(staff, ownerNote.id, { text: 'changed' }), code('NOT_FOUND'));
  await assert.rejects(actions.revise(staff, 'action_missing', { text: 'changed' }), code('NOT_FOUND'));
  // Preparing again with the owner's idempotency key does not reveal the owner's action either.
  await assert.rejects(actions.prepare(staff, { connector: 'synthetic-pay', operation: 'note', payload: { text: 'owner' }, idempotencyKey: 'note-owner-1', sourceIds: ['synthetic-sales'] }), code('NOT_FOUND'));
  assert.equal((await actions.revise(staff, staffNote.id, { text: 'staff again' })).revision, 2);
});
