import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { handlers } from '../runtime/connectors-ext/service.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

const owner = { memberId: 'owner', role: 'owner' as const, epoch: 1, channel: 'desktop' as const };
/** The module host a non-demo launch hands this lane, with trusted host options. */
export function host(engine: Engine, options: Record<string, unknown> = {}): ModuleHost {
  const e = engine as any;
  return { get store() { return e.store(); }, services: e.services, demo: false, directory: e.options.directory, options, call: (method: string, payload: Record<string, unknown>) => engine.request(method, payload) };
}

const fixture = (path: string) => readFile(new URL(`../../fixtures/connectors/${path}`, import.meta.url), 'utf8');
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
async function open(t: any, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-cx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...options } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Cafe', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return engine;
}

test('the coverage board lists all 56 groups with a depth per operation', async t => {
  const engine = await open(t);
  const systems = await engine.request('connectorsx.systems', {});
  assert.equal(systems.groups.length, 56);
  assert.equal(systems.board.systems, 56);
  for (const group of systems.groups) {
    assert.ok(group.operations.length > 0, group.id);
    for (const operation of group.operations) {
      assert.ok(['import', 'read', 'full'].includes(operation.depth));
      assert.ok(['tested', 'experimental', 'planned', 'not-possible'].includes(operation.status));
      assert.notEqual(operation.tier, 'supported', 'synthetic evidence alone never makes an operation supported');
    }
    assert.equal(group.liveVerified, false);
  }
  const tally = systems.groups.find((g: any) => g.id === 'tally');
  assert.ok(tally.operations.some((o: any) => o.depth === 'full' && o.owner === 'writeback'));
  const one = await engine.request('connectorsx.systems', { group: 'paytm-business' });
  assert.equal(one.groups.length, 1); assert.equal(one.groups[0].depth, 'import');
  await assert.rejects(engine.request('connectorsx.systems', { group: 'nope' }), code('SYSTEM_NOT_FOUND'));
  await assert.rejects(engine.request('connectorsx.systems', { extra: 1 }), code('CONNECTOR_REQUEST_INVALID'));
});

test('a file connection previews, checks the source total, imports once and shows its months', async t => {
  const engine = await open(t);
  const connection = await engine.request('connectorsx.connect', { group: 'restaurant-partners', road: 'file', company: 'Synthetic Cafe' });
  assert.match(connection.sourceId, /^cx-restaurant-partners-/);
  const text = await fixture('restaurant-partners/payout-annexure-week-36.csv');
  const preview = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text });
  assert.equal(preview.status, 'accepted'); assert.equal(preview.observed.total, '72200'); assert.equal(preview.excludedRows, 1);
  assert.equal(preview.pendingRows, 2); assert.deepEqual(preview.unmappedFields, ['Order Value']);
  assert.equal('pending' in preview, false, 'replies never carry source rows');
  const imported = await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
  assert.equal(imported.committed.rows, 2); assert.equal(imported.pendingRows, 0);
  const again = await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
  assert.equal(again.duplicate, true);
  const second = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text });
  const twice = await engine.request('connectorsx.importCommit', { envelopeId: second.id });
  assert.equal(twice.committed.duplicate, true, 'the same file by a second road counts once');
  const facts = await engine.request('memory.list', {});
  assert.equal(facts.facts.filter((f: any) => f.sourceId === connection.sourceId).length, 2);
  const [fresh] = await engine.request('connectorsx.freshness', { sourceId: connection.sourceId, asOf: '2026-10-14' });
  assert.equal(fresh.months.length, 12);
  assert.equal(fresh.months.find((m: any) => m.month === '2026-09').status, 'loaded');
  assert.equal(fresh.months.find((m: any) => m.month === '2026-08').status, 'not-loaded-yet');
  const cut = text.replace('Total,,,,,722.00\n', '').replace('Z1002', 'Z1009');
  const refused = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text: cut.replaceAll('/09/2026', '/07/2026') });
  assert.equal(refused.status, 'refused'); assert.equal(refused.refusal.code, 'SOURCE_CUT_SHORT');
  await assert.rejects(engine.request('connectorsx.importCommit', { envelopeId: refused.id }), code('IMPORT_NOT_ACCEPTED'));
  const filtered = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text: text.replace('Z1002,02/09/2026,Delivered,350.00,70.00,266.00\n', '').replaceAll('/09/2026', '/08/2026') });
  assert.equal(filtered.refusal.code, 'SOURCE_TOTAL_MISMATCH');
  const [after] = await engine.request('connectorsx.freshness', { sourceId: connection.sourceId, asOf: '2026-10-14' });
  assert.equal(after.months.find((m: any) => m.month === '2026-08').status, 'refused');
  const history = await engine.request('connectorsx.envelopes', { connectionId: connection.id });
  assert.equal(history.length, 4); assert.equal(history[0].refusal.code, 'SOURCE_TOTAL_MISMATCH');
  const unmapped = await engine.request('connectorsx.unmapped', {});
  assert.deepEqual(unmapped.fields.map((f: any) => f.field), ['Order Value']);
});

test('exports without their own total wait for the report total and match it to the paisa', async t => {
  const engine = await open(t);
  const text = await fixture('paytm-business/settlements-sep-2026.csv');
  const target = { recipeId: 'paytm.settlements', sourceId: 'paytm-main', company: 'Synthetic Cafe', text };
  const waiting = await engine.request('connectorsx.importPreview', target);
  assert.equal(waiting.refusal.code, 'SOURCE_TOTALS_REQUIRED');
  const wrong = await engine.request('connectorsx.importPreview', { ...target, reportTotals: { total: '415000', rowCount: 3 } });
  assert.equal(wrong.refusal.code, 'SOURCE_TOTAL_MISMATCH');
  const right = await engine.request('connectorsx.importPreview', { ...target, reportTotals: { total: '415050', rowCount: 3 } });
  assert.equal(right.status, 'accepted'); assert.equal(right.excludedRows, 1); assert.equal(right.sourceTotals.provenance, 'user-entered-report');
  await engine.request('connectorsx.importCommit', { envelopeId: right.id });
  const sources = await engine.request('sources.list', {});
  assert.ok(sources.some((s: any) => s.sourceId === 'paytm-main'));
  await assert.rejects(engine.request('connectorsx.importPreview', { ...target, reportTotals: { total: '4150.50' } }), code('INVALID_SOURCE_TOTALS'));
});

test('connections never hold credentials; unbuilt roads refuse with typed codes', async t => {
  const engine = await open(t);
  await assert.rejects(engine.request('connectorsx.connect', { group: 'razorpay', road: 'file', company: 'X', settings: { keySecret: 'abc' } }), code('CREDENTIAL_NOT_ACCEPTED'));
  await assert.rejects(engine.request('connectorsx.connect', { group: 'tally', road: 'screen', company: 'X' }), code('SCREEN_EXPORT_NOT_BUILT'));
  await assert.rejects(engine.request('connectorsx.connect', { group: 'quick-commerce', road: 'interface', company: 'X' }), code('READ_NOT_AVAILABLE'));
  await assert.rejects(engine.request('connectorsx.connect', { group: 'not-a-group', road: 'file', company: 'X' }), code('SYSTEM_NOT_FOUND'));
  const file = await engine.request('connectorsx.connect', { group: 'paytm-business', road: 'file', company: 'X' });
  await assert.rejects(engine.request('connectorsx.read', { connectionId: file.id, operation: 'payments' }), code('DEMO_EXTERNAL_DISABLED'));
  await assert.rejects(handlers.read(owner, { connectionId: file.id, operation: 'payments' }, host(engine)), code('READ_NOT_AVAILABLE'));
  await engine.request('connectorsx.pause', { connectionId: file.id, paused: true });
  await assert.rejects(engine.request('connectorsx.importPreview', { recipeId: 'paytm.settlements', connectionId: file.id, text: 'a' }), code('CONNECTION_PAUSED'));
  const removed = await engine.request('connectorsx.disconnect', { connectionId: file.id });
  assert.equal(removed.factsKept, true);
  assert.deepEqual(await engine.request('connectorsx.connections', {}), []);
});

test('sign-in uses the browser with PKCE; the missing pieces are typed refusals', async t => {
  const plainEngine = await open(t);
  const books = await plainEngine.request('connectorsx.connect', { group: 'zoho-books', road: 'file', company: 'X' });
  await assert.rejects(plainEngine.request('connectorsx.signIn', { connectionId: books.id }), code('OAUTH_CLIENT_REQUIRED'));
  const razorpay = await plainEngine.request('connectorsx.connect', { group: 'razorpay', road: 'file', company: 'X' });
  assert.equal((await plainEngine.request('connectorsx.signIn', { connectionId: razorpay.id })).method, 'key');
  const engine = await open(t, { modules: { 'connectors-ext': { oauthClients: { google: { clientId: 'synthetic-client.apps', redirectUri: 'http://127.0.0.1:47123/callback' } } } } });
  const sheets = await engine.request('connectorsx.connect', { group: 'google-workspace', road: 'file', company: 'X' });
  const started = await engine.request('connectorsx.signIn', { connectionId: sheets.id, operation: 'sheets' });
  const url = new URL(started.authorizeUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok((url.searchParams.get('code_challenge') ?? '').length >= 43);
  await assert.rejects(engine.request('connectorsx.signInComplete', { state: url.searchParams.get('state'), code: 'x' }), code('DEMO_EXTERNAL_DISABLED'));
  await assert.rejects(handlers.signInComplete(owner, { state: url.searchParams.get('state'), code: 'x' }, host(engine)), code('TOKEN_EXCHANGE_HOST_REQUIRED'));
  const exchanged: any[] = [];
  const withBroker = host(engine, { tokenExchange: async (_ctx: any, request: any) => { exchanged.push(request); return { ok: true as const }; } });
  await assert.rejects(handlers.signInComplete(owner, { state: 'unknown-state', code: 'x' }, withBroker), code('SIGN_IN_EXPIRED'));
  assert.deepEqual(await handlers.signInComplete(owner, { state: url.searchParams.get('state'), code: 'auth-code' }, withBroker), { signedIn: true, connectionId: sheets.id });
  assert.equal(exchanged[0].verifier.length >= 43, true); assert.equal(exchanged[0].code, 'auth-code');
  await assert.rejects(handlers.signInComplete(owner, { state: url.searchParams.get('state'), code: 'auth-code' }, withBroker), code('SIGN_IN_EXPIRED'), 'a sign-in state is single-use');
});

test('deleting a source removes what this lane derived from it', async t => {
  const engine = await open(t);
  const text = await fixture('restaurant-partners/payout-annexure-week-36.csv');
  const preview = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'zomato-week', company: 'Synthetic Cafe', text });
  await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
  assert.equal((await engine.request('connectorsx.envelopes', { sourceId: 'zomato-week' })).length, 1);
  await engine.request('sources.delete', { id: 'zomato-week' });
  assert.equal((await engine.request('connectorsx.envelopes', { sourceId: 'zomato-week' })).length, 0);
});

test('demo mode keeps external reads disabled', async t => {
  const engine = await open(t, { demo: true });
  await assert.rejects(engine.request('connectorsx.read', { connectionId: 'x', operation: 'y' }), code('DEMO_EXTERNAL_DISABLED'));
});

test('an interface read goes through the credential broker, checks the source total and imports', async t => {
  const { recordedHttp } = await import('../runtime/adapters/read-kit.ts');
  const engine = await open(t);
  const page = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/connectors/razorpay/${name}`, import.meta.url), 'utf8'));
  const items = [...page('recon-page-1.json').items, ...page('recon-page-2.json').items];
  const RZP = 'https://api.razorpay.com', SETL = 'setl_SynthRecon00001';
  const responses = { [`GET ${RZP}/v1/settlements/${SETL}`]: { body: readFileSync(new URL('../../fixtures/connectors/razorpay/settlement.json', import.meta.url), 'utf8') },
    [`GET ${RZP}/v1/settlements/recon/combined?year=2026&month=9&day=5&count=1000&skip=0`]: { body: JSON.stringify({ entity: 'collection', count: items.length, items }) } };
  const calls: any[] = [], asked: any[] = [];
  const options = { http: recordedHttp(responses, calls), credentialBroker: async (_ctx: any, request: any) => { asked.push(request); return 'rzp_key_id:rzp_key_secret'; } };
  const item = await engine.request('connectorsx.connect', { group: 'razorpay', road: 'interface', company: 'Synthetic Cafe' });
  await assert.rejects(handlers.read(owner, { connectionId: item.id, operation: 'settlement-recon', parameters: { settlementId: SETL } }, host(engine)), code('CREDENTIAL_BROKER_REQUIRED'));
  await assert.rejects(handlers.read(owner, { connectionId: item.id, operation: 'settlement-recon', parameters: { other: 'x' } }, host(engine, options)), code('CONNECTOR_REQUEST_INVALID'));
  const read = await handlers.read(owner, { connectionId: item.id, operation: 'settlement-recon', parameters: { settlementId: SETL } }, host(engine, options));
  assert.equal(read.status, 'accepted', JSON.stringify(read.refusal ?? read.abstention)); assert.equal(read.sourceTotals.provenance, 'source-declared');
  assert.equal(read.sourceTotals.total, '126460'); assert.equal(read.read.requests, 2);
  assert.equal(JSON.stringify(read).includes('rzp_key_secret'), false); assert.equal(asked[0].origin, RZP);
  assert.ok(calls.every(call => call.headers.Authorization?.startsWith('Basic ')));
  const committed = await engine.request('connectorsx.importCommit', { envelopeId: read.id });
  assert.ok(committed.committed.rows > 0);
  const failing = { ...options, http: recordedHttp({ [`GET ${RZP}/v1/settlements/${SETL}`]: { status: 401, body: '{}' } }) };
  await assert.rejects(handlers.read(owner, { connectionId: item.id, operation: 'settlement-recon', parameters: { settlementId: SETL } }, host(engine, failing)), code('SOURCE_SIGN_IN_EXPIRED'));
  const [fresh] = await engine.request('connectorsx.freshness', { sourceId: item.sourceId, asOf: '2026-10-14' });
  assert.equal(fresh.lastFailure.code, 'SOURCE_SIGN_IN_EXPIRED');
});
