// W6 6F9 (D38): images and video through Sunra's MCP server, behind the 6F1 client. One approval card per generation
// with the cost in rupees computed by code and a receipt, a rights record, never an auto-confirm, keys only from
// protected storage. Fixture-tested: no Sunra key exists, so a local stand-in with Sunra's tool shapes answers and
// nothing is generated or paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { owner, seedBlueprint, seedOrder, seedRun, setup } from './venture-views-env.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { setMcpCredential } from '../runtime/venture/agent-runtime/external-credentials.ts';
import { createExternalMcpTools } from '../runtime/venture/agent-runtime/external-mcp.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { CHECKED_READ_ONLY } from '../runtime/venture/agent-runtime/mcp-policy.ts';
import { DEFAULT_MCP_ADAPTERS } from '../runtime/venture/agent-runtime/mcp-adapters.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { quoteSunra, sunraAdapter, sunraServerReference, type SunraPriceCard } from '../runtime/venture/media/sunra.ts';
import type { AgentApprovalRequest } from '../runtime/venture/agent-runtime/driver-types.ts';

const FIXED: SunraPriceCard = { id: 'mep_sample', model_endpoint: 'text-to-image', type: 'pre_defined', display: '$0.045-$0.09 per image',
  prices: [{ unit_amount: '0.045', matches: { resolution: '1K', images: { $size_lte: 1 } } }, { unit_amount: '0.09', matches: { images: { $size_lte: 1 } } }, { unit_amount: '0.126' }] };
const VIDEO: SunraPriceCard = { id: 'mep_video', model_endpoint: 'text-to-video', type: 'post_calculated', display: '$0.28 per second', freeze_amount: '1.41', prices: [{ unit_amount: '0.28' }] };
const RATE = { perUsd: '885000', setOn: '2026-11-01' };

test('the rupee cost is code arithmetic on Sunra\'s price card and the owner\'s rate, rounded once', () => {
  const quote = quoteSunra(FIXED, { prompt: 'A synthetic sample', resolution: '1K' }, RATE);
  assert.equal(quote.basis, 'fixed'); assert.equal(quote.usdMicros, '45000'); assert.equal(quote.paise, '398'); assert.equal(quote.display, '₹3.98');
  assert.equal(quoteSunra(FIXED, { prompt: 'x', resolution: '2K' }, RATE).usdMicros, '90000');
  assert.equal(quoteSunra(FIXED, { prompt: 'x', images: ['a', 'b'] }, RATE).usdMicros, '126000');
  const video = quoteSunra(VIDEO, { prompt: 'x', duration: 5 }, RATE);
  assert.equal(video.basis, 'up-to'); assert.equal(video.usdMicros, '1410000'); assert.equal(video.display, '₹124.79');
  assert.throws(() => quoteSunra({ ...FIXED, prices: [{ unit_amount: '0.1', matches: { resolution: { $regex: '.*' } } }] }, { resolution: '1K' }, RATE), { code: 'SUNRA_QUOTE_UNAVAILABLE' });
  assert.throws(() => quoteSunra(FIXED, { prompt: 'x', num_images: 2 }, RATE), { code: 'SUNRA_ONE_PER_APPROVAL' });
});

test('the Sunra server reference runs the npm package through npx with its key in SUNRA_KEY only', () => {
  const server = sunraServerReference('C:\\Program Files\\nodejs\\npx.cmd');
  assert.deepEqual({ transport: server.transport, tokenEnv: server.transport === 'stdio' && server.tokenEnv }, { transport: 'stdio', tokenEnv: 'SUNRA_KEY' });
  assert.ok(server.transport === 'stdio' && server.args.includes('@sunra/mcp-server@0.1.2'));
  assert.ok(DEFAULT_MCP_ADAPTERS.some(adapter => adapter.id === 'sunra' && adapter.matches(server)));
});

const FIXTURE = fileURLToPath(new URL('./fixtures/mcp-sunra-shaped-w6.mjs', import.meta.url));
async function sunraJob(t: { after(fn: () => unknown): void }, options: { rate?: boolean; intakeRights?: boolean } = {}) {
  const env = await setup(); const { client, order } = await seedOrder(env, await seedBlueprint(env)); const run = await seedRun(env, order, {});
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  if (options.rate !== false) await setSpendPolicy(env.deps, owner, { inrPerUsd: '88.50' });
  if (options.intakeRights) await ventureAction(env.deps, owner, 'prepare', 'test.rights', tx => { const row = tx.find('venture-order', order.id)!;
    tx.replace({ ...row, intake: { ...(row.intake ?? {}), rights: { basis: 'own-footage', holder: 'The client', reference: null, scope: null, expiresOn: null, recordedAt: env.now(), recordedBy: 'owner' } } as any }); });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const settings = (await getAgentSettings(env.deps, owner, {})).settings;
  settings.mcpServers = [{ id: 'sunra', name: 'Sunra', transport: 'stdio', command: process.execPath, args: [FIXTURE], tokenEnv: 'SUNRA_KEY' }];
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  const saved = new Map<string, string>();
  env.deps.credentials = { get: async (_w, name) => saved.get(name) ?? null, set: async (_w, name, value) => { saved.set(name, value); }, delete: async (_w, name) => { saved.delete(name); } };
  const key = ['synthetic', 'sunra', 'value'].join('-');
  await setMcpCredential(env.deps, owner, { serverId: 'sunra', token: key });
  const abort = new AbortController(), job = await createNativeJob(env.deps, owner, run.id, { agentId: 'delivery', sections: ['Reply'], check: () => undefined, signal: abort.signal });
  t.after(() => job.close());
  const cards: AgentApprovalRequest[] = []; let answer = true;
  const sunra = DEFAULT_MCP_ADAPTERS.find(adapter => adapter.id === 'sunra')!;
  const proxy = createExternalMcpTools(env.deps, owner, job.capability, { signal: abort.signal, guard: state => { job.assertState(state); },
    adapters: [sunraAdapter({ matches: server => server.id === 'sunra', priceCard: async () => FIXED })],
    checkedList: [{ server: { stdio: { command: process.execPath, args: [FIXTURE] } }, checkedOn: '2026-11-01', tools: CHECKED_READ_ONLY.find(entry => 'npmPackage' in entry.server && entry.server.npmPackage === '@sunra/mcp-server')!.tools }],
    approve: async request => { cards.push(request); return answer; } });
  t.after(() => proxy.close());
  assert.ok(sunra);
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sunra', query: '' }, owner);
  const fp = (name: string) => listing.tools.find((row: any) => row.name === name).fingerprint;
  const call = (tool: string, args: Record<string, unknown>) => proxy.tools[1]!.call({ serverId: 'sunra', tool, fingerprint: fp(tool), arguments: args }, owner) as Promise<any>;
  return { env, run, order, cards, key, call, listing, decline: () => { answer = false; } };
}

test('one generation gets one card with the rupee cost, its receipt and the rights record; the key reaches only the program', async t => {
  const job = await sunraJob(t);
  const result = await job.call('submit', { endpointId: 'black-forest-labs/flux-1.1-pro/text-to-image', input: { prompt: 'A synthetic sample', resolution: '1K' } });
  assert.equal(job.cards.length, 1);
  const card: any = job.cards[0]!.arguments;
  assert.equal(card.cost.display, '₹3.98'); assert.equal(card.cost.currency, 'INR'); assert.ok(card.cost.receiptId);
  assert.equal(card.rights.aiGenerated, true); assert.equal(card.rights.orderId, job.order.id);
  assert.match(job.cards[0]!.description!, /₹3\.98/);
  const parsed = JSON.parse(result.result.content[0].text);
  assert.equal(parsed.keyed, true); assert.ok(!JSON.stringify(result).includes(job.key)); assert.ok(!JSON.stringify(job.cards).includes(job.key));
  const records = listRecords(job.env.store.read(), 'venture-media-generation');
  assert.equal(records.length, 1); assert.equal(records[0]!.id, card.cost.receiptId);
  assert.equal(records[0]!.status, 'submitted'); assert.equal(records[0]!.requestId, 'pd_synthetic_1'); assert.equal(records[0]!.quote.paise, '398');
  // Reading the queue is on Chausar's checked list and needs no card.
  await job.call('status', { requestId: 'pd_synthetic_1' });
  assert.equal(job.cards.length, 1);
});

test('auto-confirm, webhooks, the key tool and batches are refused before any card or call', async t => {
  const job = await sunraJob(t);
  await assert.rejects(job.call('submit', { endpointId: 'a/b/text-to-image', input: { prompt: 'x', auto_confirm: true } }), { code: 'SUNRA_AUTO_CONFIRM_REFUSED' });
  await assert.rejects(job.call('subscribe', { endpointId: 'a/b/text-to-image', input: { prompt: 'x', options: { skipConfirmation: true } } }), { code: 'SUNRA_AUTO_CONFIRM_REFUSED' });
  await assert.rejects(job.call('submit', { endpointId: 'a/b/text-to-image', input: { prompt: 'x' }, webhookUrl: 'https://example.com/hook' }), { code: 'SUNRA_WEBHOOK_REFUSED' });
  await assert.rejects(job.call('set-sunra-key', { apiKey: 'x' }), { code: 'SUNRA_KEY_TOOL_REFUSED' });
  await assert.rejects(job.call('submit', { endpointId: 'a/b/text-to-image', input: { prompt: 'x', num_images: 3 } }), { code: 'SUNRA_ONE_PER_APPROVAL' });
  assert.equal(job.cards.length, 0);
  assert.equal(listRecords(job.env.store.read(), 'venture-media-generation').length, 0);
});

test('without the owner\'s rupee rate there is no card; a reference image needs recorded rights', async t => {
  const noRate = await sunraJob(t, { rate: false });
  await assert.rejects(noRate.call('submit', { endpointId: 'a/b/text-to-image', input: { prompt: 'x' } }), { code: 'RUPEE_RATE_REQUIRED' });
  assert.equal(noRate.cards.length, 0);
  const noRights = await sunraJob(t);
  await assert.rejects(noRights.call('submit', { endpointId: 'a/b/image-editing', input: { prompt: 'x', image_url: 'https://example.com/client-photo.jpg' } }), { code: 'RIGHTS_REQUIRED' });
  assert.equal(noRights.cards.length, 0);
  const withRights = await sunraJob(t, { intakeRights: true });
  await withRights.call('submit', { endpointId: 'a/b/image-editing', input: { prompt: 'x', image_url: 'https://example.com/client-photo.jpg' } });
  const card: any = withRights.cards[0]!.arguments;
  assert.deepEqual(card.rights.references, [{ url: 'https://example.com/client-photo.jpg', basis: 'own-footage', holder: 'The client' }]);
});

test('a declined generation sends nothing and its quote stays as a declined receipt', async t => {
  const job = await sunraJob(t); job.decline();
  await assert.rejects(job.call('submit', { endpointId: 'a/b/text-to-image', input: { prompt: 'x' } }), { code: 'MCP_CALL_DECLINED' });
  const records = listRecords(job.env.store.read(), 'venture-media-generation');
  assert.equal(records.length, 1); assert.equal(records[0]!.status, 'declined'); assert.equal(records[0]!.requestId, null);
});
