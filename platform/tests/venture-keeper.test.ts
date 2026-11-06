// Ink v2 wave 4 (4A1): Keeper, the engine's own jobs shown honestly as code, never as an AI. venture.team.keeper lists
// each job with its last run from records only (or the workspace port for backups); the journal sweep's tick writes
// one record per job, replaced each run, and emits keeper.ran; nothing claims a run that has no record.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, JournalRecord, KeeperView, TeamListView } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { call, code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import { flagshipTeam } from './venture-team-fixtures.ts';

const keeper = (env: Env) => call<KeeperView>(env, 'venture.team.keeper');
const job = async (env: Env, id: string) => (await keeper(env)).jobs.find(item => item.id === id)!;
const runs = (env: Env) => listRecords(env.store.read(), 'venture-keeper-run');
type Backups = { auto: boolean; count: number; newestAt: string | null; nextDueAt: string | null; lastError: string | null } | null;
const withBackups = (env: Env, value: Backups) => { (env.workspace as unknown as { backups: () => Promise<Backups> }).backups = async () => value; };

test('Keeper lists its seven jobs from records only; reading writes nothing and claims no run', async () => {
  const env = await setup();
  const { jobs } = await keeper(env);
  assert.deepEqual(jobs.map(item => [item.id, item.name]), [
    ['backups', 'Backups'], ['journal-sweep', 'Journal sweep'], ['connection-checks', 'Connection checks'],
    ['rule-freshness', 'Platform rule dates'], ['rate-tables', 'Tax rate tables'], ['posting-steps', 'Posting steps'],
    ['network-strength', 'Network strength'],
  ]);
  assert.ok(jobs.every(item => item.lastRun === null), 'no record, no run');
  assert.deepEqual(Object.fromEntries(jobs.map(item => [item.id, item.note])), {
    backups: 'Not run yet.', 'journal-sweep': 'Not run yet.', 'connection-checks': 'Not run yet.',
    'rule-freshness': 'Not needed for this business.', 'rate-tables': 'Not needed for this business.', 'posting-steps': 'Not needed for this business.',
    'network-strength': 'Not run yet.',
  });
  assert.deepEqual(runs(env), [], 'reading Keeper writes nothing');
});

test('backups come from the workspace port, automatic ones only; the hosted app has none and says so', async () => {
  const env = await setup();
  // The port counts automatic backups only: a backup the owner made by hand is not Keeper's run.
  withBackups(env, { auto: true, count: 3, newestAt: '2026-10-15T09:00:00.000Z', nextDueAt: '2026-10-16T09:00:00.000Z', lastError: null });
  assert.deepEqual(await job(env, 'backups'), {
    id: 'backups', name: 'Backups', note: null,
    lastRun: { at: '2026-10-15T09:00:00.000Z', outcome: 'ok', line: '3 automatic backups kept on this computer. The newest is from 15 Oct 2026.' },
  });
  withBackups(env, { auto: true, count: 3, newestAt: '2026-10-15T09:00:00.000Z', nextDueAt: null, lastError: 'The disk is full.' });
  assert.deepEqual((await job(env, 'backups')).lastRun, {
    at: '2026-10-15T09:00:00.000Z', outcome: 'warn', line: '3 automatic backups kept on this computer. The newest is from 15 Oct 2026. The last try did not work: The disk is full.',
  });
  withBackups(env, { auto: true, count: 0, newestAt: null, nextDueAt: null, lastError: 'The disk is full.' });
  assert.deepEqual(await job(env, 'backups'), { id: 'backups', name: 'Backups', lastRun: null, note: 'No automatic backup yet. The last try did not work: The disk is full.' });
  // Automatic backups off: no run is claimed, even when older automatic backups are still in the folder.
  withBackups(env, { auto: false, count: 2, newestAt: '2026-10-01T09:00:00.000Z', nextDueAt: null, lastError: null });
  assert.deepEqual(await job(env, 'backups'), { id: 'backups', name: 'Backups', lastRun: null, note: 'Automatic backups are off.' });
  withBackups(env, null);
  assert.deepEqual((await job(env, 'backups')).note, 'This computer keeps no automatic backups of this business.');
  env.deps.host = 'hosted-web';
  withBackups(env, { auto: true, count: 3, newestAt: '2026-10-15T09:00:00.000Z', nextDueAt: null, lastError: null });
  assert.deepEqual(await job(env, 'backups'), { id: 'backups', name: 'Backups', lastRun: null, note: 'Not on the hosted app.' });
});

test('the journal sweep writes its Keeper run, with keeper.ran, only when something changed or the record is a day old', async () => {
  const env = await setup();
  const keeperRan = () => env.published.flat().filter(event => event.name === 'keeper.ran').length;
  const before = env.store.read().revision;
  await sweepWholeJournal(env.deps, owner);
  const withKeeper = env.store.read().revision - before;
  const first = runs(env);
  assert.deepEqual(first.map(item => [item.job, item.outcome, item.line]), [['journal-sweep', 'ok', 'Nothing was left half done.']]);
  assert.deepEqual((await job(env, 'journal-sweep')).lastRun, { at: env.now(), outcome: 'ok', line: 'Nothing was left half done.' });
  assert.equal((await job(env, 'journal-sweep')).note, null);
  assert.equal(keeperRan(), 1, 'keeper.ran is emitted');

  // An idle business: the same result five minutes later writes nothing and announces nothing.
  const revision = env.store.read().revision;
  env.advance(5 * 60_000);
  await sweepWholeJournal(env.deps, owner);
  assert.equal(runs(env)[0].at, first[0].at, 'not rewritten');
  assert.equal(keeperRan(), 1);
  assert.equal(env.store.read().revision - revision, withKeeper - 1, "only the sweep's own writes; Keeper wrote nothing");

  // A day on, the record is renewed once, so the card never shows a result older than a day.
  env.advance(24 * 60 * 60_000);
  await sweepWholeJournal(env.deps, owner);
  assert.equal(runs(env).length, 1, 'replaced, not added');
  assert.equal(runs(env)[0].at, env.now());
  assert.equal(keeperRan(), 2);
});

test('a sweep that found claims left half way warns at once, and says they may have gone out', async () => {
  const env = await setup();
  await sweepWholeJournal(env.deps, owner);
  const at = '2026-10-15T09:00:00.000Z';
  await env.store.update(state => {
    state.conversations.push({
      id: 'journal_test1', kind: 'venture-journal-entry', ventureId: env.venture.id, memberId: 'owner', epoch: 1, at,
      action: 'connector.write', subject: 'reminder', target: 'Mail app', actionDigest: 'a'.repeat(64), describe: 'Send the reminder email.', agent: null,
      shadow: false, quote: null, state: 'approved', claimedAt: at, decidedBy: 'owner', outcome: null, receiptId: null,
      journal: [{ state: 'approved', at, by: 'owner', line: 'You approved this.' }],
      approval: { tokenHash: 'b'.repeat(64), approvedBy: 'owner', at, expiresAt: '2026-10-15T09:15:00.000Z', usedAt: at, key: 'k.once' },
      expiresAt: '2026-10-15T09:15:00.000Z',
    } satisfies JournalRecord);
  });
  env.advance(31 * 60_000);
  assert.equal((await sweepWholeJournal(env.deps, owner)).length, 1);
  assert.deepEqual((await job(env, 'journal-sweep')).lastRun, {
    at: env.now(), outcome: 'warn', line: '1 journal entry was left half done and may have gone out. Check it in the journal before trying again.',
  });
});

test('rule dates, tax rate tables and posting steps run on the same tick, for the businesses that use them', async () => {
  const youtube = await setup();
  await flagshipTeam(youtube, 'youtube');
  await sweepWholeJournal(youtube.deps, owner);
  const rules = await job(youtube, 'rule-freshness');
  assert.equal(rules.note, null);
  assert.match(rules.lastRun!.line, /^Platform rules: \d+ current, \d+ to recheck\.$/);
  assert.ok(rules.lastRun!.outcome === 'ok' || rules.lastRun!.outcome === 'warn');
  assert.equal((await job(youtube, 'rate-tables')).note, 'Not needed for this business.');
  assert.equal((await job(youtube, 'posting-steps')).note, 'Not needed for this business.');

  const ca = await setup();
  await flagshipTeam(ca, 'ca-firm');
  await sweepWholeJournal(ca.deps, owner);
  const rates = await job(ca, 'rate-tables');
  assert.equal(rates.lastRun!.outcome, 'warn');
  assert.match(rates.lastRun!.line, /^\d+ tax rate tables? waits? for your CA to confirm (it|them)\.$/);

  const social = await setup();
  await flagshipTeam(social, 'social-agency');
  await sweepWholeJournal(social.deps, owner);
  assert.deepEqual((await job(social, 'posting-steps')).lastRun, {
    at: social.now(), outcome: 'warn', line: 'No posting step has worked on this computer yet. Check them in Connections before posting from here.',
  });
  assert.deepEqual(runs(social).map(item => item.job).sort(), ['journal-sweep', 'posting-steps', 'rule-freshness']);
});

test('Keeper on the team: code in Operations, no steps, no chat; its gates and posture are refused', async () => {
  const env = await setup();
  assert.deepEqual((await call<TeamListView>(env, 'venture.team.list')).agents, [], 'no team before a plan');
  await seedBlueprint(env, { price2: '1500000' });
  const agents = (await call<TeamListView>(env, 'venture.team.list')).agents;
  const keeperAgent = agents.at(-1) as AgentView;
  assert.deepEqual({ id: keeperAgent.id, name: keeperAgent.name, kind: keeperAgent.kind, department: keeperAgent.department, steps: keeperAgent.steps, chat: keeperAgent.chat, state: keeperAgent.state },
    { id: 'keeper', name: 'Keeper', kind: 'code', department: 'operations', steps: [], chat: false, state: 'idle' });
  assert.match(keeperAgent.role, /code, not AI/);
  assert.equal(keeperAgent.spend, 'USD 0.0000', 'code spends nothing on AI');
  await assert.rejects(call(env, 'venture.team.gate', { agentId: 'keeper', stepId: 'backups', gate: 'auto' }), code('AGENT_IS_CODE'));
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'keeper', posture: 'rehearsal' }), code('AGENT_IS_CODE'));
});
