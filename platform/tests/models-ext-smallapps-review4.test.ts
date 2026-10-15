import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { ChausarError, initialState, type Context, type StateStore } from '../runtime/contracts.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { smallAppsPart } from '../runtime/smallapps/methods.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

const dictionary = compileDictionary(structuredClone(starterPacks.find(p => p.pack === 'ecommerce')!));
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const core = [{ id: 'local', title: 'Chausar local workspace', operations: [{ id: 'reminder-draft', title: 'Create a payment reminder draft', impact: 'reversible' }] }];
const refund = { system: 'razorpay', action: 'refund.create', title: 'Refund a Razorpay payment', kind: 'money', tier: 2, alwaysWaits: true, status: 'experimental', installed: true,
  recipe: { requiredFields: ['paymentId', 'amountMinor'] }, connections: [{ id: 'connection_rzp', label: 'Razorpay', environment: 'live', read: true, write: true }] };
const m = smallAppsPart.methods;

/**
 * A host whose writeback.prepare and actions.prepare behave like the real ones on idempotency: the same intent returns
 * the action already held for it, in whatever status it now has (writeback/service.ts prepare, actions.ts prepare).
 */
function fakeHost() {
  const state = initialState('Fake shop'); (state as any).ontology = { current: dictionary };
  const store = { read: () => state, update: async (change: any) => change(state) } as unknown as StateStore;
  const held = new Map<string, { id: string; status: string }>();
  const calls: { method: string; payload: any; tainted: boolean }[] = [];
  const hold = (key: string) => held.get(key) ?? (held.set(key, { id: `action_${held.size + 1}`, status: 'prepared' }), held.get(key)!);
  const host = { store, services: {}, demo: false, directory: '/nowhere', options: {},
    async call(method: string, payload: any, options?: { tainted?: boolean }) {
      calls.push({ method, payload, tainted: options?.tainted === true });
      if (method === 'ontology.get') return { current: dictionary };
      if (method === 'actions.catalogue') return core;
      if (method === 'writeback.catalogue') return [refund];
      if (method === 'writeback.prepare') {
        const action = hold(`wb:${payload.intentId}`);
        return { id: action.id, system: 'razorpay', action: payload.action, digest: 'e'.repeat(64), status: action.status, practice: false, kind: 'money', alwaysWaits: true,
          expiresAt: action.status === 'prepared' ? '2026-10-15T08:00:00.000Z' : null, approval: { needsSecondAsk: true } };
      }
      if (method === 'actions.prepare') { const action = hold(`core:${payload.idempotencyKey}`); return { id: action.id, status: action.status, digest: 'd'.repeat(64), impact: 'reversible' }; }
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request');
    } } as unknown as ModuleHost;
  return { host, held, calls, state };
}
async function appWith(host: ModuleHost, line: string, ctx: Context = owner, request = true) {
  const proposed = await m['smallapps.propose'].handler(ctx, { line }, host) as any;
  return m['smallapps.create'].handler(ctx, { descriptor: proposed.descriptor, ...(request ? { request: line } : {}) }, host) as Promise<any>;
}
const actionCard = (app: any) => app.descriptor.cards.find((c: any) => c.kind === 'action').id;
const press = (host: ModuleHost, app: any, payload: unknown, ctx: Context = owner, more: Record<string, unknown> = {}) =>
  m['smallapps.pressAction'].handler(ctx, { id: app.id, cardId: actionCard(app), payload, ...more }, host) as Promise<any>;
const pays = { paymentId: 'pay_1', amountMinor: '125000' };

test('review 4 item 1: a tainted or off-desktop request never makes a "planner" app; its presses and a tainted presser are marked', async () => {
  const { host, calls } = fakeHost();
  const line = 'sales this month with a refund button';
  const lastWriteback = () => calls.filter(c => c.method === 'writeback.prepare').at(-1)!.payload;
  // The PoC: a tainted MCP context proposes and creates with the planner's exact line.
  const tainted = await appWith(host, line, { ...owner, channel: 'mcp', sourceTainted: true });
  assert.equal(tainted.madeBy, 'outside');
  await press(host, tainted, pays);
  assert.equal(lastWriteback().sourceTainted, true, 'A clean press of an app a tainted request made is still outside text.');
  // Tainted alone, or another channel alone, is enough.
  assert.equal((await appWith(host, line, { ...owner, sourceTainted: true })).madeBy, 'outside');
  assert.equal((await appWith(host, line, { ...owner, channel: 'phone' })).madeBy, 'outside');
  assert.equal((await appWith(host, line, { ...owner, channel: 'mcp' })).madeBy, 'outside');
  // The untainted desktop app still makes a planner app, and a tainted presser always presses tainted.
  const planned = await appWith(host, line);
  assert.equal(planned.madeBy, 'planner');
  await press(host, planned, pays);
  assert.equal(lastWriteback().sourceTainted, undefined);
  await press(host, planned, { paymentId: 'pay_2', amountMinor: '1' }, { ...owner, sourceTainted: true });
  assert.equal(lastWriteback().sourceTainted, true);
  // Core actions carry the mark as the call option.
  const reminder = await appWith(host, 'collections this month with a reminder button', { ...owner, sourceTainted: true });
  await press(host, reminder, { invoiceId: 'inv-1' });
  assert.equal(calls.filter(c => c.method === 'actions.prepare').at(-1)!.tainted, true);
});

test('review 4 item 1: a rebuild never launders the mark, and a tainted rebuild adds it', async () => {
  const { host, state, calls } = fakeHost();
  const line = 'sales this month with a refund button';
  const outside = await appWith(host, line, { ...owner, sourceTainted: true });
  const planned = await appWith(host, line);
  const stale = () => { for (const app of (state as any).extensions['models-ext'].smallApps.apps) app.descriptor.dictionary = { version: dictionary.version, hash: 'f'.repeat(64) }; };
  stale();
  const clean = await m['smallapps.rebuild'].handler(owner, { id: outside.id }, host) as any;
  assert.equal(clean.rebuilt, true); assert.equal(clean.app.madeBy, 'outside');
  const dirty = await m['smallapps.rebuild'].handler({ ...owner, channel: 'mcp', sourceTainted: true }, { id: planned.id }, host) as any;
  assert.equal(dirty.rebuilt, true); assert.equal(dirty.app.madeBy, 'outside');
  await press(host, dirty.app, pays);
  assert.equal(calls.filter(c => c.method === 'writeback.prepare').at(-1)!.payload.sourceTainted, true);
});

test('review 4 item 4: a double press is one intent while it waits; a finished one prepares afresh; in-between states are said in words', async () => {
  const { host, held, calls } = fakeHost();
  const app = await appWith(host, 'sales this month with a refund button');
  const intents = () => calls.filter(c => c.method === 'writeback.prepare').map(c => c.payload.intentId as string);
  const statusOf = (id: string) => [...held.values()].find(a => a.id === id)!;
  const first = await press(host, app, pays);
  const again = await press(host, app, pays);
  assert.equal(again.action.id, first.action.id, 'A double press while it waits is the same action.');
  assert.equal(intents()[0], intents()[1]);
  assert.match(intents()[0], /^smallapp:[a-f0-9]{48}:0$/);
  // Expired (writeback cancels an expired preparation): the next press is a new generation and a fresh prepared action.
  statusOf(first.action.id).status = 'cancelled';
  const fresh = await press(host, app, pays);
  assert.notEqual(fresh.action.id, first.action.id); assert.equal(fresh.action.status, 'prepared'); assert.match(intents().at(-1)!, /:1$/);
  // Approved, being done, or not sure: nothing new is prepared and the words say what happened, not "unexpected shape".
  for (const [status, words] of [['approved', /already approved/], ['executing', /being done now/], ['unknown', /not known yet/]] as const) {
    statusOf(fresh.action.id).status = status;
    const said = await press(host, app, pays);
    assert.equal(said.action, null); assert.deepEqual(said.existing, { id: fresh.action.id, connector: 'razorpay', operation: 'refund.create', status, through: 'writeback' });
    assert.match(said.words, words); assert.match(said.words, /Nothing new was prepared/);
  }
  // Done, refused or blocked: each next press prepares afresh, one generation further.
  let latest = fresh.action.id;
  for (const status of ['verified', 'rejected', 'blocked']) {
    statusOf(latest).status = status;
    const next = await press(host, app, pays);
    assert.notEqual(next.action.id, latest); assert.equal(next.action.status, 'prepared'); latest = next.action.id;
  }
  assert.match(intents().at(-1)!, /:4$/);
  const presses = (host.store.read() as any).extensions['models-ext'].smallApps.apps[0].presses;
  assert.deepEqual(presses.map((p: any) => p.generation), [0, 0, 1, 2, 3, 4]);
  // Another member pressing the same card with the same payload is their own intent.
  const other: Context = { memberId: 'member_2', role: 'cofounder', epoch: 1, channel: 'desktop' };
  await press(host, app, pays, other);
  assert.doesNotMatch(intents().at(-1)!, new RegExp(intents()[0].split(':')[1]));
  // A caller's own idempotency key is their intent: a finished action under it is said in words, never re-generated.
  const keyed = await press(host, app, pays, owner, { idempotencyKey: 'own-key-1' });
  statusOf(keyed.action.id).status = 'verified';
  const done = await press(host, app, pays, owner, { idempotencyKey: 'own-key-1' });
  assert.equal(done.action, null); assert.equal(done.existing.status, 'verified'); assert.match(done.words, /already done/);
  assert.equal(intents().at(-1), 'own-key-1');
});

test('review 4 item 4: a core action follows the same rule', async () => {
  const { host, held, calls } = fakeHost();
  const app = await appWith(host, 'collections this month with a reminder button');
  const first = await press(host, app, { invoiceId: 'inv-1' });
  [...held.values()].find(a => a.id === first.action.id)!.status = 'rejected';
  const next = await press(host, app, { invoiceId: 'inv-1' });
  assert.notEqual(next.action.id, first.action.id); assert.equal(next.action.through, 'core');
  const keys = calls.filter(c => c.method === 'actions.prepare').map(c => c.payload.idempotencyKey as string);
  assert.deepEqual(keys.map(k => k.slice(-2)), [':0', ':0', ':1']);
});

test('review 4 item 4, end to end: a cancelled reminder presses afresh, an approved one is said in words', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'models-ext': { clock: () => '2026-10-14T09:00:00.000Z' } } });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Demo Shop', passphrase: 'correct horse battery staple 42', demo: true, pack: 'ecommerce' });
  const proposed = await engine.request('smallapps.propose', { line: 'collections this month with a reminder button' });
  const app = await engine.request('smallapps.create', { descriptor: proposed.descriptor, request: 'collections this month with a reminder button' });
  const payload = { invoiceId: 'inv-1', text: 'Gentle reminder' };
  const pressNow = () => engine.request('smallapps.pressAction', { id: app.id, cardId: actionCard(app), payload });
  const first = await pressNow();
  assert.equal((await pressNow()).action.id, first.action.id);
  await engine.vault!.update(state => { (state.actions.find(a => a.id === first.action.id) as any).status = 'cancelled'; });
  const fresh = await pressNow();
  assert.notEqual(fresh.action.id, first.action.id); assert.equal(fresh.action.status, 'prepared');
  await engine.request('actions.approve', { id: fresh.action.id, digest: fresh.action.digest });
  const said = await pressNow();
  assert.equal(said.action, null); assert.equal(said.existing.status, 'approved'); assert.match(said.words, /already approved/);
  assert.equal((await engine.request('actions.list')).filter((a: any) => a.connector === 'local').length, 2, 'Nothing more was prepared.');
});
