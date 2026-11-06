// One-shot C4 task 32: ready routines from the plan. venture.routines.suggestions gives at most two routines the
// business's accepted plan already names (a step whose title says its rhythm), code-written, with the agent and the
// schedule; none when the plan names none; asking writes nothing. A monthly step runs on the 1st of each month.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { BlueprintRecord, RoutineSuggestionsView } from '../runtime/venture/contracts.ts';
import { handlers as agents } from '../runtime/venture/agents/index.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { nextOccurrence, occurrencesBetween, whenWords } from '../runtime/venture/agents/routines.ts';
import { owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const suggestions = (env: Env, payload: unknown = {}) =>
  (agents['venture.routines.suggestions'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<RoutineSuggestionsView>)(env.deps, owner, payload);

/** The accepted plan with its four steps titled as given. */
async function titled(env: Env, titles: string[]): Promise<void> {
  const plan = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  await ventureAction(env.deps, owner, 'admin', 'seed.titles', tx => {
    const stored = tx.find('venture-blueprint', plan.id) as BlueprintRecord;
    tx.replace<BlueprintRecord>({ ...stored, deliverySteps: stored.deliverySteps.map((step, index) => ({ ...step, title: { ...step.title, value: titles[index] ?? step.title.value } })) });
  });
}

test('a plan with a monthly step gives that routine, on the 1st of each month, for the agent, and writes nothing', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const before = env.store.read().conversations.length;
  const view = await suggestions(env);
  assert.equal(view.suggestions.length, 1);
  const [one] = view.suggestions;
  assert.equal(one.name, 'Draft the monthly report for review');
  assert.equal(one.step, 'Draft the monthly report for review');
  assert.equal(one.agent, 'delivery');
  assert.deepEqual(one.schedule, { kind: 'monthly', day: 1, time: '09:00', timeZone: 'Asia/Kolkata' });
  assert.equal(one.when, 'On the 1st of each month, 9:00 am, Asia/Kolkata');
  assert.equal(one.prompt, 'Draft the monthly report for review for this business, from its own records and plan. Keep it as a draft for my approval.');
  assert.equal(env.store.read().conversations.length, before, 'asking stores nothing');
  assert.equal(listRecords(env.store.read(), 'venture-routine').length, 0);
  await assert.rejects(suggestions(env, { extra: 1 }));
});

test('at most two, weekly and daily rhythms read from the words; none when the plan names no recurring step', async () => {
  const env = await setup();
  await titled(env, ['Send the weekly summary', 'Check the inbox every day', 'Draft the monthly report', 'Close each month']);
  const view = await suggestions(env);
  assert.deepEqual(view.suggestions.map(item => [item.name, item.schedule.kind]), [['Send the weekly summary', 'calendar'], ['Check the inbox every day', 'calendar']]);
  assert.deepEqual(view.suggestions[0].schedule, { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' });
  assert.deepEqual(view.suggestions[1].schedule, { kind: 'calendar', weekdays: [1, 2, 3, 4, 5], time: '09:00', timeZone: 'Asia/Kolkata' });

  const none = await setup();
  await titled(none, ['Collect the files', 'Sort every entry', 'Draft the report', 'Send it to the client']);
  assert.deepEqual((await suggestions(none)).suggestions, []);

  const unplanned = await setup();
  assert.deepEqual((await suggestions(unplanned)).suggestions, [], 'no accepted plan, no suggestion');
});

test('a monthly schedule runs on its day each month, at its time where the business is', () => {
  const schedule = { kind: 'monthly' as const, day: 1, time: '09:00', timeZone: 'Asia/Kolkata' };
  // 15 Oct 2026, 10:00 UTC: the next 1st at 09:00 in India is 1 Nov, 03:30 UTC.
  assert.equal(nextOccurrence(schedule, Date.parse('2026-10-15T10:00:00.000Z')), '2026-11-01T03:30:00.000Z');
  const between = occurrencesBetween(schedule, Date.parse('2026-10-15T10:00:00.000Z'), Date.parse('2027-01-15T10:00:00.000Z'));
  assert.deepEqual([between.count, between.latest, between.previous], [3, '2027-01-01T03:30:00.000Z', '2026-12-01T03:30:00.000Z']);
  assert.equal(whenWords({ ...schedule, day: 22 }, { country: { code: 'IN' } as never }), 'On the 22nd of each month, 9:00 am, Asia/Kolkata');
});
