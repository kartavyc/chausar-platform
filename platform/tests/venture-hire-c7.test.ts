// C7 task 14: hiring, one phase at a time. Each phase's call has only its own fields and its schema only its own; an
// extra field or a read outside the list is MODEL_OUTPUT_REJECTED; the owner's edit is checked again; review refuses a
// hard stop the owner typed in an edit; confirm with an old digest is APPROVAL_STALE; no client name reaches any phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { agentBusiness, consent } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';
import { HIRE_WORDS } from '../runtime/venture/agents/hire.ts';
import { HARD_STOPS } from '../runtime/venture/policy/hard-stops.ts';

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
  // The AI's draft is said to the owner as "you" (venture-hire-voice.test.ts): "for my approval" reads "for your approval".
  assert.deepEqual(review.card.does, ['Keeps the content calendar up to date', 'Drafts captions for your approval']);
  // What it never does: this agent's own line first (the one that is about it), then every hard stop, all shown open.
  assert.deepEqual(review.card.never, [HIRE_WORDS.never, ...HARD_STOPS.map(stop => stop.line)]);
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
  // A hire cancelled in an older version stays stored; its interview takes no more answers.
  await ventureAction(env.deps, owner, 'prepare', 'test.hire-cancelled', tx => tx.replace({ ...tx.find('venture-agent-hire', other.id)!, status: 'cancelled' }));
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

// Found in the real app on 16 Nov 2026 (Team, Hire): a normal voice from the owner's AI was refused twice, whole, when
// one of its six fields tripped a persona rule the AI had not been told of (a greeting that says "Share a photo", a
// hand-off line that says "check with you", a line longer than its field). The voice is a draft: a field that passes is
// kept and one that does not is left empty, as the instructions say an unneeded field is, so the owner is not sent back.
test('a voice with a field the persona rules refuse keeps the fields that pass and leaves that one empty', async () => {
  const voice = { tone: 'Warm, playful and appetizing', replyLength: 'short', greeting: "Hi! Share a cake photo and I'll draft a caption.",
    handOffLine: 'Let me check with you before this goes anywhere.', blockedTopics: ['medical advice', 'prices', 'approvals'], signOff: 'x'.repeat(90) };
  const { asked, start, answer } = await hiring({ voice });
  const made = await start();
  await answer(made.id, 'role');
  const drafted = await answer(made.id, 'reads');
  assert.equal(drafted.phase, 'voice');
  assert.deepEqual(drafted.voice, { tone: 'Warm, playful and appetizing', replyLength: 'short', greeting: null, handOffLine: null, blockedTopics: ['medical advice', 'prices'], signOff: null });
  assert.equal(asked.length, 3, 'no second call was needed');
  // The schema tells the AI each field's limit, so a normal answer fits the first time.
  const fields = asked[2].schema.properties;
  for (const [name, limit] of [['tone', 160], ['greeting', 80], ['handOffLine', 200], ['signOff', 80]] as const) assert.match(fields[name].description, new RegExp(`${limit} characters`), name);
  // A voice in the wrong shape is still refused.
  const wrong = await hiring({ voice: { ...voice, sends: true } });
  const other = await wrong.start();
  await wrong.answer(other.id, 'role');
  await assert.rejects(wrong.answer(other.id, 'reads'), { code: 'MODEL_OUTPUT_REJECTED' });
});

// The role the AI drafts is read by the same code checks the owner's Next runs. A draft they would refuse (a duty that
// posts, a name already on the team) is asked for once more by the engine, with the reason, before the owner sees it.
test('a drafted role the hire check would refuse is asked for once more with the reason', async () => {
  const drafts = [{ ...ROLE, duties: ['Posts captions to Instagram', 'Keeps a list of caption ideas'] }, ROLE];
  const { env, asked, start, answer } = await hiring();
  env.models.respond['agent-chat'] = task => { asked.push(task); return task.schemaName === 'venture-hire-role' ? drafts.shift() : task.schemaName === 'venture-hire-reads' ? READS : VOICE; };
  const made = await start();
  assert.equal(asked.length, 2);
  assert.deepEqual(Object.keys(asked[0].input), ['sentence']);
  assert.deepEqual(Object.keys(asked[1].input).sort(), ['again', 'sentence']);
  assert.match(asked[1].input.again, /asks you before anything is sent, paid, posted, deleted or priced/);
  assert.deepEqual(made.role.duties, ['Keeps the content calendar up to date', 'Drafts captions for your approval']);
  assert.equal((await answer(made.id, 'role')).phase, 'reads');
  // A name already on the team is a reason too.
  const taken = await hiring();
  const names = [{ ...ROLE, name: 'Mira' }, { ...ROLE, name: 'Tara' }];
  taken.env.models.respond['agent-chat'] = task => { taken.asked.push(task); return task.schemaName === 'venture-hire-role' ? names.shift() : task.schemaName === 'venture-hire-reads' ? READS : VOICE; };
  const first = await taken.start();
  const voiced = await taken.answer(first.id, 'role');
  await taken.answer(voiced.id, 'reads');
  const review = await taken.answer(first.id, 'voice');
  await taken.env.agents('venture.agents.hire.confirm', { hireId: first.id, digest: review.digest });
  names.splice(0, names.length, { ...ROLE, name: 'Mira' }, { ...ROLE, name: 'Tara' });
  const before = taken.asked.length;
  const second = await taken.start();
  assert.equal(taken.asked.length, before + 2);
  assert.match(taken.asked.at(-1).input.again, /already called Mira/);
  assert.equal(second.role.name, 'Tara');
});

test('a role refused twice is shown as drafted, and Next says why in the check\'s own words', async () => {
  const bad = { ...ROLE, duties: ['Posts captions to Instagram'] };
  const { asked, start, answer } = await hiring({ role: bad });
  const made = await start();
  assert.equal(asked.length, 2, 'one more try, never a third');
  assert.deepEqual(made.role.duties, ['Posts captions to Instagram']);
  await assert.rejects(answer(made.id, 'role'), { code: 'HIRE_FLOOR' });
});

test('an answer in the wrong shape is asked for once more before the owner is told', async () => {
  const { env, asked, start } = await hiring();
  let first = true;
  env.models.respond['agent-chat'] = task => { asked.push(task); if (first) { first = false; return { ...ROLE, send: true }; } return ROLE; };
  const made = await start();
  assert.equal(made.phase, 'role');
  assert.equal(asked.length, 2);
  assert.match(asked[1].input.again, /name, a job and duties/);
  const twice = await hiring({ role: { ...ROLE, send: true } });
  await assert.rejects(twice.start(), { code: 'MODEL_OUTPUT_REJECTED' });
  assert.equal(twice.asked.length, 2);
});
