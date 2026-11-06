// C7 task 25: Chats answers a how-to question from Chausar's own guide. The guide tool gives section ids and titles only;
// a guide part names one id and code fills in that section's own words; an id the guide does not have is dropped; with a
// guide part the model keeps at most one sentence of its own, of 30 words or fewer, with no list and no numbered step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guideSection, GUIDE_URL } from '../runtime/venture/core/guide.ts';
import { answer, chatConsent, chiefBusiness, scriptChief, text, tools } from './venture-chief-helpers.ts';

const guidePart = (anchor: string) => ({ kind: 'guide', text: '', receiptId: '', key: anchor });

test('the guide tool lists ids and titles only; a guide part shows the section word for word with its link', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const tasks = scriptChief(env, [tools('guide'), answer([text('Here is how to connect Codex.'), guidePart('chatgpt-plan-codex')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'How do I connect Codex?' });
  const listed = (tasks[1].input as any).results.find((item: any) => item.tool === 'guide').data.sections;
  assert.ok(listed.length > 10);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['id', 'title']);
  const section = guideSection('chatgpt-plan-codex')!;
  assert.deepEqual(sent.added[1].parts, [
    { kind: 'text', text: 'Here is how to connect Codex.' },
    { kind: 'guide', anchor: 'chatgpt-plan-codex', title: section.title, text: section.text, link: `${GUIDE_URL}#chatgpt-plan-codex` },
  ]);
});

test('an id the guide does not have is dropped', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('See the guide.'), guidePart('made-up-part')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'How do I connect Codex?' });
  assert.equal(sent.added[1].parts.some((part: any) => part.kind === 'guide'), false);
});

test("beside a guide part, a numbered step or more than one sentence of the model's own is cut: the quote alone", async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('1. Open Settings. 2. Pick Codex.'), guidePart('chatgpt-plan-codex')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'How do I connect Codex?' });
  assert.deepEqual(sent.added[1].parts.map((part: any) => part.kind), ['guide']);
  const long = await chiefBusiness();
  await chatConsent(long);
  scriptChief(long, [answer([text('First do this. Then do that.'), guidePart('chatgpt-plan-codex')])]);
  const again = await long.chief('venture.chief.thread.send', { text: 'How do I connect Codex?' });
  assert.deepEqual(again.added[1].parts.map((part: any) => part.kind), ['guide']);
});
