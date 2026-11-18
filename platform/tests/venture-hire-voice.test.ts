// The hand hire's AI drafts speak to the owner as "you" (15 Nov 2026). The agents proposed at setup were turned to
// that voice on 14 Nov (core/owner-voice.ts), but a role drafted in the hire interview still came out as the owner's
// own first person turned around ("Reminds me about follow ups", "Drafts captions for my approval"), which reads
// oddly on the card and on Team. The AI is now asked for "you", code turns what still comes out as "me" or "my", and
// what the owner types themselves stays exactly as typed. The hire check reads both voices the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentBusiness, consent } from './venture-agent-helpers.ts';

const SENTENCE = 'someone who keeps my content calendar and reminds me about follow ups';
const ROLE = { name: 'Mira', job: 'Keeps my content calendar and reminds me about follow ups.', duties: ['Keeps my content calendar up to date', 'Reminds me about follow ups', 'Drafts captions for my approval'] };
const READS = { reads: [{ read: 'plan', why: 'To know what my business offers.' }, { read: 'trackers', why: 'To keep the calendar.' }] };
const VOICE = { tone: 'Warm and plain', replyLength: 'short', greeting: "Hello, I'm Mira.", handOffLine: '', blockedTopics: [], signOff: '' };

async function hiring(answers: { role?: unknown } = {}) {
  const env = await agentBusiness();
  await consent(env, 'story-editor');
  const asked: any[] = [];
  env.models.respond['agent-chat'] = task => {
    asked.push(task);
    if (task.schemaName === 'venture-hire-role') return answers.role ?? ROLE;
    if (task.schemaName === 'venture-hire-reads') return READS;
    if (task.schemaName === 'venture-hire-voice') return VOICE;
    throw new Error(`unexpected ${task.schemaName}`);
  };
  const start = () => env.agents('venture.agents.hire.start', { sentence: SENTENCE });
  const answer = (hireId: string, phase: string, edits?: unknown) => env.agents('venture.agents.hire.answer', { hireId, phase, ...(edits ? { edits } : {}) });
  return { env, asked, start, answer };
}

test('the role your AI drafts is said to the owner: "you" and "your", never "me" or "my"', async () => {
  const { asked, start, answer, env } = await hiring();
  const made = await start();
  assert.deepEqual(made.role, {
    name: 'Mira', job: 'Keeps your content calendar and reminds you about follow ups.',
    duties: ['Keeps your content calendar up to date', 'Reminds you about follow ups', 'Drafts captions for your approval'],
  });
  // The AI is asked for that voice in the first place.
  assert.match(asked[0].instructions, /Say "you" for the owner, never "me" or "my"\./);
  // What the owner said is theirs: the sentence is kept and sent as they typed it.
  assert.equal(made.sentence, SENTENCE);
  assert.equal(asked[0].input.sentence, SENTENCE);
  // Why it reads each area is the AI's draft too.
  const reads = await answer(made.id, 'role');
  assert.deepEqual(reads.reads, [{ read: 'plan', why: 'To know what your business offers.' }, { read: 'trackers', why: 'To keep the calendar.' }]);
  // How the agent talks is its own voice: its "I" is the agent, and is never turned.
  const voice = await answer(made.id, 'reads');
  assert.equal(voice.voice.greeting, "Hello, I'm Mira.");
  // The check passes the turned role, and the card the owner approves reads in that voice.
  const review = await answer(made.id, 'voice');
  assert.deepEqual(review.card.does, ['Keeps your content calendar up to date', 'Reminds you about follow ups', 'Drafts captions for your approval']);
  const hired = await env.agents('venture.agents.hire.confirm', { hireId: made.id, digest: review.digest });
  assert.equal(hired.status, 'hired');
  assert.equal(hired.role.job, 'Keeps your content calendar and reminds you about follow ups.');
});

test('what the owner types themselves is never turned, and the check reads it the same way', async () => {
  const { start, answer } = await hiring();
  const made = await start();
  // The owner rewrites the job and one duty in their own words; the untouched duties keep the AI's turned words.
  const mine = { job: 'Keeps my calendar and nudges me.', duties: ['Reminds me to post on Fridays', 'Drafts captions for your approval'] };
  const next = await answer(made.id, 'role', mine);
  assert.equal(next.role.job, 'Keeps my calendar and nudges me.');
  assert.deepEqual(next.role.duties, ['Reminds me to post on Fridays', 'Drafts captions for your approval']);
  // An outward act is refused in either voice, typed or drafted.
  const other = await start();
  await assert.rejects(answer(other.id, 'role', { duties: ['Sends invoices without asking me'] }), { code: 'HIRE_FLOOR' });
  await assert.rejects(answer(other.id, 'role', { duties: ['Sends invoices without asking you'] }), { code: 'HIRE_FLOOR' });
});

test('with templates only the role is the owner\'s own sentence, as typed', async () => {
  const { env, start } = await hiring();
  env.models.main = 'template';
  const made = await start();
  assert.equal(made.role.job, SENTENCE);
  assert.deepEqual(made.role.duties, [SENTENCE]);
});
