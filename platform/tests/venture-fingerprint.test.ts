// Stale by fingerprint (Ink v2 wave 5, package 5A4; catalogue P10): a derived unit (captions, a translation, a dub, an
// article, a chapter list) keeps the digest of the file it was made from. When that file changes, staleUnits marks the
// unit stale; a stale unit cannot be delivered (DERIVED_STALE, "The transcript changed after these captions were
// made. Make them again.") and is never reused silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentVenture, digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as playbookHandlers } from '../runtime/venture/playbooks/index.ts';
import { fingerprint, isStale, requireFresh, sourceDigest, staleLine, staleUnits } from '../runtime/venture/playbooks/kit/fingerprint.ts';
import { mediaAcceptBlock, storeRunAssets } from '../runtime/venture/playbooks/kit/assets.ts';
import { KIT_TOOLS } from '../runtime/venture/delivery/harness/tools-kit.ts';
import { business, code, owner, PLAIN_IDEA } from './venture-judge-helpers.ts';

type Env = Awaited<ReturnType<typeof business>>;
const SRT = (said: string) => `1\n00:00:00,000 --> 00:00:02,000\n${said}\n`;

/** An order with a transcript, and captions and a translation the run made from it. */
async function derivedOrder(env: Env) {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Captions and a Hindi version.' });
  const transcript = await env.call('venture.files.add', { orderId: order.id, name: 'episode.srt', contentBase64: Buffer.from(SRT('Budgets start small.')).toString('base64') });
  const tool = KIT_TOOLS['assets.record'];
  const env2 = { runRef: { kind: 'delivery', runId: 'delivery_d' }, files: [{ id: transcript.id, name: 'episode.srt', format: 'transcript', digest: transcript.digest }], tables: [], receipts: [], intake: null } as any;
  const call = async (input: Record<string, unknown>, id: string) => ({ id, tool: 'assets.record', outcome: 'succeeded', envelope: { ok: true, result: (await tool.run(env2, input)).result } }) as any;
  const calls = [
    await call({ file: 'episode.en.srt', source: 'generated', model: 'captions-core', prompt: 'web profile', licence: 'Made by Chausar from the client\'s transcript', unit: 'captions', madeFrom: 'transcript' }, 'call_c'),
    await call({ file: 'episode.hi.srt', source: 'generated', model: 'translator', prompt: 'Hindi', licence: 'Made from the client\'s transcript', unit: 'translation', madeFrom: 'f1' }, 'call_t'),
  ];
  await ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, calls, { runId: 'delivery_d', orderId: order.id, clientId: env.client.id }));
  return { order, transcript };
}

/** The owner's edit to the transcript in Review: the stored file changes, and so does its digest. */
async function editTranscript(env: Env, uploadId: string, said: string) {
  await ventureAction(env.deps, owner, 'prepare', 'test.edit', tx => {
    const upload = tx.find('venture-upload', uploadId)!;
    const encoded = Buffer.from(SRT(said)).toString('base64');
    tx.replace({ ...upload, contentBase64: encoded, digest: digest(encoded) });
  });
}

test('fingerprint: a derived unit keeps its source\'s digest and is fresh until that source changes', async () => {
  const env = await business(PLAIN_IDEA);
  const { order, transcript } = await derivedOrder(env);
  assert.equal(fingerprint('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(fingerprint(Buffer.from('abc')), fingerprint('abc'));
  const state = env.store.read();
  const captions = listRecords(state, 'venture-asset').find(asset => asset.name === 'episode.en.srt')!;
  assert.deepEqual(captions.derived!.source, { kind: 'transcript', orderId: order.id }, 'the transcript is the order\'s, newest');
  assert.equal(captions.derived!.sourceDigest, transcript.digest);
  assert.equal(sourceDigest(state, { kind: 'upload', id: transcript.id }), transcript.digest);
  assert.deepEqual(staleUnits(state, order.id).map(unit => [unit.name, unit.stale]), [['episode.en.srt', false], ['episode.hi.srt', false]]);
  requireFresh(state, captions);
});

test('fingerprint: when the transcript changes every unit made from it is stale, with plain words, and cannot be delivered', async () => {
  const env = await business(PLAIN_IDEA);
  const { order, transcript } = await derivedOrder(env);
  await editTranscript(env, transcript.id, 'Budgets start very small.');
  const state = env.store.read();
  const units = staleUnits(state, order.id);
  assert.deepEqual(units.map(unit => unit.stale), [true, true]);
  assert.equal(units[0].line, 'The transcript changed after these captions were made. Make them again.');
  assert.equal(units[1].line, 'The file changed after this translation was made. Make it again.');
  const captions = listRecords(state, 'venture-asset').find(asset => asset.name === 'episode.en.srt')!;
  assert.throws(() => requireFresh(state, captions), (error: any) => error.code === 'DERIVED_STALE' && error.message === 'The transcript changed after these captions were made. Make them again.');
  const block = mediaAcceptBlock(state, currentVenture(state)!, { id: 'delivery_d', orderId: order.id });
  assert.deepEqual(block, { code: 'DERIVED_STALE', line: 'The transcript changed after these captions were made. Make them again.' });
  // A source that is gone is stale too, and says so.
  await ventureAction(env.deps, owner, 'prepare', 'test.forget', tx => { tx.state.conversations = tx.state.conversations.filter((record: any) => record?.id !== transcript.id); });
  const after = env.store.read();
  assert.equal(staleLine(after, captions), 'The transcript these captions were made from is gone. Make them again.');
  assert.equal(isStale(after, { derived: null }), false, 'a file made from nothing derived is never stale');
});

test('fingerprint: a stale unit is never reused silently, nor run again as if fresh', async () => {
  const env = await business(PLAIN_IDEA);
  const { order, transcript } = await derivedOrder(env);
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'The same captions again.' });
  const captions = listRecords(env.store.read(), 'venture-asset').find(asset => asset.name === 'episode.en.srt')!;
  await editTranscript(env, transcript.id, 'Changed words.');
  const reuse = (playbookHandlers as any)['venture.assets.reuse'];
  await assert.rejects(reuse(env.deps, owner, { id: captions.id, orderId: second.id }), code('DERIVED_STALE'));
  // Run again, the new captions keep the transcript's new digest and are fresh.
  const rerun = await (playbookHandlers as any)['venture.assets.rerun'](env.deps, owner, { id: captions.id });
  assert.equal(rerun.asset.derived.sourceDigest, sourceDigest(env.store.read(), { kind: 'transcript', orderId: order.id }));
  assert.equal(rerun.asset.stale, false);
  assert.equal(rerun.superseded.stale, true);
  assert.deepEqual(staleUnits(env.store.read(), order.id).map(unit => unit.name), ['episode.hi.srt'], 'only units in use are listed; the requested one is not made yet');
});

test('fingerprint: a Rerun\'s file recorded with no unit keeps the derived link the request had', async () => {
  const env = await business(PLAIN_IDEA);
  const { order } = await derivedOrder(env);
  const captions = listRecords(env.store.read(), 'venture-asset').find(asset => asset.name === 'episode.en.srt')!;
  const rerun = await (playbookHandlers as any)['venture.assets.rerun'](env.deps, owner, { id: captions.id });
  const made = await KIT_TOOLS['assets.record'].run({ runRef: { kind: 'delivery', runId: 'delivery_e' }, files: [], tables: [], receipts: [], intake: null } as any,
    { file: 'episode.en.srt', source: 'generated', model: 'captions-core', prompt: 'web profile', licence: 'Made by Chausar from the client\'s transcript' });
  await ventureAction(env.deps, owner, 'prepare', 'test.fill', tx => storeRunAssets(tx, [{ id: 'call_e', tool: 'assets.record', outcome: 'succeeded', envelope: { ok: true, result: made.result } } as any], { runId: 'delivery_e', orderId: order.id, clientId: env.client.id }));
  const filled = listRecords(env.store.read(), 'venture-asset').find(asset => asset.id === rerun.asset.id)!;
  assert.equal(filled.state, 'ready');
  assert.deepEqual(filled.derived, rerun.asset.derived);
  assert.deepEqual(staleUnits(env.store.read(), order.id).map(unit => unit.name).sort(), ['episode.en.srt', 'episode.hi.srt']);
});
