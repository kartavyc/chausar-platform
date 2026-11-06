// One-shot A3 (S3 in the W6 hands-on report): Chats works live, and when the AI call itself fails (a used-up plan, a
// timeout, a tool that stopped) Chausar still answers from the business's own records. The answer says plainly that the
// AI couldn't answer, and shows what the records say, every figure with its receipt. What needs the owner (the chat
// consent, a client record that changed) still stops the answer. A number the model writes in words stays a model
// estimate. Nothing here touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { AI_FAILED_LEAD } from '../runtime/venture/chief/answer.ts';
import { answer, chatConsent, chiefBusiness, estimate, scriptChief, text, tools } from './venture-chief-helpers.ts';
import { code } from './venture-judge-helpers.ts';

const QUESTION = 'How is money this month?';
const USED_UP = 'Claude has used up your plan for now. Wait for it to reset, or choose another AI under Connections, Your AI.';

test('A3 S3: an AI call that fails with a named failure is answered from the records, saying the AI could not answer', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('never used')])]);
  env.models.failNextSend = new ChausarError('AI_USAGE_LIMIT', USED_UP);
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  const reply = sent.added[1];
  assert.equal(reply.from, 'chief');
  assert.deepEqual(reply.parts.slice(0, 2), [{ kind: 'text', text: AI_FAILED_LEAD }, { kind: 'text', text: USED_UP }]);
  assert.equal(AI_FAILED_LEAD, "Your AI couldn't answer this time, so here is what Chausar's records say.");
  const figures = reply.parts.filter((part: any) => part.kind === 'figure');
  assert.ok(figures.length >= 1, 'what the records say, with receipts');
  for (const figure of figures) assert.match(figure.receiptId, /^\w+_/, `${figure.display} carries its receipt`);
  assert.ok(reply.counted && Array.isArray(reply.counted.entities), 'the counts by code ride along');
  const kept = listRecords(env.store.read(), 'venture-chief-message').at(-1)!;
  assert.equal(kept.author, 'template', 'the answer is the records\', not the AI\'s');
});

test('A3 S3: a failure with no owner words of its own (a time-out) gets the lead alone', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('never used')])]);
  env.models.failNextSend = new ChausarError('MODEL_TIMEOUT', 'The installed model command timed out.');
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  const parts = sent.added[1].parts;
  assert.deepEqual(parts[0], { kind: 'text', text: AI_FAILED_LEAD });
  assert.equal(parts.some((part: any) => part.kind === 'text' && /timed out/.test(part.text)), false, 'no tool words');
  assert.ok(parts.some((part: any) => part.kind === 'figure'));
});

test('A3 review 2 L-b: a call whose outcome is unknown says it may have run and charged, after the lead', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('never used')])]);
  const words = 'The connection to the model provider broke part way. It may have run and charged for it. Chausar did not retry it.';
  env.models.failNextSend = new ChausarError('MODEL_OUTCOME_UNKNOWN', words);
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  assert.deepEqual(sent.added[1].parts.slice(0, 2), [{ kind: 'text', text: AI_FAILED_LEAD }, { kind: 'text', text: words }]);
});

test('A3 S3: a failure on a later turn keeps the figures read so far', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const tasks = scriptChief(env, [tools('money'), answer([text('never used')])]);
  let sends = 0;
  env.models.onSend = async () => { sends += 1; if (sends === 2) env.models.failNextSend = new ChausarError('MODEL_FAILED', 'Claude stopped with an error.'); };
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  assert.equal(tasks.length, 1, 'the second turn never got an answer');
  assert.deepEqual(sent.added[1].parts[0], { kind: 'text', text: AI_FAILED_LEAD });
  assert.ok(sent.added[1].parts.some((part: any) => part.kind === 'figure'), 'the money tool read on turn one is shown');
});

test('A3 S3: what needs the owner still stops the answer: a changed AI connection, a client record that changed', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('never used')])]);
  env.models.failNextSend = new ChausarError('CHAT_CONSENT_STALE', 'Your AI connection changed since you agreed, so chats wait until you agree again.');
  await assert.rejects(env.chief('venture.chief.thread.send', { text: QUESTION }), code('CHAT_CONSENT_STALE'));
  scriptChief(env, [answer([text('never used')])]);
  env.models.failNextSend = new ChausarError('JOB_SOURCE_CHANGED', 'The client records changed during this answer. Ask again.');
  await assert.rejects(env.chief('venture.chief.thread.send', { text: QUESTION }), code('JOB_SOURCE_CHANGED'));
  assert.equal(listRecords(env.store.read(), 'venture-chief-message').length, 0, 'nothing stored');
});

test('A3 S3: Chats answers live, and a number the model writes is a model estimate, never a figure', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('Nothing is invoiced yet.'), estimate('Maybe two weeks.'), text('About 3 clients could reorder.')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  assert.deepEqual(sent.added[1].parts, [
    { kind: 'text', text: 'Nothing is invoiced yet.' },
    { kind: 'estimate', text: 'Maybe two weeks.' },
    { kind: 'estimate', text: 'About 3 clients could reorder.' },
  ]);
  assert.equal(listRecords(env.store.read(), 'venture-chief-message').at(-1)!.author, 'model');
});

// Found by the A3 live check on Codex: every Chats call was refused before it reached the AI, because the chief's answer
// schema carried a keyword the model schema rule does not allow (maxLength on each proposal's reason). The test port
// never ran that rule, so it was hidden; these tests run it.
test('A3 S3: the chief\'s answer schema passes the model schema rule every real call is held to', async () => {
  const { assertSchemaSafe } = await import('../runtime/venture/models/schema.ts');
  const { CHIEF_TURN_SCHEMA } = await import('../runtime/venture/chief/answer.ts');
  assert.doesNotThrow(() => assertSchemaSafe(CHIEF_TURN_SCHEMA));
});

test('A3 S3: with the schema rule held at every preview, as the real models port holds it, Chats answers with the AI\'s words', async () => {
  const { assertSchemaSafe } = await import('../runtime/venture/models/schema.ts');
  const env = await chiefBusiness();
  await chatConsent(env);
  env.models.refusePreview = task => { assertSchemaSafe(task.schema); return null; };
  scriptChief(env, [answer([text('Nothing is invoiced yet this month.')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
  assert.deepEqual(sent.added[1].parts, [{ kind: 'text', text: 'Nothing is invoiced yet this month.' }]);
  assert.equal(listRecords(env.store.read(), 'venture-chief-message').at(-1)!.author, 'model');
});

// A3 review (M2): the records answer is only for the AI call itself failing. A refusal that tells the owner what to fix
// says its own words; anything else (an engine bug, a refused schema) is an error, noted as a crash, never hidden.
test('A3 review M2: only the AI call failing falls back to the records; the allow-list', async () => {
  for (const code of ['AI_USAGE_LIMIT', 'AI_RATE_LIMITED', 'AI_STREAM_CUT', 'MODEL_FAILED', 'MODEL_TIMEOUT', 'MODEL_OUTCOME_UNKNOWN', 'RESPONSE_TOO_LARGE']) {
    const env = await chiefBusiness();
    await chatConsent(env);
    scriptChief(env, [answer([text('never used')])]);
    env.models.failNextSend = new ChausarError(code, 'Synthetic failure words.');
    const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
    assert.deepEqual(sent.added[1].parts[0], { kind: 'text', text: AI_FAILED_LEAD }, code);
  }
});

test('A3 review M2: a refusal with its own fix says its own words, not the records lead', async () => {
  for (const code of ['MODEL_KEY_MISSING', 'BUDGET_REACHED', 'CODEX_SETUP_CHANGED', 'CODEX_SETUP_UNAVAILABLE', 'PRESET_UNAVAILABLE', 'CLI_UNAVAILABLE']) {
    const env = await chiefBusiness();
    await chatConsent(env);
    scriptChief(env, [answer([text('never used')])]);
    env.models.failNextSend = new ChausarError(code, `Synthetic words with the fix for ${code}.`);
    await assert.rejects(env.chief('venture.chief.thread.send', { text: QUESTION }), (error: any) => error.code === code && error.message.includes('the fix'), code);
    assert.equal(listRecords(env.store.read(), 'venture-chief-message').length, 0, `${code}: nothing stored`);
  }
});

test('A3 review M2: an engine error is never hidden: a plain error and a refused schema are thrown, and become REQUEST_FAILED', async () => {
  const { ownerError } = await import('../runtime/owner-error.ts');
  const plain = await chiefBusiness();
  await chatConsent(plain);
  scriptChief(plain, [answer([text('never used')])]);
  plain.models.failNextSend = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) as never;
  const thrown = await plain.chief('venture.chief.thread.send', { text: QUESTION }).then(() => null, (error: unknown) => error);
  assert.ok(thrown, 'not answered from the records');
  assert.equal(ownerError(thrown).code, 'REQUEST_FAILED');
  const schema = await chiefBusiness();
  await chatConsent(schema);
  scriptChief(schema, [answer([text('never used')])]);
  schema.models.refusePreview = () => new ChausarError('INVALID_VENTURE_REQUEST', 'The model schema is not allowed at the root.');
  // A3 review 2 (L-a): an INVALID_VENTURE_REQUEST from the models port is an engine bug, not a refusal for the owner.
  const refused = await schema.chief('venture.chief.thread.send', { text: QUESTION }).then(() => null, (error: unknown) => error);
  assert.ok(refused, 'not answered from the records');
  assert.equal(ownerError(refused).code, 'REQUEST_FAILED');
});
