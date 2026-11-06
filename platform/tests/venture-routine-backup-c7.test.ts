// C7 tasks 6 and 7: a backup AI for routines. The setting is off by default; its order names only AIs connected to this
// business other than the main one, at most two; turning it on needs each one's own consent digest and records a backup
// consent per AI; the main chat consent keeps its exact rule. At Run it, a main AI that refused before anything reached
// it hands the run to the next usable backup and the run says why; a cut stream never falls back; off means the old
// failure; a client run whose consent predates the backup's connection stays waiting; a backup without its consent waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import type { RoutineRunRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { currentRoutineScope } from '../runtime/venture/agents/routine-scope.ts';
import { chatConsentState } from '../runtime/venture/agents/consent.ts';
import { MIN, at, codexBusiness, type CodexEnv } from './venture-c7-helpers.ts';
import { NOW, owner } from './venture-judge-helpers.ts';

const phone = { ...owner, channel: 'phone' as const };
const backupGet = (env: CodexEnv) => env.agents('venture.routines.backup.get', {});
const backupSet = (env: CodexEnv, payload: unknown, ctx = owner) => env.agents('venture.routines.backup.set', payload, ctx);
async function turnOn(env: CodexEnv) {
  const view = await backupGet(env);
  const claude = view.choices.find((choice: any) => choice.presetId === 'claude-code-cli');
  assert.ok(claude, 'Claude Code is offered as a backup');
  return backupSet(env, { on: true, order: ['claude-code-cli'], digests: [claude.digest] });
}
const runs = (env: CodexEnv) => listRecords(env.store.read(), 'venture-routine-run');
async function due(env: CodexEnv) {
  env.setNow(at(61 * MIN));
  await routineTick(env.deps, owner);
  const row = (await env.call('venture.queue.list')).rows.find((item: any) => item.id.startsWith('routine:'));
  assert.ok(row);
  return row;
}
const runIt = (env: CodexEnv, row: any) => env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
/** The main AI refuses before anything reaches it (the port's own refusal); a backup goes through. */
const mainRefuses = (env: CodexEnv, code: string) => { env.models.refusePreview = () => currentRoutineScope()?.presetId ? null : new ChausarError(code, 'Codex has used up your plan for now.'); };

test('the setting: off by default; only connected AIs other than the main one; at most two; on needs each consent digest; app only', async () => {
  const env = await codexBusiness({ claudeConnectedAt: NOW });
  const view = await backupGet(env);
  assert.deepEqual([view.on, view.order], [false, []]);
  assert.deepEqual(view.choices.map((choice: any) => choice.presetId), ['claude-code-cli']);
  assert.match(view.choices[0].text, /Claude Code/);
  await assert.rejects(backupSet(env, { on: true, order: ['codex-cli'], digests: ['a'.repeat(64)] }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(backupSet(env, { on: true, order: ['anthropic-sonnet-5-5'], digests: ['a'.repeat(64)] }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(backupSet(env, { on: true, order: ['claude-code-cli'] }), { code: 'APPROVAL_STALE' });
  await assert.rejects(backupSet(env, { on: true, order: ['claude-code-cli'], digests: ['b'.repeat(64)] }), { code: 'APPROVAL_STALE' });
  await assert.rejects(backupSet(env, { on: true, order: ['claude-code-cli'], digests: [view.choices[0].digest] }, phone), { code: 'APP_APPROVAL_REQUIRED' });
  const on = await turnOn(env);
  assert.deepEqual([on.on, on.order], [true, ['claude-code-cli']]);
  const backups = listRecords(env.store.read(), 'venture-chat-consent').filter(record => record.backup === true);
  assert.deepEqual(backups.map(record => record.presetId), ['claude-code-cli']);
  // The main consent still reads given: a backup consent is not the newest main one.
  const { view: main } = chatConsentState(env.deps, owner, env.store.read(), (await env.call('venture.get')).venture);
  assert.equal(main.state, 'given');
});

test('Run it: the main AI refused before dispatch, so the backup answers and the run says why', async () => {
  const env = await codexBusiness({ claudeConnectedAt: NOW });
  await turnOn(env);
  const row = await due(env);
  mainRefuses(env, 'AI_USAGE_LIMIT');
  const decided = await runIt(env, row);
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(env.aiCalls(), 1);
  assert.deepEqual(env.presetsAsked, ['codex-cli', 'claude-code-cli']);
  const run: RoutineRunRecord = runs(env).at(-1)!;
  assert.equal(run.state, 'completed');
  assert.deepEqual(run.ranOn, { presetId: 'claude-code-cli', label: 'Claude Code', why: 'Ran on Claude Code because your Codex plan was used up.' });
});

test('a cut stream after dispatch never falls back; with the backup off the old failure stands', async () => {
  const env = await codexBusiness({ claudeConnectedAt: NOW });
  await turnOn(env);
  const row = await due(env);
  env.models.refuseSend = () => currentRoutineScope()?.presetId ? null : new ChausarError('AI_STREAM_CUT', 'The connection dropped.');
  await runIt(env, row);
  assert.deepEqual(env.presetsAsked, ['codex-cli']);
  assert.equal(runs(env).at(-1)!.state, 'failed');
  const off = await codexBusiness({ claudeConnectedAt: NOW });
  const offRow = await due(off);
  mainRefuses(off, 'AI_SIGN_IN_REFUSED');
  await runIt(off, offRow);
  assert.deepEqual(off.presetsAsked, ['codex-cli']);
  assert.equal(runs(off).at(-1)!.state, 'failed');
});

test("a backup without its consent, or a client whose consent predates the backup's connection, never takes the run", async () => {
  const env = await codexBusiness({ claudeConnectedAt: NOW });
  await turnOn(env);
  // The owner set the backup again later, so the consent given before that no longer counts.
  await ventureAction(env.deps, owner, 'approve', 'test.reset', tx => { tx.replace({ ...tx.venture!, routineBackup: { on: true, order: ['claude-code-cli'], at: at(30 * MIN) } }); });
  const row = await due(env);
  mainRefuses(env, 'AI_USAGE_LIMIT');
  await runIt(env, row);
  assert.deepEqual(env.presetsAsked, ['codex-cli'], 'the backup had no consent, so nothing went to it');
  assert.equal(runs(env).at(-1)!.state, 'queued', 'it waits for the main plan instead');

  const client = await codexBusiness({ claudeConnectedAt: at(10 * MIN) });
  await turnOn(client);
  const made = await client.call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com' });
  const clientId = made.client?.id ?? made.id;
  await ventureAction(client.deps, owner, 'approve', 'test.consent', tx => {
    const record = tx.find('venture-client', clientId)!;
    tx.replace({ ...record, aiConsent: { id: 'consent-1', revision: 1, grantedAt: NOW, withdrawnAt: null } as any });
  });
  const clientRow = await due(client);
  await ventureAction(client.deps, owner, 'prepare', 'test.client', tx => {
    const run = tx.list('venture-routine-run').at(-1)!;
    tx.replace({ ...run, clientId });
  });
  mainRefuses(client, 'AI_USAGE_LIMIT');
  const { planBookOf } = await import('../runtime/venture/models/plan-book.ts');
  planBookOf(client.store).failed('codex', 'usage-limit', client.deps.clock().toISOString());
  const refused = await runIt(client, clientRow);
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'CLIENT_AI_CONSENT_REQUIRED']);
  assert.deepEqual(client.presetsAsked, []);
  assert.equal(runs(client).at(-1)!.state, 'needs-input');
});
