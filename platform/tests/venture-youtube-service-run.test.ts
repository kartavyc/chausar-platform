import {scriptedAgent,consentForOrder,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
import {YOUTUBE_DESK} from '../runtime/venture/playbooks/youtube/desk.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {business,owner} from './venture-judge-helpers.ts';import {ventureAction,listRecords} from '../runtime/venture/records.ts';
async function prepared(){const f=await business('A YouTube channel for small makers in India'),added=await f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'after-publish-review'}}}),offer=added.blueprint.offers.at(-1)!;const priced=await f.call('venture.blueprint.update',{patch:{offers:[{id:offer.id,unitPrice:'1000'}]}});await f.call('venture.blueprint.accept',{digest:priced.blueprint.digest});const order=await f.call('venture.order.create',{clientId:f.client.id,offerId:offer.id,request:'Review the published video.',intake:{rights:{basis:'own-footage',holder:'Client'},fields:{channelUrl:'https://youtube.com/@makers',hoursPerWeek:'4',targetQueries:['stock count','shop sales','cash flow'],scripted:true}}});await f.deps.services.trust.updatePolicy(owner,{send:'shape'});return{f,order};}
async function source(x:Awaited<ReturnType<typeof prepared>>){const {f,order}=x;const file=await f.call('venture.files.add',{orderId:order.id,name:'studio.csv',contentBase64:Buffer.from('id,ctr,retention,views,search,browse\nv1,2,70,1000,100,700').toString('base64')});await YOUTUBE_DESK.research.act!(f.deps,owner,{playbook:'youtube',kind:'research',id:'new',action:'create',payload:{mode:'after-publish',orderId:order.id,fileId:file.id,mapping:{videoId:'id',ctrBasisPoints:'ctr',retentionBasisPoints:'retention',views:'views',searchViews:'search',browseViews:'browse'},options:{videoId:'v1'},sourceConsent:true}});return file;}

test('actual after-publish service reads its code source, writes its own sections and reaches client review without media-cut stages',async()=>{
 const x=await prepared(),{f,order}=x;await source(x);await consentForOrder(f.deps,owner,order.id);let read=false,proof='';const observed:any[]=[];
 f.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:scriptedAgent(()=>({title:'Published video review',sections:[{heading:'One directive',parts:[{kind:'text',text:'Improve the title and thumbnail.',ref:''}]},{heading:'Source evidence',parts:[{kind:'figure',text:'',ref:proof}]},{heading:'Thresholds',parts:[{kind:'text',text:'House thresholds guide this source review.',ref:''}]},{heading:'Coverage',parts:[{kind:'text',text:'Only the supplied Studio export was reviewed. Missing information remains unavailable.',ref:''}]}],questionsForClient:[]}),undefined,(name,data)=>observed.push({name,data}),async call=>{
  const result=await call('calculate',{operation:'youtube_after_publish',arguments:{}});assert.equal(result.result.ok,true,JSON.stringify(result));
  proof=result.refs.figures.find((figure:any)=>figure.figureKey.includes('ctrBasisPoints'))?.ref;assert.ok(proof);read=true;
 })});
 const pending=await f.call('venture.delivery.run',{orderId:order.id});await waitForAgentWork(f.store,pending.id);
 const run=(await f.call('venture.delivery.list')).find((run:any)=>run.id===pending.id);
 assert.equal(run.status,'ready-for-review',JSON.stringify(observed.filter(row=>row.name==='tool_error')));
 assert.equal(run.playbookChecks.find((r:any)=>r.check==='after-publish-directive')?.outcome,'pass');assert.equal(run.playbookChecks.find((r:any)=>r.check==='source-backed-analysis')?.outcome,'pass');
 assert.equal(run.workflow.steps.some((s:any)=>s.id==='assemble'),false);assert.equal(read,true);
});
