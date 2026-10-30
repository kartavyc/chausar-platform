// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { business, owner, phone } from './venture-judge-helpers.ts';
import { YOUTUBE_EDIT_TOOLS } from '../runtime/venture/delivery/harness/tools-youtube-edit.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { YOUTUBE_DESK } from '../runtime/venture/playbooks/youtube/desk.ts';
import { digest, currentVenture } from '../runtime/venture/records.ts';
import type { YoutubeEditView } from '../runtime/venture/playbooks/youtube/records.ts';
const SOURCE = { label: 'word-times.json', durationMs: 10000, words: [
  { id: 'w1', text: 'We', startMs: 0, endMs: 1000 }, { id: 'w2', text: 'make', startMs: 1000, endMs: 2000 },
  { id: 'w3', text: 'coffee', startMs: 2000, endMs: 3000 },
] };
async function setup() {
  const env = await business('A YouTube channel for small makers in India');
  const offer = env.offers.find(offer => offer.playbookOffer === 'episode-package')!;
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Make a video from my own footage.', intake: { rights: { basis: 'own-footage', holder: 'Asha Rao' }, format: 'long' } });
  const act = (id: string, action: string, payload: any, digest?: string, ctx = owner) => YOUTUBE_DESK.edit.act!(env.deps, ctx, { playbook: 'youtube', kind: 'edit', id, action, payload, ...(digest ? { digest } : {}) });
  await env.call('venture.files.add', { orderId: order.id, name: 'source.srt', contentBase64: Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nWe make coffee\n').toString('base64') });
  const created = await act('new', 'create', { orderId: order.id, source: SOURCE, sourceRef: { kind: 'transcript', orderId: order.id } });
  return { env, order, act, created: created.result as YoutubeEditView };
}
test('the stored desk binds large edits to a second ask, keeps one undo step and rejects stale actions', async () => {
  const { env, act, created } = await setup();
  const requested = (await act(created.id, 'apply', { request: 'Cut the opening', ops: [{ kind: 'cut', from: 'w1', to: 'w3' }] }, created.digest)).result as YoutubeEditView;
  assert.equal(requested.document.cuts.length, 0);
  assert.ok(requested.pending);
  await assert.rejects(() => act(created.id, 'confirm', {}, created.digest), { code: 'EDIT_STALE' });
  const confirmed = (await act(created.id, 'confirm', {}, requested.digest)).result as YoutubeEditView;
  assert.equal(confirmed.document.cuts.length, 1);
  const restored = (await act(created.id, 'undo', {}, confirmed.digest)).result as YoutubeEditView;
  assert.equal(restored.document.cuts.length, 0);
  assert.equal(restored.history.length, 0);
  await assert.rejects(() => act(created.id, 'undo', {}, restored.digest, phone), { code: 'APP_APPROVAL_REQUIRED' });
  const list = await YOUTUBE_DESK.edit.list!(env.deps, owner, { playbook: 'youtube', kind: 'edit' });
  assert.equal(list.rows.length, 1);
});
test('a cleanup preview uses measured cuts and applying it keeps those exact air edges', async () => {
  const { act, created } = await setup();
  const preview = (await act(created.id, 'suggest', {}, created.digest)).result as any;
  assert.equal(preview.cleanup.removedMs, 0);
  const applied = (await act(created.id, 'cleanup', { confirmed: false }, created.digest)).result as YoutubeEditView;
  assert.equal(applied.document.cuts.length, 0);
});


test('word times bind to the current order transcript and refuse captions after its source changes', async () => {
  const { env, order, act } = await setup();
  const add = (text: string) => env.call('venture.files.add', { orderId: order.id, name: 'source.srt', contentBase64: Buffer.from(`1\n00:00:00,000 --> 00:00:03,000\n${text}\n`).toString('base64') });
  await add('We make coffee');
  const bound = (await act('new', 'create', { orderId: order.id, source: SOURCE, sourceRef: { kind: 'transcript', orderId: order.id } })).result as YoutubeEditView;
  const captions = (await act(bound.id, 'captions', { profile: 'web' }, bound.digest)).result as YoutubeEditView;
  assert.ok(captions.captions);
  const run = await env.call('venture.delivery.run', { orderId: order.id });
  const toolEnv = { deps: env.deps, ventureId: currentVenture(env.store.read())!.id, runRef: { kind: 'delivery', runId: run.id }, intake: { rights: { basis: 'own-footage', holder: 'Asha Rao' } }, now: () => '2026-10-27T12:00:00.000Z' } as unknown as ToolEnv;
  assert.ok((await YOUTUBE_EDIT_TOOLS['youtube.captions'].run(toolEnv, { editId: bound.id, profile: 'web' })).result);
  await add('We make tea');
  await assert.rejects(() => YOUTUBE_EDIT_TOOLS['youtube.captions'].run(toolEnv, { editId: bound.id, profile: 'web' }), { code: 'DERIVED_STALE' });
  await assert.rejects(() => act(bound.id, 'captions', { profile: 'web' }, captions.digest), { code: 'DERIVED_STALE' });
  await assert.rejects(() => YOUTUBE_DESK.edit.get!(env.deps, owner, { playbook: 'youtube', kind: 'edit', id: bound.id }), { code: 'DERIVED_STALE' });
});
