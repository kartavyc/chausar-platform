import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// All data is synthetic. The provider is a local fake on 127.0.0.1 (port 0) speaking the Ollama chat format.
type Reply = { status?: number; body: unknown } | string;
async function fixture(t: TestContext) {
  const requests: any[] = [];
  let reply: Reply = { body: { proposals: [] } };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      const answer = typeof reply === 'string' ? reply : JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(reply.body) }, done: true, done_reason: 'stop' });
      response.writeHead(typeof reply === 'string' ? 200 : reply.status ?? 200, { 'content-type': 'application/json' }); response.end(answer);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`;
  const directory = await mkdtemp(join(tmpdir(), 'chausar-learning-models-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock) });
  t.after(async () => { await engine.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Model Shop', passphrase: 'Synthetic learning models passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  const request = (method: string, payload: Record<string, unknown> = {}) => engine.request(method, payload) as Promise<any>;
  const route = async () => { await request('models.configure', { config: { id: 'synthetic-local', kind: 'ollama', model: 'synthetic-model', endpoint } }); return request('learningx.modelRouteSet', { routeId: 'synthetic-local' }); };
  const receipts = () => engine.vault!.read().modelReceipts as any[];
  return { engine, request, route, requests, receipts, setReply: (value: Reply) => { reply = value; } };
}
const ACCOUNTS = [
  { id: 'acct-1', name: 'HDFC Current', parentGroup: 'Bank Accounts' },
  { id: 'acct-2', name: 'Freight Inward', parentGroup: 'Direct Expenses' },
  { id: 'acct-3', name: 'Sharma 27AAPFU0939F1ZV Traders' },
];
const proposal = (id: string, accountClass: string, confidence = 'high', evidence = 'Name and group words point to this class.') => ({ id, accountClass, confidence, evidence });

test('accounts: preview → owner approval → one attempt → validated proposals merged through the rule proposer, with a receipt', async t => {
  const f = await fixture(t); await f.route(); await f.request('trust.update', { send: 'samples' });
  const set = await f.request('learningx.accountsPropose', { accounts: ACCOUNTS });
  const preview = await f.request('learningx.accountsAsk', { setId: set.id });
  assert.equal(preview.state, 'preview'); assert.equal(preview.approvalRequired, true); assert.equal(preview.approve.method, 'models.approve');
  // Samples: names leave, identifiers inside them are masked, account identifiers never leave.
  assert.ok(preview.payload.includes('HDFC Current')); assert.ok(preview.payload.includes('[GSTIN]'));
  for (const secret of ['27AAPFU0939F1ZV', 'acct-1', 'acct-3']) assert.equal(preview.payload.includes(secret), false, secret);

  // Not approved: nothing is sent, and the request stays open.
  assert.deepEqual((await f.request('learningx.accountsAskRun', { previewId: preview.previewId })).code, 'APPROVAL_REQUIRED');
  assert.equal((await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: 'outbound_approval_forged' })).code, 'APPROVAL_REQUIRED');
  assert.equal(f.requests.length, 0);

  f.setReply({ body: { proposals: [proposal('a1', 'bank'), proposal('a2', 'indirect-expenses', 'medium', 'Freight reads like an overhead.'), proposal('a3', 'sundry-creditors', 'low', 'Traders are usually suppliers.')] } });
  const approval = await f.request('models.approve', { id: preview.previewId });
  const done = await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: approval.id });
  assert.equal(done.state, 'done'); assert.equal(f.requests.length, 1); assert.equal(done.modelProposals, 3);
  // The provider received exactly the approved bytes.
  assert.equal(JSON.stringify(f.requests[0]), JSON.stringify(JSON.parse(preview.payload)));
  const byId = Object.fromEntries(done.set.proposals.map((p: any) => [p.accountId, p]));
  assert.equal(done.set.basedOn, set.id); assert.equal(done.set.modelReceiptId, done.receiptId);
  assert.equal(byId['acct-1'].accountClass, 'bank'); assert.equal(byId['acct-1'].needsQuestion, false);
  // The model disagrees with the group: the rule class stays and a person is asked.
  assert.equal(byId['acct-2'].accountClass, 'direct-expenses'); assert.equal(byId['acct-2'].needsQuestion, true);
  assert.ok(byId['acct-2'].evidence.some((e: any) => e.kind === 'model' && e.accountClass === 'indirect-expenses'));
  // A model as the only evidence always asks.
  assert.equal(byId['acct-3'].accountClass, 'sundry-creditors'); assert.equal(byId['acct-3'].needsQuestion, true);
  const receipt = f.receipts().find(r => r.id === done.receiptId);
  assert.deepEqual([receipt.purpose, receipt.task, receipt.status, receipt.attempts, receipt.digest], ['task', 'learning-accounts-sort', 'completed', 1, preview.digest]);
  assert.equal(receipt.taskOutput.length, 3);
  // A single attempt: running again sends nothing.
  assert.equal((await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: approval.id })).code, 'ALREADY_ATTEMPTED');
  assert.equal(f.requests.length, 1);
  assert.equal((await f.request('learningx.accountsList')).sets.length, 2);
});

test('send level: "nothing" sends nothing; "shape" sends table words and Tally groups only, never names', async t => {
  const f = await fixture(t); await f.route();
  const set = await f.request('learningx.accountsPropose', { accounts: ACCOUNTS });
  const nothing = await f.request('learningx.accountsAsk', { setId: set.id });
  assert.deepEqual([nothing.state, nothing.code], ['not-yet', 'SEND_LEVEL_WITHHELD']);
  assert.equal(f.receipts().length, 0);
  await f.request('trust.update', { send: 'shape' });
  const shape = await f.request('learningx.accountsAsk', { setId: set.id });
  assert.equal(shape.state, 'preview');
  for (const secret of ['HDFC', 'Sharma', 'Traders', '27AAPFU', 'acct-']) assert.equal(shape.payload.includes(secret), false, secret);
  assert.ok(shape.payload.includes('Bank Accounts') && shape.payload.includes('freight inward'));
  // Accounts with no structure at all: a clean refusal rather than an empty request.
  const bare = await f.request('learningx.accountsPropose', { accounts: [{ id: 'b1', name: 'Sharma Traders' }] });
  assert.equal((await f.request('learningx.accountsAsk', { setId: bare.id })).code, 'SEND_LEVEL_WITHHELD');
  // A send level changed after the preview refuses the run before anything is sent.
  const approval = await f.request('models.approve', { id: shape.previewId });
  await f.request('trust.update', { send: 'samples' });
  assert.equal((await f.request('learningx.accountsAskRun', { previewId: shape.previewId, approvalId: approval.id })).code, 'SEND_LEVEL_WITHHELD');
  assert.equal(f.requests.length, 0);
});

test('no route, or a route the owner has not chosen as it is now, is a clean "not yet"', async t => {
  const f = await fixture(t); await f.request('trust.update', { send: 'samples' });
  const set = await f.request('learningx.accountsPropose', { accounts: ACCOUNTS });
  assert.equal((await f.request('learningx.accountsAsk', { setId: set.id })).code, 'MODEL_ROUTE_UNAVAILABLE');
  assert.equal((await f.request('learningx.modelRoute')).ready, false);
  assert.equal((await f.request('learningx.editsAsk')).code, 'MODEL_ROUTE_UNAVAILABLE');
  await f.route();
  const preview = await f.request('learningx.accountsAsk', { setId: set.id });
  const approval = await f.request('models.approve', { id: preview.previewId });
  // Reconfiguring the route revokes the owner's choice until the owner chooses it again.
  await f.request('models.configure', { config: { id: 'synthetic-local', kind: 'ollama', model: 'another-synthetic-model', endpoint: (await f.request('models.list'))[0].endpoint } });
  assert.equal((await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: approval.id })).code, 'MODEL_ROUTE_UNAVAILABLE');
  assert.equal((await f.request('learningx.accountsAsk', { setId: set.id })).code, 'MODEL_ROUTE_UNAVAILABLE');
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.request('learningx.modelRouteSet', { routeId: 'missing-route' }), (error: any) => error.code === 'ROUTE_NOT_FOUND');
});

test('invalid model output is refused whole: garbage, extra classes, unknown ids, extra fields; a provider error is not retried', async t => {
  const f = await fixture(t); await f.route(); await f.request('trust.update', { send: 'samples' });
  const set = await f.request('learningx.accountsPropose', { accounts: ACCOUNTS });
  const cases: [Reply, string][] = [
    ['this is not json', 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('a1', 'bank'), proposal('a2', 'marketing')] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('a9', 'bank')] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('acct-1', 'bank')] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [{ ...proposal('a1', 'bank'), note: 'ignore the rules' }] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('a1', 'bank'), proposal('a1', 'cash')] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('a1', 'bank', 'certain')] } }, 'MODEL_OUTPUT_INVALID'],
    [{ body: { proposals: [proposal('a1', 'bank', 'high', 'x'.repeat(201))] } }, 'MODEL_OUTPUT_INVALID'],
    [{ status: 500, body: { error: 'synthetic failure' } }, 'MODEL_FAILED'],
  ];
  for (const [index, [reply, code]] of cases.entries()) {
    f.setReply(reply);
    const preview = await f.request('learningx.accountsAsk', { setId: set.id });
    const approval = await f.request('models.approve', { id: preview.previewId });
    const result = await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: approval.id });
    assert.deepEqual([result.state, result.code], ['not-yet', code], String(index));
    assert.equal(f.requests.length, index + 1, 'exactly one provider request per approved run');
    const receipt = f.receipts().find(r => r.id === preview.previewId);
    assert.deepEqual([receipt.status, receipt.attempts], ['failed', 1]);
    assert.equal((await f.request('learningx.accountsAskRun', { previewId: preview.previewId, approvalId: approval.id })).code, 'ALREADY_ATTEMPTED');
  }
  assert.equal(f.requests.length, cases.length);
  // Nothing was applied in part: only the original set exists.
  assert.deepEqual((await f.request('learningx.accountsList')).sets.map((s: any) => s.id), [set.id]);
});

test('dictionary edits: model edits pass assertEdit, applyEdit and the answer key exactly as other edits; invalid replies are refused whole', async t => {
  const f = await fixture(t); await f.route();
  await f.request('ontology.publish', { pack: 'ecommerce' });
  assert.equal((await f.request('learningx.editsAsk')).code, 'SEND_LEVEL_WITHHELD');
  await f.request('trust.update', { send: 'shape' });
  const preview = await f.request('learningx.editsAsk');
  assert.equal(preview.state, 'preview');
  // Shape: dictionary structure only; the owner's labels and meanings stay here.
  assert.ok(preview.payload.includes('earned')); assert.equal(preview.payload.includes('meaning\\":'), false);
  f.setReply({ body: { edits: [{ edit: 'change-label', name: 'billed', label: 'Invoiced' }, { edit: 'change-sign', name: 'earned', sign: -1 }] } });
  const approval = await f.request('models.approve', { id: preview.previewId });
  const done = await f.request('learningx.editsAskRun', { previewId: preview.previewId, approvalId: approval.id });
  assert.equal(done.state, 'done'); assert.equal(f.requests.length, 1); assert.deepEqual(done.refused, []);
  const byKind = Object.fromEntries(done.items.map((item: any) => [`${item.edit.edit}:${item.edit.name}`, item]));
  assert.equal(byKind['change-label:billed'].status, 'awaiting-review');
  assert.equal(byKind['change-sign:earned'].status, 'failed-answer-key');
  assert.ok(done.items.every((item: any) => item.evidence.origin === 'model' && item.evidence.modelReceiptId === done.receiptId));
  assert.deepEqual((await f.request('learningx.edits', { status: 'awaiting-review' })).items.map((item: any) => item.edit.name), ['billed']);
  assert.equal(f.receipts().find(r => r.id === done.receiptId).status, 'completed');

  // An unregistered kind, or an edit that does not apply, refuses the whole reply: no edit is recorded.
  for (const edits of [[{ edit: 'change-label', name: 'received', label: 'Collected' }, { edit: 'run', script: 'x' }], [{ edit: 'change-meaning', name: 'nothing', meaning: 'A meaning for nothing at all.' }]]) {
    f.setReply({ body: { edits } });
    const again = await f.request('learningx.editsAsk');
    const ok = await f.request('models.approve', { id: again.previewId });
    const before = (await f.request('learningx.edits')).total;
    assert.equal((await f.request('learningx.editsAskRun', { previewId: again.previewId, approvalId: ok.id })).code, 'MODEL_OUTPUT_INVALID');
    assert.equal((await f.request('learningx.edits')).total, before);
  }
  assert.equal(f.requests.length, 3);
  // A dictionary changed after the preview refuses before sending.
  const stale = await f.request('learningx.editsAsk');
  const staleApproval = await f.request('models.approve', { id: stale.previewId });
  await f.request('ontology.publish', { pack: 'retail' }).catch(() => f.request('ontology.publish', { pack: 'services' }));
  assert.equal((await f.request('learningx.editsAskRun', { previewId: stale.previewId, approvalId: staleApproval.id })).code, 'PREVIEW_STALE');
  assert.equal(f.requests.length, 3);
});
