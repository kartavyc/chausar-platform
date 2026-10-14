import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { WritebackService } from '../runtime/writeback/service.ts';
import type { SecondAsk } from '../runtime/writeback/service.ts';
import { installedAdapters } from '../runtime/writeback/systems/index.ts';
import { credentialFields, writebackHostOptions, writebackModule } from '../runtime/modules/lane-writeback.ts';
import { ConnectorCredentialStore } from '../runtime/connectors-ext/credentials.ts';
import { RazorpayFake, razorpaySeed } from '../fakes/razorpay/index.ts';
import { WhatsAppFake, whatsappSeed } from '../fakes/whatsapp/index.ts';

class Store implements StateStore {
  state: State = initialState('Round two'); queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const PASS = 'correct horse battery staple 42';
const refund = { paymentId: 'pay_SYNTH00000001A', amountMinor: '50000', note: 'Damaged carton (synthetic)' };

async function moneySetup() {
  const store = new Store(); const fake = new RazorpayFake(); const asks = new Map<string, SecondAsk>();
  const service = new WritebackService(store, { http: fake.transport, dial: async () => { throw new Error('no mail'); }, clock: () => new Date().toISOString(), directory: mkdtempSync(join(tmpdir(), 'chausar-r2-')), demo: false,
    adapters: installedAdapters(), credentials: async () => ({ keyId: razorpaySeed.keyId, keySecret: razorpaySeed.keySecret }), verifyPassphrase: async secret => secret === PASS, secondAsk: asks });
  const c = await service.connect(owner, { system: 'razorpay', label: 'Test keys', environment: 'sandbox', account: {} });
  await service.grant(owner, { connectionId: c.id, write: ['refund.create', 'paymentLink.create'] });
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'refund.create', payload: refund, intentId: 'refund-1' });
  return { store, fake, service, asks, connection: c, prepared };
}

test('money needs the passphrase again: a single-use token bound to this exact digest, member and two minutes', async () => {
  const { service, prepared, fake, connection } = await moneySetup();
  assert.equal(prepared.approval.needsSecondAsk, true);
  await assert.rejects(service.approve(owner, prepared.id, prepared.digest), { code: 'REAUTH_REQUIRED' });
  await assert.rejects(service.reauth(owner, prepared.id, prepared.digest, 'wrong passphrase'), { code: 'REAUTH_FAILED' });
  await assert.rejects(service.reauth({ ...owner, sourceTainted: true }, prepared.id, prepared.digest, PASS), { code: 'TAINTED_APPROVAL' });
  await assert.rejects(service.reauth({ ...owner, channel: 'phone' }, prepared.id, prepared.digest, PASS), { code: 'OPEN_DESKTOP' });
  // Digest substitution: a token issued for one action cannot approve another.
  const other: any = await service.prepare(owner, { connectionId: connection.id, action: 'refund.create', payload: { ...refund, amountMinor: '60000' }, intentId: 'refund-2' });
  const forOther = await service.reauth(owner, other.id, other.digest, PASS);
  await assert.rejects(service.approve(owner, prepared.id, prepared.digest, forOther.token), { code: 'REAUTH_REQUIRED' });
  await assert.rejects(service.approve(owner, other.id, other.digest, forOther.token), { code: 'REAUTH_REQUIRED' }, 'a refused attempt still consumes the token');
  const { token } = await service.reauth(owner, prepared.id, prepared.digest, PASS);
  await assert.rejects(service.approve(owner, prepared.id, 'f'.repeat(64), token), { code: 'REAUTH_REQUIRED' });
  const fresh = await service.reauth(owner, prepared.id, prepared.digest, PASS);
  const approved: any = await service.approve(owner, prepared.id, prepared.digest, fresh.token);
  assert.equal(approved.status, 'approved');
  await assert.rejects(service.approve(owner, prepared.id, prepared.digest, fresh.token), { code: 'REAUTH_REQUIRED' }, 'replay refused');
  assert.equal((await service.execute(owner, prepared.id) as any).status, 'verified'); assert.equal(fake.log.filter(r => r.method === 'POST').length, 1);
});

test('a second-ask token expires, and an app that cannot check the passphrase cannot approve money', async () => {
  const { service, prepared, asks } = await moneySetup();
  const { token } = await service.reauth(owner, prepared.id, prepared.digest, PASS);
  for (const grant of asks.values()) grant.expiresAt = Date.now() - 1;
  await assert.rejects(service.approve(owner, prepared.id, prepared.digest, token), { code: 'REAUTH_REQUIRED' });
  delete (service.ports as any).verifyPassphrase;
  await assert.rejects(service.reauth(owner, prepared.id, prepared.digest, PASS), { code: 'REAUTH_UNAVAILABLE' });
});

test('concurrent executes of one approved refund send it once', async () => {
  const { service, prepared, fake } = await moneySetup();
  const { token } = await service.reauth(owner, prepared.id, prepared.digest, PASS);
  await service.approve(owner, prepared.id, prepared.digest, token);
  const results = await Promise.allSettled([service.execute(owner, prepared.id), service.execute(owner, prepared.id), service.execute(owner, prepared.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(fake.log.filter(r => r.method === 'POST').length, 1);
});

test('one sealed credential per connection: a linked write connection reads the connectors-ext sign-in; read never grants write', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chausar-r2-cred-'));
  const options: any = writebackHostOptions({ directory, demo: false, env: {} });
  const shared = new ConnectorCredentialStore(join(directory, 'connector-credentials'));
  shared.set('source-zoho-1', { kind: 'key', system: 'zoho-books', secret: 'synthetic-zoho-token', storedAt: '2026-10-14T00:00:00.000Z' });
  const store = new Store(); (store.state.extensions ??= {})['connectors-ext'] = { version: 1, connections: [{ id: 'cx-1', group: 'zoho-books', sourceId: 'source-zoho-1', branch: 'main', status: 'active' }, { id: 'cx-2', group: 'shopify', sourceId: 'source-shop-1', branch: 'main', status: 'active' }, { id: 'cx-3', group: 'zoho-books', sourceId: 'source-zoho-3', branch: 'south', status: 'active' }, { id: 'cx-4', group: 'zoho-books', sourceId: 'source-zoho-4', branch: 'main', status: 'paused' }], envelopes: [], signIns: [] };
  const service = new WritebackService(store, { http: async () => { throw new Error('unused'); }, dial: async () => { throw new Error('unused'); }, clock: () => new Date().toISOString(), directory, demo: false, adapters: installedAdapters(), credentials: options.credentials });
  await assert.rejects(service.connect(owner, { system: 'zoho-books', label: 'Books', environment: 'live', account: {}, linkTo: 'cx-2' }), { code: 'WRITE_LINK_INVALID' });
  const c = await service.connect(owner, { system: 'zoho-books', label: 'Books', environment: 'live', account: { organizationId: '60012345678', dataCenter: 'in' }, linkTo: 'cx-1' });
  assert.deepEqual(c.link, { connectionId: 'cx-1', sourceId: 'source-zoho-1', group: 'zoho-books', branch: 'main' }); assert.deepEqual(c.write, []);
  await assert.rejects(service.connect(owner, { system: 'zoho-books', label: 'Paused', environment: 'live', account: {}, linkTo: 'cx-4' }), { code: 'WRITE_LINK_INVALID' });
  store.state.members.push({ id: 'north-cofounder', name: 'North', role: 'cofounder', active: true, epoch: 1, branches: ['north'] });
  await assert.rejects(service.connect({ memberId: 'north-cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' }, { system: 'zoho-books', label: 'South books', environment: 'live', account: {}, linkTo: 'cx-3' }), { code: 'FORBIDDEN_BRANCH' });
  assert.deepEqual(await service.adapterContext(owner, c).credentials(), { accessToken: 'synthetic-zoho-token' });
  await assert.rejects(service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: { customerId: '1', date: '2026-10-14', lines: [{ name: 'x', quantity: 1, rateMinor: '100' }] }, intentId: 'i-1' }), { code: 'WRITE_NOT_GRANTED' });
  // A connection with no read side keeps its own sealed entry, set only from the desktop.
  const host: any = { store, services: {}, demo: false, directory, options, call: async () => null };
  const mail: any = await service.connect(owner, { system: 'mail', label: 'Mail', environment: 'live', account: { smtpHost: 'smtp.example.test', smtpPort: '587', smtpSecurity: 'starttls', from: 'a@example.test' } });
  const set = writebackModule.methods['writeback.credentials.set'].handler;
  await assert.rejects(Promise.resolve().then(() => set({ ...owner, sourceTainted: true }, { connectionId: mail.id, secret: 'u@example.test:pw' }, host)), { code: 'OPEN_DESKTOP' });
  await assert.rejects(Promise.resolve().then(() => set(owner, { connectionId: mail.id, secret: 'no-colon-here' }, host)), { code: 'WRITE_CREDENTIALS_UNAVAILABLE' });
  await set(owner, { connectionId: mail.id, secret: 'u@example.test:synthetic-password' }, host);
  await assert.rejects(Promise.resolve().then(() => set(owner, { connectionId: c.id, secret: 'x:y1' }, host)), { code: 'WRITE_CREDENTIAL_LINKED' });
  assert.deepEqual(await service.adapterContext(owner, service.connections(owner).find(x => x.id === mail.id)!).credentials(), { username: 'u@example.test', password: 'synthetic-password' });
  const status: any[] = await writebackModule.methods['writeback.credentials.status'].handler(owner, {}, host) as any;
  assert.ok(status.every(s => s.present)); assert.ok(!JSON.stringify(status).includes('synthetic'), 'status never shows a secret');
  assert.ok(!JSON.stringify(store.state).includes('synthetic-password') && !JSON.stringify(store.state).includes('synthetic-zoho-token'), 'secrets never enter the vault');
  assert.deepEqual(credentialFields('razorpay', 'rzp_test_1:sec:ret'), { keyId: 'rzp_test_1', keySecret: 'sec:ret' });
  assert.deepEqual(writebackHostOptions({ directory, demo: true, env: {} }), {});
  // Pausing the read connection stops its sign-in being used for writes.
  (store.state.extensions as any)['connectors-ext'].connections[0].status = 'paused';
  await assert.rejects(service.adapterContext(owner, c).credentials(), { code: 'WRITE_LINK_INVALID' });
  // An expired OAuth sign-in is never refreshed here: connectors-ext owns refresh.
  shared.set('source-zoho-1', { kind: 'oauth', system: 'zoho-books', provider: 'zoho', accessToken: 'old', refreshToken: 'r', expiresAt: '2020-01-01T00:00:00.000Z', scopes: [], settings: {}, storedAt: '2020-01-01T00:00:00.000Z' });
  (store.state.extensions as any)['connectors-ext'].connections[0].status = 'active';
  await assert.rejects(service.adapterContext(owner, c).credentials(), { code: 'WRITE_SIGN_IN_EXPIRED' });
  // Disconnecting removes the connection's own secret.
  await writebackModule.methods['writeback.disconnect'].handler(owner, { connectionId: mail.id }, host);
  assert.equal(new ConnectorCredentialStore(join(directory, 'connector-credentials')).get(`writeback.${mail.id}`), null);
});

test('the second ask is the owner\'s, and five wrong passphrases lock it for fifteen minutes', async () => {
  const { service, prepared, store } = await moneySetup();
  store.state.members.push({ id: 'cofounder', name: 'Co', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  const co: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
  const theirs: any = await service.prepare(co, { connectionId: prepared.connection.id, action: 'refund.create', payload: { ...refund, amountMinor: '1000' }, intentId: 'refund-co' });
  await assert.rejects(service.reauth(co, theirs.id, theirs.digest, PASS), { code: 'REAUTH_OWNER_ONLY' });
  (service.ports as any).reauthFailures = new Map();
  for (let i = 0; i < 5; i++) await assert.rejects(service.reauth(owner, prepared.id, prepared.digest, `wrong ${i} passphrase`), { code: 'REAUTH_FAILED' });
  await assert.rejects(service.reauth(owner, prepared.id, prepared.digest, PASS), { code: 'REAUTH_LOCKED' });
  assert.ok(!JSON.stringify(store.state).includes('wrong 0'), 'a guessed passphrase is never kept');
});

test('WhatsApp read-back uses the hosted relay through hosted.messageStatuses when no host option is given', async () => {
  const fake = new WhatsAppFake(whatsappSeed); fake.silence();
  const store = new Store(); const directory = mkdtempSync(join(tmpdir(), 'chausar-r2-wa-'));
  let relayed: any[] = []; const calls: any[] = [];
  const host: any = { store, services: {}, demo: false, directory, call: async (method: string, payload: any) => { calls.push([method, payload]); return relayed; },
    options: { http: fake.transport, credentials: async () => ({ accessToken: whatsappSeed.token }) } };
  const m = writebackModule.methods; const owner2 = owner;
  const c: any = await m['writeback.connect'].handler(owner2, { system: 'whatsapp', label: 'WA', environment: 'sandbox', account: { phoneNumberId: whatsappSeed.phoneNumberId, wabaId: whatsappSeed.wabaId } }, host);
  await m['writeback.grant'].handler(owner2, { connectionId: c.id, write: ['template.send'] }, host);
  const prepared: any = await m['writeback.prepare'].handler(owner2, { connectionId: c.id, action: 'template.send', intentId: 'wa-1', payload: { to: '919000000001', template: 'payment_reminder', language: 'en', parameters: ['inv-1', 'Rs 300.00', '2026-09-10'] } }, host);
  await m['writeback.approve'].handler(owner2, { id: prepared.id, digest: prepared.digest }, host);
  const sent: any = await m['writeback.execute'].handler(owner2, { id: prepared.id }, host);
  assert.equal(sent.status, 'unknown', 'no status yet: not sure');
  assert.ok(calls.some(([method]) => method === 'hosted.messageStatuses'));
  const message = fake.messages[0];
  relayed = [{ messageId: message.id, status: 'delivered', at: '2026-10-14T10:00:00.000Z', reference: message.reference }];
  assert.equal((await m['writeback.readBack'].handler(owner2, { id: prepared.id }, host) as any).status, 'verified');
  assert.equal(fake.messages.length, 1);
  const missing: any = { ...host, call: async () => { const { ChausarError } = await import('../runtime/contracts.ts'); throw new ChausarError('UNKNOWN_METHOD', 'Unknown method.'); } };
  const again: any = await m['writeback.prepare'].handler(owner2, { connectionId: c.id, action: 'template.send', intentId: 'wa-2', payload: { to: '919000000002', template: 'payment_reminder', language: 'en', parameters: ['inv-2', 'Rs 10.00', '2026-09-10'] } }, missing);
  assert.equal(again.word, 'waiting-for-you', 'without the relay the send still prepares; read-back stays not sure');
  const forged: any = { ...host, call: async () => [{ messageId: 'wamid.X', status: 'delivered', at: 'yesterday', reference: 'CHS-0000000000000000' }] };
  await m['writeback.approve'].handler(owner2, { id: again.id, digest: again.digest }, missing);
  await m['writeback.execute'].handler(owner2, { id: again.id }, missing);
  await assert.rejects(Promise.resolve().then(() => m['writeback.readBack'].handler(owner2, { id: again.id }, forged)), { code: 'INVALID_DATE' });
});
