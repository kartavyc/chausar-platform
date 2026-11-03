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

test('A3 S3: a failure with no owner words of its own (a timeout, an unknown error) gets the lead alone', async () => {
  for (const failure of [new ChausarError('MODEL_TIMEOUT', 'The installed model command timed out.'), Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })]) {
    const env = await chiefBusiness();
    await chatConsent(env);
    scriptChief(env, [answer([text('never used')])]);
    env.models.failNextSend = failure as ChausarError;
    const sent = await env.chief('venture.chief.thread.send', { text: QUESTION });
    const parts = sent.added[1].parts;
    assert.deepEqual(parts[0], { kind: 'text', text: AI_FAILED_LEAD });
    assert.equal(parts.some((part: any) => part.kind === 'text' && /timed out|socket|ECONNRESET/.test(part.text)), false, 'no tool or library words');
    assert.ok(parts.some((part: any) => part.kind === 'figure'));
  }
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
