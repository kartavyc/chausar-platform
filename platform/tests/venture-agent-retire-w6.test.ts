// Retiring an agent (wave 6 package 6G2, DECISIONS D43). A check screen lists what the agent holds, what is in flight
// and the routines that will switch off, with who can take over. Retiring hands its steps to another agent or to the
// owner, switches its routines off and puts its thread on a read-only Retired shelf. Nothing is lost: receipts, the
// exact-approval journal, approvals waiting on Today and every undo stay as they were. Today names it with "(retired)".
// Bring back restores it as it was, routines included.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectorCheckRecord, RoutineRecord } from '../runtime/venture/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contract-values.ts';
import { METHOD_LEVEL_OF } from '../runtime/venture/method-hints.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { saveRoutine } from '../runtime/venture/agents/routines.ts';
import { chatRoute } from '../runtime/venture/agents/consent.ts';
import { teamAgents } from '../runtime/venture/chief/routing.ts';
import { jobAgentFor, RETIRE_KEPT_LINE } from '../runtime/venture/agents/retired.ts';
import { code, NOW, owner, phone, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { agentBusiness, consent, type AgentEnv } from './venture-agent-helpers.ts';

const PROMPT = 'Tell me which videos are waiting on me and what each one needs from me.';
const HOURLY = { kind: 'interval' as const, everyMinutes: 60, from: NOW };

/** A routine the owner set, written straight to the vault (the connection check is routines.set's, tested there). */
function routine(env: AgentEnv, agent: string, on = true, name = 'Check in'): Promise<RoutineRecord> {
  return ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, { name, agent, prompt: PROMPT, on, schedule: HOURLY }, 'owner'));
}
const routineNow = (env: AgentEnv, id: string) => listRecords(env.store.read(), 'venture-routine').find(item => item.id === id)!;

/** A row for the chat tier's AI in a connection check, as Check connections writes it (4J7). */
async function checked(env: AgentEnv): Promise<void> {
  const route = chatRoute(env.models.status());
  assert.ok(route);
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put<ConnectorCheckRecord>({
    ...tx.base('venture-connector-check'), rows: [{ connectorId: `model:${route.presetId}`, outcome: 'answered', line: 'Your key answered.', account: null, expiresOn: null }],
  }));
}

async function retire(env: AgentEnv, agent: string, to: string) {
  const seen = await env.agents('venture.agents.retire.check', { agent });
  return env.agents('venture.agents.retire', { agent, to, digest: seen.digest });
}

const AGENT_IDS = ['intake-clerk', 'producer', 'story-editor', 'cutter', 'packager', 'analyst', 'community-helper'];

test('retire check: what the agent holds, what is in flight, the routines that switch off and who can take over', async () => {
  const env = await agentBusiness();
  await consent(env);
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Publish the trailer on YouTube today.' });
  const on = await routine(env, 'story-editor');
  await routine(env, 'story-editor', false, 'Old check');
  await routine(env, 'packager', true, 'Packager check');
  const editor = (await env.call('venture.team.list')).agents.find((agent: any) => agent.id === 'story-editor');
  const seen = await env.agents('venture.agents.retire.check', { agent: 'story-editor' });
  assert.deepEqual(seen.agent, { id: 'story-editor', name: 'Story editor', role: editor.role });
  assert.deepEqual(seen.holds.steps, editor.steps.map((step: any) => step.purpose));
  assert.equal(seen.holds.messages, 2);
  assert.equal(seen.holds.notes, 0);
  assert.equal(seen.holds.instructions, 0);
  assert.deepEqual(seen.routines.map((item: any) => item.id), [on.id], 'only routines that are on switch off');
  assert.equal(seen.routines[0].name, 'Check in');
  assert.match(seen.routines[0].when, /^Every hour/);
  const today = seen.inFlight.filter((item: any) => item.kind === 'today');
  assert.equal(today.length, 1);
  assert.match(today[0].line, /^On Today: /);
  assert.deepEqual(seen.to.map((item: any) => item.id), AGENT_IDS.filter(id => id !== 'story-editor'), 'every other AI agent, in team order');
  assert.ok(seen.to.every((item: any) => typeof item.name === 'string' && item.name.length > 0));
  assert.equal(seen.kept, RETIRE_KEPT_LINE);
  assert.equal(seen.blocked, null);
  assert.match(seen.digest, /^[0-9a-f]{64}$/);
  await assert.rejects(env.agents('venture.agents.retire.check', { agent: 'keeper' }), code('AGENT_IS_CODE'));
  await assert.rejects(env.agents('venture.agents.retire.check', { agent: 'chausar' }), code('AGENT_IS_CODE'));
  await assert.rejects(env.agents('venture.agents.retire.check', { agent: 'nobody' }), code('AGENT_NOT_FOUND'));
  await assert.rejects(env.agents('venture.agents.retire.check', {}), code('INVALID_VENTURE_REQUEST'));
});

test('retire: the agent goes to the Retired shelf, its routines switch off and its steps go to the agent the owner chose', async () => {
  const env = await agentBusiness();
  const on = await routine(env, 'story-editor');
  const off = await routine(env, 'story-editor', false, 'Old check');
  const theirs = await routine(env, 'packager', true, 'Packager check');
  const before = await env.call('venture.team.list');
  const editor = before.agents.find((agent: any) => agent.id === 'story-editor');
  const packager = before.agents.find((agent: any) => agent.id === 'packager');
  const seen = await env.agents('venture.agents.retire.check', { agent: 'story-editor' });
  const ask = (to: string, digest = seen.digest, ctx = owner) => env.agents('venture.agents.retire', { agent: 'story-editor', to, digest }, ctx);
  await assert.rejects(ask('packager', seen.digest, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(ask('packager', '0'.repeat(64)), code('APPROVAL_STALE'));
  await assert.rejects(ask('story-editor'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(ask('keeper'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(ask('chausar'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.agents('venture.agents.retire', { agent: 'story-editor', to: 'packager' }), code('INVALID_VENTURE_REQUEST'));
  const done = await ask('packager');
  assert.equal(done.retired.id, 'story-editor');
  assert.equal(done.retired.name, 'Story editor');
  assert.deepEqual(done.retired.to, { id: 'packager', name: 'Packager' });
  assert.equal(done.retired.department, editor.department);
  assert.match(done.line, /Packager/);
  assert.equal(routineNow(env, on.id).on, false, 'its routine switched off');
  assert.equal(routineNow(env, on.id).removedAt, null, 'switched off, never removed');
  assert.equal(routineNow(env, off.id).on, false);
  assert.equal(routineNow(env, theirs.id).on, true, "another agent's routine is untouched");
  const after = await env.call('venture.team.list');
  assert.ok(!after.agents.some((agent: any) => agent.id === 'story-editor'));
  assert.deepEqual(after.retired.map((item: any) => item.id), ['story-editor']);
  assert.deepEqual(after.retired[0].to, { id: 'packager', name: 'Packager' });
  const receiver = after.agents.find((agent: any) => agent.id === 'packager');
  assert.deepEqual(new Set(receiver.steps.map((step: any) => step.id)), new Set([...packager.steps, ...editor.steps].map((step: any) => step.id)));
  // The read-only shelf: its thread still reads, but takes no new words and no new notes.
  const thread = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  assert.equal(thread.agent.id, 'story-editor');
  assert.equal(thread.retired.at, done.retired.at);
  assert.match(thread.retired.line, /read only/i);
  await assert.rejects(env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Hello there' }), code('AGENT_RETIRED'));
  await assert.rejects(env.agents('venture.agents.notes.edit', { agent: 'story-editor', text: 'Meera wants files by the 5th.' }), code('AGENT_RETIRED'));
  await assert.rejects(env.agents('venture.routines.set', { routine: { name: 'New one', agent: 'story-editor', prompt: PROMPT, on: false, schedule: HOURLY } }), code('AGENT_RETIRED'));
  await assert.rejects(env.agents('venture.agents.retire.check', { agent: 'story-editor' }), code('AGENT_RETIRED'));
  // The receiver's chat now carries the handed steps; the chief no longer routes to the retired agent.
  const receiverOrders = await env.agents('venture.agents.orders.list', { agent: 'packager' });
  for (const step of editor.steps) assert.ok(receiverOrders.steps.some((item: any) => item.stepId === step.id), `packager guides ${step.id}`);
  const state = env.store.read();
  const venture = currentVenture(state)!;
  assert.ok(!teamAgents(state, venture).some(agent => agent.id === 'story-editor'));
  // New work on its steps runs under the receiver's own AI settings.
  assert.equal(jobAgentFor(state, venture.id, 'story-editor'), 'packager');
  assert.equal(jobAgentFor(state, venture.id, 'packager'), 'packager');
});

test('retire never loses a receipt, an approval in flight or an undo, and Today names it with (retired)', async () => {
  const env = await agentBusiness();
  await consent(env);
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Publish the trailer on YouTube today.' });
  const proposal = listRecords(env.store.read(), 'venture-proposal').at(-1)!;
  const said = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Remember that Meera wants files by the 5th.' });
  await env.agents('venture.agents.proposal.decide', { id: said.added[1].proposal.id, digest: said.added[1].proposal.digest, decision: 'accept' });
  const open = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Remember that Ravi likes calls after six.' });
  const kept = ['venture-price-receipt', 'venture-work-receipt', 'venture-journal-entry', 'venture-journal-chain', 'venture-proposal', 'venture-agent-proposal', 'venture-agent-note', 'venture-agent-note-change'] as const;
  const snapshot = () => JSON.stringify(kept.map(kind => listRecords(env.store.read(), kind)));
  const sums = listRecords(env.store.read(), 'venture-sum-receipt').map(item => JSON.stringify(item));
  const rowOf = async () => (await env.call('venture.queue.list')).rows.find((row: any) => row.id.includes(proposal.id));
  const rowBefore = await rowOf();
  assert.equal(rowBefore.agent, 'Story editor');
  const was = snapshot();
  const seen = await env.agents('venture.agents.retire.check', { agent: 'story-editor' });
  assert.ok(seen.inFlight.some((item: any) => item.kind === 'proposal'), 'the open note proposal is listed');
  const done = await env.agents('venture.agents.retire', { agent: 'story-editor', to: 'owner', digest: seen.digest });
  assert.equal(done.retired.to, null, 'handed to the owner');
  assert.equal(snapshot(), was, 'receipts, the journal, approvals and notes are untouched');
  const sumsAfter = new Set(listRecords(env.store.read(), 'venture-sum-receipt').map(item => JSON.stringify(item)));
  for (const sum of sums) assert.ok(sumsAfter.has(sum));
  // The Today approval is still there and still decidable; it names the agent with (retired).
  const rowAfter = await rowOf();
  assert.ok(rowAfter, 'the approval in flight is still on Today');
  assert.equal(rowAfter.agent, 'Story editor (retired)');
  await env.call('venture.queue.decide', { id: rowAfter.id, digest: rowAfter.digest, action: 'deny' });
  assert.equal(listRecords(env.store.read(), 'venture-proposal').find(item => item.id === proposal.id)!.status, 'dismissed');
  // The open note proposal can still be decided, and the kept note's change can still be undone.
  const decided = await env.agents('venture.agents.proposal.decide', { id: open.added[1].proposal.id, digest: open.added[1].proposal.digest, decision: 'reject' });
  assert.equal(decided.proposal.status, 'rejected');
  const notes = await env.agents('venture.agents.notes.list', { agent: 'story-editor' });
  const undone = await env.agents('venture.agents.notes.undo', { agent: 'story-editor', changeId: notes.changes[0].id });
  assert.equal(undone.change.who, 'undo');
  // Handed to the owner: no AI agent card takes its steps, and new work on them runs under the team's own settings.
  const team = await env.call('venture.team.list');
  assert.ok(!team.agents.some((agent: any) => agent.steps.some((step: any) => step.id === 'publish' && agent.id === 'story-editor')));
  assert.equal(jobAgentFor(env.store.read(), currentVenture(env.store.read())!.id, 'story-editor'), 'delivery');
});

test('Bring back restores the agent as it was: its steps, its chat and the routines retirement switched off', async () => {
  const env = await agentBusiness();
  const on = await routine(env, 'story-editor');
  const off = await routine(env, 'story-editor', false, 'Old check');
  const shape = async () => (await env.call('venture.team.list')).agents.map((agent: any) => ({ id: agent.id, steps: agent.steps.map((step: any) => step.id) }));
  const before = await shape();
  await retire(env, 'story-editor', 'packager');
  await assert.rejects(env.agents('venture.agents.restore', { agent: 'story-editor' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.agents('venture.agents.restore', { agent: 'packager' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.agents('venture.agents.restore', { agent: 'story-editor' }), code('ROUTINE_NEEDS_CHECK'), 'switching a routine back on needs a checked connection, as routines.set does');
  assert.equal(routineNow(env, on.id).on, false, 'a refused Bring back changes nothing');
  await checked(env);
  const back = await env.agents('venture.agents.restore', { agent: 'story-editor' });
  assert.equal(back.agent.id, 'story-editor');
  assert.equal(back.routines, 1);
  assert.match(back.line, /Story editor/);
  assert.equal(routineNow(env, on.id).on, true);
  assert.equal(routineNow(env, off.id).on, false, 'a routine that was already off stays off');
  assert.deepEqual(await shape(), before);
  assert.equal((await env.call('venture.team.list')).retired, undefined);
  assert.equal((await env.agents('venture.agents.thread.list', { agent: 'story-editor' })).retired, undefined);
  const [record] = listRecords(env.store.read(), 'venture-agent-retirement');
  assert.ok(record.restoredAt, 'the retirement stays as history');
  await assert.rejects(env.agents('venture.agents.restore', { agent: 'story-editor' }), code('INVALID_VENTURE_REQUEST'));
});

test('handover follows the chain: a receiver that retires passes the work on, and Bring back puts it back', async () => {
  const env = await agentBusiness();
  const steps = async (id: string) => ((await env.call('venture.team.list')).agents.find((agent: any) => agent.id === id)?.steps ?? []).map((step: any) => step.id);
  const editor = await steps('story-editor');
  const packager = await steps('packager');
  await retire(env, 'story-editor', 'packager');
  const seen = await env.agents('venture.agents.retire.check', { agent: 'packager' });
  assert.ok(!seen.to.some((item: any) => item.id === 'story-editor'), 'a retired agent cannot take over');
  await assert.rejects(env.agents('venture.agents.retire', { agent: 'packager', to: 'story-editor', digest: seen.digest }), code('INVALID_VENTURE_REQUEST'));
  await env.agents('venture.agents.retire', { agent: 'packager', to: 'cutter', digest: seen.digest });
  const venture = currentVenture(env.store.read())!;
  assert.equal(jobAgentFor(env.store.read(), venture.id, 'story-editor'), 'cutter');
  for (const step of [...editor, ...packager]) assert.ok((await steps('cutter')).includes(step));
  await env.agents('venture.agents.restore', { agent: 'packager' });
  assert.deepEqual(new Set(await steps('packager')), new Set([...packager, ...editor]));
  assert.equal(jobAgentFor(env.store.read(), venture.id, 'story-editor'), 'packager');
});

test('the last AI agent cannot retire: the check says so and retire refuses with AGENT_LAST_ONE', async () => {
  const env = await agentBusiness(PLAIN_IDEA);
  const seen = await env.agents('venture.agents.retire.check', { agent: 'delivery' });
  assert.deepEqual(seen.to, []);
  assert.ok(seen.blocked);
  await assert.rejects(env.agents('venture.agents.retire', { agent: 'delivery', to: 'owner', digest: seen.digest }), code('AGENT_LAST_ONE'));
  assert.equal(listRecords(env.store.read(), 'venture-agent-retirement').length, 0);
});

test('the new methods are registered: owned by agents, their levels, and retire and Bring back need the app', () => {
  for (const method of ['venture.agents.retire.check', 'venture.agents.retire', 'venture.agents.restore'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'agents');
    assert.equal(typeof (agentHandlers as Record<string, unknown>)[method], 'function');
  }
  assert.equal(METHOD_LEVEL_OF['venture.agents.retire.check'], 'read');
  assert.equal(METHOD_LEVEL_OF['venture.agents.retire'], 'approve');
  assert.equal(METHOD_LEVEL_OF['venture.agents.restore'], 'approve');
  assert.ok(APP_ONLY_METHODS.includes('venture.agents.retire'));
  assert.ok(APP_ONLY_METHODS.includes('venture.agents.restore'));
  assert.ok(!APP_ONLY_METHODS.includes('venture.agents.retire.check'));
});
