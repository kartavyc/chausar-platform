// Original public edge desk refusal tests, Cloudflare REST documentation and existing site-edit journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner,draft} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {renderDeliverable} from '../runtime/venture/delivery/deliverable.ts';
import {shareCreate,shareRecordAnswer} from '../runtime/venture/build/share-links.ts';
test('fix-and-measure changes use current client approval, exact owner preview, journalled apply and rollback',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'SEO agency'}),desk={playbook:'seo-visibility',kind:'edge'};
 const shelf=new Map<string,string>();env.deps.secrets={get:k=>shelf.get(k)??null,set:(k,v)=>{shelf.set(k,v);},delete:k=>{shelf.delete(k);},has:k=>shelf.has(k),clear:()=>shelf.clear()};let remote='Old title.',writes=0;
 env.deps.net={resolve:async()=>[{address:'93.184.216.34',family:4}],send:async request=>{if(request.method==='PUT'){writes++;remote=String(request.body);return {status:200,headers:{},body:Buffer.from('{"success":true}')};}return {status:200,headers:{},body:Buffer.from(remote)};}};
 await env.call('venture.desk.act',{...desk,id:'connection',action:'configure',payload:{accountId:'a'.repeat(32),namespaceId:'b'.repeat(32),token:'test'+' scoped token',siteUrl:'https://clinic.example/'}});
 const offer=env.offers.find(o=>o.playbookOffer==='fix-and-measure')!,order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Fix the title.',intake:{fields:{siteUrl:'https://clinic.example/'}}}),run=await env.call('venture.delivery.run',{orderId:order.id});
 await ventureAction(env.deps,owner,'prepare','fixture.approved-fix',tx=>{const content=draft('Review title',{Report:['Reviewed clinic title.']});tx.replace({...tx.find('venture-delivery-run',run.id)!,status:'accepted',practice:false,deliverable:content,renderedText:renderDeliverable(content,[],tx.venture!.country),editedText:null,checks:[],playbookChecks:[],verdict:{verdict:'accepted',at:tx.now,by:'owner'},servedBy:'model'} as any);});
 await shareCreate(env.deps,owner,{deliveryId:run.id});await shareRecordAnswer(env.deps,owner,{draftId:run.id,answer:'approved'});
 const staged=await env.call('venture.desk.act',{...desk,id:'new',action:'stage',payload:{runId:run.id,path:'clinic/title',after:'Reviewed clinic title.',summary:'Correct the title'}});assert.equal(writes,0);
 const view=await env.call('venture.desk.get',{...desk,id:staged.id});await assert.rejects(env.call('venture.desk.act',{...desk,id:staged.id,action:'apply',digest:'old',payload:{}}),{code:'APPROVAL_STALE'});assert.equal(writes,0);
 const applied=await env.call('venture.desk.act',{...desk,id:staged.id,action:'apply',digest:view.digest,payload:{}});assert.equal(applied.result.state,'applied');assert.equal(remote,'Reviewed clinic title.');assert.equal(writes,1);
 const undo=await env.call('venture.desk.act',{...desk,id:staged.id,action:'rollback',digest:view.digest,payload:{}});assert.equal(undo.result.state,'rolled-back');assert.equal(remote,'Old title.');assert.equal(writes,2);
});
test('edge configuration is session-only and the desk refuses an unapproved draft before reading a key',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'SEO agency'});const shelf=new Map<string,string>();env.deps.secrets={get:k=>shelf.get(k)??null,set:(k,v)=>{shelf.set(k,v);},delete:k=>{shelf.delete(k);},has:k=>shelf.has(k),clear:()=>shelf.clear()};let reads=0;
 Object.assign(env.deps,{net:{resolve:async()=>[{address:'93.184.216.34',family:4}],send:async()=>{reads++;throw Error('must not fetch');}}});
 const desk={playbook:'seo-visibility',kind:'edge'};
 const kept=await env.call('venture.desk.act',{...desk,id:'connection',action:'configure',payload:{accountId:'a'.repeat(32),namespaceId:'b'.repeat(32),token:'example'+' cloud token',siteUrl:'https://clinic.example'}});assert.equal(kept.result.connected,true);
 assert.ok(!JSON.stringify(env.store.read()).includes('example cloud token'));const view=await env.call('venture.desk.get',{...desk,id:'connection'});assert.equal(view.item.connected,true);assert.ok(!JSON.stringify(view).includes('token'));
 await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'stage',payload:{runId:'missing',path:'clinic/home',after:'Approved title.',summary:'Update title'}}),{code:'DELIVERY_NOT_FOUND'});assert.equal(reads,0);
 await env.call('venture.desk.act',{...desk,id:'connection',action:'disconnect',payload:{}});assert.equal((await env.call('venture.desk.get',{...desk,id:'connection'})).item.connected,false);
});
