// SEO4 final Writer verification runs through actual delivery checks, never a Writer web grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySeoArticle} from '../runtime/venture/playbooks/seo-visibility/verify-article.ts';
import {kitBusiness,deliver,draft,owner} from './fixtures/venture/kit-business.ts';
import {seoManifestCsv} from '../runtime/venture/playbooks/seo-visibility/manifest-core.ts';
import {ventureAction} from '../runtime/venture/records.ts';
const net={resolve:async()=>[{address:'93.184.216.34',family:4 as const}],send:async(target:any)=>({status:200,headers:{},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'35% of local visitors used the clinic.')})};
const words='Our survey found 35% [claim:c1] of local visitors used the clinic.';
const evidence={claims:[{id:'c1',number:'35%',urls:['https://source.example/a','https://independent.example/b']}],competitors:[],local:null};
test('final article verification fetches against the final text and blocks a changed unsupported claim',async()=>{
 const input={offerKey:'content-retainer',stageId:'write',servedBy:'model',deliverable:draft('Article',{Article:[words],Sources:['Recorded source pages.'],Limits:['No ranking promise.']}),files:[{name:'seo-evidence.csv',contentBase64:Buffer.from(JSON.stringify(evidence)).toString('base64')}],intake:null} as any;
 assert.equal((await verifySeoArticle(input,net)).find(c=>c.check==='claims-corroborated')?.outcome,'pass');
 assert.equal((await verifySeoArticle({...input,deliverable:draft('Article',{Article:[words.replace('35%','65%')]})},net)).find(c=>c.check==='claims-corroborated')?.outcome,'fail');
 assert.equal((await verifySeoArticle({...input,deliverable:draft('Article',{Article:[words+' Invented 99% [claim:c1] conversion.']})},net)).find(c=>c.check==='claims-corroborated')?.outcome,'fail');
});
test('the actual article run requires an owner cap before any model preview and checks its final output',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-27T12:00:00.000Z')},{idea:'SEO agency for clinics'});Object.assign(env.deps,{net});
 const offer=env.offers.find(o=>o.playbookOffer==='content-retainer')!;const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Write a sourced article for our clinic.',intake:{fields:{siteUrl:'https://clinic.example/'}}});
 const count=env.models.previewed.length;await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'ARTICLE_LIMIT_REQUIRED'});assert.equal(env.models.previewed.length,count);
 await ventureAction(env.deps,owner,'approve','seed.evidence',tx=>{const current=tx.find('venture-order',order.id)!;assert.ok(current.intake);tx.replace({...current,intake:{...current.intake,fields:{...current.intake.fields,articleLimitUsd:'1'}}});});
 await env.call('venture.files.add',{orderId:order.id,name:'seo-evidence.csv',contentBase64:Buffer.from(seoManifestCsv(evidence)).toString('base64')});
 const status=env.models.status();env.models.status=()=>({...status,tiers:{...status.tiers,fast:{...status.tiers.fast,presetId:'built-in-templates'}}} as any);
 const result=await deliver(env,order.id,draft('Clinic article',{Article:[words],Sources:['Recorded source pages.'],Limits:['No ranking promise.']}));
 assert.equal(result.playbookChecks?.find((c:any)=>c.check==='claims-corroborated')?.outcome,'pass');
});
