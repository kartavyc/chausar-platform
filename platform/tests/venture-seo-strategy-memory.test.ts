// SEO7 complete, frozen experiment windows are required before strategy memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyWindows} from '../runtime/venture/playbooks/seo-visibility/strategy-windows.ts';
import {evaluateStrategy} from '../runtime/venture/playbooks/seo-visibility/strategy.ts';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
const panel={state:'approved' as const,approvedDigest:'panel',orderId:'order',spec:{questions:Array.from({length:15},(_,n)=>({id:'q'+n,text:'Question '+n})),engines:['engine'],repeats:1,minimumFilled:15,timepoints:[{id:'before',from:'2026-09-01T00:00:00.000Z',to:'2026-09-02T00:00:00.000Z'},{id:'after',from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z'}]}};
const observations=panel.spec.timepoints.flatMap(w=>panel.spec.questions.map((q,n)=>({panelId:'panel-id',panelDigest:'panel',questionId:q.id,engine:'engine',timepointId:w.id,repeat:1,capturedAt:w.from,method:'owner-capture' as const,screenshotFileId:'upload_test',answer:'Captured answer',mentioned:w.id==='after'&&n<5,fixture:false,slot:[q.id,'engine',w.id,1].join('|')})));
test('two completed flat windows stop before a later planned window finishes',()=>{
 const extended={...panel,spec:{...panel.spec,timepoints:[...panel.spec.timepoints,{id:'second',from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z'},{id:'future',from:'2026-12-01T00:00:00.000Z',to:'2026-12-02T00:00:00.000Z'}]}};
 const complete=extended.spec.timepoints.slice(0,3).flatMap(w=>panel.spec.questions.map(q=>({...observations[0]!,questionId:q.id,timepointId:w.id,capturedAt:w.from,mentioned:false,slot:[q.id,'engine',w.id,1].join('|')})));
 const result=strategyWindows(extended,complete,'2026-09-15T00:00:00.000Z','2026-10-28T00:00:00.000Z');assert.equal(result.complete,true);assert.deepEqual(result.windows,[0,0]);
 assert.equal(evaluateStrategy({candidate:{digest:'c'},fidelity:{candidateDigest:'c',digest:'f',passed:true},experiment:{fidelityDigest:'f',digest:'e',panelDigest:'p',windowEnds:result.windowEnds},publication:{experimentDigest:'e',digest:'pub'},receipt:{publicationDigest:'pub',digest:'receipt',publishedAt:'2026-09-15'},panelDigest:'p',asOf:'2026-10-28',windows:result.windows}).state,'stopped');
});
test('strategy counts complete equal panels after the receipt; gaps, fixtures and overlapping publication hold memory',()=>{
 assert.deepEqual(strategyWindows(panel,observations,'2026-09-15T00:00:00.000Z','2026-10-28T00:00:00.000Z'),{complete:true,windows:[5/15],windowEnds:'2026-10-02',receipt:'before:0/15|after:5/15'});
 assert.equal(strategyWindows(panel,observations.slice(1),'2026-09-15T00:00:00.000Z','2026-10-28T00:00:00.000Z').complete,false);
 assert.equal(strategyWindows(panel,observations.map(o=>({...o,fixture:true})),'2026-09-15T00:00:00.000Z','2026-10-28T00:00:00.000Z').complete,false);
 assert.equal(strategyWindows(panel,observations,'2026-10-01T12:00:00.000Z','2026-10-28T00:00:00.000Z').complete,false);
});
test('strategy desk exists but cannot turn caller invented digest claims into remembered evidence',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')}, {idea:'SEO agency'}),desk={playbook:'seo-visibility',kind:'strategy'};
 assert.deepEqual((await env.call('venture.desk.list',desk)).rows,[]);
 await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'create',payload:{workId:'fiction',panelId:'fiction',receipt:'claimed'}}),{code:'INVALID_VENTURE_REQUEST'});
 await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'create',payload:{workId:'fiction',panelId:'fiction'}}),{code:'SEO_WORK_NOT_FOUND'});
});
