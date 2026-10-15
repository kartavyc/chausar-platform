import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { WritebackService } from '../runtime/writeback/service.ts';
import type { SecondAsk } from '../runtime/writeback/service.ts';
import { installedAdapters } from '../runtime/writeback/systems/index.ts';
import { memberSecrets, writebackModule, writebackZone } from '../runtime/modules/lane-writeback.ts';
import { RazorpayFake, razorpaySeed } from '../fakes/razorpay/index.ts';

class Store implements StateStore {
  state: State = initialState('Round four'); queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const co: Context = { memberId: 'co', role: 'cofounder', epoch: 1, channel: 'desktop' };
const refund = { paymentId: 'pay_SYNTH00000001A', amountMinor: '1000' };

/** The core-gateway-auth contract, as a typed fixture until it lands: each member's own approval secret. */
function secretStore(secrets: Record<string, string>) {
  const calls: string[] = [];
  const call = async (ctx: Context, method: string, payload: Record<string, unknown>) => {
    calls.push(method);
    if (method === 'auth.approvalSecret.status') return { set: Object.hasOwn(secrets, ctx.memberId) };
    if (method === 'auth.approvalSecret.verify') return { verified: secrets[ctx.memberId] === payload.secret };
    throw new ChausarError('UNKNOWN_METHOD', 'Unknown method.');
  };
  return { call, calls };
}

async function setup(withSecrets: Record<string, string> | null) {
  const store = new Store(); store.state.members.push({ id: 'co', name: 'Co', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  const fake = new RazorpayFake(); const asks = new Map<string, SecondAsk>();
  const fixture = withSecrets ? secretStore(withSecrets) : null;
  const ports = (ctx: Context) => ({ http: fake.transport, dial: async () => { throw new Error('no mail'); }, clock: () => new Date().toISOString(), directory: mkdtempSync(join(tmpdir(), 'chausar-r4-')), demo: false,
    adapters: installedAdapters(), credentials: async () => ({ keyId: razorpaySeed.keyId, keySecret: razorpaySeed.keySecret }), verifyPassphrase: async (secret: string) => secret === 'owner vault passphrase', secondAsk: asks,
    reauthFailures: new Map(), ...(fixture ? { memberSecrets: memberSecrets({ call: (method: string, payload: Record<string, unknown>) => fixture.call(ctx, method, payload) } as any) } : {}) });
  const as = (ctx: Context) => new WritebackService(store, ports(ctx));
  const c = await as(owner).connect(owner, { system: 'razorpay', label: 'Keys', environment: 'sandbox', account: {} });
  await as(owner).grant(owner, { connectionId: c.id, write: ['refund.create'] });
  return { store, as, connection: c, fixture };
}

test('per-member approval secrets: a co-founder answers the second ask with their own secret, never the owner\'s', async () => {
  const { as, connection } = await setup({ owner: 'owner secret 1', co: 'cofounder secret 2' });
  const prepared: any = await as(co).prepare(co, { connectionId: connection.id, action: 'refund.create', payload: refund, intentId: 'co-1' });
  await assert.rejects(as(co).reauth(co, prepared.id, prepared.digest, 'owner secret 1'), { code: 'REAUTH_FAILED' });
  await assert.rejects(as(co).reauth(co, prepared.id, prepared.digest, 'owner vault passphrase'), { code: 'REAUTH_FAILED' }, 'the vault passphrase is not a member secret');
  const { token } = await as(co).reauth(co, prepared.id, prepared.digest, 'cofounder secret 2');
  await assert.rejects(as(owner).approve(owner, prepared.id, prepared.digest, token), { code: 'REAUTH_REQUIRED' }, 'a token is bound to the member who answered');
  const again = await as(co).reauth(co, prepared.id, prepared.digest, 'cofounder secret 2');
  assert.equal((await as(co).approve(co, prepared.id, prepared.digest, again.token) as any).status, 'approved');
});

test('without the member-secret store, only the owner answers, with the vault passphrase', async () => {
  const { as, connection } = await setup(null);
  const prepared: any = await as(co).prepare(co, { connectionId: connection.id, action: 'refund.create', payload: refund, intentId: 'co-2' });
  await assert.rejects(as(co).reauth(co, prepared.id, prepared.digest, 'anything'), { code: 'REAUTH_OWNER_ONLY' });
  const mine: any = await as(owner).prepare(owner, { connectionId: connection.id, action: 'refund.create', payload: { ...refund, amountMinor: '2000' }, intentId: 'own-2' });
  assert.ok((await as(owner).reauth(owner, mine.id, mine.digest, 'owner vault passphrase')).token);
});

test('a member without their own secret yet falls back to the owner rule; the store answering UNKNOWN_METHOD counts as not installed', async () => {
  const { as, connection } = await setup({ owner: 'owner secret 1' });
  const prepared: any = await as(co).prepare(co, { connectionId: connection.id, action: 'refund.create', payload: refund, intentId: 'co-3' });
  await assert.rejects(as(co).reauth(co, prepared.id, prepared.digest, 'x'), { code: 'REAUTH_OWNER_ONLY' });
  const missing = memberSecrets({ call: async () => { throw new ChausarError('UNKNOWN_METHOD', 'Unknown method.'); } } as any);
  assert.equal(await missing.available(owner), false);
  const broken = memberSecrets({ call: async () => ({ verified: 'yes' }) } as any);
  await assert.rejects(broken.verify(owner, 's'), { code: 'WRITE_REPLY_INVALID' });
});

test('overview: write status apart from read, no secrets, and only linked read connections the caller may see', async () => {
  const store = new Store(); const directory = mkdtempSync(join(tmpdir(), 'chausar-r4-ov-'));
  store.state.members.push({ id: 'north', name: 'North', role: 'cofounder', active: true, epoch: 1, branches: ['north'] });
  (store.state.extensions ??= {})['connectors-ext'] = { version: 1, connections: [
    { id: 'cx-main', group: 'zoho-books', sourceId: 'src-main', branch: 'main', status: 'active', label: 'Books (main)' },
    { id: 'cx-north', group: 'zoho-books', sourceId: 'src-north', branch: 'north', status: 'active', label: 'Books (north)' },
    { id: 'cx-paused', group: 'shopify', sourceId: 'src-shop', branch: 'main', status: 'paused', label: 'Shop' }], envelopes: [], signIns: [] };
  const host: any = { store, services: {}, demo: false, directory, call: async () => { throw new ChausarError('UNKNOWN_METHOD', 'Unknown method.'); }, options: { credentialStore: { has: (id: string) => ({ present: id.startsWith('writeback.') }) } } };
  const m = writebackModule.methods;
  const linked: any = await m['writeback.connect'].handler(owner, { system: 'zoho-books', label: 'Books write', environment: 'live', account: { organizationId: '60012345678', dataCenter: 'in' }, linkTo: 'cx-main' }, host);
  await m['writeback.grant'].handler(owner, { connectionId: linked.id, write: ['invoice.createDraft'] }, host);
  const mail: any = await m['writeback.connect'].handler(owner, { system: 'mail', label: 'Mail', environment: 'live', account: { smtpHost: 'smtp.example.test', smtpPort: '587', smtpSecurity: 'starttls', from: 'a@example.test' } }, host);
  const view: any = await m['writeback.overview'].handler(owner, {}, host);
  assert.equal(view.demo, false);
  const books = view.connections.find((c: any) => c.id === linked.id);
  assert.equal(books.credential, 'linked'); assert.equal(books.read, true);
  assert.deepEqual(books.actions.filter((a: any) => a.granted).map((a: any) => a.action), ['invoice.createDraft']);
  assert.ok(books.actions.every((a: any) => typeof a.undoable === 'boolean' && typeof a.grantable === 'boolean'));
  assert.equal(view.connections.find((c: any) => c.id === mail.id).credential, 'stored');
  assert.deepEqual(view.linkable.map((l: any) => l.id).sort(), ['cx-main', 'cx-north'], 'paused read connections cannot be linked');
  assert.ok(view.systems.find((s: any) => s.system === 'mail').fields.some((f: any) => f.name === 'smtpHost'));
  assert.ok(!JSON.stringify(view).match(/password|keySecret|accessToken/i), 'no secret field in the overview');
  const north: any = await m['writeback.overview'].handler({ memberId: 'north', role: 'cofounder', epoch: 1, channel: 'desktop' }, {}, host);
  assert.deepEqual(north.linkable.map((l: any) => l.id), ['cx-north']);
  assert.ok(!north.connections.some((c: any) => c.id === linked.id), 'a write connection linked to another branch is not shown');
});

test('caps: today counted in the write-back day, from the workspace time zone unless the host sets one', async () => {
  const store = new Store(); const directory = mkdtempSync(join(tmpdir(), 'chausar-r4-caps-'));
  const at = '2026-10-14T20:00:00.000Z'; // 15 October in India, still 14 October in New York
  const host: any = { store, services: {}, demo: false, directory, call: async () => null, options: { clock: () => at } };
  const caps = writebackModule.methods['writeback.caps'].handler;
  let view: any = await caps(owner, {}, host);
  assert.equal(view.timeZone, 'Asia/Kolkata'); assert.equal(view.today, '2026-10-15');
  (store.state.workspace as any).timeZone = 'America/New_York';
  view = await caps(owner, {}, host);
  assert.equal(view.timeZone, 'America/New_York'); assert.equal(view.today, '2026-10-14');
  (store.state.workspace as any).timeZone = 'Not/AZone';
  assert.equal(writebackZone(host), 'Asia/Kolkata');
  assert.equal(writebackZone({ ...host, options: { timeZone: 'Europe/London' } }), 'Europe/London');
  assert.deepEqual(view.counts, { preparedToday: 0, sentToday: 0, customersToday: 0 });
  assert.equal(view.settings.reminderCapPerCustomer, 1);
});
