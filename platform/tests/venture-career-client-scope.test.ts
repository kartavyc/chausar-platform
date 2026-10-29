import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
test('a changed order client cannot inherit another client career facts or source listings in a new pack',async()=>{
 const e=await kitBusiness(undefined,{idea:'A career coach and job search help business'});await ventureAction(e.deps,owner,'approve','test.rehearsal',tx=>tx.touch({launchStage:'rehearsal'}));
 const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers.find(o=>o.playbookOffer==='profile-and-tailoring')!.id,request:'A factual career pack',intake:{fields:{targetRoles:['Researcher'],locations:['Pune'],facts:'Original client research internship.',languages:['English']}}});
 const base={playbook:'job-search-desk',kind:'fact'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'propose',payload:{value:{id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:[]}}});await e.call('venture.desk.act',{...base,id:made.id,action:'approve',payload:{},digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});await e.call('venture.desk.act',{playbook:'job-search-desk',kind:'listing',id:order.id,action:'paste',payload:{url:'https://jobs.example/1',text:'Original client role evidence.'}});
 const other=await e.call('venture.client.add',{name:'Different Client',email:'different@example.com',countryCode:'IN'});await ventureAction(e.deps,owner,'approve','test.change-client',tx=>tx.replace({...tx.find('venture-order',order.id)!,clientId:other.id}));
 const research=await e.call('venture.desk.get',{playbook:'job-search-desk',kind:'research',id:order.id});assert.deepEqual(research.item.facts,[]);assert.deepEqual(research.item.listings,[]);
 await assert.rejects(e.call('venture.desk.act',{playbook:'job-search-desk',kind:'thread',id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'resume'}],sources:[]}}}),{code:'CAREER_UNSTATED_FACT'});
});
