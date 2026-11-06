import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {JOB_SEARCH_DESK_DESK} from '../runtime/venture/playbooks/job-search-desk/desk.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';
const base={playbook:'job-search-desk',kind:'fact'} as const;
async function setup(){const env=await kitBusiness({now:new Date('2026-10-29T10:00:00Z')},{idea:'A career coach and job search help business'});await ventureAction(env.deps,owner,'approve','test.rehearsal',tx=>tx.touch({launchStage:'rehearsal'}));const offer=env.offers.find(o=>o.playbookOffer==='profile-and-tailoring');assert.ok(offer);const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Prepare my approved research internship profile.',intake:{fields:{targetRoles:['Research analyst'],locations:['Pune'],facts:'Interviewed customers as an intern.',languages:['English']}}});return {env,order};}
test('public career fact ledger keeps proposals unusable until current exact owner approval',async()=>{
 const {env,order}=await setup(),value={id:'internship',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['team management']};
 const made=await env.call('venture.desk.act',{...base,id:order.id,action:'propose',payload:{value}});
 const first=await env.call('venture.desk.get',{...base,id:made.id});assert.equal(first.item.state.approved,null);
 await assert.rejects(env.call('venture.desk.act',{...base,id:made.id,action:'approve',payload:{},digest:'old'}),{code:'APPROVAL_STALE'});
 await env.call('venture.desk.act',{...base,id:made.id,action:'approve',payload:{},digest:first.digest});
 const approved=await env.call('venture.desk.get',{...base,id:made.id});assert.equal(approved.item.state.approved.statement,value.statement);
 await env.call('venture.desk.act',{...base,id:made.id,action:'revise',payload:{value:{...value,qualifiers:[]}},digest:approved.digest});
 const revised=await env.call('venture.desk.get',{...base,id:made.id});assert.deepEqual(revised.item.state.approved.qualifiers,['as an intern']);assert.deepEqual(revised.item.state.proposal.qualifiers,[]);
 await assert.rejects(JOB_SEARCH_DESK_DESK.fact!.act!(env.deps,{...owner,sourceTainted:true},{...base,id:made.id,action:'approve',payload:{},digest:revised.digest}));
 await assert.rejects(env.call('venture.desk.act',{...base,id:made.id,action:'approve',payload:{extra:true},digest:revised.digest}),{code:'INVALID_VENTURE_REQUEST'});
});
test('public career capture refuses a blocked site before network and stores pasted source with exact hash',async()=>{
 const {env,order}=await setup();let calls=0;env.deps.net={resolve:async()=>{calls++;return [{address:'142.250.1.10',family:4}];}};
 await assert.rejects(env.call('venture.desk.act',{playbook:'job-search-desk',kind:'listing',id:order.id,action:'capture',payload:{url:'https://linkedin.com/jobs/1',approvedUrl:'https://linkedin.com/jobs/1'}}),{code:'FETCH_POLICY_REFUSED'});
 assert.equal(calls,0);assert.equal(listRecords(env.store.read(),'venture-career-listing').length,0);
 const made=await env.call('venture.desk.act',{playbook:'job-search-desk',kind:'listing',id:order.id,action:'paste',payload:{url:'https://linkedin.com/jobs/1',text:'Research analyst in Pune. Customer interviews required.'}});
 const get=await env.call('venture.desk.get',{playbook:'job-search-desk',kind:'listing',id:made.id});assert.equal(get.item.sourceKind,'owner-paste');assert.match(get.item.revision,/^[a-f0-9]{64}$/);
});
