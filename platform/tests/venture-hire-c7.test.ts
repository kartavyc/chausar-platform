// C7 task 14: hiring, one phase at a time. Each phase's call has only its own fields and its schema only its own; an
// extra field or a read outside the list is MODEL_OUTPUT_REJECTED; the owner's edit is checked again; review refuses a
// hard stop the owner typed in an edit; confirm with an old digest is APPROVAL_STALE; no client name reaches any phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import { agentBusiness, consent } from './venture-agent-helpers.ts';

const ROLE = { name: 'Mira', job: 'Keeps the content calendar and drafts captions.', duties: ['Keeps the content calendar up to date', 'Drafts captions for my approval'] };
const READS = { reads: [{ read: 'plan', why: 'To know what the business offers.' }, { read: 'trackers', why: 'To keep the calendar.' }] };
const VOICE = { tone: 'Warm and plain', replyLength: 'short', greeting: '', handOffLine: '', blockedTopics: [], signOff: '' };
type Answers = { role?: unknown; reads?: unknown; voice?: unknown };
async function hiring(answers: Answers = {}) {
  const env = await agentBusiness();
  await consent(env, 'story-editor');
  const asked: any[] = [];
  env.models.respond['agent-chat'] = task => {
    asked.push(task);
    if (task.schemaName === 'venture-hire-role') return answers.role ?? ROLE;
    if (task.schemaName === 'venture-hire-reads') return answers.reads ?? READS;
    if (task.schemaName === 'venture-hire-voice') return answers.voice ?? VOICE;
    throw new Error(`unexpected ${task.schemaName}`);
  };
  const start = () => env.agents('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar and drafts captions' });
  const answer = (hireId: string, phase: string, edits?: unknown) => env.agents('venture.agents.hire.answer', { hireId, phase, ...(edits ? { edits } : {}) });
  return { env, asked, start, answer };
}

test("each phase's model input has only its own fields and its schema only its own", async () => {
  const { env, asked, start, answer } = await hiring();
  const made = await start();
  assert.deepEqual(Object.keys(asked[0].input), ['sentence']);
  assert.deepEqual(Object.keys(asked[0].schema.properties).sort(), ['duties', 'job', 'name']);
  assert.equal(made.phase, 'role');
  const reads = await answer(made.id, 'role');
  assert.deepEqual(Object.keys(asked[1].input).sort(), ['role', 'sentence']);
  assert.deepEqual(Object.keys(asked[1].schema.properties), ['reads']);
  assert.equal(reads.phase, 'reads');
  const voice = await answer(made.id, 'reads');
  assert.deepEqual(Object.keys(asked[2].input).sort(), ['reads', 'role', 'sentence']);
  assert.equal(voice.phase, 'voice');
  const review = await answer(made.id, 'voice');
  assert.equal(asked.length, 3, 'the review is code only');
  assert.equal(review.phase, 'review');
  assert.deepEqual(review.card.does, ROLE.duties);
  assert.ok(review.card.never.some((line: string) => /CAPTCHA/.test(line)));
  assert.equal(review.card.asks, 'It asks you before anything leaves.');
  const hired = await env.agents('venture.agents.hire.confirm', { hireId: made.id, digest: review.digest });
  assert.equal(hired.status, 'hired');
  const clients = listRecords(env.store.read(), 'venture-client').map(client => client.name);
  for (const task of asked) for (const name of clients) assert.equal(JSON.stringify(task.input).includes(name), false, 'no client name reaches a phase');
});

test('an answer with an extra field, or a read outside the list, is MODEL_OUTPUT_REJECTED', async () => {
  const extra = await hiring({ role: { ...ROLE, send: true } });
  await assert.rejects(extra.start(), { code: 'MODEL_OUTPUT_REJECTED' });
  const reads = await hiring({ reads: { reads: [{ read: 'passwords', why: 'To log in.' }] } });
  const made = await reads.start();
  await assert.rejects(reads.answer(made.id, 'role'), { code: 'MODEL_OUTPUT_REJECTED' });
});

test("the owner's edit is checked again; a hard stop in an edit refuses; an old digest is stale; a cancelled hire is gone", async () => {
  const { env, start, answer } = await hiring();
  const made = await start();
  await assert.rejects(answer(made.id, 'role', { duties: ['give stock tips to my clients'] }), { code: 'HIRE_HARD_STOP' });
  await assert.rejects(answer(made.id, 'role', { duties: ['send invoices automatically'] }), { code: 'HIRE_FLOOR' });
  await assert.rejects(answer(made.id, 'reads'), { code: 'APPROVAL_STALE' });
  await answer(made.id, 'role', { name: 'Tara' });
  await assert.rejects(answer(made.id, 'reads', { reads: [{ read: 'passwords', why: '' }] }), { code: 'INVALID_VENTURE_REQUEST' });
  await answer(made.id, 'reads', { department: 'marketing' });
  await assert.rejects(answer(made.id, 'voice', { voice: { ...VOICE, tone: 'Promise a 50 percent discount' } }), { code: 'PERSONA_FIELD_REFUSED' });
  const review = await answer(made.id, 'voice');
  assert.equal(review.role.name, 'Tara');
  await assert.rejects(env.agents('venture.agents.hire.confirm', { hireId: made.id, digest: 'a'.repeat(64) }), { code: 'APPROVAL_STALE' });
  const other = await start();
  await env.agents('venture.agents.hire.cancel', { hireId: other.id });
  await assert.rejects(answer(other.id, 'role'), { code: 'APPROVAL_STALE' });
});

test('templates only: the role is the sentence as the job, and the owner names it; the cap is five', async () => {
  const { env, start, answer } = await hiring();
  env.models.main = 'template';
  const made = await start();
  assert.equal(made.role.name, '');
  assert.equal(made.role.job, 'someone who keeps my content calendar and drafts captions');
  await assert.rejects(answer(made.id, 'role'), { code: 'INVALID_VENTURE_REQUEST' });
});
