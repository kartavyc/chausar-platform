// Client brand kits (Ink v2 wave 5, package 5A4; catalogue P7): venture.brandKit.set stores a client's colours (hex),
// fonts (names), logo (an order file), voice, one to three samples (four refused), banned words, banned topics,
// competitors and the claims they can prove, each with its proof file. Each set is the owner's approval inside the app
// and a new version, every version kept. resolveKit returns every field with its source: the client's kit, then the
// business voice and house style (4J17), then the default. The writing turn of a creative step lists the resolved kit,
// and the client's past briefs are kept and listed as client memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { currentVenture, listRecords } from '../runtime/venture/records.ts';
import { handlers as playbookHandlers } from '../runtime/venture/playbooks/index.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { brandKitPart, resolveKit } from '../runtime/venture/playbooks/kit/brand-kit.ts';
import { BANNED_WORDS } from '../runtime/venture/records.ts';
import { TEST_CARD } from './venture-agent-helpers.ts';
import { business, code, owner, phone, PLAIN_IDEA, readyDraft } from './venture-judge-helpers.ts';

type Env = Awaited<ReturnType<typeof business>>;
const kit = (env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> =>
  (playbookHandlers as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<any>>)[method](env.deps, ctx, payload);

/** A photo for the client's order, and a PDF proof, added the way the owner adds files. */
async function clientFiles(env: Env) {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Posts for the new menu, warm and simple.' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const logo = await env.call('venture.files.add', { orderId: order.id, name: 'logo.png', contentBase64: png.toString('base64') });
  const proof = await env.call('venture.files.add', { orderId: order.id, name: 'award.pdf', contentBase64: Buffer.from('%PDF-1.4 award').toString('base64') });
  return { order, logo, proof };
}

const FULL = (logo: string, proof: string) => ({
  colours: ['#1F6F43', '#fff'], fonts: ['Mukta', 'Inter'], logoFileId: logo, voice: ['Warm, short sentences', 'Speaks to families'],
  samples: ['Fresh samosas every morning, made the way Nani taught us.'], bannedWords: ['cheap'], bannedTopics: ['politics'],
  competitors: ['Sharma Sweets'], claims: [{ claim: 'Best sweet shop in Pune 2025 (Pune Food Awards)', proofFileId: proof }],
});

test('brand kit: the owner sets every field inside the app; each set is a kept version with undo', async () => {
  const env = await business(PLAIN_IDEA);
  const { logo, proof } = await clientFiles(env);
  const empty = await kit(env, 'venture.brandKit.get', { clientId: env.client.id });
  assert.equal(empty.kit, null);
  assert.equal(empty.version, null);
  assert.match(empty.line, /no brand kit/i);
  await assert.rejects(kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: FULL(logo.id, proof.id) }, phone), code('APP_APPROVAL_REQUIRED'));
  const first = await kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: FULL(logo.id, proof.id) });
  assert.equal(first.version, 1);
  assert.deepEqual(first.kit.colours, ['#1f6f43', '#ffffff'], 'colours kept as six-digit lower-case hex');
  assert.equal(first.kit.logoFileId, logo.id);
  assert.deepEqual(first.kit.claims, [{ claim: 'Best sweet shop in Pune 2025 (Pune Food Awards)', proofFileId: proof.id }]);
  assert.equal(first.undo, null);
  const second = await kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: { colours: ['#000000'] } });
  assert.equal(second.version, 2);
  assert.deepEqual(second.kit.fonts, [], 'a field left out is empty in the new version');
  assert.deepEqual(second.undo.colours, ['#1f6f43', '#ffffff'], 'undo is the version before, to set again');
  assert.equal(listRecords(env.store.read(), 'venture-brand-kit').length, 2, 'every version is kept');
  assert.match(second.line, /version 2/);
});

test('brand kit: four samples, a bad colour, another client\'s file, a claim without proof, a key or a card number are refused', async () => {
  const env = await business(PLAIN_IDEA);
  const { logo, proof } = await clientFiles(env);
  const set = (patch: Record<string, unknown>) => kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: { ...FULL(logo.id, proof.id), ...patch } });
  await assert.rejects(set({ samples: ['one', 'two', 'three', 'four'] }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /one to three samples/.test(error.message));
  await assert.rejects(set({ colours: ['green'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ claims: [{ claim: 'Number one', proofFileId: null }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ logoFileId: 'upload_missing' }), code('UPLOAD_NOT_FOUND'));
  await assert.rejects(set({ unknownField: 1 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ voice: ['Pay with ' + TEST_CARD] }), code('CHAT_KEY_REFUSED'));
  const other = await env.call('venture.client.add', { name: 'Ravi Shah', email: 'ravi@example.com', countryCode: 'IN' });
  await assert.rejects(kit(env, 'venture.brandKit.set', { clientId: other.id, kit: { logoFileId: logo.id } }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /this client's/.test(error.message));
  await assert.rejects(kit(env, 'venture.brandKit.set', { clientId: 'client_missing', kit: {} }), code('CLIENT_NOT_FOUND'));
  assert.equal(listRecords(env.store.read(), 'venture-brand-kit').length, 0, 'nothing was kept');
});

test('brand kit: resolveKit gives every field with its source: client kit, then the business voice and house style, then the default', async () => {
  const env = await business(PLAIN_IDEA);
  const { logo, proof } = await clientFiles(env);
  // No kit, no voice: banned words come from Chausar's house style, everything else is the default.
  let resolved = resolveKit(env.store.read(), currentVenture(env.store.read())!, env.client.id);
  assert.deepEqual(resolved.bannedWords, { value: [...BANNED_WORDS], source: 'house-style' });
  assert.deepEqual(resolved.colours, { value: [], source: 'default' });
  // The business voice (4J17) fills voice and banned words when the client's kit does not.
  const sections = { audience: ['Families'], howITalk: ['Warm and direct'], neverUse: ['synergy'], wordsIUse: ['fresh'], willNotClaim: [], format: ['Short sentences'] };
  await (agentHandlers as any)['venture.voice.set'](env.deps, owner, { voice: { language: 'en', channel: null, on: true, sections } });
  await kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: { colours: ['#1f6f43'], logoFileId: logo.id, claims: [{ claim: 'Award winner 2025', proofFileId: proof.id }] } });
  resolved = resolveKit(env.store.read(), currentVenture(env.store.read())!, env.client.id);
  assert.deepEqual(resolved.colours, { value: ['#1f6f43'], source: 'client-kit' });
  assert.deepEqual(resolved.logoFileId, { value: logo.id, source: 'client-kit' });
  assert.deepEqual(resolved.voice, { value: ['Warm and direct'], source: 'business-voice' });
  assert.deepEqual(resolved.bannedWords, { value: ['synergy'], source: 'business-voice' });
  assert.deepEqual(resolved.samples, { value: [], source: 'default' });
  // Field by field: the client's own banned words win over the business's.
  await kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: { bannedWords: ['cheap'] } });
  resolved = resolveKit(env.store.read(), currentVenture(env.store.read())!, env.client.id);
  assert.deepEqual(resolved.bannedWords, { value: ['cheap'], source: 'client-kit' });
  assert.deepEqual(resolved.voice.source, 'business-voice');
});

test('brand kit: the writing turn lists the resolved kit, and the client\'s past briefs are kept as client memory', async () => {
  const env = await business(PLAIN_IDEA);
  const { logo, proof } = await clientFiles(env);
  assert.deepEqual(brandKitPart(env.store.read(), currentVenture(env.store.read())!, env.client.id), {}, 'no kit: the input stays the same');
  await kit(env, 'venture.brandKit.set', { clientId: env.client.id, kit: FULL(logo.id, proof.id) });
  await readyDraft(env, 'Please write three posts for Diwali.');
  const writing = env.models.answered.filter(task => task.purpose === 'delivery').at(-1)!;
  const listed = (writing.input as any).brandKit;
  assert.ok(listed, 'the writing turn carries the kit');
  assert.match(listed.note, /client's brand kit/i);
  assert.deepEqual(listed.kit.colours, { value: ['#1f6f43', '#ffffff'], source: 'client-kit' });
  assert.deepEqual(listed.kit.bannedWords, { value: ['cheap'], source: 'client-kit' });
  assert.equal(listed.kit.logoFileId, undefined, 'file ids stay with Chausar');
  assert.deepEqual(listed.kit.claims.value, ['Best sweet shop in Pune 2025 (Pune Food Awards)'], 'claims as words, their proofs kept back');
  const view = await kit(env, 'venture.brandKit.get', { clientId: env.client.id });
  assert.deepEqual(view.memory.map((brief: any) => brief.request), ['Please write three posts for Diwali.', 'Posts for the new menu, warm and simple.'], 'newest first');
});
