// P6: the venture host behind the real Engine (demo mode, experimental file storage, a temp folder).
// Tests that need other packages skip while those packages answer NOT_BUILT_YET; in Phase C they must pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { DRAFT_METHODS, PRE_VAULT_METHODS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type {
  BlueprintView, BriefRecord, GitHubTransport, ModelHttpRequest, ModelPreset, ModelStatusView, ModelTransport, PriceReceiptRecord,
} from '../runtime/venture/contracts.ts';

const PASSPHRASE = 'long-enough-passphrase';
const FAKE_KEY = 'sk-ant-test-not-a-real-key-0000';
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';

/** Records every model request and answers none of them: these tests never need a model's words. */
function recordingTransport(): ModelTransport & { requests: ModelHttpRequest[] } {
  const requests: ModelHttpRequest[] = [];
  return {
    requests, replay: true,
    http: async request => { requests.push(request); throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
    process: async request => {
      if (request.purpose === 'version-check') return { exitCode: 0, stdout: 'synthetic recording' };
      throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.');
    },
  };
}
type StatusView = ModelStatusView;
const noGitHub: GitHubTransport = { kind: 'fixture', read: async () => ({ status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null }) };

async function engineOn(t: any, transport: ModelTransport = recordingTransport()) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-engine-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: transport, githubTransport: noGitHub } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  return engine;
}

type Outcome<T> = { value: T } | { error: any };
async function settle<T>(pending: Promise<T>): Promise<Outcome<T>> {
  try { return { value: await pending }; } catch (error) { return { error }; }
}
/** The reach rule: the venture code answered, with a value or a coded error the desktop keeps. */
function assertReached(outcome: Outcome<unknown>, method: string) {
  if (!('error' in outcome)) return;
  const { error } = outcome;
  assert.equal(typeof error?.code, 'string', `${method} threw an error without a code: ${error?.stack ?? error}`);
  assert.match(error.code, /^[A-Z_]+$/, `${method} code ${error.code}`);
  assert.notEqual(error.code, 'REQUEST_FAILED', method);
  assert.equal(typeof error.message, 'string', method);
  assert.doesNotMatch(error.message, /^Unknown request/, method);
}

class NotBuiltYet extends Error {}
/** Runs one step; a NOT_BUILT_YET answer turns the whole test into a skip naming the missing part. */
async function need<T>(label: string, pending: Promise<T>): Promise<T> {
  try { return await pending; }
  catch (error: any) { if (error?.code === 'NOT_BUILT_YET') throw new NotBuiltYet(`${label} answered NOT_BUILT_YET`); throw error; }
}
async function skipping(t: any, body: () => Promise<void>) {
  try { await body(); }
  catch (error) { if (error instanceof NotBuiltYet) { t.skip(error.message); return; } throw error; }
}

test('before any vault, venture.countries and venture.preview reach the venture code', async t => {
  const engine = await engineOn(t);
  const countries = await settle(engine.request('venture.countries', {}));
  if ('error' in countries) assert.equal(countries.error.code, 'NOT_BUILT_YET', countries.error.stack);
  else assert.ok(Array.isArray(countries.value) && countries.value.length > 0);
  const preview = await settle(engine.request('venture.preview', { idea: IDEA, countryCode: 'IN' }));
  if ('error' in preview) assert.equal(preview.error.code, 'NOT_BUILT_YET', preview.error.stack);
  else assert.equal((preview.value as { saved: unknown }).saved, false);
  assert.equal((await engine.request('workspace.status', {})).open, false);
});

test('before any vault, the nine draft methods reach the draft desk, not the vault check', async t => {
  const transport = recordingTransport();
  const engine = await engineOn(t, transport);
  for (const method of DRAFT_METHODS) {
    const outcome = await settle(engine.request(method, {}));
    assertReached(outcome, method);
    if ('error' in outcome) assert.notEqual(outcome.error.code, 'VAULT_LOCKED', `${method} must not need a vault`);
  }
  assert.deepEqual(transport.requests, [], 'an empty payload never reaches a model');
  assert.equal((await engine.request('workspace.status', {})).open, false);
});

test('after workspace.create, every other venture method called with {} reaches the host', async t => {
  const transport = recordingTransport();
  const engine = await engineOn(t, transport);
  await engine.request('workspace.create', { name: 'Venture reach test', passphrase: PASSPHRASE, pack: 'services' });
  const methods = VENTURE_METHODS.filter(method => !PRE_VAULT_METHODS.includes(method) && !DRAFT_METHODS.includes(method));
  assert.equal(methods.length, 77);
  for (const method of methods) assertReached(await settle(engine.request(method, {})), method);
  assert.deepEqual(transport.requests, [], 'an empty payload never reaches a model');
});

test('two first requests sent together share one host, so the key they store is the one status sees', async t => {
  await skipping(t, async () => {
    const engine = await engineOn(t);
    await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
    const presets = await need('venture.models.presets', engine.request('venture.models.presets', {})) as ModelPreset[];
    await need('venture.create', engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }));
    // Lock and open again so the next two requests are the first ones a new host sees.
    await engine.request('workspace.lock', {});
    await engine.request('workspace.open', { passphrase: PASSPHRASE });
    const haiku = presets.find(preset => preset.id === 'anthropic-haiku-5-5');
    assert.ok(haiku);
    const [connected, view] = await Promise.all([
      engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: haiku.consentDigest, apiKey: FAKE_KEY, tiers: ['fast'] }),
      engine.request('venture.get', {}),
    ]);
    assert.ok(connected && view);
    const status = await engine.request('venture.models.status', {}) as StatusView;
    const connection = status.connections.find(c => c.presetId === 'anthropic-haiku-5-5' && c.status === 'connected');
    assert.ok(connection);
    assert.equal(connection.keyLoaded, true);
    assert.equal(JSON.stringify(engine.vault?.read()).includes(FAKE_KEY), false);
  });
});

test('workspace.lock then workspace.open drops the host and the keys it held', async t => {
  await skipping(t, async () => {
    const engine = await engineOn(t);
    await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
    const presets = await need('venture.models.presets', engine.request('venture.models.presets', {})) as ModelPreset[];
    await need('venture.create', engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }));
    const haiku = presets.find(preset => preset.id === 'anthropic-haiku-5-5');
    assert.ok(haiku);
    await engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: haiku.consentDigest, apiKey: FAKE_KEY, tiers: ['fast'] });
    const before = await engine.request('venture.models.status', {}) as StatusView;
    assert.equal(before.connections.find(c => c.presetId === 'anthropic-haiku-5-5' && c.status === 'connected')?.keyLoaded, true);
    await engine.request('workspace.lock', {});
    await engine.request('workspace.open', { passphrase: PASSPHRASE });
    const after = await engine.request('venture.models.status', {}) as StatusView;
    const connection = after.connections.find(c => c.presetId === 'anthropic-haiku-5-5' && c.status === 'connected');
    assert.ok(connection, 'the connection record stays in the vault');
    assert.equal(connection.keyLoaded, false, 'the key lived only in the dropped host');
  });
});

/** The Plan screen's calls in screen order, with templates only. Returns the accepted plan and, when asked for, the quote. */
async function planScreen(engine: Engine, quote: boolean) {
  await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
  await need('venture.create', engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }));
  await need('venture.interview.next', engine.request('venture.interview.next', { useTemplate: true }));
  const answers: [string, Record<string, unknown>][] = [
    ['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }],
  ];
  for (const [questionId, answer] of answers) await engine.request('venture.interview.answer', { questionId, answer });
  const draft = await need('venture.blueprint.draft', engine.request('venture.blueprint.draft', { useTemplate: true })) as BlueprintView;
  assert.equal(draft.blueprint.status, 'draft');
  let receipt: PriceReceiptRecord | null = null;
  if (quote) {
    receipt = await need('venture.price.quote', engine.request('venture.price.quote', { offerId: 'offer_1' })) as PriceReceiptRecord;
    assert.equal(receipt.inputs.blueprintDigest, draft.blueprint.digest, 'the quote prices the draft');
    // INR 2,499.00 at 18%: tax (249900 x 1800 + 5000) / 10000 = 44982, total 249900 + 44982 = 294882.
    assert.equal(receipt.totalMinor, '294882');
    const onDraft = await engine.request('venture.blueprint.get', {}) as BlueprintView;
    assert.equal(onDraft.offerReceipts.offer_1?.id, receipt.id);
  }
  const accepted = await engine.request('venture.blueprint.accept', { digest: draft.blueprint.digest }) as BlueprintView;
  assert.equal(accepted.blueprint.status, 'accepted');
  assert.equal(accepted.blueprint.digest, draft.blueprint.digest);
  const afterAccept = await engine.request('venture.blueprint.get', {}) as BlueprintView;
  if (receipt) assert.equal(afterAccept.offerReceipts.offer_1?.id, receipt.id, 'accepting keeps the draft receipt current');
  return { blueprint: afterAccept.blueprint, receipt };
}

test('the Plan screen sequence prices the draft, keeps the receipt through acceptance and writes it into the brief', async t => {
  await skipping(t, async () => {
    const engine = await engineOn(t);
    await planScreen(engine, true);
    const brief = await need('venture.build.brief', engine.request('venture.build.brief', { useTemplate: true })) as BriefRecord;
    const markdown = brief.markdown;
    const section3 = markdown.slice(markdown.indexOf('## 3.'), markdown.indexOf('## 4.'));
    assert.ok(section3.startsWith('## 3.'), markdown);
    assert.match(section3, /INR 2,948\.82/);
  });
});

test('without a quote, the brief refuses PRICE_REQUIRED and names the offer', async t => {
  await skipping(t, async () => {
    const engine = await engineOn(t);
    const { blueprint } = await planScreen(engine, false);
    const offerName = blueprint.offers.find(offer => offer.id === 'offer_1')?.name.value;
    assert.ok(offerName);
    const outcome = await settle(need('venture.build.brief', engine.request('venture.build.brief', { useTemplate: true })));
    assert.ok('error' in outcome, 'the brief must refuse an offer that has a price but no receipt');
    if (outcome.error instanceof NotBuiltYet) throw outcome.error;
    assert.equal(outcome.error.code, 'PRICE_REQUIRED', outcome.error.stack);
    assert.ok(outcome.error.message.includes(offerName), outcome.error.message);
  });
});
