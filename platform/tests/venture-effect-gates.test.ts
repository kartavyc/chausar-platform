// The policy gate before each outside effect, the journal sweep, shadow mode for an agent's outside writes and the
// spot-check completion hook (engine-final, items 12 and 13). Posting, website edits and invoice issue each pass
// gateEffect with the owner's approval sealed on their journal entry; nothing else opens the gate, and a failing check
// blocks. The sweep runs when a vault opens and on the engine tick. No network anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import type { ApprovalSeal, JournalEntry, JournalRecord, MockEffect, SiteEditRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { gateEffect, sealApproval } from '../runtime/venture/policy/holds.ts';
import { spotCheckOnFinish } from '../runtime/venture/policy/spot-check.ts';
import type { Policy } from '../runtime/venture/policy/verdict.ts';
import type { PolicyContext } from '../runtime/venture/policy/ladder.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { applySiteEdit, localFolderTarget, rollbackSiteEdit, stageSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { toolSpec, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { code, owner, setup } from './venture-views-env.ts';
import { VentureTestStore } from './venture-test-store.ts';

const DIGEST = 'a'.repeat(64);
const seal = (over: Partial<ApprovalSeal> = {}): ApprovalSeal => ({
  tokenHash: 'b'.repeat(64), approvedBy: 'owner', at: '2026-10-15T10:00:00.000Z', expiresAt: '2026-10-15T10:15:00.000Z', usedAt: '2026-10-15T10:00:01.000Z', key: 'k.once', ...over,
});
const journalList = async (deps: VentureDeps) => (await views['venture.journal.list']!(deps, owner, {}) as { entries: JournalEntry[] }).entries;

// ---------------------------------------------------------------------------
// 1. The gate itself
// ---------------------------------------------------------------------------

test('gateEffect opens only on the owner approval sealed on the entry, bound to the exact digest; anything else asks or is denied', () => {
  for (const name of ['invoice.issue', 'connector.post', 'site.edit.apply']) {
    assert.equal(gateEffect({ name, digest: DIGEST }, sealApproval({ approval: seal() }, DIGEST)).verdict, 'allow', name);
    // The floor asks for each of them without a sealed approval.
    assert.throws(() => gateEffect({ name, digest: DIGEST }, sealApproval({ approval: null }, DIGEST)), code('POLICY_ASK'), name);
    assert.throws(() => gateEffect({ name, digest: DIGEST }, sealApproval({}, DIGEST)), code('POLICY_ASK'), name);
    // A seal not spent by a claim is not an approval of this run of the effect.
    assert.throws(() => gateEffect({ name, digest: DIGEST }, sealApproval({ approval: seal({ usedAt: null }) }, DIGEST)), code('POLICY_ASK'), name);
    // The entry is for something else than what is about to run.
    assert.throws(() => gateEffect({ name, digest: DIGEST }, sealApproval({ approval: seal() }, 'c'.repeat(64))), code('POLICY_ASK'), name);
  }
  // Fail closed: a check that throws, answers late or answers something unknown blocks even a sealed approval.
  const throwing: Policy<PolicyContext> = { id: 'broken', decide() { throw new Error('boom'); } };
  const late: Policy<PolicyContext> = { id: 'late', decide: async () => ({ verdict: 'allow', code: 'late', reason: 'Later.' }) };
  const odd: Policy<PolicyContext> = { id: 'odd', decide: () => ({ verdict: 'maybe', code: 'odd', reason: 'Odd.' }) as any };
  const deny: Policy<PolicyContext> = { id: 'owner-rule', decide: () => ({ verdict: 'deny', code: 'owner_rule', reason: 'Your rule blocks posting on Sundays.' }) };
  for (const policy of [throwing, late, odd, deny]) {
    assert.throws(() => gateEffect({ name: 'connector.post', digest: DIGEST }, sealApproval({ approval: seal() }, DIGEST), { policies: [policy] }), code('POLICY_DENIED'), policy.id);
  }
});

test('posting, website edits and invoice issue each put their effect to the gate, with the approval sealed on their entry, inside the apply', async () => {
  const read = (path: string) => readFile(new URL(`../runtime/venture/${path}`, import.meta.url), 'utf8');
  const sites: [string, string][] = [
    ['money/invoices.ts', "gateEffect({ name: 'invoice.issue', digest: approved }, sealApproval(handle.entry, digestOf(handle.entry)));"],
    ['build/posting.ts', "gateEffect({ name: 'connector.post', digest: seen }, sealApproval(post, post.digest));"],
    ['build/site-edits.ts', "gateEffect({ name: 'site.edit.apply', digest: planDigest }, sealApproval(handle.entry, digestOf(handle.entry)));"],
  ];
  for (const [file, line] of sites) assert.ok((await read(file)).includes(line), `${file} gates its effect`);
});

// ---------------------------------------------------------------------------
// 2. Website edits through the journal: a bound single-use token, the gate, listed once
// ---------------------------------------------------------------------------

async function siteFolder() {
  const root = await mkdtemp(join(tmpdir(), 'chausar-effect-gates-'));
  await mkdir(join(root, 'pages'));
  await writeFile(join(root, 'pages', 'index.html'), '<p>Open Monday to Friday.</p>\n');
  return root;
}

test('a website edit is applied and undone through the journal with a token bound to its plan digest, and listed once', async () => {
  const env = await setup();
  const root = await siteFolder();
  try {
    const target = localFolderTarget(root);
    const staged = await stageSiteEdit(env.deps, owner, target, { path: 'pages/index.html', after: '<p>Open Monday to Saturday.</p>\n', summary: 'Add Saturday' });
    await assert.rejects(applySiteEdit(env.deps, { ...owner, channel: 'mcp' }, target, { editId: staged.id, planDigest: staged.planDigest }), code('APP_APPROVAL_REQUIRED'));
    assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, 0, 'a refused apply journals nothing');

    const applied = await applySiteEdit(env.deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    assert.equal(applied.state, 'applied');
    const [entry] = listRecords(env.store.read(), 'venture-journal-entry');
    assert.equal(entry.action, 'site.apply');
    assert.equal(entry.subject, `${staged.id}.applied`);
    assert.equal(entry.actionDigest, staged.planDigest);
    assert.equal(entry.state, 'applied');
    assert.deepEqual(entry.journal.map(step => step.state), ['described', 'approved', 'applied']);
    assert.ok(entry.approval && entry.approval.usedAt !== null && /^[a-f0-9]{64}$/.test(entry.approval.tokenHash), 'the single-use token was spent; only its hash is kept');
    assert.doesNotMatch(JSON.stringify(env.store.read().conversations), /cjat1\./, 'the token itself is stored nowhere');

    const back = await rollbackSiteEdit(env.deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    assert.equal(back.state, 'rolled-back');
    assert.deepEqual(listRecords(env.store.read(), 'venture-journal-entry').map(item => [item.subject, item.state]), [[`${staged.id}.applied`, 'applied'], [`${staged.id}.rolled-back`, 'applied']]);
    const list = await journalList(env.deps);
    assert.deepEqual(list.map(item => [item.action, item.target, item.state]), [['Edit website', 'pages/index.html', 'applied']], 'the edit shows once, from its own record');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a site file changed since review: the journal entry is rejected, the edit goes back to staged, and a later apply works', async () => {
  const env = await setup();
  const root = await siteFolder();
  try {
    const target = localFolderTarget(root);
    const staged = await stageSiteEdit(env.deps, owner, target, { path: 'pages/index.html', after: '<p>Open daily.</p>\n', summary: 'Open daily' });
    // Changed between the pre-check and the write: the target refuses before writing.
    const racing = { ...target, async replace(): Promise<void> { throw new ChausarError('SITE_CHANGED_SINCE_REVIEW', 'The file changed since you reviewed this edit. Nothing was written.'); } };
    await assert.rejects(applySiteEdit(env.deps, owner, racing, { editId: staged.id, planDigest: staged.planDigest }), code('SITE_CHANGED_SINCE_REVIEW'));
    assert.equal(listRecords(env.store.read(), 'venture-journal-entry')[0].state, 'rejected');
    assert.equal(listRecords(env.store.read(), 'venture-site-edit')[0].state, 'staged');
    const applied = await applySiteEdit(env.deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    assert.equal(applied.state, 'applied');
    assert.deepEqual(listRecords(env.store.read(), 'venture-journal-entry').map(item => item.state), ['rejected', 'applied']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. The journal sweep: the whole journal, an interrupted site edit, the host and the engine on open
// ---------------------------------------------------------------------------

/** A journal entry left approved and claimed, as a crash leaves it. */
function claimedEntry(ventureId: string, memberId: string, over: Partial<JournalRecord> = {}): JournalRecord {
  const at = '2026-10-15T09:00:00.000Z';
  return {
    id: `journal_${Math.random().toString(36).slice(2, 12)}`, kind: 'venture-journal-entry', ventureId, memberId, epoch: 1, at,
    action: 'connector.write', subject: 'reminder', target: 'Mail app', actionDigest: DIGEST, describe: 'Send the reminder email.', agent: null,
    shadow: false, quote: null, state: 'approved', claimedAt: at, decidedBy: memberId, outcome: null, receiptId: null,
    journal: [{ state: 'described', at, by: memberId, line: 'Send the reminder email.' }, { state: 'approved', at, by: memberId, line: 'You approved this.' }],
    approval: { tokenHash: 'b'.repeat(64), approvedBy: memberId, at, expiresAt: '2026-10-15T09:15:00.000Z', usedAt: at, key: 'k.once' },
    expiresAt: '2026-10-15T09:15:00.000Z', ...over,
  };
}

test('the whole-journal sweep marks interrupted claims outcome_unknown, and an edit left half way needs inspection', async () => {
  const env = await setup();
  const edit = await ventureAction(env.deps, owner, 'prepare', 'seed.edit', tx => tx.put<SiteEditRecord>({
    ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:/site' }, path: 'index.html', summary: 'New hours',
    before: 'a', after: 'b', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'applying',
    log: [{ at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New hours' }],
  }));
  await env.store.update(state => {
    state.conversations.push(claimedEntry(env.venture.id, 'owner'));
    state.conversations.push(claimedEntry(env.venture.id, 'owner', { action: 'site.apply', subject: `${edit.id}.applied`, target: 'index.html', describe: 'Apply the website edit: New hours' }));
  });
  env.advance(31 * 60_000);
  const swept = await sweepWholeJournal(env.deps, owner);
  assert.equal(swept.length, 2);
  for (const entry of listRecords(env.store.read(), 'venture-journal-entry')) {
    assert.equal(entry.state, 'outcome_unknown');
    assert.match(entry.journal.at(-1)!.line, /under way when Chausar stopped\. Check before retrying/);
  }
  const inspected = listRecords(env.store.read(), 'venture-site-edit')[0];
  assert.equal(inspected.state, 'needs-inspection');
  assert.match(inspected.log.at(-1)!.line, /Chausar stopped while writing this edit/);
  assert.deepEqual(await sweepWholeJournal(env.deps, owner), [], 'a second sweep finds nothing');
});

test('VentureHost.sweepJournal never throws: it sweeps a business, answers 0 without one and null once closed', async () => {
  const env = await setup();
  await env.store.update(state => { state.conversations.push(claimedEntry(env.venture.id, 'owner')); });
  const options = { demo: true, storage: 'experimental-file' as const, clock: env.deps.clock, host: 'test' as const };
  const host = new VentureHost(env.store, env.deps.services, options);
  assert.equal(await host.sweepJournal(owner, 2 * 60 * 60_000), 0, 'a claim younger than the limit stays');
  assert.equal(await host.sweepJournal(owner, 1), 1);
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry')[0].state, 'outcome_unknown');
  assert.equal(await host.sweepJournal({ memberId: 'nobody', role: 'viewer', epoch: 9 } as Context, 1), null, 'a refused sweep answers null');
  host.close();
  assert.equal(await host.sweepJournal(owner, 1), null);
  const empty = new VentureHost(new VentureTestStore(), env.deps.services, options);
  assert.equal(await empty.sweepJournal(owner, 1), 0, 'a vault without a business has nothing to sweep');
});

test('the engine sweeps the journal when a vault with a business opens: a claim left by the last session is outcome_unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-effect-gates-engine-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test' } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  const passphrase = 'long-enough-passphrase';
  await engine.request('workspace.create', { name: 'Effect gates', passphrase, pack: 'services' });
  try {
    await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  } catch (error: any) {
    if (error?.code === 'NOT_BUILT_YET') return t.skip('venture.create answered NOT_BUILT_YET');
    throw error;
  }
  const vault = (engine as any).store();
  const state = vault.read();
  const ventureId = state.conversations.find((record: any) => record?.kind === 'venture-record').id;
  const memberId = state.members.find((member: any) => member.role === 'owner').id;
  await vault.update((draft: any) => { draft.conversations.push(claimedEntry(ventureId, memberId)); });
  assert.equal((await engine.request('venture.journal.list', {})).entries[0].state, 'approved');
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { passphrase });
  const [entry] = (await engine.request('venture.journal.list', {})).entries as JournalEntry[];
  assert.equal(entry.state, 'outcome_unknown');
  assert.match(entry.line, /Check before retrying/);
});

// ---------------------------------------------------------------------------
// 4. Shadow: an agent's outside write is simulated, never approved or applied
// ---------------------------------------------------------------------------

function outboxEnv(deps: VentureDeps, posture: PolicyContext['posture'], runRef: ToolEnv['runRef'] = { kind: 'delivery', runId: 'delivery_shadow1' }): ToolEnv {
  return {
    deps, ventureId: 'unused', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef, files: [], tables: [], receipts: [],
    dictionary: [], sandbox: undefined, now: () => deps.clock().toISOString(), allowed: [], delegateOffer: [],
    policy: { context: { posture, approval: { kind: 'owner-turn' }, gates: {}, stepsByTool: {} } }, ctx: owner,
  };
}

test('at shadow, outbox.propose journals a shadow entry and answers the simulation; at approve each it only records the request', async () => {
  const env = await setup();
  const spec = toolSpec('outbox.propose')!;
  const input = { connector: 'mail-app', summary: 'Send the March books to Cafe Aroma.' };

  const shadow = await spec.run(outboxEnv(env.deps, 'shadow'), input);
  const result = shadow.result as { shadow: boolean; sent: boolean; wouldHappen: string[]; couldNotSimulate: string[] };
  assert.equal(result.shadow, true);
  assert.equal(result.sent, false);
  assert.deepEqual(result.wouldHappen, []);
  assert.equal(result.couldNotSimulate.length, 1);
  assert.match(result.couldNotSimulate[0], /cannot be known without sending it/);
  assert.equal((shadow.mock as MockEffect).connector, 'mail-app', 'the run still records the outside write for its checks');
  const [entry] = listRecords(env.store.read(), 'venture-journal-entry');
  assert.equal(entry.shadow, true);
  assert.equal(entry.state, 'described');
  assert.equal(entry.agent, 'delivery');
  assert.equal(entry.target, 'Your mail app');
  assert.deepEqual(await journalList(env.deps), [], 'a shadow entry never happened, so the journal leaves it out');

  const plain = await spec.run(outboxEnv(env.deps, 'approve-each'), input);
  assert.equal((plain.result as { shadow?: boolean }).shadow, undefined);
  const rehearsal = await spec.run(outboxEnv(env.deps, 'shadow', { kind: 'rehearsal', scenarioId: 'clean', episode: 1 }), input);
  assert.equal((rehearsal.result as { shadow?: boolean }).shadow, undefined, 'made-up clients journal nothing');
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, 1);
});

// ---------------------------------------------------------------------------
// 5. The spot-check completion hook
// ---------------------------------------------------------------------------

test('a finished run gets no spot-check decision while auto with spot checks is locked, even in a vault whose stage says auto', async () => {
  const env = await setup();
  const finish = (runId: string, spendMicros = '1000') => ventureAction(env.deps, owner, 'approve', 'finish', tx => spotCheckOnFinish(tx, { runId, spendMicros }));
  await ventureAction(env.deps, owner, 'admin', 'stage', tx => tx.touch({ launchStage: 'approve-each' }));
  assert.equal(await finish('delivery_1'), null, 'below auto with spot checks the owner approves each run anyway');
  // Ink v2 wave 4 (4J15): the policy caps every posture at approve each while auto is locked (policy/auto-lock.ts).
  await ventureAction(env.deps, owner, 'admin', 'stage', tx => tx.touch({ launchStage: 'auto-spot-check' }));
  assert.equal(await finish('delivery_2'), null);
  assert.equal(await finish('delivery_3', '900000'), null);
  assert.equal(listRecords(env.store.read(), 'venture-spot-check').length, 0);
});
