// SEO4 final Writer verification runs through actual delivery checks, never a Writer web grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Deliverable} from '../runtime/venture/contracts.ts';
import {createHash} from 'node:crypto';
import {renderDeliverable} from '../runtime/venture/delivery/deliverable.ts';
import {seoClaimChecks,seoLocalChecks,seoReceiptChecks} from '../runtime/venture/playbooks/seo-visibility/checks.ts';
import {verifySeoArticle} from '../runtime/venture/playbooks/seo-visibility/verify-article.ts';
import {kitBusiness,deliver,draft,owner} from './fixtures/venture/kit-business.ts';
import {seoManifestCsv} from '../runtime/venture/playbooks/seo-visibility/manifest-core.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {getAgentSettings,setAgentSettings} from '../runtime/venture/agent-runtime/settings-methods.ts';
import {consentForOrder,scriptedAgent,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
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
 await consentForOrder(env.deps,owner,order.id);
 const count=env.models.previewed.length;await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'ARTICLE_LIMIT_REQUIRED'});assert.equal(env.models.previewed.length,count);
 await ventureAction(env.deps,owner,'approve','seed.evidence',tx=>{const current=tx.find('venture-order',order.id)!;assert.ok(current.intake);tx.replace({...current,intake:{...current.intake,fields:{...current.intake.fields,articleLimitUsd:'1'}}});});
 await env.call('venture.files.add',{orderId:order.id,name:'seo-evidence.csv',contentBase64:Buffer.from(seoManifestCsv(evidence)).toString('base64')});
 const status=env.models.status();env.models.status=()=>({...status,tiers:{...status.tiers,fast:{...status.tiers.fast,presetId:'built-in-templates'}}} as any);
 const settings=(await getAgentSettings(env.deps,owner,{})).settings;settings.claude.network='on';await setAgentSettings(env.deps,owner,{settings});
 env.deps.agentRoute=async()=>({driver:scriptedAgent(signal=>env.models.nextAgentDraft(signal),undefined,(name,data)=>env.models.agentReads.push({name,data}),async call=>{
  const files=await call('list_files');const file=files.files.find((row:any)=>row.name==='seo-evidence.csv');
  const checked=await call('calculate',{operation:'seo_source_claim',arguments:{fileId:file.id,claimId:'c1'}});
  return {'claim.c1':checked.refs.figures.find((row:any)=>row.figureKey==='claim-c1').ref};
 }),settings:{...SCRIPTED_AGENT_SETTINGS,network:true}});
 const answer:any=draft('Clinic article',{Article:['Our survey found'],Sources:['Recorded source pages.'],Limits:['No ranking promise.']});
 answer.sections[0].parts.push({kind:'figure',text:'',ref:'claim.c1'},{kind:'text',text:'[claim:c1] of local visitors used the clinic.',ref:''});
 const result=await deliver(env,order.id,answer);
 assert.equal(result.playbookChecks?.find((c:any)=>c.check==='claims-corroborated')?.outcome,'pass',JSON.stringify(env.models.agentReads.filter(read=>read.name==='tool_error')));
});

function receiptArticle(display='35%') {
 const deliverable:Deliverable=draft('Article',{Article:['Our survey found'],Sources:['Recorded source pages.'],Limits:['No ranking promise.']});
 deliverable.sections[0].parts.push({kind:'figure',receiptId:'receipt-survey',figureKey:'share'},{kind:'text',text:'[claim:c1] of local visitors used the clinic.'});
 return {offerKey:'content-retainer',stageId:'write',servedBy:'model',deliverable,receipts:[{id:'receipt-survey',figures:[{key:'share',label:'Survey result',display,unit:'percent'}]}],dateOrder:'day-month-year',files:[{name:'seo-evidence.csv',contentBase64:Buffer.from(JSON.stringify(evidence)).toString('base64')}],intake:null} as any;
}
test('receipt-backed article figures are verified at their rendered values, including changed percentages',async()=>{
 assert.equal((await verifySeoArticle(receiptArticle(),net))[0].outcome,'pass');
 assert.equal((await verifySeoArticle(receiptArticle('65%'),net))[0].outcome,'fail','a receipt does not establish independent source corroboration');
 assert.equal((await verifySeoArticle(receiptArticle('99%'),net))[0].outcome,'fail');
});
test('receipt-backed article checking fails closed for missing or ambiguous figure references',async()=>{
 for(const change of [(input:any)=>{input.receipts=[];},(input:any)=>{input.receipts[0].figures[0].key='other';},(input:any)=>{input.receipts.push(structuredClone(input.receipts[0]));}]){
  const input=receiptArticle();change(input);
  assert.equal((await verifySeoArticle(input,net))[0].outcome,'fail');
  assert.equal(seoClaimChecks(input)[0].outcome,'fail');
  assert.equal(seoLocalChecks({...input,offerKey:'local-seo'})[0].outcome,'fail');
 }
});
test('receipt-backed article proof hashes cover the same rendered text as the owner sees',()=>{
 const input=receiptArticle();
 assert.equal(seoClaimChecks(input)[0].outcome,'fail','numeric figure needs corroboration even though its prose has no digits');
 const hash=createHash('sha256').update(renderDeliverable(input.deliverable,input.receipts,{dateOrder:'day-month-year'},{attachments:false})).digest('hex');
 input.toolCalls=[{tool:'seo.corroborate',envelope:{ok:true,result:{data:{artifactDigest:hash,pass:true}}}},{tool:'seo.lint',envelope:{ok:true,result:{data:{artifactDigest:hash,checks:[{id:'doorway-page',pass:true}]}}}}];
 assert.equal(seoClaimChecks(input)[0].outcome,'pass');
 assert.equal(seoLocalChecks({...input,offerKey:'local-seo'})[0].outcome,'pass');
 input.receipts[0].figures[0].display='65%';
 assert.equal(seoClaimChecks(input)[0].outcome,'fail');
 assert.equal(seoLocalChecks({...input,offerKey:'local-seo'})[0].outcome,'fail');
 const report=structuredClone(input);report.deliverable.sections[0].parts[2].text='of local visitors used the clinic.';
 assert.equal(seoReceiptChecks({...report,offerKey:'visibility-audit'})[0].outcome,'pass','receipt-backed report figures are still distinct from numeric prose');
});

test('a words-only article can finish source checks without network permission or a fetch',async()=>{
 const input=receiptArticle();input.deliverable=draft('Article',{Article:['A plain description of the clinic.'],Limits:['No ranking promise.']});input.receipts=[];
 const result=await verifySeoArticle(input,{resolve:async()=>{throw new Error('No source request is permitted.');},send:async()=>{throw new Error('No source request is permitted.');}});
 assert.equal(result.find(check=>check.check==='claims-corroborated')?.outcome,'pass');
});
