// Human support handoff and grounded triage, nexusdesk and agentbehavior (Apache-2.0); original tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPerson, humanHandoff, replyPair, triageSupport } from '../runtime/venture/playbooks/support-desk/handoff.ts';
import { matchCustomer } from '../runtime/venture/playbooks/support-desk/match.ts';
import { addRating, ratingSummary } from '../runtime/venture/playbooks/support-desk/ratings.ts';
import { proposeTicket, confirmTicket } from '../runtime/venture/playbooks/support-desk/tickets.ts';
const at='2026-10-27T10:00:00.000Z';
const ticket=confirmTicket(proposeTicket({thread:'thread',customerEmail:'buyer@example.com',subject:'Help',language:'hi',blocked:false},at),at,false);
test('human requests pause drafts, cancel queued work, flag running work, and keep only the last ten messages',()=>{
  assert.equal(needsPerson('Please connect me to a human'),true);
  assert.equal(needsPerson('मुझे किसी इंसान से बात करनी है'),true);
  const messages=Array.from({length:12},(_,i)=>({ticketId:'ticket',messageId:null,sender:'buyer@example.com',text:`Message ${i}`,at,messageKind:'customer' as const,references:[],untrusted:true}));
  const result=humanHandoff({...ticket,messages},[{id:'q',state:'queued'},{id:'r',state:'running'},{id:'d',state:'done'}],at);
  assert.equal(result.ticket.autoDraftsPaused,true);
  assert.deepEqual(result.runs.map(r=>r.state),['cancelled','running','done']);
  assert.equal(result.runs[1]!.stopRequested,true);
  assert.equal(result.summary.messages.length,10);
  assert.equal(result.summary.messages[0]!.text,'Message 2');
  assert.equal(result.ticket.messages.at(-1)!.messageKind,'system');
});
test('matching uses code confidence and ambiguity needs owner confirmation',()=>{
  const candidates=[{id:'c1',email:'buyer@example.com',phone:'9876543210',orderNumber:'O-12'},{id:'c2',email:'other@example.com',phone:'1111111111',orderNumber:'O-99'}];
  assert.equal(matchCustomer({email:'BUYER@example.com',phone:'9876543210',orderNumber:'O-12'},candidates).matchedId,'c1');
  assert.equal(matchCustomer({email:'buyer@example.com'},[candidates[0]!,{...candidates[0]!,id:'c3'}]).needsConfirmation,true);
  assert.equal(matchCustomer({orderNumber:'unknown'},candidates).needsConfirmation,true);
});
test('translated replies retain the original and source, triage ignores tone, and ratings show their denominator',()=>{
  assert.deepEqual(replyPair('Please check tracking.','कृपया ट्रैकिंग देखें।','hi',['policy.txt']),{original:'Please check tracking.',translated:'कृपया ट्रैकिंग देखें।',language:'hi',sources:['policy.txt'],approved:false,policyChange:false});
  assert.throws(()=>replyPair('A reply','','hi',[]));
  assert.equal(triageSupport({impact:'delivery-blocked',evidence:['tracking.csv'],tone:'angry'}).priority,triageSupport({impact:'delivery-blocked',evidence:['tracking.csv'],tone:'kind'}).priority);
  const first=addRating([], 'ticket', 5, at);
  assert.throws(()=>addRating(first,'ticket',1,at));
  assert.deepEqual(ratingSummary(first),{count:1,average:null,line:'1 rating'});
  const five=Array.from({length:5},(_,i)=>({ticketId:`t${i}`,score:4,at}));
  assert.deepEqual(ratingSummary(five),{count:5,average:'4.0',line:'4.0 from 5 ratings'});
});
