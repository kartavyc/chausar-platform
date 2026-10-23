// P2-journal: the action journal and bound approval tokens. Every outside effect is one entry: described, then approved
// in the app with a token bound to the action digest, the member, the session and the business, then applied, rejected
// or outcome_unknown. A timeout or crash mid-send is outcome_unknown and is never run again; the owner resolves it.
// Shadow entries are only simulated, and the simulation lists what it could not simulate. No network anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_ERRORS, VENTURE_METHODS, VENTURE_RECORD_KINDS } from '../runtime/venture/contracts.ts';
import type { ConnectorPostRecord, JournalEntry, JournalRecord, SiteEditRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import {
  AGENT_WINDOW_MS, CHECK_BEFORE_RETRYING, JOURNAL_ACTIONS, applyAction, approveAction, journalled, proposeAction, rejectAction, resolveUnknown, sweepJournal,
  type ProposeInput,
} from '../runtime/venture/journal/index.ts';
import { APPROVAL_TOKEN_PATTERN, containsApprovalToken, tokenHash } from '../runtime/venture/journal/tokens.ts';
import { DEFAULT_SIMULATORS, shadowAction, simulateJournal } from '../runtime/venture/journal/simulation.ts';
import { QUOTE_TTL_MS } from '../runtime/venture/money/quote.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agent: Context = { ...owner, channel: 'mcp' };
const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const START = Date.parse('2026-10-21T10:00:00.000Z');

function setup() {
  const store = new VentureTestStore();
  let time = START;
  const deps = { store, clock: () => new Date(time) } as unknown as VentureDeps;
  return { store, deps, advance: (ms: number) => { time += ms; } };
}

async function seed(deps: VentureDeps, workingName = 'Ledger Cafe Books') {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName, country: null,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
}

async function addPartner(store: VentureTestStore) {
  await store.update(state => { state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: [] }); });
}

const input = (over: Partial<ProposeInput> = {}): ProposeInput => ({
  action: 'invoice.issue', subject: 'invoice_1', target: 'Cafe Aroma Demo', actionDigest: 'a'.repeat(64), line: 'Issue the invoice for Cafe Aroma Demo.', ...over,
});
const write = (subject: string): ProposeInput => input({ action: 'connector.write', subject, target: 'Mail app', actionDigest: createHash('sha256').update(subject).digest('hex'), line: 'Send the reminder email.' });
const entries = (store: VentureTestStore) => listRecords(store.read(), 'venture-journal-entry');
const states = (entry: { journal: { state: string }[] }) => entry.journal.map(step => step.state);

/** An effect that counts how often it ran. Typed loosely: each test returns the result shape it needs. */
function counter(result: () => Promise<any>) {
  let calls = 0;
  return { run: async (): Promise<any> => { calls += 1; return result(); }, calls: () => calls };
}

// ---------------------------------------------------------------------------
// 1. Propose, approve, apply
// ---------------------------------------------------------------------------

test('propose describes the action; approve in the app mints a token bound to it; apply runs once and records applied with its receipt', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, input({ agent: 'Books agent' }));
  assert.equal(proposed.state, 'described');
  assert.deepEqual(states(proposed), ['described']);
  assert.equal(proposed.agent, 'Books agent');
  assert.equal(proposed.approval ?? null, null);
  assert.equal(proposed.expiresAt, new Date(START + AGENT_WINDOW_MS).toISOString(), 'an agent proposal waits fifteen minutes');
  assert.equal(AGENT_WINDOW_MS, 15 * 60_000);

  await assert.rejects(approveAction(deps, agent, { entryId: proposed.id, digest: proposed.actionDigest }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(approveAction(deps, { ...owner, sourceTainted: true }, { entryId: proposed.id, digest: proposed.actionDigest }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(approveAction(deps, owner, { entryId: proposed.id, digest: 'b'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(approveAction(deps, owner, { entryId: 'journal_missing', digest: proposed.actionDigest }), code('JOURNAL_NOT_FOUND'));

  const { entry: approved, token } = await approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
  assert.equal(approved.state, 'approved');
  assert.match(token, APPROVAL_TOKEN_PATTERN);
  assert.equal(approved.approval?.tokenHash, tokenHash(token));
  assert.equal(approved.approval?.usedAt, null);
  const stored = JSON.stringify(store.read());
  assert.ok(!stored.includes(token), 'the token itself is never stored');
  assert.ok(!containsApprovalToken(stored));
  assert.ok(stored.includes(tokenHash(token)));
  await assert.rejects(approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest }), code('JOURNAL_ALREADY_DECIDED'));

  const effect = counter(async () => ({ outcome: 'applied', line: 'Issued INV-0001.', receiptId: 'price_1', value: 'issued' }));
  const done = await applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: 'issue-once' }, effect.run);
  assert.equal(done.value, 'issued');
  assert.equal(done.replayed, false);
  assert.equal(effect.calls(), 1);
  const applied = entries(store)[0];
  assert.equal(applied.state, 'applied');
  assert.deepEqual(states(applied), ['described', 'approved', 'applied']);
  assert.equal(applied.receiptId, 'price_1');
  assert.equal(applied.journal.at(-1)!.line, 'Issued INV-0001.');
  assert.equal(applied.approval?.key, 'issue-once');
  assert.ok(applied.approval?.usedAt);
});

test('the owner rejects a waiting action once; nothing runs, and a rejected action cannot be approved', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, write('reminder_1'));
  await assert.rejects(rejectAction(deps, agent, { entryId: proposed.id, digest: proposed.actionDigest }), code('APP_APPROVAL_REQUIRED'));
  const rejected = await rejectAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.outcome?.by, 'owner');
  assert.equal(rejected.decidedBy, 'owner');
  await assert.rejects(rejectAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest }), code('JOURNAL_ALREADY_DECIDED'));
  await assert.rejects(approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest }), code('JOURNAL_ALREADY_DECIDED'));
  assert.deepEqual(states(entries(store)[0]), ['described', 'rejected']);
});

// ---------------------------------------------------------------------------
// 2. Bound, single-use tokens and the idempotency key
// ---------------------------------------------------------------------------

test('a token is bound to its action, member, session and business; it is single use, and a replay with the same key never writes twice', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await addPartner(store);
  const a = await proposeAction(deps, agent, write('reminder_a'));
  const b = await proposeAction(deps, agent, write('reminder_b'));
  const { token } = await approveAction(deps, owner, { entryId: a.id, digest: a.actionDigest });
  const effect = counter(async () => ({ outcome: 'applied', line: 'Sent.', value: 1 }));

  // Bound to the action: B was never approved, and A's token does not open it.
  await assert.rejects(applyAction(deps, owner, { entryId: b.id, token, idempotencyKey: 'k-b' }, effect.run), code('JOURNAL_TOKEN_INVALID'));
  // Bound to the member and the session.
  await assert.rejects(applyAction(deps, partner, { entryId: a.id, token, idempotencyKey: 'k-a' }, effect.run), code('JOURNAL_TOKEN_INVALID'));
  await assert.rejects(applyAction(deps, { ...owner, channel: 'web' }, { entryId: a.id, token, idempotencyKey: 'k-a' }, effect.run), code('JOURNAL_TOKEN_INVALID'));
  // Bound to the business, and signed: a changed claim or a made-up token is refused.
  const [prefix, body, mac] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  assert.ok(claims.businessId.includes(listRecords(store.read(), 'venture-record')[0].id));
  const otherBusiness = Buffer.from(JSON.stringify({ ...claims, businessId: 'workspace_other:venture_other' })).toString('base64url');
  await assert.rejects(applyAction(deps, owner, { entryId: a.id, token: `${prefix}.${otherBusiness}.${mac}`, idempotencyKey: 'k-a' }, effect.run), code('JOURNAL_TOKEN_INVALID'));
  await assert.rejects(applyAction(deps, owner, { entryId: a.id, token: 'cjat1.e30.AAAA', idempotencyKey: 'k-a' }, effect.run), code('JOURNAL_TOKEN_INVALID'));
  await assert.rejects(applyAction(deps, owner, { entryId: a.id, token: '', idempotencyKey: 'k-a' }, effect.run), code('INVALID_VENTURE_REQUEST'));
  assert.equal(effect.calls(), 0);

  const first = await applyAction(deps, owner, { entryId: a.id, token, idempotencyKey: 'k-a' }, effect.run);
  assert.equal(first.replayed, false);
  const replay = await applyAction(deps, owner, { entryId: a.id, token, idempotencyKey: 'k-a' }, effect.run);
  assert.equal(replay.replayed, true);
  assert.equal(replay.entry.state, 'applied');
  assert.equal(effect.calls(), 1, 'the same key returns what happened, without running it again');
  await assert.rejects(applyAction(deps, owner, { entryId: a.id, token, idempotencyKey: 'k-other' }, effect.run), code('JOURNAL_TOKEN_USED'));

  const { token: tokenB } = await approveAction(deps, owner, { entryId: b.id, digest: b.actionDigest });
  await assert.rejects(applyAction(deps, owner, { entryId: b.id, token: tokenB, idempotencyKey: 'k-a' }, effect.run), code('JOURNAL_KEY_REUSED'));
  assert.equal(effect.calls(), 1);
});

test('agent proposals expire after fifteen minutes and quotes after an hour, with the quote binding of spend', async () => {
  const { deps, advance } = setup();
  await seed(deps);
  const late = await proposeAction(deps, agent, write('late'));
  advance(AGENT_WINDOW_MS + 1000);
  await assert.rejects(approveAction(deps, owner, { entryId: late.id, digest: late.actionDigest }), code('JOURNAL_EXPIRED'));

  const slow = await proposeAction(deps, agent, write('slow'));
  const { token } = await approveAction(deps, owner, { entryId: slow.id, digest: slow.actionDigest });
  advance(AGENT_WINDOW_MS + 1000);
  await assert.rejects(applyAction(deps, owner, { entryId: slow.id, token, idempotencyKey: 'slow' }, async () => ({ outcome: 'applied', line: 'Sent.', value: null })), code('JOURNAL_EXPIRED'));

  const quote = { figure: '1000', payer: 'anthropic-sonnet-5-5' };
  const send = await proposeAction(deps, agent, input({ action: 'delivery.send', subject: 'run_1:call_1', target: 'Cafe Aroma Demo', line: 'Send the next step to your AI.', quote }));
  assert.equal(send.expiresAt, new Date(Date.parse(send.at) + QUOTE_TTL_MS).toISOString());
  assert.deepEqual(send.quote, quote);
  await assert.rejects(approveAction(deps, owner, { entryId: send.id, digest: send.actionDigest, offered: { figure: '2000', payer: quote.payer } }), code('QUOTE_CHANGED'));
  advance(59 * 60_000);
  const approved = await approveAction(deps, owner, { entryId: send.id, digest: send.actionDigest, offered: quote });
  assert.equal(approved.entry.state, 'approved');

  // Proposed now, 59 minutes in: the preview behind it ends two minutes from now, so the entry ends then too.
  const notAfter = new Date(Date.parse(send.at) + 61 * 60_000).toISOString();
  const capped = await proposeAction(deps, agent, input({ action: 'delivery.send', subject: 'run_1:call_2', quote, notAfter }));
  assert.equal(capped.expiresAt, notAfter, 'notAfter caps the window');
});

// ---------------------------------------------------------------------------
// 3. Claims, unknown outcomes, and the explicit resolve path
// ---------------------------------------------------------------------------

test('the claim is durable before the send: the effect sees its entry claimed, with the token spent and the key kept', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, write('claimed'));
  const { token } = await approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
  let seen: JournalRecord | undefined;
  await applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: 'claim-key' }, async () => {
    seen = entries(store).find(entry => entry.id === proposed.id);
    return { outcome: 'applied', line: 'Sent.', value: null };
  });
  assert.equal(seen?.state, 'approved');
  assert.ok(seen?.claimedAt, 'claimed in its own commit before the effect ran');
  assert.ok(seen?.approval?.usedAt);
  assert.equal(seen?.approval?.key, 'claim-key');
});

test('a send that times out, crashes or comes back unclear is outcome_unknown, never runs again, and only the owner resolves it', async () => {
  const cases: [string, () => Promise<any>, number | undefined, string][] = [
    ['timeout', () => new Promise(() => {}), 20, 'JOURNAL_OUTCOME_UNKNOWN'],
    ['crash', async () => { throw new TypeError('socket closed'); }, undefined, 'TypeError'],
    ['unclear', async () => ({ outcome: 'unknown', line: 'The mail app did not confirm the send.', value: null }), undefined, ''],
    ['model timeout', async () => { throw new ChausarError('MODEL_TIMEOUT', 'Your AI did not answer in time.'); }, undefined, 'MODEL_TIMEOUT'],
  ];
  for (const [name, result, timeoutMs, thrown] of cases) {
    const { deps, store } = setup();
    await seed(deps);
    const spec = name === 'model timeout' ? input({ action: 'delivery.send', subject: 'run_1:call_1', line: 'Send the next step to your AI.' }) : write(`case_${name.replace(' ', '_')}`);
    const proposed = await proposeAction(deps, agent, spec);
    const { token } = await approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
    const effect = counter(result);
    const applying = applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: `key-${name.replace(" ", "-")}`, timeoutMs }, effect.run);
    if (thrown === 'TypeError') await assert.rejects(applying, TypeError);
    else if (thrown) await assert.rejects(applying, code(thrown));
    else assert.equal((await applying).entry.state, 'outcome_unknown');
    const entry = entries(store)[0];
    assert.equal(entry.state, 'outcome_unknown', name);
    assert.match(entry.journal.at(-1)!.line, /Check/, name);
    if (name !== 'unclear') assert.ok(entry.journal.at(-1)!.line.includes(CHECK_BEFORE_RETRYING), name);
    assert.equal(entry.outcome?.by, 'engine');

    // Never resent: the same key, a new key and a fresh proposal of the same thing are all refused.
    await assert.rejects(applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: `key-${name.replace(" ", "-")}` }, effect.run), code('JOURNAL_OUTCOME_UNKNOWN'));
    await assert.rejects(applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: 'another' }, effect.run), code('JOURNAL_OUTCOME_UNKNOWN'));
    await assert.rejects(journalled(deps, owner, spec, effect.run), code('JOURNAL_OUTCOME_UNKNOWN'));
    assert.equal(effect.calls(), 1, name);

    await assert.rejects(resolveUnknown(deps, agent, { entryId: proposed.id, found: 'applied' }), code('APP_APPROVAL_REQUIRED'));
    const found = name === 'crash' ? 'not-applied' : 'applied';
    const resolved = await resolveUnknown(deps, owner, { entryId: proposed.id, found });
    assert.equal(resolved.state, found === 'applied' ? 'applied' : 'rejected');
    assert.equal(resolved.outcome?.by, 'owner');
    await assert.rejects(resolveUnknown(deps, owner, { entryId: proposed.id, found: 'applied' }), code('JOURNAL_NOT_UNKNOWN'), 'one rule and one code for settling (W1 H3)');
    assert.equal(effect.calls(), 1, 'recording what the owner found never resends');
  }
});

test('a failure known to have done nothing is rejected with its reason, and the error comes back unchanged', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const refused = await proposeAction(deps, agent, write('refused'));
  const { token } = await approveAction(deps, owner, { entryId: refused.id, digest: refused.actionDigest });
  await assert.rejects(applyAction(deps, owner, { entryId: refused.id, token, idempotencyKey: 'refused' }, async () => { throw new ChausarError('TOOL_FAILED', 'The mail app refused the address.'); }), code('TOOL_FAILED'));
  const notSent = await proposeAction(deps, agent, write('not_sent'));
  const second = await approveAction(deps, owner, { entryId: notSent.id, digest: notSent.actionDigest });
  const done = await applyAction(deps, owner, { entryId: notSent.id, token: second.token, idempotencyKey: 'not-sent' }, async () => ({ outcome: 'not-sent', line: 'Sign in to the mail app first.', value: null, by: 'platform' }));
  assert.equal(done.entry.state, 'rejected');
  assert.equal(done.entry.outcome?.by, 'platform');
  const [first, other] = entries(store);
  assert.deepEqual([first.state, first.journal.at(-1)!.line], ['rejected', 'The mail app refused the address.']);
  assert.equal(other.journal.at(-1)!.line, 'Sign in to the mail app first.');
  // An invoice is one commit: even a crash leaves nothing behind, so it is rejected, not unknown.
  const invoice = await proposeAction(deps, agent, input({ subject: 'invoice_9' }));
  const third = await approveAction(deps, owner, { entryId: invoice.id, digest: invoice.actionDigest });
  await assert.rejects(applyAction(deps, owner, { entryId: invoice.id, token: third.token, idempotencyKey: 'invoice_9' }, async () => { throw new TypeError('boom'); }), TypeError);
  assert.equal(entries(store).find(entry => entry.id === invoice.id)!.state, 'rejected');
});

test('the sweep marks a claim left by a crash outcome_unknown and rejects proposals nobody decided in time', async () => {
  const { deps, store, advance } = setup();
  await seed(deps);
  const crashed = await proposeAction(deps, agent, write('crashed'));
  await approveAction(deps, owner, { entryId: crashed.id, digest: crashed.actionDigest });
  // The process stopped after the claim: the record says approved and claimed, and nothing else.
  await store.update(state => {
    const record = state.conversations.find(item => item.id === crashed.id) as JournalRecord;
    record.claimedAt = new Date(START).toISOString();
    record.approval!.usedAt = record.claimedAt;
  });
  const waiting = await proposeAction(deps, agent, write('waiting'));
  const fresh = await proposeAction(deps, agent, write('fresh'));
  advance(AGENT_WINDOW_MS + 1000);
  const recent = await proposeAction(deps, agent, write('recent'));
  const swept = await sweepJournal(deps, owner, { claimLimitMs: 60_000 });
  assert.deepEqual(swept.map(item => item.id).sort(), [crashed.id, fresh.id, waiting.id].sort());
  const byId = new Map(entries(store).map(entry => [entry.id, entry]));
  assert.equal(byId.get(crashed.id)!.state, 'outcome_unknown');
  assert.ok(byId.get(crashed.id)!.journal.at(-1)!.line.includes(CHECK_BEFORE_RETRYING));
  assert.equal(byId.get(waiting.id)!.state, 'rejected');
  assert.equal(byId.get(waiting.id)!.outcome?.by, 'engine');
  assert.equal(byId.get(recent.id)!.state, 'described');
  assert.deepEqual(await sweepJournal(deps, owner, { claimLimitMs: 60_000 }), []);
});

// ---------------------------------------------------------------------------
// 4. One call in the app: propose, approve, apply
// ---------------------------------------------------------------------------

test('journalled: inside the app one call proposes, approves and applies; an agent cannot; a waiting proposal of the same action is reused', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const effect = counter(async () => ({ outcome: 'applied', line: 'Sent.', value: 'ok' }));
  await assert.rejects(journalled(deps, agent, write('one_call'), effect.run), code('APP_APPROVAL_REQUIRED'));
  assert.equal(entries(store).length, 0);
  const waiting = await proposeAction(deps, agent, write('one_call'));
  const done = await journalled(deps, owner, write('one_call'), effect.run);
  assert.equal(done.value, 'ok');
  assert.equal(done.entry.id, waiting.id, 'the agent proposal is the entry the owner approved');
  assert.deepEqual(states(entries(store)[0]), ['described', 'approved', 'applied']);
  await assert.rejects(journalled(deps, owner, write('one_call'), effect.run), code('JOURNAL_ALREADY_DECIDED'));
  assert.equal(effect.calls(), 1);

  // The effect may settle the entry inside its own commit, so the effect and the journal step land together.
  const settled = await journalled(deps, owner, write('in_commit'), async handle => {
    await ventureAction(deps, owner, 'approve', 'test.effect', tx => { handle.settleIn(tx, 'Sent in the same commit.', 'receipt_7'); });
    return { outcome: 'applied', line: 'ignored', value: null };
  });
  assert.equal(settled.entry.state, 'applied');
  assert.deepEqual(states(settled.entry), ['described', 'approved', 'applied']);
  assert.equal(settled.entry.journal.at(-1)!.line, 'Sent in the same commit.');
  assert.equal((settled.entry as JournalRecord).receiptId, 'receipt_7');
});

// ---------------------------------------------------------------------------
// 5. Shadow mode
// ---------------------------------------------------------------------------

test('shadow: the agent goes on against a simulated result that lists what could not be simulated, and a shadow entry never runs', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const first = await shadowAction(deps, agent, input({ subject: 'invoice_shadow' }));
  assert.equal(first.entry.shadow, true);
  assert.equal(first.simulation.kind, 'complete');
  assert.deepEqual(first.simulation.value.effects, ['Issue the invoice for Cafe Aroma Demo.']);
  assert.deepEqual(first.simulation.unsimulated, []);

  const second = await shadowAction(deps, agent, input({ action: 'connector.post', subject: 'post_shadow', target: 'LinkedIn', line: 'Post to LinkedIn.' }));
  assert.equal(second.simulation.kind, 'incomplete');
  assert.deepEqual(second.simulation.value.effects, ['Issue the invoice for Cafe Aroma Demo.'], 'what it could simulate is still there');
  assert.equal(second.simulation.unsimulated.length, 1);
  assert.deepEqual({ ...second.simulation.unsimulated[0], reason: '' }, { entryId: second.entry.id, action: 'connector.post', target: 'LinkedIn', reason: '' });
  assert.match(second.simulation.unsimulated[0].reason, /LinkedIn|platform/);

  await assert.rejects(approveAction(deps, owner, { entryId: second.entry.id, digest: second.entry.actionDigest }), code('JOURNAL_SHADOW'));
  await assert.rejects(rejectAction(deps, owner, { entryId: second.entry.id, digest: second.entry.actionDigest }), code('JOURNAL_SHADOW'));
  assert.deepEqual(entries(store).map(entry => entry.state), ['described', 'described']);
  assert.deepEqual((await views['venture.journal.list']!(deps, owner, {}) as { entries: JournalEntry[] }).entries, [], 'shadow entries never happened, so the journal leaves them out');

  // The pure replay keeps going past an effect it cannot simulate and lists every one.
  const records = entries(store);
  const replay = simulateJournal({ effects: [] as string[] }, [records[1], records[0], records[1]], DEFAULT_SIMULATORS);
  assert.equal(replay.kind, 'incomplete');
  assert.equal(replay.simulated, 1);
  assert.equal(replay.unsimulated.length, 2);
  for (const action of Object.keys(JOURNAL_ACTIONS)) assert.equal(typeof DEFAULT_SIMULATORS[action as keyof typeof JOURNAL_ACTIONS], 'function', action);
});

// ---------------------------------------------------------------------------
// 6. venture.journal.list
// ---------------------------------------------------------------------------

test('venture.journal.list: every outside effect newest first in the shared JournalEntry shape, posts and website edits included', async () => {
  const { deps, advance } = setup();
  assert.deepEqual(await views['venture.journal.list']!(deps, owner, {}), { entries: [] }, 'no business yet');
  await seed(deps);
  const issued = await journalled(deps, owner, input(), async () => ({ outcome: 'applied', line: 'Issued INV-0001.', receiptId: 'price_1', value: null }));
  advance(1000);
  await ventureAction(deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId: 'linkedin', mode: 'owner-browser-session', account: null, text: 'Hello', agent: null, digest: 'd'.repeat(64),
    state: 'rejected', describe: 'Post to LinkedIn from your own browser on this computer.', risk: null, claimedAt: null, decidedBy: 'owner',
    outcome: { line: 'You chose not to post this.', url: null, by: 'owner' },
    journal: [{ state: 'described', at: tx.now, by: 'owner', line: 'Post to LinkedIn.' }, { state: 'rejected', at: tx.now, by: 'owner', line: 'You chose not to post this.' }],
  }));
  advance(1000);
  await ventureAction(deps, owner, 'prepare', 'seed.site', tx => tx.put<SiteEditRecord>({
    ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:C:/site' }, path: 'index.html', summary: 'New opening hours',
    before: 'a', after: 'b', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'staged',
    log: [{ at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New opening hours' }],
  }));
  advance(1000);
  await proposeAction(deps, agent, write('waiting'));

  const { entries: list } = await views['venture.journal.list']!(deps, owner, {}) as { entries: JournalEntry[] };
  assert.deepEqual(list.map(entry => [entry.action, entry.target, entry.state]), [
    ['Write to a connected service', 'Mail app', 'described'],
    ['Edit website', 'index.html', 'described'],
    ['Post', 'LinkedIn', 'rejected'],
    ['Issue invoice', 'Cafe Aroma Demo', 'applied'],
  ]);
  const invoice = list.at(-1)!;
  assert.deepEqual(invoice, { id: issued.entry.id, action: 'Issue invoice', target: 'Cafe Aroma Demo', state: 'applied', at: invoice.at, line: 'Issued INV-0001.', receiptId: 'price_1' });
  for (const entry of list) {
    assert.deepEqual(Object.keys(entry).filter(key => key !== 'receiptId').sort(), ['action', 'at', 'id', 'line', 'state', 'target']);
    assert.deepEqual(houseStyleFindings(entry.line), []);
  }
  assert.equal((await views['venture.journal.list']!(deps, owner, { limit: 1 }) as { entries: JournalEntry[] }).entries.length, 1);
  for (const payload of [{ limit: 0 }, { limit: 501 }, { limit: 'all' }, { limit: 1.5 }, { other: true }]) {
    await assert.rejects(views['venture.journal.list']!(deps, owner, payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
  // A read: an agent and the phone may list it.
  assert.equal((await views['venture.journal.list']!(deps, agent, {}) as { entries: JournalEntry[] }).entries.length, 4);
});

// ---------------------------------------------------------------------------
// 7. Registration and house rules
// ---------------------------------------------------------------------------

test('venture.journal.list is a views read method registered everywhere a venture method must be', async () => {
  assert.ok((VENTURE_METHODS as readonly string[]).includes('venture.journal.list'));
  assert.equal(METHOD_OWNERS['venture.journal.list'], 'views');
  assert.equal(APP_ONLY_METHODS.includes('venture.journal.list'), false);
  assert.equal(typeof views['venture.journal.list'], 'function');
  assert.ok((VENTURE_RECORD_KINDS as readonly string[]).includes('venture-journal-entry'));
  for (const error of ['JOURNAL_NOT_FOUND', 'JOURNAL_ALREADY_DECIDED', 'JOURNAL_EXPIRED', 'JOURNAL_TOKEN_INVALID', 'JOURNAL_TOKEN_USED', 'JOURNAL_KEY_REUSED', 'JOURNAL_SHADOW', 'JOURNAL_OUTCOME_UNKNOWN']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(error), error);
  }
  const ipc = await readFile(new URL('../../app/desktop/ipc-contract.cjs', import.meta.url), 'utf8');
  const types = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const engine = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  assert.ok(ipc.includes("'venture.journal.list'"), 'ipc allowlist');
  assert.ok(types.includes('"venture.journal.list"'), 'ipc types');
  assert.ok(engine.includes("case 'venture.journal.list':"), 'engine routing');
});

test('static: the journal files throw only declared codes, keep the house style, credit their sources, and never store a token', async () => {
  const folder = new URL('../runtime/venture/journal/', import.meta.url);
  const files = (await readdir(folder)).filter(name => name.endsWith('.ts'));
  assert.deepEqual(files.sort(), ['index.ts', 'journal.ts', 'list.ts', 'simulation.ts', 'tokens.ts']);
  let all = '';
  for (const file of files) {
    const source = await readFile(new URL(file, folder), 'utf8');
    all += source;
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), `${file}: ${match[1]}`);
    assert.ok(!source.includes('\u2014'), `${file} has a long dash`);
    assert.deepEqual(houseStyleFindings(source), [], file);
  }
  assert.match(all, /cloudflare\/cloudflare-os \(Apache-2\.0/);
  assert.match(all, /useopendesk\/opendesk \(Apache-2\.0/);
  assert.match(all, /HelixDB\/helix-foundry \(Apache-2\.0/);
  assert.doesNotMatch(all, /\btoken:\s*token\b/, 'no record field holds the token itself');
});
