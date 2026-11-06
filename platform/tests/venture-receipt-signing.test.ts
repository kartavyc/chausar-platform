// Ink v2 wave 4, package 4J10 (H26): signed receipts. Price, sum, work and tie receipts carry an Ed25519 signature over
// their canonical JSON, made in the same commit as the receipt with the business's own key. The private half is never
// stored: its seed is derived from the vault's own key when the vault opens (receipt:signing on the secret shelf), and
// only public halves are kept, every one ever used. A receipt changed outside Chausar is never signed over again.
// venture.receipt.verify {id} answers valid and a label: reproduction_ready (the inputs and table versions are kept),
// incomplete or signature_only. node scripts/verify-receipts.mjs checks the export's receipts offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, randomBytes, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { canonical } from '../runtime/actions.ts';
import type { MoneyExportFile, PriceReceiptRecord, ReceiptSignature, ReceiptVerifyView, SumReceiptRecord, WorkReceiptRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { owedPlan, sumReceipt } from '../runtime/venture/money/sums.ts';
import { CHANGED_LINE, KEY_GONE_LINE, NO_KEY_LINE, SIGNED_RECEIPTS_FORMAT, UNSIGNED_LINE, UNSIGNED_SINCE_LINE, signedReceiptsFile, signedText } from '../runtime/venture/journal/signing.ts';
import { sealDigest } from '../runtime/venture/journal/seal-json.ts';
import { signingSeedOf } from '../runtime/venture/journal/chain.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const ROOT = new URL('..', new URL('..', import.meta.url));
const ask = <T>(env: Env, table: Record<string, unknown>, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> =>
  (table[method] as (d: unknown, c: Context, p: unknown) => Promise<unknown>)(env.deps, ctx, payload) as Promise<T>;
const verifyReceipt = (env: Env, id: string) => ask<ReceiptVerifyView>(env, money, 'venture.receipt.verify', { id });
const getReceipt = (env: Env, id: string) => ask<PriceReceiptRecord & { signature?: ReceiptSignature }>(env, money, 'venture.receipt.get', { id });
const signatures = (env: Env) => listRecords(env.store.read(), 'venture-receipt-signature', env.venture.id);
const keys = (env: Env) => listRecords(env.store.read(), 'venture-signing-key', env.venture.id);
const PKCS8_PREFIX = '302e020100300506032b657004220420';

/** The views setup with a signing seed on the shelf, as VentureHost derives it from the vault's key at open. */
async function signing(seed = randomBytes(32).toString('hex')): Promise<Env & { seed: string }> {
  const env = await setup();
  env.deps.secrets.set('receipt:signing', seed);
  env.deps.secrets.set('journal:head', HEAD_KEY);
  return Object.assign(env, { seed });
}
const HEAD_KEY = randomBytes(32).toString('hex');

async function quote(env: Env, quantity?: string): Promise<PriceReceiptRecord> {
  if (!listRecords(env.store.read(), 'venture-blueprint').length) await seedBlueprint(env);
  return ask<PriceReceiptRecord>(env, money, 'venture.price.quote', { offerId: 'offer_1', ...(quantity ? { quantity } : {}) });
}

/** A work receipt as a run's tool would leave it, with the tables it read. */
async function workReceipt(env: Env, over: Partial<WorkReceiptRecord> = {}, table = true): Promise<WorkReceiptRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.work', tx => {
    const read = tx.put({
      ...tx.base('venture-work-table'), name: 'Bank statement', columns: ['date', 'amount'], rows: [{ id: 'r1', cells: { date: '2026-10-01', amount: '1000' } }],
      source: { kind: 'picked', uploadIds: ['upload_1'] }, runRef: { kind: 'delivery', runId: 'run_1' }, digest: 'table-digest',
    } as any);
    return tx.put<WorkReceiptRecord>({
      ...tx.base('venture-work-receipt'), operation: 'work.sum', runRef: { kind: 'delivery', runId: 'run_1' }, currency: 'INR',
      inputs: { tables: table ? [{ id: read.id, name: 'Bank statement', digest: 'table-digest' }] : [], columns: { amount: 'amount' }, rowIds: ['r1'] },
      steps: [{ op: 'add', inputs: ['1000'], result: '1000', rule: 'Add every amount.' }],
      figures: [{ key: 'total', label: 'Total', minor: '1000', display: 'INR 10.00', currency: 'INR', unit: 'money' }],
      reconciliation: null, allowedNumbers: ['1000'], explanation: 'One amount, INR 10.00.', digest: 'work-digest', ...over,
    });
  });
}
const script = (...args: string[]) =>
  spawnSync(process.execPath, [new URL('scripts/verify-receipts.mjs', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...args], { encoding: 'utf8' });

test('a price receipt is signed in its own commit; venture.receipt.get returns the signature and the exact text signed', async () => {
  const env = await signing();
  assert.equal(keys(env).length, 0, 'no key record before the first receipt');
  const receipt = await quote(env);
  const [key] = keys(env);
  assert.deepEqual(Object.keys(key).sort(), ['algorithm', 'at', 'epoch', 'id', 'kind', 'memberId', 'publicKey', 'ventureId'], 'only the public half is kept');
  const served = await getReceipt(env, receipt.id);
  const signature = served.signature!;
  assert.deepEqual(Object.keys(signature).sort(), ['algorithm', 'publicKey', 'signature', 'signed', 'signedAt']);
  const stored = listRecords(env.store.read(), 'venture-price-receipt').find(item => item.id === receipt.id)!;
  // The offer receipt the owner reads carries a worked-out stale flag; what was signed is the stored receipt itself.
  assert.equal(signature.signed, canonical(JSON.parse(JSON.stringify(stored))));
  const publicKey = createPublicKey({ key: Buffer.from(signature.publicKey, 'base64'), format: 'der', type: 'spki' });
  assert.ok(verify(null, Buffer.from(signature.signed, 'utf8'), publicKey, Buffer.from(signature.signature, 'base64')), 'a client checks what it was served');
  const view = await verifyReceipt(env, receipt.id);
  assert.deepEqual([view.id, view.valid, view.label], [receipt.id, true, 'reproduction_ready']);
  assert.equal(view.line, 'Signed by this business and unchanged since. What it was worked out from is kept, so it can be worked out again.');
  await quote(env, '2');
  assert.equal(keys(env).length, 1, 'the same key signs the next one');
  assert.equal(signatures(env).length, 2);
});

test('the private half is never stored: it comes from the vault key at open, through the host, and no record, export or log holds it', async () => {
  // A store that can derive keys from its vault key, as platform/runtime/vault.ts does.
  class DerivingStore extends VentureTestStore {
    derivedKey(purpose: string): Buffer { return Buffer.from(sealDigest({ test: 'vault key', purpose }), 'hex'); }
  }
  const env = await setup();
  const store = new DerivingStore(env.store.read());
  await seedBlueprint({ ...env, store, deps: { ...env.deps, store } } as Env);
  const host = new VentureHost(store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test' } as never);
  try {
    const receipt = await host.request(owner, 'venture.price.quote', { offerId: 'offer_1' }) as PriceReceiptRecord;
    const served = await host.request(owner, 'venture.receipt.get', { id: receipt.id }) as { signature?: ReceiptSignature };
    assert.ok(served.signature, 'the host derived the seed and signed');
    const seed = store.derivedKey('receipt-signing').toString('hex');
    const pkcs8 = createPrivateKey({ key: Buffer.from(PKCS8_PREFIX + seed, 'hex'), format: 'der', type: 'pkcs8' }).export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const everything = JSON.stringify(store.read());
    for (const secret of [seed, pkcs8, Buffer.from(seed, 'hex').toString('base64')]) assert.equal(everything.includes(secret), false, 'the vault records never hold the private half');
    assert.equal(createPublicKey(createPrivateKey({ key: Buffer.from(PKCS8_PREFIX + seed, 'hex'), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).toString('base64'), served.signature!.publicKey);
    const venture = listRecords(store.read(), 'venture-record')[0];
    assert.equal(JSON.stringify(signedReceiptsFile(store.read(), venture)).includes(seed), false);
  } finally {
    host.close();
  }
});

test('a receipt changed in the store no longer matches; Chausar signing a later change of it never vouches for the edit', async () => {
  const env = await signing();
  const receipt = await quote(env);
  await env.store.update(state => {
    const record = state.conversations.find((item: any) => item.id === receipt.id) as PriceReceiptRecord;
    record.totalMinor = '1';
  });
  assert.equal((await verifyReceipt(env, receipt.id)).valid, false);
  assert.equal((await verifyReceipt(env, receipt.id)).line, 'This receipt does not match its signature: it changed after Chausar signed it.');
  // Chausar now marks the edited receipt stale through a proper write: it is not signed again over the edit.
  await ventureAction(env.deps, owner, 'prepare', 'test.stale', tx => { tx.replace({ ...tx.find('venture-price-receipt', receipt.id)!, stale: true }); });
  assert.equal((await verifyReceipt(env, receipt.id)).valid, false, 'still changed, never valid');
  // A change Chausar makes to a receipt nobody touched is signed again in that commit.
  const fresh = await quote(env, '4');
  await ventureAction(env.deps, owner, 'prepare', 'test.stale', tx => { tx.replace({ ...tx.find('venture-price-receipt', fresh.id)!, stale: true }); });
  assert.equal((await verifyReceipt(env, fresh.id)).valid, true);
  // A signature changed in the store fails the same way.
  const other = await quote(env, '3');
  await env.store.update(state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-receipt-signature' && item.receiptId === other.id) as any;
    record.signature = Buffer.alloc(64).toString('base64');
  });
  assert.equal((await verifyReceipt(env, other.id)).valid, false);
});

test('unsigned and lost keys: before signing says so, unsigned after the first key reads changed, a key no longer kept says so', async () => {
  const env = await setup();
  const early = await quote(env);
  assert.equal(keys(env).length, 0, 'no seed on this shelf: nothing could be signed');
  assert.deepEqual([(await verifyReceipt(env, early.id)).valid, (await verifyReceipt(env, early.id)).line], [false, NO_KEY_LINE]);
  assert.equal(signingSeedOf({}), null, 'deps with no secret shelf sign nothing and never throw');
  assert.equal(signingSeedOf({ secrets: {} }), null);
  env.advance(60_000);
  env.deps.secrets.set('receipt:signing', randomBytes(32).toString('hex'));
  const later = await quote(env, '2');
  const before = await verifyReceipt(env, early.id);
  assert.deepEqual([before.valid, before.line], [false, UNSIGNED_LINE]);
  await env.store.update(state => { state.conversations = state.conversations.filter((item: any) => !(item.kind === 'venture-receipt-signature' && item.receiptId === later.id)); });
  const stripped = await verifyReceipt(env, later.id);
  assert.deepEqual([stripped.valid, stripped.line], [false, UNSIGNED_SINCE_LINE], 'made after the first key and unsigned: changed');
  const third = await quote(env, '3');
  await env.store.update(state => { state.conversations = state.conversations.filter((item: any) => item.kind !== 'venture-signing-key'); });
  assert.deepEqual([(await verifyReceipt(env, third.id)).valid, (await verifyReceipt(env, third.id)).line], [false, KEY_GONE_LINE]);
  await assert.rejects(verifyReceipt(env, 'fig:call-cost:call_1'), code('RECEIPT_NOT_FOUND'));
  await assert.rejects(verifyReceipt(env, 'price_missing'), code('RECEIPT_NOT_FOUND'));
  await assert.rejects(ask(env, money, 'venture.receipt.verify', { id: early.id, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('every public half stays: receipts signed with an older key still check, in the app and in the export file', async () => {
  const env = await signing();
  const first = await quote(env);
  env.advance(60_000);
  env.deps.secrets.set('receipt:signing', randomBytes(32).toString('hex'));
  const second = await quote(env, '2');
  assert.equal(keys(env).length, 2);
  assert.equal((await verifyReceipt(env, first.id)).valid, true);
  assert.equal((await verifyReceipt(env, second.id)).valid, true);
  const file = signedReceiptsFile(env.store.read(), env.venture);
  assert.equal(file.keys.length, 2);
  assert.notEqual(file.receipts.find(item => item.id === first.id)!.publicKey, file.receipts.find(item => item.id === second.id)!.publicKey);
});

test('sum, work and tie receipts are signed too, each with an honest label', async () => {
  const env = await signing();
  const sum = await sumReceipt(env.deps, owner, env.venture.id, owedPlan(env.store.read(), env.venture, null));
  assert.deepEqual([(await verifyReceipt(env, sum.id)).valid, (await verifyReceipt(env, sum.id)).label], [true, 'reproduction_ready']);
  const kept = await workReceipt(env);
  assert.deepEqual([(await verifyReceipt(env, kept.id)).valid, (await verifyReceipt(env, kept.id)).label], [true, 'reproduction_ready']);
  const bare = await workReceipt(env, {}, false);
  const bareView = await verifyReceipt(env, bare.id);
  assert.deepEqual([bareView.valid, bareView.label], [true, 'signature_only']);
  assert.equal(bareView.line, 'Signed by this business and unchanged since. It keeps its figures, not what they were worked out from.');
  await ventureAction(env.deps, owner, 'admin', 'test.drop', tx => {
    tx.state.conversations = tx.state.conversations.filter((record: any) => record?.kind !== 'venture-work-table');
  });
  const gone = await verifyReceipt(env, kept.id);
  assert.deepEqual([gone.valid, gone.label], [true, 'incomplete']);
  const ca = await workReceipt(env, {
    operation: 'ca.engine', ca: { engine: 'gst', inputs: { turnover: '100' }, inputsDigest: 'x', caReceiptId: 'ca_1', table: null, tables: [{ id: 'gst-rates', version: '2026-27' } as any], sections: [], assumptions: [], openQuestions: [], working: {} } as any,
  }, false);
  assert.equal((await verifyReceipt(env, ca.id)).label, 'reproduction_ready');
  const tie = await ventureAction(env.deps, owner, 'prepare', 'seed.tie', tx => {
    const person = tx.put({ ...tx.base('venture-person'), name: 'Asha Rao' } as any);
    return tx.put({ ...tx.base('venture-tie'), personId: person.id, signals: [{ kind: 'met', count: 1 }], scoreBp: 1200, band: 'met-once', computedAt: tx.now, digest: 'tie-digest' } as any);
  });
  assert.deepEqual([(await verifyReceipt(env, tie.id)).valid, (await verifyReceipt(env, tie.id)).label], [true, 'reproduction_ready']);
});

test('a tie replaced and a person forgotten take their signature rows with them', async () => {
  const env = await signing();
  const { person, tie } = await ventureAction(env.deps, owner, 'prepare', 'seed.tie', tx => {
    const person = tx.put({ ...tx.base('venture-person'), name: 'Asha Rao' } as any);
    const tie = tx.put({ ...tx.base('venture-tie'), personId: person.id, signals: [{ kind: 'met', count: 1 }], scoreBp: 1200, band: 'met-once', computedAt: tx.now, digest: 'tie-1' } as any);
    return { person, tie };
  });
  assert.equal(signatures(env).filter(item => item.receiptId === tie.id).length, 1);
  // The strength work stores a new tie and drops the old one in one pass, as network/strength.ts does.
  const next = await ventureAction(env.deps, owner, 'prepare', 'test.retie', tx => {
    const added = { ...tx.base('venture-tie'), personId: person.id, signals: [{ kind: 'met', count: 2 }], scoreBp: 1500, band: 'know', computedAt: tx.now, digest: 'tie-2' };
    tx.state.conversations = [...tx.state.conversations.filter((record: any) => record?.id !== tie.id), added as any];
    return added;
  });
  assert.equal(signatures(env).filter(item => item.receiptId === tie.id).length, 0, 'the old tie\'s signature went with it');
  assert.equal(signatures(env).filter(item => item.receiptId === next.id).length, 1, 'the new tie was signed');
  // Forget: the person and their tie are removed in one pass; their signature rows go too.
  await ventureAction(env.deps, owner, 'approve', 'test.forget', tx => {
    tx.state.conversations = tx.state.conversations.filter((record: any) => record?.id !== person.id && record?.personId !== person.id);
  });
  assert.equal(signatures(env).filter(item => item.receiptKind === 'venture-tie').length, 0);
});

test('a BigInt in a receipt or a journal item is a ChausarError, never a TypeError', () => {
  assert.throws(() => signedText({ totalMinor: 1n }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => sealDigest({ amount: 10n }), code('INVALID_VENTURE_REQUEST'));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => sealDigest(cycle), code('INVALID_VENTURE_REQUEST'));
  assert.equal(sealDigest({ b: 1, a: undefined, c: [undefined, 'x'] }), sealDigest(JSON.parse(JSON.stringify({ b: 1, a: undefined, c: [undefined, 'x'] }))));
});

test('venture.money.export carries the signed receipts, and scripts/verify-receipts.mjs checks that file offline', async () => {
  const env = await signing();
  const receipt = await quote(env);
  await sumReceipt(env.deps, owner, env.venture.id, owedPlan(env.store.read(), env.venture, null));
  await workReceipt(env);
  const exported = await ask<MoneyExportFile>(env, money, 'venture.money.export', { month: '2026-10' });
  const file = exported.receipts!;
  assert.equal(file.format, SIGNED_RECEIPTS_FORMAT);
  assert.ok(file.receipts.length >= 3);
  assert.equal(JSON.stringify(exported).includes(env.seed), false);
  const folder = await mkdtemp(join(tmpdir(), 'chausar-receipts-'));
  try {
    const path = join(folder, 'receipts.json');
    await writeFile(path, JSON.stringify(file, null, 2));
    const total = file.receipts.length;
    const good = script(path);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, new RegExp(`${total} of ${total} receipts match their signatures\\.`));
    assert.match(good.stdout, /The signer was not checked/, 'without --key the script says who signed was not checked');
    const pinned = script(path, `--key=${file.publicKey}`);
    assert.equal(pinned.status, 0, pinned.stderr);
    assert.doesNotMatch(pinned.stdout, /signer was not checked/);
    const otherKey = script(path, '--key=MCowBQYDK2VwAyEA' + 'A'.repeat(43) + '=');
    assert.equal(otherKey.status, 1);
    assert.match(otherKey.stdout, /not the key you gave/);
    const changed = JSON.parse(await readFile(path, 'utf8'));
    changed.receipts.find((item: any) => item.id === receipt.id).receipt.totalMinor = '1';
    await writeFile(path, JSON.stringify(changed));
    const bad = script(path);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, new RegExp(`CHANGED ${receipt.id}`));
    assert.match(bad.stdout, new RegExp(`${total - 1} of ${total} receipts match their signatures\\.`));
    await writeFile(path, 'not json');
    assert.equal(script(path).status, 2);
    assert.equal(script().status, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('the sum receipt the owner reads is the signed one: the same addends make no second signature', async () => {
  const env = await signing();
  const first = await sumReceipt(env.deps, owner, env.venture.id, owedPlan(env.store.read(), env.venture, null));
  const again = await sumReceipt(env.deps, owner, env.venture.id, owedPlan(env.store.read(), env.venture, null));
  assert.equal(first.id, again.id);
  assert.equal(signatures(env).filter(item => item.receiptId === first.id).length, 1);
  const served = await ask<SumReceiptRecord & { signature?: ReceiptSignature }>(env, money, 'venture.receipt.get', { id: first.id });
  assert.ok(served.signature);
  assert.equal(JSON.stringify(await ask(env, views, 'venture.journal.list')).includes(env.seed), false);
});

test('the first signing time is pinned on the venture record with an HMAC: deleting every key cannot make a changed receipt "unsigned"', async () => {
  const env = await signing();
  const receipt = await quote(env);
  const venture = () => [...env.store.read().conversations].reverse().find((item: any) => item.kind === 'venture-record') as any;
  assert.match(venture().signingSince.mac, /^[0-9a-f]{64}$/);
  // Its signature and every key record taken away: still changed, never "made before signing" or "no key here".
  await env.store.update(state => {
    state.conversations = state.conversations.filter((item: any) => item.kind !== 'venture-signing-key' && item.kind !== 'venture-receipt-signature');
  });
  const view = await verifyReceipt(env, receipt.id);
  assert.deepEqual([view.valid, view.line], [false, UNSIGNED_SINCE_LINE]);
  // The pin moved later, to pass the receipt off as older: its HMAC no longer holds, so it fails closed.
  await env.store.update(state => {
    const record = [...state.conversations].reverse().find((item: any) => item.kind === 'venture-record') as any;
    record.signingSince = { ...record.signingSince, at: '2099-01-01T00:00:00.000Z' };
  });
  assert.deepEqual([(await verifyReceipt(env, receipt.id)).valid, (await verifyReceipt(env, receipt.id)).line], [false, UNSIGNED_SINCE_LINE]);
});

test('4J22a: verify names its reason as a code, so only a real mismatch reads as one on screen', async () => {
  const env = await setup();
  const early = await quote(env);
  assert.equal((await verifyReceipt(env, early.id)).reason, 'no-key');
  env.advance(60_000);
  env.deps.secrets.set('receipt:signing', randomBytes(32).toString('hex'));
  const later = await quote(env, '2');
  assert.equal((await verifyReceipt(env, early.id)).reason, 'unsigned-old');
  assert.equal((await verifyReceipt(env, later.id)).reason, 'signed');
  const edited = await quote(env, '3');
  await env.store.update(state => { state.conversations = state.conversations.map((item: any) => (item.id === edited.id ? { ...item, explanation: `${item.explanation} (edited)` } : item)); });
  const changed = await verifyReceipt(env, edited.id);
  assert.deepEqual([changed.valid, changed.reason, changed.line], [false, 'changed', CHANGED_LINE]);
  await env.store.update(state => { state.conversations = state.conversations.filter((item: any) => !(item.kind === 'venture-receipt-signature' && item.receiptId === later.id)); });
  assert.equal((await verifyReceipt(env, later.id)).reason, 'unsigned-since');
  const fourth = await quote(env, '4');
  await env.store.update(state => { state.conversations = state.conversations.filter((item: any) => item.kind !== 'venture-signing-key'); });
  assert.equal((await verifyReceipt(env, fourth.id)).reason, 'key-gone');
});
