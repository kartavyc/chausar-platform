import assert from 'node:assert/strict';
import {test} from 'node:test';
import {business,owner} from './venture-judge-helpers.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';
import {flagshipPlanById} from '../runtime/venture/playbooks/plan.ts';
import {flagshipDelivery} from '../runtime/venture/playbooks/steps.ts';

const idea='A YouTube channel for small makers in India';
const intake={rights:{basis:'own-footage',holder:'Asha'},fields:{channelUrl:'https://www.youtube.com/@ashamakers',hoursPerWeek:'4',targetQueries:['stock count','shop sales','cash flow'],scripted:true}};
test('explicit YouTube service survives price and rewrite, owns its intake and workflow, and cannot be removed with an open order',async()=>{
 const f=await business(idea);
 assert.deepEqual(flagshipPlanById('youtube')!.offers.map(row=>row.key),['episode-package','shorts-from-own-video','licensed-clips']);
 const added=await f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'weekly-plan'}}});
 const service=added.blueprint.offers.at(-1)!;assert.equal(service.playbookOffer,'weekly-plan');assert.equal(service.pricing.unitPriceMinor,null);
 await assert.rejects(f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'weekly-plan'}}}),{code:'YOUTUBE_SERVICE_EXISTS'});
 const priced=await f.call('venture.blueprint.update',{patch:{offers:[{id:service.id,unitPrice:'1500'}]}});await f.call('venture.blueprint.accept',{digest:priced.blueprint.digest});
 const rewritten=await f.call('venture.blueprint.draft',{useTemplate:true});const kept=rewritten.blueprint.offers.find((row:any)=>row.id===service.id)!;
 assert.equal(kept.playbookOffer,'weekly-plan');assert.equal(kept.pricing.unitPriceMinor,'150000');assert.ok(rewritten.intake[service.id].kit.some((field:any)=>field.id==='hoursPerWeek'));
 await f.call('venture.blueprint.accept',{digest:rewritten.blueprint.digest});
 const order=await f.call('venture.order.create',{clientId:f.client.id,offerId:service.id,request:'Plan our next recording week.',intake});
 assert.equal(order.intake.fields.hoursPerWeek,'4');assert.equal(flagshipDelivery('youtube')!.draftStep('weekly-plan'),'weekly-plan');
 const waiting=await f.call('venture.delivery.run',{orderId:order.id});const run=listRecords(f.store.read(),'venture-delivery-run').find(row=>row.id===waiting.id)!;
 assert.deepEqual(run.workflow?.steps.map(step=>step.id),['intake','clarify','weekly-plan','verify','review','publish']);
 assert.equal(run.workflow?.steps.at(-1)?.title,'You share the approved service report or publishing texts');
 assert.equal(run.workflow?.steps.some(step=>step.id==='assemble'),false);
 await assert.rejects(f.call('venture.blueprint.update',{patch:{removeOffer:{id:service.id}}}),{code:'INVALID_VENTURE_REQUEST'});
 const record=listRecords(f.store.read(),'venture-owner-offer').find(row=>row.offerId===service.id)!;
 await ventureAction(f.deps,owner,'approve','test.tamper-service',tx=>tx.replace({...record,youtubeService:'channel-audit'} as typeof record));
 await assert.rejects(f.call('venture.order.create',{clientId:f.client.id,offerId:service.id,request:'Plan another recording week.',intake}),{code:'YOUTUBE_SERVICE_INVALID'});
});
test('service selection refuses unknown service, foreign playbook and extra unapproved fields',async()=>{
 const f=await business(idea);
 for(const addOffer of [{youtubeService:'invented'},{youtubeService:['weekly-plan']},{youtubeService:'weekly-plan',pricingModel:'hourly'}])await assert.rejects(f.call('venture.blueprint.update',{patch:{addOffer}}),{code:'INVALID_VENTURE_REQUEST'});
 const foreign=await business('Monthly bookkeeping for cafes in Pune.');await assert.rejects(foreign.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'weekly-plan'}}}),{code:'YOUTUBE_SERVICE_INVALID'});
 assert.equal(listRecords(foreign.store.read(),'venture-owner-offer').length,0);
});

test('screencast service intake preserves the actual local video path and disclosures for the media workflow',async()=>{
 const f=await business(idea),added=await f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'screencast-tutorial'}}}),service=added.blueprint.offers.at(-1)!;
 assert.deepEqual(added.intake[service.id].fields,['format','aiVoice','aiPresenter','paidPromotion','cutFile']);
 const priced=await f.call('venture.blueprint.update',{patch:{offers:[{id:service.id,unitPrice:'1500'}]}});await f.call('venture.blueprint.accept',{digest:priced.blueprint.digest});
 const order=await f.call('venture.order.create',{clientId:f.client.id,offerId:service.id,request:'An instructional screencast and three Shorts.',intake:{...intake,format:'long',aiVoice:true,aiPresenter:false,paidPromotion:false,cutFile:'C:\\recordings\\lesson.mp4'}});
 assert.equal(order.intake.cutFile,'C:\\recordings\\lesson.mp4');assert.equal(order.intake.aiVoice,true);assert.equal(order.intake.fields.scripted,true);
 await assert.rejects(f.call('venture.order.create',{clientId:f.client.id,offerId:service.id,request:'No network footage.',intake:{...intake,cutFile:'\\\\server\\lesson.mp4'}}),{code:'INVALID_VENTURE_REQUEST'});
});

test('service intake requires weekly hours only for a weekly plan and scripted status only for screencasts',async()=>{const f=await business(idea),added=await f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'channel-audit'}}}),audit=added.blueprint.offers.at(-1)!;assert.equal(added.intake[audit.id].kit.find((field:any)=>field.id==='hoursPerWeek').required,false);const priced=await f.call('venture.blueprint.update',{patch:{offers:[{id:audit.id,unitPrice:'1000'}]}});await f.call('venture.blueprint.accept',{digest:priced.blueprint.digest});const order=await f.call('venture.order.create',{clientId:f.client.id,offerId:audit.id,request:'Review the channel export',intake:{rights:intake.rights,fields:{channelUrl:intake.fields.channelUrl}}});assert.equal(order.intake.fields.channelUrl,intake.fields.channelUrl);const weekly=await f.call('venture.blueprint.update',{patch:{addOffer:{youtubeService:'weekly-plan'}}}),field=weekly.intake[weekly.blueprint.offers.at(-1)!.id].kit.find((field:any)=>field.id==='hoursPerWeek');assert.equal(field.required,true);});
