// 5E2 public desk operations; exact order sources and owner approvals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {seoManifestCsv} from '../runtime/venture/playbooks/seo-visibility/manifest-core.ts';
const desk={playbook:'seo-visibility',kind:'work'};
test('public refresh work routes owner-recorded content gaps and missing AI answers from the same uploaded evidence',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'SEO agency'}),offer=env.offers.find(o=>o.playbookOffer==='fix-and-measure')!,order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Plan missing content.',intake:{fields:{siteUrl:'https://clinic.example'}}});
 const file=await env.call('venture.files.add',{orderId:order.id,name:'refresh.csv',contentBase64:Buffer.from(seoManifestCsv({csv:'Query,Page,Clicks,Impressions,Position\nclinic,https://clinic.example/a,1,100,4',gaps:['Clinic hours'],missingAi:['Nearby clinic']})).toString('base64')});
 const result=await env.call('venture.desk.act',{...desk,id:'new',action:'create',payload:{orderId:order.id,operation:'refresh',uploadId:file.id}});
 assert.deepEqual(result.result.result.rows.map((r:any)=>r.action),['title-meta','new-article','ai-overview']);assert.equal(result.result.result.kind,'plan-only');
});
test('actual work API stores code results from bound order bytes and rejects stale or cross-order approvals',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-27T12:00:00.000Z')},{idea:'SEO agency for clinics'});const offer=env.offers.find(o=>o.playbookOffer==='fix-and-measure')!;
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Refresh the clinic pages.',intake:{fields:{siteUrl:'https://clinic.example/'}}});
 let uploadId='';await ventureAction(env.deps,owner,'approve','seed',tx=>{uploadId=tx.put({...tx.base('venture-upload'),name:'search.csv',format:'csv',scope:{kind:'order',orderId:order.id},bytes:200,contentBase64:Buffer.from('Query,Page,Clicks,Impressions,Position\nclinic,https://clinic.example/a,1,100,4').toString('base64')} as any).id;});
 const result=await env.call('venture.desk.act',{...desk,id:'new',action:'create',payload:{orderId:order.id,operation:'refresh',uploadId}});assert.equal(result.result.result.kind,'plan-only');assert.match(result.result.receipt,/^[a-f0-9]{64}$/);
 const viewed=await env.call('venture.desk.get',{...desk,id:result.id});await assert.rejects(env.call('venture.desk.act',{...desk,id:result.id,action:'approve',digest:'old',payload:{}}),{code:'APPROVAL_STALE'});
 await ventureAction(env.deps,owner,'approve','change',tx=>{const file=tx.find('venture-upload',uploadId)!;tx.replace({...file,contentBase64:Buffer.from('changed').toString('base64')});});
 await assert.rejects(env.call('venture.desk.act',{...desk,id:result.id,action:'approve',digest:viewed.digest,payload:{}}),{code:'SEO_SOURCE_CHANGED'});
 const other=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Another site.',intake:{fields:{siteUrl:'https://other.example/'}}});
 await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'create',payload:{orderId:other.id,operation:'refresh',uploadId}}),{code:'SEO_SOURCE_REQUIRED'});
});
