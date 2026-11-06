// Chat states (wave 6, package 6G1, decision D42): every Chats thread is Pinned, Active, Snoozed or Settled. A chat
// that has been quiet for the owner's number of days (7 by default) settles on its own, never while a step waits for
// the owner or the chief's question waits for an answer; such a chat is never hidden, so it also wakes from a snooze
// early. Snooze presets are worked out by the engine on the owner's own clock. Every state change is an owner action
// with its Undo, and none touches a message or a receipt. The settled chats are the archive Settings shows.
// Settlement rules learned from T3 Code's ThreadSettlementService and threadSettled (MIT, T3 Tools Inc.); reimplemented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { appendChiefMessage, draftProposal } from '../runtime/venture/chief/store.ts';
import type { ChiefThreadRecord, ProposalRecord } from '../runtime/venture/contracts.ts';
import { code, owner, phone } from './venture-judge-helpers.ts';
import { chatConsent, chiefBusiness, scriptChief, type ChiefEnv } from './venture-chief-helpers.ts';

/** A thread whose last message is at, read. */
async function seedThread(env: ChiefEnv, title: string, at: string): Promise<string> {
  env.setNow(at);
  return ventureAction(env.deps, owner, 'prepare', 'seed.chief', tx => {
    const thread = tx.put<ChiefThreadRecord>({ ...tx.base('venture-chief-thread'), title, pinned: false, routine: null, lastAt: tx.now });
    appendChiefMessage(tx, { threadId: thread.id, from: 'owner', text: title, author: 'owner' });
    const answered = appendChiefMessage(tx, { threadId: thread.id, from: 'chief', text: `About ${title.toLowerCase()}`, author: 'model', receiptIds: ['R-seed'] });
    tx.replace({ ...answered, read: true });
    return thread.id;
  });
}

/** A step drafted in the thread, waiting for the owner's Start or Not now. */
async function draftIn(env: ChiefEnv, threadId: string): Promise<string> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.proposal', tx => draftProposal(tx, {
    kind: 'quote', source: 'chief', title: 'Quote the long episode', line: 'Chausar works out the price with its receipt. Nothing is sent.', input: {}, threadId,
  }).id);
}

const summaryOf = async (env: ChiefEnv, threadId: string) => (await env.chief('venture.chief.thread.list', { threadId })).thread;
const groupsOf = async (env: ChiefEnv) => (await env.chief('venture.chief.threads')).groups.map((group: any) => [group.key, group.threads.map((thread: any) => thread.id)]);

// Wednesday 21 October 2026, 11:30 in India.
const NOW = '2026-10-21T06:00:00.000Z';

test('6G1: pin, snooze, settle and back to active, each an owner action from the app with its Undo', async () => {
  const env = await chiefBusiness();
  const a = await seedThread(env, 'First question', '2026-10-20T06:00:00.000Z');
  const b = await seedThread(env, 'Second question', '2026-10-21T05:00:00.000Z');
  env.setNow(NOW);
  const fresh = await summaryOf(env, a);
  assert.equal(fresh.state, 'active');
  assert.equal(fresh.snoozedUntil, null);
  assert.equal(fresh.settled, null);
  assert.equal(fresh.waiting, false);

  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'settled' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'gone' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed' }), code('INVALID_VENTURE_REQUEST'), 'a snooze needs a preset or a time');
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'active', preset: 'later' }), code('INVALID_VENTURE_REQUEST'));

  const pinned = await env.chief('venture.chief.thread.state', { threadId: a, state: 'pinned' });
  assert.equal(pinned.thread.state, 'pinned');
  assert.equal(pinned.thread.pinned, true);
  assert.deepEqual(pinned.undo, { threadId: a, state: 'active' });
  assert.deepEqual(await groupsOf(env), [['pinned', [a]], ['today', [b]]]);

  const snoozed = await env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', preset: 'tomorrow' });
  assert.equal(snoozed.thread.state, 'snoozed');
  assert.equal(snoozed.thread.pinned, false, 'the four states are one at a time');
  assert.equal(snoozed.thread.snoozedUntil, '2026-10-22T03:30:00.000Z', 'tomorrow at 09:00 in India');
  assert.deepEqual(snoozed.undo, { threadId: a, state: 'pinned' });
  assert.equal(snoozed.line, 'Snoozed until 22 Oct 2026, 9:00 am. It comes back early if it needs you.');
  assert.deepEqual(await groupsOf(env), [['today', [b]], ['snoozed', [a]]], 'a snoozed chat sits at the end, out of the way');

  const settled = await env.chief('venture.chief.thread.state', { threadId: a, state: 'settled' });
  assert.equal(settled.thread.state, 'settled');
  assert.deepEqual(settled.thread.settled, { at: NOW, by: 'owner' });
  assert.equal(settled.thread.snoozedUntil, null);
  assert.equal(settled.line, 'Moved to old chats. It stays there until you open it again.');
  assert.deepEqual(settled.undo, { threadId: a, state: 'snoozed', until: '2026-10-22T03:30:00.000Z' }, 'Undo puts the same wake time back');
  const view = await env.chief('venture.chief.threads');
  assert.deepEqual(view.groups.map((group: any) => group.key), ['today'], 'a settled chat leaves the list');
  assert.deepEqual(view.settled.map((thread: any) => thread.id), [a], 'and is in the archive');
  assert.equal(view.settleAfterDays, 7);

  const undone = await env.chief('venture.chief.thread.state', settled.undo);
  assert.equal(undone.thread.state, 'snoozed');
  assert.equal(undone.thread.snoozedUntil, '2026-10-22T03:30:00.000Z');
  const active = await env.chief('venture.chief.thread.state', { threadId: a, state: 'active' });
  assert.equal(active.thread.state, 'active');
  assert.deepEqual(active.undo, { threadId: a, state: 'snoozed', until: '2026-10-22T03:30:00.000Z' });

  // The old pin method still works and is the same state.
  const viaPin = await env.chief('venture.chief.thread.pin', { threadId: b, pinned: true });
  assert.equal(viaPin.thread.state, 'pinned');
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: 'chiefthread_nowhere', state: 'active' }), code('INVALID_VENTURE_REQUEST'));
});

test('6G1: snooze presets on the owner\'s clock; a past time is refused; the chat wakes when its time comes', async () => {
  const env = await chiefBusiness();
  const a = await seedThread(env, 'Snooze me', '2026-10-21T05:00:00.000Z');
  env.setNow(NOW);
  const opened = await env.chief('venture.chief.thread.list', { threadId: a });
  assert.deepEqual(opened.snooze, [
    { id: 'later', until: '2026-10-21T09:00:00.000Z' },
    { id: 'tomorrow', until: '2026-10-22T03:30:00.000Z' },
    { id: 'next-week', until: '2026-10-26T03:30:00.000Z' },
  ], 'in three hours, tomorrow 09:00 and Monday 09:00, where the business is');
  // On a Sunday, tomorrow is next week's Monday: one choice, never two at the same minute.
  env.setNow('2026-10-25T06:00:00.000Z');
  assert.deepEqual((await env.chief('venture.chief.thread.list', { threadId: a })).snooze, [
    { id: 'later', until: '2026-10-25T09:00:00.000Z' }, { id: 'tomorrow', until: '2026-10-26T03:30:00.000Z' },
  ]);
  // On a Monday, next week is the Monday after.
  env.setNow('2026-10-26T06:00:00.000Z');
  assert.equal((await env.chief('venture.chief.thread.list', { threadId: a })).snooze.at(-1).until, '2026-11-02T03:30:00.000Z');

  env.setNow(NOW);
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', until: '2026-10-21T05:59:00.000Z' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', preset: 'someday' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', preset: 'later', until: '2026-10-22T03:30:00.000Z' }), code('INVALID_VENTURE_REQUEST'));
  const later = await env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', preset: 'later' });
  assert.equal(later.thread.snoozedUntil, '2026-10-21T09:00:00.000Z');
  env.setNow('2026-10-21T08:59:00.000Z');
  assert.equal((await summaryOf(env, a)).state, 'snoozed');
  env.setNow('2026-10-21T09:00:00.000Z');
  const woke = await summaryOf(env, a);
  assert.equal(woke.state, 'active');
  assert.equal(woke.snoozedUntil, null, 'a past wake time is not shown');
});

test('6G1: a chat quiet for 7 days settles on its own; pinned, waiting and reopened chats do not', async () => {
  const env = await chiefBusiness();
  const quiet = await seedThread(env, 'Quiet for eight days', '2026-10-13T06:00:00.000Z');
  const recent = await seedThread(env, 'Quiet for six days', '2026-10-15T06:00:00.000Z');
  const pinned = await seedThread(env, 'Pinned and quiet', '2026-10-01T06:00:00.000Z');
  const waiting = await seedThread(env, 'A step waits', '2026-10-01T07:00:00.000Z');
  await draftIn(env, waiting);
  env.setNow(NOW);
  await env.chief('venture.chief.thread.state', { threadId: pinned, state: 'pinned' });

  const view = await env.chief('venture.chief.threads');
  assert.deepEqual(view.settled.map((thread: any) => [thread.id, thread.settled]), [[quiet, { at: '2026-10-20T06:00:00.000Z', by: 'auto' }]]);
  const shown = view.groups.flatMap((group: any) => group.threads.map((thread: any) => thread.id));
  assert.deepEqual(shown.sort(), [recent, pinned, waiting].sort());
  const step = view.groups.flatMap((group: any) => group.threads).find((thread: any) => thread.id === waiting);
  assert.equal(step.waiting, true);
  assert.equal(step.state, 'active');

  // A chat that waits for the owner is never hidden by the owner either.
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: waiting, state: 'settled' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: waiting, state: 'snoozed', preset: 'later' }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual((await env.chief('venture.chief.thread.list', { threadId: waiting })).snooze, [], 'no presets while it waits');

  // Reopening an auto-settled chat keeps it active for another full quiet spell, with Undo back to settled.
  const reopened = await env.chief('venture.chief.thread.state', { threadId: quiet, state: 'active' });
  assert.equal(reopened.thread.state, 'active');
  assert.deepEqual(reopened.undo, { threadId: quiet, state: 'settled' });
  env.setNow('2026-10-28T05:59:00.000Z');
  assert.equal((await summaryOf(env, quiet)).state, 'active');
  env.setNow('2026-10-28T06:00:00.000Z');
  assert.deepEqual((await summaryOf(env, quiet)).settled, { at: '2026-10-28T06:00:00.000Z', by: 'auto' });

  // The owner's number of days: 0 is off; Undo gives the number before.
  env.setNow(NOW);
  await assert.rejects(env.chief('venture.chief.settle.set', { days: 0 }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.chief.settle.set', { days: -1 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.settle.set', { days: 2.5 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.settle.set', { days: 366 }), code('INVALID_VENTURE_REQUEST'));
  const off = await env.chief('venture.chief.settle.set', { days: 0 });
  assert.deepEqual(off, { days: 0, undo: 7, line: 'Chats never settle on their own.' });
  assert.deepEqual((await env.chief('venture.chief.threads')).settled, []);
  const two = await env.chief('venture.chief.settle.set', { days: 3 });
  assert.deepEqual(two, { days: 3, undo: 0, line: 'Chats settle after 3 quiet days.' });
  // Six days quiet is past three; the chat reopened today is not.
  assert.deepEqual((await env.chief('venture.chief.threads')).settled.map((thread: any) => [thread.id, thread.settled]), [[recent, { at: '2026-10-18T06:00:00.000Z', by: 'auto' }]]);
});

test('6G1: a step or a question for the owner wakes a snoozed chat early; a plain message does not', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, []);
  env.setNow(NOW);
  // The chief's question back (two agents named) waits for the owner's answer.
  const asked = await env.chief('venture.chief.thread.send', { text: '@Editor and @Packager, how are the hooks?' });
  assert.equal(asked.thread.waiting, true);
  assert.equal(asked.thread.state, 'active');
  await assert.rejects(env.chief('venture.chief.thread.state', { threadId: asked.thread.id, state: 'settled' }), code('INVALID_VENTURE_REQUEST'));
  // The owner's answer ends the wait.
  const answered = await env.chief('venture.chief.thread.send', { threadId: asked.thread.id, text: '@Editor cut a trailer from episode 14' });
  assert.equal(answered.thread.waiting, false);

  const a = answered.thread.id;
  await env.chief('venture.chief.thread.state', { threadId: a, state: 'snoozed', preset: 'next-week' });
  // A routine posting a plain line into it does not wake it.
  await ventureAction(env.deps, owner, 'prepare', 'seed.chief', tx => { appendChiefMessage(tx, { threadId: a, from: 'chief', text: 'A routine line.', author: 'engine' }); });
  assert.equal((await summaryOf(env, a)).state, 'snoozed');
  // A step that needs the owner does.
  const proposalId = await draftIn(env, a);
  const woke = await summaryOf(env, a);
  assert.equal(woke.state, 'active');
  assert.equal(woke.waiting, true);
  // Once decided, it goes back to sleep until its time.
  await ventureAction(env.deps, owner, 'prepare', 'seed.decide', tx => { tx.replace<ProposalRecord>({ ...tx.find('venture-proposal', proposalId)!, status: 'dismissed' }); });
  assert.equal((await summaryOf(env, a)).state, 'snoozed');

  // The owner writing in a snoozed or settled chat brings it back.
  const sent = await env.chief('venture.chief.thread.send', { threadId: a, text: '@Editor cut a trailer from episode 15' });
  assert.equal(sent.thread.state, 'active');
  await env.chief('venture.chief.thread.state', { threadId: a, state: 'settled' });
  const again = await env.chief('venture.chief.thread.send', { threadId: a, text: '@Editor cut a trailer from episode 16' });
  assert.equal(again.thread.state, 'active');
  assert.equal(again.thread.settled, null);
});

test('6G1: state changes never touch a message or a receipt, and each is recorded as the owner\'s action', async () => {
  const env = await chiefBusiness();
  const a = await seedThread(env, 'Keep my receipts', '2026-10-20T06:00:00.000Z');
  env.setNow(NOW);
  const before = structuredClone(listRecords(env.store.read(), 'venture-chief-message'));
  for (const step of [{ state: 'pinned' }, { state: 'snoozed', preset: 'later' }, { state: 'settled' }, { state: 'active' }]) {
    await env.chief('venture.chief.thread.state', { threadId: a, ...step });
  }
  await env.chief('venture.chief.settle.set', { days: 14 });
  assert.deepEqual(listRecords(env.store.read(), 'venture-chief-message'), before);
  const thread = listRecords(env.store.read(), 'venture-chief-thread').find(item => item.id === a)!;
  assert.equal(thread.lastAt, '2026-10-20T06:00:00.000Z', 'a state change is not a message, so the chat does not move up');
  const logged = env.store.read().activity.filter(item => item.event.startsWith('venture.chief.state') || item.event === 'venture.chief.settle');
  assert.deepEqual(logged.map(item => [item.event, item.details.memberId]), [
    ['venture.chief.state', owner.memberId], ['venture.chief.state', owner.memberId], ['venture.chief.state', owner.memberId], ['venture.chief.state', owner.memberId],
    ['venture.chief.settle', owner.memberId],
  ]);
});
