// W6 6F2 (D31): playbook packs. A pack is markdown skills, MCP server references and WASM calculators, nothing else.
// Load, validate, show; calculators run sandboxed with no imports and their answers become code receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePack, PACK_FORMAT } from '../runtime/venture/packs/pack-format.ts';
import { addPack, listPacks, removePack, loadPackFolder, runPackCalculator } from '../runtime/venture/packs/packs.ts';
import { getAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { ensurePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { wasmModule, base64, LOOP_BODY, DIVIDE_BODY } from './fixtures/pack-wasm-w6.ts';

const calculator = (overrides: Record<string, unknown> = {}) => ({ id: 'gst-on-amount', name: 'GST on an amount', about: 'GST at a rate in basis points.',
  inputs: [{ name: 'amount', label: 'Amount in paise', unit: 'money' }, { name: 'rateBps', label: 'GST rate in basis points', unit: 'bps' }],
  output: { label: 'GST', unit: 'money' }, wasmBase64: base64(wasmModule()), maxMemoryPages: 0, timeoutMs: 1000, ...overrides });
const pack = (overrides: Record<string, unknown> = {}) => ({ format: PACK_FORMAT, id: 'gst-helper', name: 'GST helper', version: '1.0.0', about: 'Notes and a calculator for GST work.',
  skills: [{ id: 'gst-notes', title: 'How to explain GST to a client', markdown: '# GST notes\n\nUse plain words. Every amount comes from the calculator.' }],
  mcpServers: [{ id: 'microsoft-learn', name: 'Microsoft Learn', transport: 'http', url: 'https://learn.microsoft.com/api/mcp' }],
  calculators: [calculator()], ...overrides });
const refused = (raw: unknown, code: string) => assert.throws(() => validatePack(raw), (error: any) => { assert.equal(error.code, code, error.message); return true; });

test('a pack of skills, server references and a pure calculator validates and shows without its code bytes', () => {
  const valid = validatePack(pack());
  assert.equal(valid.view.id, 'gst-helper');
  assert.deepEqual(valid.view.skills.map(row => row.id), ['gst-notes']);
  assert.equal(valid.view.calculators[0]!.inputs.length, 2);
  assert.ok(!JSON.stringify(valid.view).includes('wasmBase64'));
  assert.equal(valid.digest, validatePack(pack()).digest);
});

test('code hooks, unknown parts, impure calculators and saved credentials are refused', () => {
  refused(pack({ hooks: { onInstall: 'node x.js' } }), 'PACK_CODE_REFUSED');
  refused(pack({ scripts: ['x.js'] }), 'PACK_CODE_REFUSED');
  refused(pack({ extra: true }), 'PACK_INVALID');
  refused(pack({ skills: [{ id: '../escape', title: 'x', markdown: 'x' }] }), 'PACK_INVALID');
  refused(pack({ skills: [{ id: 'web', title: 'x', markdown: '<script>alert(1)</script>' }] }), 'PACK_CODE_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: base64(wasmModule({ importFn: true })) })] }), 'PACK_WASM_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: base64(wasmModule({ start: true })) })] }), 'PACK_WASM_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: base64(wasmModule({ memory: { min: 1 } })), maxMemoryPages: 1 })] }), 'PACK_WASM_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: base64(wasmModule({ params: 1, body: [0x20, 0x00] })) })] }), 'PACK_WASM_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: base64(wasmModule({ exportName: 'main' })) })] }), 'PACK_WASM_REFUSED');
  refused(pack({ calculators: [calculator({ wasmBase64: 'not base64!' })] }), 'PACK_WASM_REFUSED');
  refused(pack({ mcpServers: [{ id: 'x', name: 'X', transport: 'http', url: 'https://example.com/mcp', credentialRef: 'mcp:v:x', credentialRevision: 'r' }] }), 'PACK_INVALID');
  refused(pack({ format: 'other/1' }), 'PACK_INVALID');
});

test('a calculator runs sandboxed: exact BigInt answers, a trap or an endless loop is refused', async () => {
  const valid = validatePack(pack({ calculators: [calculator(), calculator({ id: 'divide', wasmBase64: base64(wasmModule({ body: DIVIDE_BODY })) }), calculator({ id: 'forever', timeoutMs: 200, wasmBase64: base64(wasmModule({ body: LOOP_BODY })) })] }));
  const [gst, divide, forever] = valid.doc.calculators;
  assert.equal(await runPackCalculator(gst!, { amount: '123456789012345', rateBps: '1800' }), '22222222022222');
  await assert.rejects(runPackCalculator(divide!, { amount: '5', rateBps: '0' }), { code: 'PACK_CALCULATOR_FAILED' });
  await assert.rejects(runPackCalculator(forever!, { amount: '1', rateBps: '1' }), { code: 'PACK_CALCULATOR_FAILED' });
  await assert.rejects(runPackCalculator(gst!, { amount: '1.5', rateBps: '1800' }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('a pack folder loads only pack.json, skills and referenced calculators; any other file is refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-pack-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { skills: _s, calculators: _c, ...meta } = pack();
  await mkdir(join(dir, 'skills')); await mkdir(join(dir, 'calculators'));
  await writeFile(join(dir, 'skills', 'gst-notes.md'), '# How to explain GST to a client\n\nUse plain words.');
  await writeFile(join(dir, 'calculators', 'gst-on-amount.wasm'), wasmModule());
  const { wasmBase64: _w, ...spec } = calculator();
  await writeFile(join(dir, 'pack.json'), JSON.stringify({ ...meta, calculators: [spec] }));
  const loaded = await loadPackFolder(dir);
  assert.equal(validatePack(loaded).view.skills[0]!.title, 'How to explain GST to a client');
  await writeFile(join(dir, 'install.js'), 'process.exit(1)');
  await assert.rejects(loadPackFolder(dir), { code: 'PACK_CODE_REFUSED' });
  await rm(join(dir, 'install.js'));
  await mkdir(join(dir, 'hooks')); await writeFile(join(dir, 'hooks', 'pre.md'), 'x');
  await assert.rejects(loadPackFolder(dir), { code: 'PACK_CODE_REFUSED' });
});

async function business(t: { after(fn: () => void): void }) {
  t.after(installKitFixture());
  const env = await kitBusiness();
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  return env;
}

test('adding a pack shows an exact preview, needs the app and its digest, and never adds its servers by itself', async t => {
  const env = await business(t);
  const preview = await addPack(env.deps, owner, { pack: pack() });
  assert.equal(preview.added, false); assert.equal(preview.pack.id, 'gst-helper');
  await assert.rejects(addPack(env.deps, { ...owner, channel: 'phone' }, { pack: pack(), digest: preview.digest }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(addPack(env.deps, owner, { pack: pack({ version: '1.0.1' }), digest: preview.digest }), { code: 'PREVIEW_CHANGED' });
  const added = await addPack(env.deps, owner, { pack: pack(), digest: preview.digest });
  assert.equal(added.added, true);
  const listed = await listPacks(env.deps, owner, {});
  assert.deepEqual(listed.packs.map(row => row.id), ['gst-helper']);
  assert.deepEqual((await getAgentSettings(env.deps, owner, {})).settings.mcpServers, []);
  await assert.rejects(addPack(env.deps, owner, { pack: pack(), digest: preview.digest }), { code: 'PACK_EXISTS' });
  await removePack(env.deps, owner, { packId: 'gst-helper' });
  assert.deepEqual((await listPacks(env.deps, owner, {})).packs, []);
});

test('an added pack calculator answers inside a job with a code receipt the draft can cite', async t => {
  const env = await business(t);
  const preview = await addPack(env.deps, owner, { pack: pack() });
  await addPack(env.deps, owner, { pack: pack(), digest: preview.digest });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const playbook = await ensurePlaybook(env.deps, owner);
  const run = await ventureAction(env.deps, owner, 'prepare', 'test.run', tx => { tx.touch({ launchStage: 'approve-each' });
    return tx.put({ ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: playbook.id, playbookHash: playbook.hash, status: 'waiting-for-you', servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null }); });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: consent.disclosureDigest });
  const job = await createNativeJob(env.deps, owner, run.id, { agentId: 'writer', sections: ['Reply'], check: () => undefined }); t.after(() => job.close());
  await job.service.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scripted-agent', version: '1' } } });
  await job.service.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = async (name: string, args: Record<string, unknown>) => { const answer: any = await job.service.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }); assert.equal(answer.error, undefined, JSON.stringify(answer.error)); return answer.result.structuredContent.data; };
  const business_ = await call('read_business', {});
  assert.ok(business_.calculations.some((row: any) => row.name === 'pack_gst_helper_gst_on_amount'));
  assert.deepEqual(business_.packSkills.map((row: any) => row.id), ['gst-helper/gst-notes']);
  const result = await call('calculate', { operation: 'pack_gst_helper_gst_on_amount', arguments: { amount: '100000', rateBps: '1800' } });
  const receipt = result.receipts[0];
  assert.equal(receipt.operation, 'pack.calc');
  assert.equal(receipt.figures.find((row: any) => row.key === 'result').minor, '18000');
  const ref = result.refs.figures.find((row: any) => row.figureKey === 'result').ref;
  const saved = await call('draft_document', { draft: { title: 'GST', sections: [{ heading: 'Reply', parts: [{ kind: 'text', text: 'The GST is', ref: '' }, { kind: 'figure', text: '', ref }] }], questionsForClient: [] } });
  assert.ok(saved.draftId);
  assert.equal(findRecord(env.store.read(), 'venture-work-receipt', receipt.id)!.operation, 'pack.calc');
});
