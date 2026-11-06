// C7 task 15: the hired agent on the team. It shows on Team and in routing by name; its chat facts hold only what its reads
// allow (no money facts without the money read); it can be retired and restored; its posture cannot be loosened; a routine
// may ask it; a "from now on" to it says its duties change in its sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { teamAgents } from '../runtime/venture/chief/routing.ts';
import { currentVenture } from '../runtime/venture/records.ts';
import { HIRE_DUTIES_LINE } from '../runtime/venture/agents/hired-facts.ts';
import { agentBusiness, consent, said } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const ROLE = { name: 'Mira', job: 'Keeps the content calendar.', duties: ['Keeps the content calendar up to date'] };
async function hired(reads: { read: string; why: string }[]) {
  const env = await agentBusiness();
  await consent(env, 'story-editor');
  const asked: any[] = [];
  env.models.respond['agent-chat'] = task => {
    asked.push(task);
    if (task.schemaName === 'venture-hire-role') return ROLE;
    if (task.schemaName === 'venture-hire-reads') return { reads };
    if (task.schemaName === 'venture-hire-voice') return { tone: '', replyLength: 'short', greeting: '', handOffLine: '', blockedTopics: [], signOff: '' };
    return { parts: [said('Here is what I know.')] };
  };
  const made = await env.agents('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar' });
  await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'role' });
  await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'reads', edits: { department: 'marketing' } });
  const review = await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'voice' });
  await env.agents('venture.agents.hire.confirm', { hireId: made.id, digest: review.digest });
  return { env, asked, id: made.id };
}
const team = (env: any) => (viewHandlers as any)['venture.team.list'](env.deps, owner, {});

test('a hired agent shows on Team and in routing by name, with its department, the day and always approve each', async () => {
  const { env, id } = await hired([{ read: 'plan', why: 'To know the offers.' }]);
  const view = await team(env);
  const mira = view.agents.find((agent: any) => agent.id === id);
  assert.equal(mira.name, 'Mira');
  assert.equal(mira.department, 'marketing');
  assert.equal(mira.posture, 'approve-each');
  assert.match(mira.hired.line, /^Hired by you on /);
  assert.deepEqual(mira.steps, []);
  assert.ok(teamAgents(env.store.read(), currentVenture(env.store.read())!).some(agent => agent.id === id && agent.name === 'Mira'));
});

test('its chat facts hold only what its reads allow: no money facts without the money read', async () => {
  const none = await hired([{ read: 'plan', why: 'To know the offers.' }]);
  await none.env.agents('venture.agents.thread.send', { agent: none.id, text: 'What do my clients owe me?' });
  const first = none.asked.at(-1);
  assert.equal(first.schemaName, 'venture-agent-answer');
  assert.deepEqual(first.input.figures, []);
  assert.deepEqual(Object.keys(first.input.reads), ['plan']);
  assert.equal(JSON.stringify(first.input.reads).includes('owed'), false);
  const money = await hired([{ read: 'money', why: 'To say what is owed.' }]);
  await money.env.agents('venture.agents.thread.send', { agent: money.id, text: 'What do my clients owe me?' });
  assert.deepEqual(Object.keys(money.asked.at(-1).input.reads), ['money']);
});

test('it can be retired and restored; its posture cannot be loosened; a "from now on" points to its sheet; a routine may ask it', async () => {
  const { env, id } = await hired([]);
  await assert.rejects((viewHandlers as any)['venture.team.posture'](env.deps, owner, { agentId: id, posture: 'approve-each' }), { code: 'HIRE_POSTURE_FIXED' });
  const sent = await env.agents('venture.agents.thread.send', { agent: id, text: 'From now on write shorter captions' });
  assert.equal(sent.added.at(-1).message.parts[0].text, HIRE_DUTIES_LINE);
  const { ventureAction } = await import('../runtime/venture/records.ts');
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put({ ...tx.base('venture-connector-check'), rows: [{ connectorId: 'model:anthropic-sonnet-5-5', outcome: 'answered', line: 'Answered.', account: null, expiresOn: null }] } as any));
  const routine = await env.agents('venture.routines.set', { routine: { name: 'Calendar check', agent: id, prompt: 'List what is due on the content calendar this week and flag anything late.', on: true, schedule: { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' } } });
  assert.equal(routine.routine.agent, id);
  const check = await env.agents('venture.agents.retire.check', { agent: id });
  await env.agents('venture.agents.retire', { agent: id, to: 'owner', digest: check.digest });
  assert.equal((await team(env)).agents.some((agent: any) => agent.id === id), false);
  await env.agents('venture.agents.restore', { agent: id });
  assert.equal((await team(env)).agents.some((agent: any) => agent.id === id), true);
});
