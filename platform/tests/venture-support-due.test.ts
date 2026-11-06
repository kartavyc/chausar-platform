// Support response-target examples from ResolveHQ (source-available); ideas only, no copied code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueAt, dueBadge, snoozeTicket, wakeTicket, queueRank } from '../runtime/venture/playbooks/support-desk/due.ts';
import { proposeTicket, confirmTicket } from '../runtime/venture/playbooks/support-desk/tickets.ts';
const policy = { timeZone: 'Asia/Kolkata', hours: [1,2,3,4,5,6].map(day => ({ day, start: '10:00', end: '19:00' })), holidays: [] as string[] };
test('due times count local business hours across Sundays and holidays', () => {
  assert.equal(dueAt('2026-10-24T12:00:00.000Z', 4, policy), '2026-10-26T07:00:00.000Z');
  assert.equal(dueAt('2026-10-24T12:00:00.000Z', 4, { ...policy, holidays: ['2026-10-26'] }), '2026-10-27T07:00:00.000Z');
  assert.equal(dueAt('2026-10-24T12:00:00.000Z', 4), '2026-10-24T16:00:00.000Z');
  assert.throws(() => dueAt('2026-10-24T12:00:00.000Z', 4, { ...policy, hours: [] }));
});
test('snooze requires a reason and a customer reply wakes the paused due clock', () => {
  const t = { ...confirmTicket(proposeTicket({ thread: 't', customerEmail: 'a@example.com', subject: 'Help', language: 'en', blocked: false }, '2026-10-27T10:00:00.000Z'), '2026-10-27T10:00:00.000Z', false), dueAt: '2026-10-27T14:00:00.000Z' };
  assert.throws(() => snoozeTicket(t, '2026-10-27T10:00:00.000Z', '2026-10-28T10:00:00.000Z', ''));
  const s = snoozeTicket(t, '2026-10-27T10:00:00.000Z', '2026-10-28T10:00:00.000Z', 'Waiting for courier');
  assert.equal(dueBadge(s, '2026-10-27T11:00:00.000Z'), '');
  const w = wakeTicket(s, '2026-10-27T12:00:00.000Z', true);
  assert.equal(w.dueAt, '2026-10-27T16:00:00.000Z');
  assert.equal(w.snoozedAt, null);
  assert.equal(dueBadge(w, '2026-10-27T13:00:00.000Z'), 'Due in 3h');
  assert.equal(dueBadge(w, '2026-10-27T18:00:00.000Z'), 'Overdue by 2h');
  assert.equal(dueBadge({ ...w, sentAt: '2026-10-27T13:00:00.000Z' }, '2026-10-27T18:00:00.000Z'), '');
  assert.deepEqual([queueRank({ ...w, dueAt: '2026-10-27T09:00:00.000Z' }, '2026-10-27T10:00:00.000Z'), queueRank({ ...w, dueAt: '2026-10-27T11:00:00.000Z' }, '2026-10-27T10:00:00.000Z'), queueRank({ ...w, dueAt: null }, '2026-10-27T10:00:00.000Z')], [0,1,2]);
});

test('owner opening-hours text becomes a bounded shop policy and response targets stay in code',async()=>{
 const {supportHours}=await import('../runtime/venture/playbooks/support-desk/due.ts');
 const policy=supportHours({shopHours:'Mon-Sat 10:00-19:00',timeZone:'Asia/Kolkata',holidays:['2026-10-26']});
 assert.equal(dueAt('2026-10-24T12:00:00.000Z',4,policy),'2026-10-27T07:00:00.000Z');
 assert.equal(supportHours({shopHours:'',timeZone:'Asia/Kolkata'}),undefined);
 assert.throws(()=>supportHours({shopHours:'whenever',timeZone:'Asia/Kolkata'}));
});
// A late app open must not extend an owner-approved pause.
test('scheduled snooze ends at its chosen time even when the app is opened later', () => {
 const t = {...confirmTicket(proposeTicket({thread:'late',customerEmail:'a@example.com',subject:'Help',language:'en',blocked:false},'2026-10-27T10:00:00.000Z'),'2026-10-27T10:00:00.000Z',false),dueAt:'2026-10-27T14:00:00.000Z'};
 const sleeping=snoozeTicket(t,'2026-10-27T10:00:00.000Z','2026-10-27T12:00:00.000Z','Waiting for courier');
 assert.equal(wakeTicket(sleeping,'2026-10-27T18:00:00.000Z').dueAt,'2026-10-27T16:00:00.000Z');
 assert.equal(wakeTicket(sleeping,'2026-10-27T18:00:00.000Z',true).dueAt,'2026-10-27T16:00:00.000Z');
});
test('the Hindi opening-hours hint is accepted by the real parser',async()=>{
 const {supportHours}=await import('../runtime/venture/playbooks/support-desk/due.ts');
 const policy=supportHours({shopHours:'सोम-शनि 10:00-19:00',timeZone:'Asia/Kolkata'});
 assert.equal(dueAt('2026-10-24T12:00:00.000Z',4,policy),'2026-10-26T07:00:00.000Z');
});

test('an unresolved ticket keeps its resolution target after the first reply is sent',()=>{
 const t={...confirmTicket(proposeTicket({thread:'resolution',customerEmail:'a@example.com',subject:'Help',language:'en',blocked:false},'2026-10-27T10:00:00.000Z'),'2026-10-27T10:00:00.000Z',false),dueAt:'2026-10-27T14:00:00.000Z',resolutionDueAt:'2026-10-28T10:00:00.000Z',sentAt:'2026-10-27T11:00:00.000Z'};
 assert.equal(dueBadge(t,'2026-10-28T12:00:00.000Z'),'Overdue by 2h');assert.equal(queueRank(t,'2026-10-28T12:00:00.000Z'),0);
 assert.equal(dueBadge({...t,status:'resolved'},'2026-10-28T12:00:00.000Z'),'');
});
