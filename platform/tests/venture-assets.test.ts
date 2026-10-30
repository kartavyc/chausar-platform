// Asset records (Ink v2 wave 5, package 5A4; catalogue P8): every file a run delivers has a venture-asset saying where
// it came from (the client's file, generated with a model and prompt, licensed stock with its licence id, or unknown),
// its licence, its credit and its cost (a receipt, or "not measured"). An unknown licence blocks Accept with
// ASSET_LICENCE_UNKNOWN naming the file. The footage share of a cut ("62% your footage") is computed by code from the
// edit list by source and goes into the AI disclosure line whenever generated footage is above zero. Rerun asks for a
// new asset that supersedes the old one, which is kept; Reuse links an existing asset into another of the client's
// orders at no new cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as playbookHandlers } from '../runtime/venture/playbooks/index.ts';
import { disclosureLine, footageShare, mediaAcceptBlock, recordHandedOverFiles, storeRunAssets } from '../runtime/venture/playbooks/kit/assets.ts';
import { KIT_TOOLS } from '../runtime/venture/delivery/harness/tools-kit.ts';
import { INTERNAL_SUGGESTIONS } from '../runtime/venture/policy/taint.ts';
import { business, code, owner, phone, PLAIN_IDEA, readyDraft } from './venture-judge-helpers.ts';

type Env = Awaited<ReturnType<typeof business>>;
const kit = (env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> =>
  (playbookHandlers as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<any>>)[method](env.deps, ctx, payload);
const DIGEST = 'ab'.repeat(32);

/** What assets.record says for one file, as a run on a real order calls it. */
async function recordCall(input: Record<string, unknown>, extra: Record<string, unknown> = {}, id = `call_${Math.random().toString(36).slice(2, 8)}`) {
  const env = { runRef: { kind: 'delivery', runId: 'delivery_x' }, files: [], tables: [], receipts: [{ id: 'work_receipt_1' }], intake: null, ...extra } as any;
  const made = await KIT_TOOLS['assets.record'].run(env, input);
  return { id, tool: 'assets.record', outcome: 'succeeded', envelope: { ok: true, result: made.result } } as any;
}

async function store(env: Env, calls: any[], at: { runId: string; orderId: string; clientId?: string }) {
  await ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, calls, { clientId: env.client.id, ...at }));
}

const GENERATED = { file: 'thumbnail.png', source: 'generated', model: 'image-model-2', prompt: 'A calm desk with a ledger', licence: 'Generated with the provider\'s terms: yours to use', digest: DIGEST, cost: 'w1' };

test('assets: assets.record notes a file\'s source, licence, credit and cost; a run stores it as the order\'s asset; practice keeps nothing', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A thumbnail for the episode.' });
  const tool = KIT_TOOLS['assets.record'];
  assert.equal(tool.effect, 'compute');
  assert.ok(INTERNAL_SUGGESTIONS.includes('assets.record'), 'it writes Chausar\'s own ledger only, so the taint latch lets it through');
  const generated = await recordCall(GENERATED);
  assert.equal(generated.envelope.result.recorded, true);
  const unknown = await recordCall({ file: 'background.mp3', source: 'unknown' });
  const stock = await recordCall({ file: 'city.mp4', source: 'licensed-stock', provider: 'Pexels', licenceId: 'px-123', licence: 'Pexels licence', attribution: 'Photo by R. Mehta', digest: DIGEST });
  await store(env, [generated, unknown, stock], { runId: 'delivery_x', orderId: order.id });
  const listed = await kit(env, 'venture.assets.list', { orderId: order.id });
  assert.equal(listed.assets.length, 3);
  const byName = (name: string) => listed.assets.find((asset: any) => asset.name === name);
  assert.deepEqual(byName('thumbnail.png').source, { kind: 'generated', model: 'image-model-2', prompt: 'A calm desk with a ledger' });
  assert.deepEqual(byName('thumbnail.png').cost, { kind: 'receipt', receiptId: 'work_receipt_1' });
  assert.equal(byName('thumbnail.png').sourceLine, 'Made by image-model-2');
  assert.equal(byName('background.mp3').licence, null);
  assert.deepEqual(byName('background.mp3').cost, { kind: 'not-measured' });
  assert.equal(byName('background.mp3').costLine, 'Cost not measured');
  assert.equal(byName('background.mp3').blocked.code, 'ASSET_LICENCE_UNKNOWN');
  assert.equal(byName('city.mp4').sourceLine, 'Stock from Pexels (licence px-123)');
  assert.equal(byName('city.mp4').blocked, null);
  // Storing the same calls again keeps one record each.
  await store(env, [generated, unknown, stock], { runId: 'delivery_x', orderId: order.id });
  assert.equal(listRecords(env.store.read(), 'venture-asset').length, 3);
  // Wrong shapes are refused to the agent; a practice run keeps nothing.
  await assert.rejects(recordCall({ file: 'x.png', source: 'generated', licence: 'ok' }), code('TOOL_FAILED'));
  await assert.rejects(recordCall({ file: 'x.png', source: 'licensed-stock', provider: 'Pexels', licence: 'ok' }), code('TOOL_FAILED'));
  const practice = await KIT_TOOLS['assets.record'].run({ runRef: { kind: 'rehearsal', scenarioId: 's', episode: 1 }, files: [], tables: [], receipts: [] } as any, GENERATED);
  assert.deepEqual(practice.result, { recorded: false, practice: true });
  // A client's own file takes its digest from the stored file, and its licence from the rights recorded at intake.
  const file = { id: 'upload_1', name: 'raw.mp4', format: 'csv', digest: 'cd'.repeat(32) };
  const withRights = await recordCall({ file: 'raw.mp4', source: 'client-file', from: 'f1' }, { files: [file], intake: { rights: { basis: 'own-footage', holder: 'Asha Rao' } } });
  assert.equal(withRights.envelope.result.asset.licence, "The client's own footage (Asha Rao)");
  assert.equal(withRights.envelope.result.asset.fileDigest, 'cd'.repeat(32));
  const noRights = await recordCall({ file: 'raw.mp4', source: 'client-file', from: 'f1' }, { files: [file] });
  assert.equal(noRights.envelope.result.asset.licence, null, 'no rights recorded at intake: the licence is unknown');
});

test('assets: an unknown licence blocks Accept with ASSET_LICENCE_UNKNOWN naming the file, on the run sheet and in review', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await readyDraft(env);
  assert.equal(run.canAccept, true);
  await store(env, [await recordCall({ file: 'music.mp3', source: 'unknown' })], { runId: run.id, orderId: run.orderId });
  const blocked = (await env.call('venture.delivery.list')).find((item: any) => item.id === run.id);
  assert.equal(blocked.canAccept, false);
  assert.match(blocked.acceptBlocked, /music\.mp3 has no known licence/);
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), (error: any) => {
    assert.equal(error.code, 'ASSET_LICENCE_UNKNOWN');
    assert.match(error.message, /music\.mp3/);
    return true;
  });
  // The owner records where it came from: the asset is no longer unknown and Accept goes through.
  await ventureAction(env.deps, owner, 'approve', 'test.licence', tx => {
    const asset = tx.list('venture-asset')[0];
    tx.replace({ ...asset, source: { kind: 'licensed-stock', provider: 'Free Music Archive', licenceId: 'fma-9' }, licence: 'CC BY 4.0' });
  });
  assert.equal(mediaAcceptBlock(env.store.read(), listRecords(env.store.read(), 'venture-record')[0], run), null);
  const accepted = await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
});

test('assets: the footage share comes from the edit list by source, and goes into the AI disclosure only when generated footage is above zero', () => {
  const assets = [
    { id: 'a_own', source: { kind: 'client-file', uploadId: 'upload_1' } },
    { id: 'a_gen', source: { kind: 'generated', model: 'video-model', prompt: 'b-roll' } },
    { id: 'a_stock', source: { kind: 'licensed-stock', provider: 'Pexels', licenceId: 'px-1' } },
  ] as any[];
  const share = footageShare([
    { assetId: 'a_own', startMs: 0, endMs: 31_000 },
    { assetId: 'a_gen', startMs: 31_000, endMs: 41_000 },
    { assetId: 'a_stock', startMs: 41_000, endMs: 50_000 },
  ], assets);
  assert.deepEqual(share.byKind, { 'client-file': 31_000, generated: 10_000, 'licensed-stock': 9_000, unknown: 0 });
  assert.equal(share.ownPercent, 62);
  assert.equal(share.line, '62% your footage');
  assert.equal(disclosureLine(share), 'This video uses AI-generated footage. 62% your footage.');
  const ownOnly = footageShare([{ assetId: 'a_own', startMs: 0, endMs: 5000 }, { assetId: 'a_stock', startMs: 5000, endMs: 7000 }], assets);
  assert.equal(ownOnly.ownPercent, 71);
  assert.equal(disclosureLine(ownOnly), null, 'no generated footage: no AI line');
  assert.throws(() => footageShare([{ assetId: 'missing', startMs: 0, endMs: 10 }], assets), code('ASSET_NOT_FOUND'));
  assert.throws(() => footageShare([{ assetId: 'a_own', startMs: 10, endMs: 5 }], assets), code('INVALID_VENTURE_REQUEST'));
});

test('assets: Rerun asks for a new asset that supersedes the old one, which is kept, and Accept waits until it is made', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await readyDraft(env);
  await store(env, [await recordCall(GENERATED)], { runId: run.id, orderId: run.orderId });
  const old = (await kit(env, 'venture.assets.list', { orderId: run.orderId })).assets[0];
  const rerun = await kit(env, 'venture.assets.rerun', { id: old.id });
  assert.equal(rerun.superseded.id, old.id);
  assert.equal(rerun.superseded.supersededBy, rerun.asset.id);
  assert.equal(rerun.asset.supersedes, old.id);
  assert.equal(rerun.asset.state, 'requested');
  assert.deepEqual(rerun.asset.source, old.source, 'asked again with the same model and prompt');
  assert.equal(rerun.asset.fileDigest, null);
  assert.equal(listRecords(env.store.read(), 'venture-asset').length, 2, 'the old one is kept');
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('ASSET_NOT_MADE'));
  await assert.rejects(kit(env, 'venture.assets.rerun', { id: old.id }), code('ASSET_REFUSED'), 'a superseded asset is not run again');
  // The run records the new file under the same name: it fills the requested asset, which is then in use.
  await store(env, [await recordCall({ ...GENERATED, digest: 'ef'.repeat(32) })], { runId: run.id, orderId: run.orderId });
  const after = await kit(env, 'venture.assets.list', { orderId: run.orderId });
  const now = after.assets.find((asset: any) => asset.id === rerun.asset.id);
  assert.equal(now.state, 'ready');
  assert.equal(now.fileDigest, 'ef'.repeat(32));
  assert.equal(after.assets.length, 2);
  // A client's own file or an unknown one is not something to run again.
  await store(env, [await recordCall({ file: 'x.wav', source: 'unknown' })], { runId: run.id, orderId: run.orderId });
  const unknownId = listRecords(env.store.read(), 'venture-asset').find(asset => asset.name === 'x.wav')!.id;
  await assert.rejects(kit(env, 'venture.assets.rerun', { id: unknownId }), code('ASSET_REFUSED'));
  await assert.rejects(kit(env, 'venture.assets.rerun', { id: 'asset_missing' }), code('ASSET_NOT_FOUND'));
});

test('assets: Reuse links an asset into another of the client\'s orders with no new cost; never another client\'s, never a blocked one', async () => {
  const env = await business(PLAIN_IDEA);
  const first = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Episode one artwork.' });
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Episode two artwork.' });
  await store(env, [await recordCall(GENERATED), await recordCall({ file: 'odd.png', source: 'unknown' })], { runId: 'delivery_x', orderId: first.id });
  const assets = (await kit(env, 'venture.assets.list', { clientId: env.client.id })).assets;
  const good = assets.find((asset: any) => asset.name === 'thumbnail.png');
  const reused = await kit(env, 'venture.assets.reuse', { id: good.id, orderId: second.id });
  assert.equal(reused.asset.orderId, second.id);
  assert.equal(reused.asset.reusedFrom, good.id);
  assert.deepEqual(reused.asset.cost, { kind: 'reused', assetId: good.id });
  assert.equal(reused.asset.costLine, 'Reused, no new cost');
  assert.equal(reused.asset.fileDigest, good.fileDigest);
  assert.match(reused.line, /no new cost/);
  assert.equal((await kit(env, 'venture.assets.list', { orderId: second.id })).assets.length, 1);
  await assert.rejects(kit(env, 'venture.assets.reuse', { id: good.id, orderId: second.id }), code('ASSET_REFUSED'), 'once per order');
  const odd = assets.find((asset: any) => asset.name === 'odd.png');
  await assert.rejects(kit(env, 'venture.assets.reuse', { id: odd.id, orderId: second.id }), code('ASSET_LICENCE_UNKNOWN'));
  const other = await env.call('venture.client.add', { name: 'Ravi Shah', email: 'ravi@example.com', countryCode: 'IN' });
  const theirs = await env.call('venture.order.create', { clientId: other.id, offerId: env.offers[0].id, request: 'Their artwork.' });
  await assert.rejects(kit(env, 'venture.assets.reuse', { id: good.id, orderId: theirs.id }), code('ASSET_REFUSED'));
  await assert.rejects(kit(env, 'venture.assets.reuse', { id: good.id, orderId: 'order_missing' }), code('ORDER_NOT_FOUND'));
  // The list takes only its two filters; a phone reads it too.
  await assert.rejects(kit(env, 'venture.assets.list', { orderId: 'x', clientId: 'y', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
  const fromPhone = await kit(env, 'venture.assets.list', {}, phone);
  assert.equal(fromPhone.assets.length, 3);
});

test('assets: a file the owner\'s own tool left with a run gets an asset record, source unknown, so Accept checks it', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await readyDraft(env);
  const delegated = { runId: run.id, outcome: 'succeeded', outputs: [{ name: 'report.xlsx', bytes: 10, digest: 'cd'.repeat(32), text: null, note: null }] } as any;
  await ventureAction(env.deps, owner, 'prepare', 'test.delegate', tx => { recordHandedOverFiles(tx, delegated); recordHandedOverFiles(tx, delegated); });
  const kept = listRecords(env.store.read(), 'venture-asset');
  assert.equal(kept.length, 1, 'once per file');
  assert.deepEqual([kept[0].name, kept[0].source.kind, kept[0].fileDigest], ['report.xlsx', 'unknown', 'cd'.repeat(32)]);
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('ASSET_LICENCE_UNKNOWN'));
  // The agent records where it came from under the same name: that record takes the unknown one's place.
  await store(env, [await recordCall({ file: 'report.xlsx', source: 'licensed-stock', provider: 'Data.gov.in', licenceId: 'gdl-1', licence: 'Government Open Data Licence', digest: 'cd'.repeat(32) })], { runId: run.id, orderId: run.orderId });
  assert.equal(mediaAcceptBlock(env.store.read(), listRecords(env.store.read(), 'venture-record')[0], run), null);
  assert.equal((await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' })).status, 'accepted');
  const failed = { ...delegated, outcome: 'failed' };
  await ventureAction(env.deps, owner, 'prepare', 'test.delegate', tx => assert.deepEqual(recordHandedOverFiles(tx, failed), []));
});
