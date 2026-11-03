import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {nativeContext} from './fixtures/venture/native-context.ts';
import {createNativeJob} from '../runtime/venture/agent-runtime/native-job.ts';
import {MCP_PROTOCOL_VERSION} from '../runtime/mcp.ts';
import {seoManifestCsv} from '../runtime/venture/playbooks/seo-visibility/manifest-core.ts';
import {getAgentSettings,setAgentSettings} from '../runtime/venture/agent-runtime/settings-methods.ts';
import {withdrawClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
import {digest,ventureAction,listRecords} from '../runtime/venture/records.ts';

const manifest={claims:[{id:'c1',number:'35%',urls:['https://source.example/a','https://independent.example/b']}],competitors:[],local:null};
async function fixture(t:any,networkAllowed=true,evidence=manifest){
 const env=await kitBusiness({now:new Date('2026-10-27T12:00:00Z')},{idea:'SEO agency for clinics'});
 const offer=env.offers.find(item=>item.playbookOffer==='content-retainer')!;
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Write a sourced article.',intake:{fields:{siteUrl:'https://clinic.example/',articleLimitUsd:'1'}}});
 await env.call('venture.files.add',{orderId:order.id,name:'seo-evidence.csv',contentBase64:Buffer.from(seoManifestCsv(evidence)).toString('base64')});
 const files=listRecords(env.store.read(),'venture-upload');const file=files.find(item=>item.scope.kind==='order'&&item.scope.orderId===order.id)!;
 const sent:string[]=[],lookups:string[]=[],hooks:{resolve?:()=>Promise<void>;send?:()=>Promise<void>;page:string}={page:'35% of local visitors used the clinic.'};env.deps.net={resolve:async hostname=>{lookups.push(hostname);await hooks.resolve?.();return [{address:'93.184.216.34',family:4 as const}];},send:async target=>{sent.push(target.url.href);await hooks.send?.();return {status:200,headers:{},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':hooks.page)};}};
 const prepared=await nativeContext(env.deps,owner,order.id);await prepared.job.close();
 const job=await createNativeJob(env.deps,owner,prepared.run.id,{agentId:'delivery',sections:['Reply'],check:()=>{},networkAllowed} as any);t.after(()=>job.close());
 await job.service.handle(owner,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'source-claim-fixture',version:'1'}}});
 await job.service.handle(owner,{jsonrpc:'2.0',method:'notifications/initialized'});
 let id=1;const call=async(name:string,args:unknown)=>{const response:any=await job.service.handle(owner,{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}});return response;};
 return {...env,nativeCall:env.call,order,file,job,sent,lookups,hooks,call};
}
test('scoped SEO source checking returns a durable percent figure bound to manifest and two independent page hashes',async t=>{
 const env=await fixture(t);
 const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});
 assert.equal(response.error,undefined,JSON.stringify(response.error));
 const data=response.result.structuredContent.data,receipt=listRecords(env.store.read(),'venture-work-receipt').find(row=>row.id===data.receipts[0].id)!;
 assert.equal(receipt.operation,'seo.claim');assert.equal(receipt.figures[0].minor,'3500');assert.equal(receipt.figures[0].display,'35%');
 assert.equal(receipt.inputs.tables.length,3);assert.equal(receipt.inputs.tables[0].digest,env.file.digest);
 assert.equal(new Set(receipt.inputs.tables.slice(1).map((row:any)=>new URL(row.id).hostname)).size,2);
 assert.equal(listRecords(env.store.read(),'venture-work-receipt').filter(row=>row.id===receipt.id).length,1);
 assert.ok(data.refs.figures.some((ref:any)=>ref.receiptId===receipt.id));assert.ok(env.sent.length>=4);
});
test('source checking has no network authority for a directly created job without an explicit grant',async t=>{
 const env=await fixture(t,false);const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});
 assert.equal(response.error?.data?.code,'AI_SETTING_UNSUPPORTED');assert.deepEqual(env.sent,[]);
});

async function networkOff(env:Awaited<ReturnType<typeof fixture>>){const view=await getAgentSettings(env.deps,owner,{});view.settings.claude.network='off';view.settings.claude.webSearch='off';await setAgentSettings(env.deps,owner,{settings:view.settings});}
for(const phase of ['before-send','after-send','consent','manifest'] as const)test(`source claim refuses ${phase} changes without issuing a receipt`,async t=>{
 const env=await fixture(t);
 const change=async()=>{
  delete env.hooks.resolve;delete env.hooks.send;
  if(phase==='consent')await withdrawClientAiConsent(env.deps,owner,{clientId:env.client.id});
  else if(phase==='manifest')await ventureAction(env.deps,owner,'prepare','fixture.sourceChanged',tx=>{const file=tx.find('venture-upload',env.file.id)!;const contentBase64=Buffer.from(seoManifestCsv({...manifest,local:{changed:true}})).toString('base64');tx.replace({...file,contentBase64,digest:digest(contentBase64)});});
  else await networkOff(env);
 };
 if(phase==='before-send')env.hooks.resolve=change;else env.hooks.send=change;
 const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});
 assert.equal(response.error?.data?.code,phase==='consent'?'CLIENT_AI_CONSENT_REQUIRED':phase==='manifest'?'JOB_SOURCE_CHANGED':'AI_SETTING_UNSUPPORTED');
 assert.equal(listRecords(env.store.read(),'venture-work-receipt').filter(row=>row.operation==='seo.claim').length,0);
 if(phase==='before-send')assert.deepEqual(env.sent,[]);
});
test('source claim rejects foreign files, model supplied URLs and unsupported precision before any fetch',async t=>{
 const env=await fixture(t);
 const foreignClient=await env.nativeCall('venture.client.add',{name:'Other client',email:'other@example.test',countryCode:'IN'});
 const foreignOrder=await env.nativeCall('venture.order.create',{clientId:foreignClient.id,offerId:env.order.offerId,request:'Another client article.',intake:{fields:{siteUrl:'https://other.example/'}}});
 await env.nativeCall('venture.files.add',{orderId:foreignOrder.id,name:'seo-evidence.csv',contentBase64:Buffer.from(seoManifestCsv({...manifest,claims:[{...manifest.claims[0],id:'other-claim'}]})).toString('base64')});
 const foreign=listRecords(env.store.read(),'venture-upload').find(row=>row.scope.kind==='order'&&row.scope.orderId===foreignOrder.id)!;
 const denied=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:foreign.id,claimId:'c1'}});assert.equal(denied.error?.data?.code,'JOB_FILE_FORBIDDEN');assert.deepEqual(env.sent,[]);
 for(const args of [{fileId:'another-order-file',claimId:'c1'},{fileId:env.file.id,claimId:'c1',urls:['https://outside.example/']},{fileId:env.file.id,claimId:'missing'}]){
  const response=await env.call('calculate',{operation:'seo_source_claim',arguments:args});assert.ok(response.error);assert.deepEqual(env.sent,[]);
 }
 const precise=await fixture(t,true,{...manifest,claims:[{...manifest.claims[0],number:'35.001%'}]});
 assert.equal((await precise.call('calculate',{operation:'seo_source_claim',arguments:{fileId:precise.file.id,claimId:'c1'}})).error?.data?.code,'SEO_INPUT_INVALID');assert.deepEqual(precise.sent,[]);
});
test('two subdomains are not independent sources and changed page bytes revoke a saved figure',async t=>{
 const same=await fixture(t,true,{...manifest,claims:[{...manifest.claims[0],urls:['https://a.source.example/a','https://b.source.example/b']}]});
 assert.equal((await same.call('calculate',{operation:'seo_source_claim',arguments:{fileId:same.file.id,claimId:'c1'}})).error?.data?.code,'SEO_INPUT_INVALID');
 const env=await fixture(t),response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});assert.equal(response.error,undefined);
 const ref=response.result.structuredContent.data.refs.figures.find((row:any)=>row.figureKey==='claim-c1').ref;env.hooks.page+=' The source was updated.';
 const saved=await env.call('draft_document',{draft:{title:'Article',sections:[{heading:'Reply',parts:[{kind:'figure',ref,text:''},{kind:'text',text:'[claim:c1] of local visitors used the clinic.',ref:''}]}],questionsForClient:[]}});
 assert.equal(saved.error?.data?.code,'JOB_SOURCE_CHANGED');
});

test('switching network off and back on does not revive the old job permission',async t=>{
 const env=await fixture(t);
 env.hooks.send=async()=>{delete env.hooks.send;const before=await getAgentSettings(env.deps,owner,{});await networkOff(env);await setAgentSettings(env.deps,owner,{settings:before.settings});};
 const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});
 assert.equal(response.error?.data?.code,'AI_SETTING_UNSUPPORTED');assert.equal(listRecords(env.store.read(),'venture-work-receipt').filter(row=>row.operation==='seo.claim').length,0);
});
test('unrelated model or effort settings do not revoke an unchanged source-network permission',async t=>{
 const env=await fixture(t);const settings=(await getAgentSettings(env.deps,owner,{})).settings;settings.claude.main.effort='low';settings.codex.main.model='another-test-model';await setAgentSettings(env.deps,owner,{settings});
 assert.equal((await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}})).error,undefined);
});

test('checked source receipts never authorize raw percentages in model prose',async t=>{
 const env=await fixture(t);assert.equal((await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}})).error,undefined);
 for(const number of ['35%','65%','99%']){
  const response=await env.call('draft_document',{draft:{title:'Article',sections:[{heading:'Reply',parts:[{kind:'text',text:`Our survey found ${number} [claim:c1].`,ref:''}]}],questionsForClient:[]}});
  assert.equal(response.error?.data?.code,'MODEL_OUTPUT_REJECTED');
 }
});
test('closing a job during source resolution prevents the physical request',async t=>{
 const env=await fixture(t);env.hooks.resolve=async()=>{delete env.hooks.resolve;await env.job.close();};
 const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});
 assert.equal(response.error?.data?.code,'JOB_CLOSED');assert.deepEqual(env.sent,[]);assert.equal(env.lookups.length,1,'no later DNS lookup after the job closes');
});

test('a native draft may cite exactly the public URLs verified by its own source-claim calculation',async t=>{
 const env=await fixture(t);const response=await env.call('calculate',{operation:'seo_source_claim',arguments:{fileId:env.file.id,claimId:'c1'}});assert.equal(response.error,undefined);
 const exposed=response.result.structuredContent.data;
 assert.deepEqual(exposed.result.result.sources.map((source:any)=>source.url),manifest.claims[0].urls);
 assert.ok(exposed.result.result.sources.every((source:any)=>Object.keys(source).sort().join(',')==='digest,domain,url'));
 assert.equal(exposed.receipts[0].inputs,undefined,'private manifest inputs are not exposed with public source identities');
 const other=await env.nativeCall('venture.client.add',{name:'Other client',email:'other@example.test',countryCode:'IN'});
 const otherOrder=await env.nativeCall('venture.order.create',{clientId:other.id,offerId:env.order.offerId,request:'Other article.',intake:{fields:{siteUrl:'https://other-client.example/'}}});
 await env.nativeCall('venture.files.add',{orderId:otherOrder.id,name:'seo-evidence.csv',contentBase64:Buffer.from(seoManifestCsv({...manifest,claims:[{id:'foreign',number:'35%',urls:['https://other-client.example/proof','https://foreign-source.example/proof']}]})).toString('base64')});
 const ref=exposed.refs.figures.find((row:any)=>row.figureKey==='claim-c1').ref;
 const draft=(urls:string)=>({title:'Article',sections:[{heading:'Reply',parts:[{kind:'figure',ref,text:''},{kind:'text',text:`[claim:c1]. Sources: ${urls}`,ref:''}]}],questionsForClient:[]});
 const saved=await env.call('draft_document',{draft:draft('https://source.example/a https://independent.example/b')});
 assert.equal(saved.error,undefined,JSON.stringify(saved.error));
 const invented=await env.call('draft_document',{draft:draft('https://invented.example/source')});
 assert.equal(invented.error?.data?.code,'DRAFT_CHECK_FAILED');
 const foreign=await env.call('draft_document',{draft:draft('https://other-client.example/proof')});assert.equal(foreign.error?.data?.code,'DRAFT_CHECK_FAILED');
 env.hooks.page+=' Changed after verification.';
 const stale=await env.call('draft_document',{draft:draft('https://source.example/a https://independent.example/b')});
 assert.equal(stale.error?.data?.code,'JOB_SOURCE_CHANGED');
});
