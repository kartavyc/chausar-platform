// Ink v2 wave 4, package 4J10 (H26): the chained journal. Every item of the journal (each step of an entry or a post, a
// website edit's log line, the per-target outcomes and end states, each tool call a saved rule allowed) is one link:
// seq, prevDigest and digest (sha256 over the link's canonical JSON), with the item's own digest in it. venture.journal
// .chain {} checks it; a gap or an item edited in the store marks it corrupt from the first bad entry, and every
// journalled action is then refused JOURNAL_CORRUPT, phone alerts included. The owner may accept the break (app only,
// owner only, with the digest seen), which starts a new chain with a line that says so. Nothing here reaches a network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHash, generateKeyPairSync, sign as signData } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { JournalChainRecord, JournalChainView, JournalEntry, JournalRecord, NotifySettingsRecord, VentureDeps, WebPushPort } from '../runtime/venture/contracts.ts';
import { DEFAULT_NOTIFY_SETTINGS } from '../runtime/venture/notify/settings.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { applyAction, approveAction, journalled, proposeAction, rejectAction, resolveUnknown, sweepJournal, type ProposeInput } from '../runtime/venture/journal/journal.ts';
import { CHAIN_GENESIS, chainItems, corruptLine, pinFor } from '../runtime/venture/journal/chain.ts';
import { deliveriesSettled, handlers as notify, notifyRefresh } from '../runtime/venture/notify/index.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { owner as viewsOwner, seedBlueprint, setup as viewsSetup, type Env } from './venture-views-env.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agent: Context = { ...owner, channel: 'mcp' };
const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const START = Date.parse('2026-10-21T10:00:00.000Z');

/** The head key VentureHost derives from the vault's own key (journal:head), on a shelf of its own. */
const HEAD_KEY = createHash('sha256').update('test journal head key').digest('hex');
function setup(headKey: string | null = HEAD_KEY) {
  const store = new VentureTestStore();
  let time = START;
  const secrets = { get: (name: string) => (name === 'journal:head' ? headKey : null) };
  const deps = { store, clock: () => new Date(time), secrets } as unknown as VentureDeps;
  return { store, deps, advance: (ms: number) => { time += ms; } };
}

async function seed(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: null,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
}

const write = (subject: string, over: Partial<ProposeInput> = {}): ProposeInput => ({
  action: 'connector.write', subject, target: 'Mail app', actionDigest: createHash('sha256').update(subject).digest('hex'), line: 'Send the reminder email.',
  operation: 'send-deliverable', ...over,
});
const applied = async () => ({ outcome: 'applied' as const, line: 'Sent.', value: 'sent' });
const chainOf = (store: VentureTestStore) => listRecords(store.read(), 'venture-journal-chain')[0] as JournalChainRecord | undefined;
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> =>
  (views as Record<string, (d: unknown, c: Context, p: unknown) => Promise<unknown>>)[method](deps, ctx, payload) as Promise<T>;
const chain = (deps: VentureDeps, ctx: Context = owner) => call<JournalChainView>(deps, 'venture.journal.chain', {}, ctx);

/** Edits the stored copy directly, as a broken disk or a hand edit would: no Chausar write runs. */
async function tamper(store: VentureTestStore, change: (state: any) => void) {
  await store.update(state => { change(state); });
}

// ---------------------------------------------------------------------------
// The chain itself
// ---------------------------------------------------------------------------

test('every journal write is chained: seq from 1, each prevDigest the link before it, each digest sha256 over the link', async () => {
  const { deps, store } = setup();
  await seed(deps);
  assert.equal(chainOf(store), undefined, 'no chain before the first journalled write');
  const fresh = await chain(deps);
  assert.deepEqual([fresh.state, fresh.entries, fresh.firstBadSeq], ['ok', 0, null]);

  await journalled(deps, owner, write('reminder_1'), applied);
  const proposed = await proposeAction(deps, agent, write('reminder_2'));
  await rejectAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });

  const record = chainOf(store)!;
  assert.ok(record, 'one chain record for the business');
  assert.equal(listRecords(store.read(), 'venture-journal-chain').length, 1);
  // described, approved, applied for the first; described, rejected for the second.
  assert.deepEqual(record.links.map(link => link.seq), [1, 2, 3, 4, 5]);
  let previous = CHAIN_GENESIS;
  for (const link of record.links) {
    assert.equal(link.prevDigest, previous, `link ${link.seq} follows the one before it`);
    const { digest: own, ...rest } = link;
    assert.equal(own, digest(rest), `link ${link.seq} digest is sha256 over its canonical JSON`);
    assert.match(link.body, /^[0-9a-f]{64}$/);
    previous = own;
  }
  const entryIds = new Set(listRecords(store.read(), 'venture-journal-entry').map(entry => entry.id));
  for (const link of record.links) assert.ok(entryIds.has(link.item.split('#')[0]), `${link.item} names its entry`);

  const view = await chain(deps);
  assert.deepEqual([view.state, view.entries, view.firstBadSeq], ['ok', 5, null]);
  assert.equal(view.line, 'Chausar\'s record of outside actions adds up: 5 entries, each one checked against the one before it.');
  assert.match(view.digest, /^[0-9a-f]{64}$/);
  // A read never writes: the chain is checked, not changed.
  assert.equal(chainOf(store)!.links.length, 5);
});

test('the chain covers every kind of entry: posts, phone alerts, credit notes, website edits and the steps a saved rule allowed', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('credit_1', { action: 'credit.issue', target: 'Cafe Aroma Demo', line: 'Issue the credit note.' }), applied);
  await ventureAction(deps, owner, 'prepare', 'seed.post', tx => tx.put({
    ...tx.base('venture-connector-post'), connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Asha', text: 'Our new hours.', agent: null, digest: 'd'.repeat(64),
    state: 'described', describe: 'Post to LinkedIn as Asha', risk: null, claimedAt: null, decidedBy: null, outcome: null,
    journal: [{ state: 'described', at: tx.now, by: 'owner', line: 'Post to LinkedIn as Asha' }], approval: null, expiresAt: tx.now,
  } as any));
  await ventureAction(deps, owner, 'prepare', 'seed.edit', tx => tx.put({
    ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:/site' }, path: 'index.html', summary: 'New hours',
    before: 'a', after: 'b', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'staged',
    log: [{ at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New hours' }],
  } as any));
  await ventureAction(deps, owner, 'prepare', 'seed.run', tx => tx.put({
    ...tx.base('venture-delivery-run'), orderId: 'order_1', playbookId: 'playbook_1', playbookHash: 'h', status: 'running', servedBy: 'model', practice: false,
    callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
    harness: { toolCalls: [
      { id: 'call_1', turn: 1, tool: 'files.read', input: {}, inputDigest: 'i1', startedAt: tx.now, allowedBy: { rule: 'auto', stepId: 'step_1' } },
      { id: 'call_2', turn: 1, tool: 'files.read', input: {}, inputDigest: 'i2', startedAt: tx.now },
    ] },
  } as any));
  // A phone alert, journalled under the owner's standing setting (4G3).
  await journalled(deps, owner, write('notify-push:alert_1:1', { action: 'notify.push', target: 'fcm.googleapis.com', line: 'Send phone alert (3)' }), applied,
    { standing: { line: 'Sent under your phone alert setting.' } });

  const items = chainOf(store)!.links.map(link => link.item);
  const post = listRecords(store.read(), 'venture-connector-post')[0];
  const edit = listRecords(store.read(), 'venture-site-edit')[0];
  const run = listRecords(store.read(), 'venture-delivery-run')[0];
  assert.ok(items.includes(`${post.id}#0`), 'the post step');
  assert.ok(items.includes(`${edit.id}#0`), 'the website edit log line');
  assert.ok(items.includes(`${run.id}@call_1`), 'the call a saved rule allowed');
  assert.ok(!items.includes(`${run.id}@call_2`), 'a call that asked is not a journal entry');
  const actions = listRecords(store.read(), 'venture-journal-entry').map(entry => entry.action).sort();
  assert.deepEqual(actions, ['credit.issue', 'notify.push']);
  for (const entry of listRecords(store.read(), 'venture-journal-entry')) for (let index = 0; index < entry.journal.length; index += 1) assert.ok(items.includes(`${entry.id}#${index}`));
  assert.equal((await chain(deps)).state, 'ok');
});

// ---------------------------------------------------------------------------
// Corrupt: an edit, a gap, an item added outside Chausar
// ---------------------------------------------------------------------------

test('an entry edited in the store marks the chain corrupt from its link, and every journalled action is then refused', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  const waiting = await proposeAction(deps, agent, write('reminder_2'));
  const approvedEntry = await proposeAction(deps, agent, write('reminder_3'));
  const { token } = await approveAction(deps, owner, { entryId: approvedEntry.id, digest: approvedEntry.actionDigest });
  // links: 1-3 the first entry, 4 reminder_2 described, 5 reminder_3 described, 6 reminder_3 approved.
  const first = listRecords(store.read(), 'venture-journal-entry')[0];
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.id === first.id) as JournalRecord;
    record.journal[1].line = 'Someone changed what was approved.';
  });

  const view = await chain(deps);
  assert.deepEqual([view.state, view.firstBadSeq], ['corrupt', 2]);
  assert.equal(view.line, corruptLine(2));
  assert.equal(corruptLine(41), 'Chausar\'s record of outside actions doesn\'t add up from entry 41, so nothing more goes out until you look.');

  const ran: string[] = [];
  const effect = async () => { ran.push('ran'); return { outcome: 'applied' as const, line: 'Sent.', value: 'sent' }; };
  await assert.rejects(proposeAction(deps, agent, write('reminder_4')), code('JOURNAL_CORRUPT'));
  await assert.rejects(journalled(deps, owner, write('reminder_5'), effect), (error: any) => {
    assert.equal(error.code, 'JOURNAL_CORRUPT');
    assert.equal(error.message, corruptLine(2));
    return true;
  });
  await assert.rejects(approveAction(deps, owner, { entryId: waiting.id, digest: waiting.actionDigest }), code('JOURNAL_CORRUPT'));
  await assert.rejects(applyAction(deps, owner, { entryId: approvedEntry.id, token, idempotencyKey: 'once' }, effect), code('JOURNAL_CORRUPT'));
  assert.deepEqual(ran, [], 'nothing ran');
  const still = listRecords(store.read(), 'venture-journal-entry').find(entry => entry.id === approvedEntry.id)!;
  assert.equal(still.claimedAt, null, 'the approved action was not even claimed');
  assert.equal(listRecords(store.read(), 'venture-journal-entry').length, 3, 'no refused proposal was recorded');

  // Settling what is already there still works: a refusal, the sweep. Nothing of it goes out.
  await rejectAction(deps, owner, { entryId: waiting.id, digest: waiting.actionDigest });
  assert.equal((await chain(deps)).firstBadSeq, 2, 'still corrupt from the same entry');
});

test('a gap (a link removed) and a step added outside Chausar each mark the chain corrupt', async () => {
  const gap = setup();
  await seed(gap.deps);
  await journalled(gap.deps, owner, write('reminder_1'), applied);
  await journalled(gap.deps, owner, write('reminder_2'), applied);
  await tamper(gap.store, state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-chain') as JournalChainRecord;
    record.links.splice(3, 1);
  });
  const gapView = await chain(gap.deps);
  assert.deepEqual([gapView.state, gapView.firstBadSeq], ['corrupt', 4]);

  const added = setup();
  await seed(added.deps);
  await journalled(added.deps, owner, write('reminder_1'), applied);
  await tamper(added.store, state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-entry') as JournalRecord;
    record.journal.push({ state: 'applied', at: record.at, by: 'owner', line: 'Sent again.' });
  });
  const addedView = await chain(added.deps);
  assert.deepEqual([addedView.state, addedView.firstBadSeq], ['corrupt', 4], 'from the entry after the newest link');

  const removed = setup();
  await seed(removed.deps);
  await journalled(removed.deps, owner, write('reminder_1'), applied);
  await journalled(removed.deps, owner, write('reminder_2'), applied);
  const firstId = listRecords(removed.store.read(), 'venture-journal-entry')[0].id;
  await tamper(removed.store, state => { state.conversations = state.conversations.filter((item: any) => item.id !== firstId); });
  assert.deepEqual([(await chain(removed.deps)).state, (await chain(removed.deps)).firstBadSeq], ['corrupt', 1], 'a deleted entry: from its first link');
});

test('an edit found by a later write stays found: the engine settling that record does not hide it', async () => {
  const { deps, store, advance } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, write('reminder_1'));
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.id === proposed.id) as JournalRecord;
    record.journal[0].line = 'Pay someone else.';
  });
  advance(16 * 60_000);
  const swept = await sweepJournal(deps, owner, { claimLimitMs: 60_000 });
  assert.equal(swept.length, 1, 'the sweep still settles it');
  const view = await chain(deps);
  assert.deepEqual([view.state, view.firstBadSeq], ['corrupt', 1]);
});

test('a journal with entries made before the chain is adopted once, on its first chained write', async () => {
  const { deps, store } = setup();
  await seed(deps);
  // An entry from before 4J10: in the store, with no chain record anywhere.
  await tamper(store, state => {
    state.conversations.push({
      id: 'journal_old', kind: 'venture-journal-entry', ventureId: state.conversations[0].ventureId, memberId: 'owner', epoch: 1, at: new Date(START).toISOString(),
      action: 'invoice.issue', subject: 'invoice_old', target: 'Cafe', actionDigest: 'a'.repeat(64), describe: 'Issue', agent: null, shadow: false, quote: null,
      state: 'applied', claimedAt: null, decidedBy: 'owner', outcome: null, receiptId: null, approval: null, expiresAt: new Date(START).toISOString(),
      journal: [{ state: 'described', at: new Date(START).toISOString(), by: 'owner', line: 'Issue' }, { state: 'applied', at: new Date(START).toISOString(), by: 'engine', line: 'Issued.' }],
    });
  });
  assert.equal((await chain(deps)).state, 'ok', 'nothing to check yet');
  await journalled(deps, owner, write('reminder_1'), applied);
  const items = chainOf(store)!.links.map(link => link.item);
  assert.deepEqual(items.slice(0, 2), ['journal_old#0', 'journal_old#1'], 'the older entry is linked first');
  assert.equal((await chain(deps)).entries, 5);
});

// ---------------------------------------------------------------------------
// Accepting a break
// ---------------------------------------------------------------------------

test('acceptBreak: app only, owner only, with the digest seen; a new chain starts with a line that says so', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await store.update(state => { state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: [] }); });
  await journalled(deps, owner, write('reminder_1'), applied);
  await journalled(deps, owner, write('reminder_2'), applied);
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-entry') as JournalRecord;
    record.target = 'Someone else';
  });
  const seen = await chain(deps);
  assert.deepEqual([seen.state, seen.firstBadSeq], ['corrupt', 1]);

  const accept = (payload: unknown, ctx: Context = owner) => call<JournalChainView>(deps, 'venture.journal.acceptBreak', payload, ctx);
  await assert.rejects(accept({ digest: seen.digest }, agent), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(accept({ digest: seen.digest }, partner), code('FORBIDDEN'));
  await assert.rejects(accept({ digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(accept({}), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(accept({ digest: seen.digest, extra: 1 }), code('INVALID_VENTURE_REQUEST'));

  const after = await accept({ digest: seen.digest });
  assert.equal(after.state, 'ok');
  assert.equal(after.firstBadSeq, null);
  const record = chainOf(store)!;
  const accepted = record.breaks.at(-1)!;
  assert.deepEqual([accepted.fromSeq, accepted.startSeq, accepted.by], [1, 7, 'owner']);
  assert.equal(accepted.line, 'You accepted a break in Chausar\'s record of outside actions from entry 1. A new record starts at entry 7; what came before it was not checked again.');
  assert.match(after.line, /A new record started at entry 7, after the break you accepted from entry 1\./);
  // The new chain starts from the break, and every item there now is linked again in it.
  const fresh = record.links.filter(link => link.seq >= 7);
  assert.equal(fresh[0].prevDigest, accepted.digest);
  assert.equal(fresh.length, 6);
  // The journal shows the break as its own line, and the decision is recorded.
  const listed = (await call<{ entries: JournalEntry[] }>(deps, 'venture.journal.list', {})).entries;
  assert.ok(listed.some(entry => entry.line === accepted.line), 'the journal says so');
  const decisions = listRecords(store.read(), 'venture-decision');
  assert.equal(decisions.at(-1)!.action, 'accept-break');
  assert.equal(decisions.at(-1)!.reason, accepted.line);
  // Nothing to accept now; and journalled actions go out again.
  await assert.rejects(accept({ digest: after.digest }), code('INVALID_VENTURE_REQUEST'));
  await journalled(deps, owner, write('reminder_3'), applied);
  assert.equal((await chain(deps)).state, 'ok');
});

test('an unknown outcome can still be resolved while the chain is corrupt: recording what the owner found sends nothing', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), async () => ({ outcome: 'unknown' as const, line: 'No answer.', value: null }));
  const unknown = listRecords(store.read(), 'venture-journal-entry')[0];
  assert.equal(unknown.state, 'outcome_unknown');
  await journalled(deps, owner, write('reminder_2'), applied);
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-entry' && item.subject === 'reminder_2') as JournalRecord;
    record.journal[0].by = 'agent';
  });
  assert.equal((await chain(deps)).state, 'corrupt');
  const resolved = await resolveUnknown(deps, owner, { entryId: unknown.id, found: 'not-applied' });
  assert.equal(resolved.state, 'rejected');
});

// ---------------------------------------------------------------------------
// Phone alerts stop too (4G3's delivery halts on a journal refusal)
// ---------------------------------------------------------------------------

const RELAY = 'https://ntfy.sh/chausar-ledger-7f3a';
function network() {
  const sent: PinnedTarget[] = [];
  return {
    sent,
    net: {
      resolve: async () => [{ address: '159.203.148.75', family: 4 as const }],
      send: async (target: PinnedTarget) => { sent.push(target); return { status: 200, headers: {}, body: Buffer.alloc(0) }; },
    },
  };
}
async function look(deps: VentureDeps) {
  const result = await notifyRefresh(deps, viewsOwner);
  await deliveriesSettled();
  return result;
}
async function breakChain(env: Env) {
  await journalled(env.deps, viewsOwner, write('reminder_1'), applied);
  await env.store.update(state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-entry' && item.subject === 'reminder_1') as JournalRecord;
    record.describe = 'Changed by hand.';
  });
}

test('a broken chain stops phone alerts too: the relay gets nothing and the items wait; after the owner accepts the break they go', async () => {
  const env = await viewsSetup();
  const { net, sent } = network();
  const deps: VentureDeps = { ...env.deps, host: 'test', net };
  // The tray off, so the relay is the only way the count leaves (as in venture-relay.test.ts).
  await ventureAction(env.deps, viewsOwner, 'approve', 'seed.tray-off', tx => {
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...DEFAULT_NOTIFY_SETTINGS, tray: false });
  });
  await (notify['venture.notify.relay'] as (d: unknown, c: Context, p: unknown) => Promise<unknown>)(deps, viewsOwner, { url: RELAY });
  await breakChain(env);
  assert.equal((await chain(env.deps, viewsOwner)).state, 'corrupt');
  await seedBlueprint(env, { status: 'draft' });
  const halted = await look(deps);
  assert.deepEqual(halted.alert, { count: 3 }, 'the centre still counts');
  assert.equal(sent.length, 0, 'nothing reached the relay');
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry', env.venture.id).filter(entry => entry.action === 'notify.relay').length, 0, 'not even proposed');
  const marks = listRecords(env.store.read(), 'venture-notification', env.venture.id).map(record => record.alert ?? null);
  assert.ok(marks.every(mark => mark === null), 'the items wait');

  const seen = await chain(env.deps, viewsOwner);
  await call(env.deps, 'venture.journal.acceptBreak', { digest: seen.digest }, viewsOwner);
  env.advance(11 * 60_000);
  assert.deepEqual((await look(deps)).alert, { count: 3 });
  assert.equal(sent.length, 1, 'once the owner looked, the alert went');
});

test('a broken chain stops web push on the hosted app too: no browser gets the count until the owner accepts the break', async () => {
  const env = await viewsSetup();
  const { net, sent } = network();
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const raw = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(raw.x, 'base64url'), Buffer.from(raw.y, 'base64url')]);
  const port: WebPushPort = { publicKey: point.toString('base64url'), subject: 'mailto:owner@example.com', sign: data => signData('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' }) };
  const web: Context = { ...viewsOwner, channel: 'web' };
  const deps: VentureDeps = { ...env.deps, host: 'hosted-web', push: port, net, ownerContext: () => web };
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: Buffer.from('0123456789abcdef').toString('base64url') }, expirationTime: null };
  const session = createHash('sha256').update('session one').digest('hex');
  await (notify['venture.notify.push.subscribe'] as (d: unknown, c: Context, p: unknown) => Promise<unknown>)(deps, web, { subscription, session });
  await breakChain(env);
  await seedBlueprint(env, { status: 'draft' });
  const looked = await notifyRefresh(deps, web);
  await deliveriesSettled();
  assert.deepEqual(looked.alert, { count: 3 });
  assert.equal(sent.length, 0, 'no push left the server');
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry', env.venture.id).filter(entry => entry.action === 'notify.push').length, 0);

  const seen = await chain(env.deps, viewsOwner);
  await call(env.deps, 'venture.journal.acceptBreak', { digest: seen.digest }, viewsOwner);
  env.advance(11 * 60_000);
  await notifyRefresh(deps, web);
  await deliveriesSettled();
  assert.equal(sent.length, 1, 'once the owner looked, the push went');
});

// ---------------------------------------------------------------------------
// The reviewer's probes: nothing added or cut outside Chausar is laundered by a later write
// ---------------------------------------------------------------------------

test('probe 1: a step pushed outside Chausar onto a linked entry stays unlinked when the engine settles that entry', async () => {
  const { deps, store, advance } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, write('reminder_1'));
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.id === proposed.id) as JournalRecord;
    record.journal.push({ state: 'described', at: record.at, by: 'owner', line: 'Also pay someone else.' });
  });
  advance(16 * 60_000);
  assert.equal((await sweepJournal(deps, owner, { claimLimitMs: 60_000 })).length, 1, 'the sweep still settles it');
  const record = chainOf(store)!;
  assert.ok(!record.links.some(link => link.item === `${proposed.id}#1`), 'the pushed step was never linked');
  assert.ok(record.links.some(link => link.item === `${proposed.id}#2`), "the sweep's own step was");
  assert.deepEqual([(await chain(deps)).state, (await chain(deps)).firstBadSeq], ['corrupt', 3], 'from the entry after the newest link');
});

/** A journal entry as one put in outside Chausar would look. */
function outsideEntry(ventureId: string, id: string) {
  const at = new Date(START).toISOString();
  return {
    id, kind: 'venture-journal-entry', ventureId, memberId: 'owner', epoch: 1, at, action: 'connector.write', subject: id, target: 'Mail app',
    actionDigest: 'f'.repeat(64), describe: 'Send money elsewhere.', agent: null, shadow: false, quote: null, state: 'described', claimedAt: null, decidedBy: null,
    outcome: null, receiptId: null, approval: null, expiresAt: new Date(START + 15 * 60_000).toISOString(), journal: [{ state: 'described', at, by: 'owner', line: 'Send money elsewhere.' }],
  };
}

test('probe 2: a whole entry put in outside Chausar after the chain exists is corrupt at once', async () => {
  const { deps, store } = setup();
  const venture = await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await tamper(store, state => { state.conversations.push(outsideEntry(venture.id, 'journal_outside')); });
  const view = await chain(deps);
  assert.deepEqual([view.state, view.firstBadSeq], ['corrupt', 4]);
  await assert.rejects(proposeAction(deps, agent, write('reminder_2')), code('JOURNAL_CORRUPT'));
});

test('probe 3: an entry put in outside Chausar is not adopted when the engine later writes to it', async () => {
  const { deps, store, advance } = setup();
  const venture = await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await tamper(store, state => { state.conversations.push(outsideEntry(venture.id, 'journal_outside')); });
  advance(16 * 60_000);
  const swept = await sweepJournal(deps, owner, { claimLimitMs: 60_000 });
  assert.deepEqual(swept.map(item => item.id), ['journal_outside']);
  const items = chainOf(store)!.links.map(link => link.item);
  assert.ok(!items.includes('journal_outside#0'), 'what came from outside is never linked');
  assert.equal((await chain(deps)).state, 'corrupt');
});

test('probe 4: a chain record deleted, or cut short at its end, is corrupt, and the next write does not start a clean one', async () => {
  const deleted = setup();
  await seed(deleted.deps);
  await journalled(deleted.deps, owner, write('reminder_1'), applied);
  await tamper(deleted.store, state => { state.conversations = state.conversations.filter((item: any) => item.kind !== 'venture-journal-chain'); });
  assert.deepEqual([(await chain(deleted.deps)).state, (await chain(deleted.deps)).firstBadSeq], ['corrupt', 1]);
  await assert.rejects(journalled(deleted.deps, owner, write('reminder_2'), applied), code('JOURNAL_CORRUPT'));
  await sweepJournal(deleted.deps, owner, { claimLimitMs: 60_000 });
  assert.equal(chainOf(deleted.store), undefined, 'no new chain was made over the loss');
  // Accepting it starts a new record after the newest entry the business was known to have.
  const seen = await chain(deleted.deps);
  const after = await call<JournalChainView>(deleted.deps, 'venture.journal.acceptBreak', { digest: seen.digest });
  assert.equal(after.state, 'ok');
  assert.equal(chainOf(deleted.store)!.breaks[0].startSeq, 4);

  const cut = setup();
  await seed(cut.deps);
  await journalled(cut.deps, owner, write('reminder_1'), applied);
  await journalled(cut.deps, owner, write('reminder_2'), applied);
  const second = listRecords(cut.store.read(), 'venture-journal-entry').find(entry => entry.subject === 'reminder_2')!;
  // The newest entry and its three links taken away together, as a tail cut would.
  await tamper(cut.store, state => {
    state.conversations = state.conversations.filter((item: any) => item.id !== second.id);
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-chain') as JournalChainRecord;
    record.links.splice(3);
  });
  assert.deepEqual([(await chain(cut.deps)).state, (await chain(cut.deps)).firstBadSeq], ['corrupt', 4], 'the pinned head says three entries went');
});

test('the digest the owner accepts names every item that does not add up: a new bad item after the look is stale', async () => {
  const { deps, store } = setup();
  const venture = await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await tamper(store, state => { state.conversations.push(outsideEntry(venture.id, 'journal_outside_1')); });
  const seen = await chain(deps);
  await tamper(store, state => { state.conversations.push(outsideEntry(venture.id, 'journal_outside_2')); });
  const now = await chain(deps);
  assert.equal(now.firstBadSeq, seen.firstBadSeq, 'the same first bad entry');
  assert.notEqual(now.digest, seen.digest, 'but not the same break');
  await assert.rejects(call(deps, 'venture.journal.acceptBreak', { digest: seen.digest }), code('APPROVAL_STALE'));
});

// ---------------------------------------------------------------------------
// The re-review's probes: the pin is HMAC'd, and every link is digested on every check
// ---------------------------------------------------------------------------

/** The newest venture record in a state, to edit its pin. */
const ventureIn = (state: any) => [...state.conversations].reverse().find((item: any) => item.kind === 'venture-record');

test('probe 2b: a chain cut short with its pin forged to match is corrupt, because the pin carries an HMAC', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await journalled(deps, owner, write('reminder_2'), applied);
  assert.match(ventureIn(store.read()).journalHead.mac, /^[0-9a-f]{64}$/, 'the pin is HMAC\'d with the head key');
  const second = listRecords(store.read(), 'venture-journal-entry').find(entry => entry.subject === 'reminder_2')!;
  await tamper(store, state => {
    state.conversations = state.conversations.filter((item: any) => item.id !== second.id);
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-chain') as JournalChainRecord;
    record.links.splice(3);
    // The pin rewritten to the new end, with the HMAC an attacker without the key can only guess.
    ventureIn(state).journalHead = { seq: 3, digest: record.links[2].digest, mac: 'f'.repeat(64) };
  });
  assert.deepEqual([(await chain(deps)).state, (await chain(deps)).firstBadSeq], ['corrupt', 1]);
  // The same pin rewritten with no HMAC at all is no better.
  await tamper(store, state => { delete ventureIn(state).journalHead.mac; });
  assert.equal((await chain(deps)).state, 'corrupt');
  // With the right key the pin would hold: what the HMAC binds is the head itself.
  const record = listRecords(store.read(), 'venture-journal-chain')[0] as JournalChainRecord;
  const venture = ventureIn(store.read());
  assert.equal(pinFor(HEAD_KEY, venture.id, { seq: 3, digest: record.links[2].digest }).mac!.length, 64);
});

test('probe 3b: a pin deleted from the venture record is corrupt while the chain has links', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await tamper(store, state => { delete ventureIn(state).journalHead; });
  assert.deepEqual([(await chain(deps)).state, (await chain(deps)).firstBadSeq], ['corrupt', 1]);
  await assert.rejects(journalled(deps, owner, write('reminder_2'), applied), code('JOURNAL_CORRUPT'));
  // Without the head key (a store that cannot derive one) the pin has no HMAC and a missing pin cannot be told apart.
  const plain = setup(null);
  await seed(plain.deps);
  await journalled(plain.deps, owner, write('reminder_1'), applied);
  assert.equal(ventureIn(plain.store.read()).journalHead.mac, undefined);
  assert.equal((await chain(plain.deps)).state, 'ok');
});

test('probe 6: links are digested on every check, so an entry swapped for another with its links rewritten shows', async () => {
  const { deps, store } = setup();
  const venture = await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await journalled(deps, owner, write('reminder_2'), applied);
  assert.equal((await chain(deps)).state, 'ok', 'checked once, so a skip of older links would now apply');
  const first = listRecords(store.read(), 'venture-journal-entry').find(entry => entry.subject === 'reminder_1')!;
  // Swap the first entry for a forged one with as many steps, and point its links at the forgery, digests left alone.
  const forged = { ...structuredClone(first), id: 'journal_forged', describe: 'Send money elsewhere.', target: 'Someone else' };
  const items = chainItems(forged as any);
  await tamper(store, state => {
    state.conversations = state.conversations.filter((item: any) => item.id !== first.id);
    state.conversations.push(forged);
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-chain') as JournalChainRecord;
    for (let index = 0; index < items.length; index += 1) {
      record.links[index].item = items[index].key;
      record.links[index].body = items[index].body;
    }
  });
  assert.deepEqual([(await chain(deps)).state, (await chain(deps)).firstBadSeq], ['corrupt', 1]);
  assert.equal(venture.id, ventureIn(store.read()).id);
});

test('a commit Chausar sealed from a sound state is remembered as sound, and a tamper after it is still caught', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await journalled(deps, owner, write('reminder_2'), applied);
  assert.equal((await chain(deps)).state, 'ok');
  await tamper(store, state => {
    const record = state.conversations.find((item: any) => item.kind === 'venture-journal-entry' && item.subject === 'reminder_2') as JournalRecord;
    record.journal[2].line = 'Sent to someone else.';
  });
  assert.equal((await chain(deps)).state, 'corrupt', 'a write outside Chausar makes a revision no seal vouched for');
  await assert.rejects(journalled(deps, owner, write('reminder_3'), applied), code('JOURNAL_CORRUPT'));
});

test('probe 2c: the chain record and the pin deleted together still read corrupt, because the linked records are stamped', async () => {
  for (const key of [HEAD_KEY, null]) {
    const { deps, store } = setup(key);
    await seed(deps);
    await journalled(deps, owner, write('reminder_1'), applied);
    const stamped = listRecords(store.read(), 'venture-journal-entry')[0];
    assert.equal(stamped.chainSeq, 1, 'the entry carries the seq of its first link');
    await tamper(store, state => {
      state.conversations = state.conversations.filter((item: any) => item.kind !== 'venture-journal-chain');
      delete ventureIn(state).journalHead;
    });
    assert.deepEqual([(await chain(deps)).state, (await chain(deps)).firstBadSeq], ['corrupt', 1], key ? 'with the head key' : 'without it');
    await assert.rejects(journalled(deps, owner, write('reminder_2'), applied), code('JOURNAL_CORRUPT'));
    assert.equal(listRecords(store.read(), 'venture-journal-chain').length, 0, 'no clean chain is made over the loss');
  }
  // The pin alone deleted, with no head key to sign it, reads corrupt too.
  const { deps, store } = setup(null);
  await seed(deps);
  await journalled(deps, owner, write('reminder_1'), applied);
  await tamper(store, state => { delete ventureIn(state).journalHead; });
  assert.equal((await chain(deps)).state, 'corrupt');
});
