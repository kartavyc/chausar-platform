import {it,expect} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
import type {ClientAiConsentView,DeliveryLite,OrderLite,RunDetail,RunControlResult,QueueList} from '../../src/engine/types';
import {MODEL_PRESETS} from '../../src/engine/fixtures-business';
import type {FakeWorkDesk} from '../../src/engine/fake-work';

async function connected() {
 const preset=MODEL_PRESETS.find(preset=>preset.id==='codex-cli')!,before=structuredClone(preset),engine=new FakeEngine();
 try{engine.firstRun.signIn();await engine.request('venture.models.connect',{presetId:preset.id,consentDigest:preset.consentDigest});}finally{Object.assign(preset,before);}
 return engine;
}

async function activeJob(){const engine=await connected(),order=(await engine.request('venture.order.list') as OrderLite[])[0]!;const consent=await engine.request('venture.client.aiConsent.get',{clientId:order.clientId}) as ClientAiConsentView;await engine.request('venture.client.aiConsent.agree',{clientId:order.clientId,disclosureDigest:consent.disclosureDigest});const run=await engine.request('venture.delivery.run',{orderId:order.id}) as DeliveryLite;return {engine,order,run};}
it('Forget erases native fake owner instructions and progress and prevents continuation',async()=>{
 const {engine,order,run}=await activeJob();await engine.request('venture.runs.steer',{runId:run.id,text:'Private client instruction.'});
 const internal=engine as unknown as {work:FakeWorkDesk;runs:RunDetail[]},detail=internal.runs.find(item=>item.runId===run.id)!;
 detail.agentProgress!.messages=[{id:'private-message',text:'Private client result.',label:'model-estimate'}];
 internal.work.eraseRecruitingCopies(detail.businessId,[order.id],'Client data deleted.');
 const erased=await engine.request('venture.runs.get',{runId:run.id}) as RunDetail;
 expect(erased.steer).toBeUndefined();expect(erased.agentProgress?.messages).toEqual([]);expect(erased.agentProgress?.tools).toEqual([]);expect(erased.agentProgress?.canResume).toBe(false);
 await expect(engine.request('venture.runs.resume',{runId:run.id})).rejects.toMatchObject({code:'RUN_RESTART_REQUIRED'});
});
it('native fake Stop is immediate, has no invented checkpoint, and refuses retired round controls',async()=>{
 const {engine,run}=await activeJob();
 const stopped=await engine.request('venture.runs.stop',{runId:run.id}) as RunControlResult;
 expect(stopped.run.stop?.state).toBe('stopped');expect(stopped.run.agentProgress?.canResume).toBe(false);
 expect((await engine.request('venture.delivery.list') as DeliveryLite[]).find(item=>item.id===run.id)?.status).toBe('stopped');
 await expect(engine.request('venture.runs.resume',{runId:run.id})).rejects.toMatchObject({code:'RUN_RESTART_REQUIRED'});
 await expect(engine.request('venture.runs.roundGate',{runId:run.id,on:true})).rejects.toMatchObject({code:'RUN_CONTROL_UNAVAILABLE'});
 await expect(engine.request('venture.runs.stop',{runId:run.id,force:'yes'})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
});
it('native fake steering stops and continues in a new session without inheriting approvals or progress',async()=>{
 const {engine,run}=await activeJob();
 const steered=await engine.request('venture.runs.steer',{runId:run.id,text:'Keep the reply short.'}) as RunControlResult;
 expect(steered.run.stop?.state).toBe('stopped');expect(steered.run.agentProgress?.canResume).toBe(true);
 expect(steered.run.steer?.[0]?.line).toBe('Saved for the next AI session.');
 const resumed=await engine.request('venture.runs.resume',{runId:run.id}) as RunControlResult;
 expect(resumed.run.runId).not.toBe(run.id);expect(resumed.line).toBe('Continued from saved work in a new AI session.');
 expect(resumed.run.agentProgress?.messages).toEqual([]);expect(resumed.run.agentProgress?.pendingApproval).toBeUndefined();expect(resumed.run.agentProgress?.cost).toBeUndefined();
 expect(resumed.run.steer?.[0]?.text).toBe('Keep the reply short.');
 await expect(engine.request('venture.runs.resume',{runId:run.id})).rejects.toMatchObject({code:'RUN_SUPERSEDED'});
});
it('native fake continuation checks current sources and permission, while Run again creates fresh work',async()=>{
 const {engine,order,run}=await activeJob();await engine.request('venture.runs.steer',{runId:run.id,text:'Keep this instruction.'});
 await engine.request('venture.client.aiConsent.withdraw',{clientId:order.clientId});
 await expect(engine.request('venture.runs.resume',{runId:run.id})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_REQUIRED'});
 const stoppedRow=(await engine.request('venture.queue.list',{scope:'all'}) as QueueList).rows.find(row=>row.id.startsWith(`runctl:${run.id}:`))!;
 await expect(engine.request('venture.queue.decide',{id:stoppedRow.id,digest:stoppedRow.digest,action:'run-again'})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_REQUIRED'});
 const consent=await engine.request('venture.client.aiConsent.get',{clientId:order.clientId}) as ClientAiConsentView;await engine.request('venture.client.aiConsent.agree',{clientId:order.clientId,disclosureDigest:consent.disclosureDigest});
 await engine.request('venture.files.add',{orderId:order.id,name:'new-brief.txt',contentBase64:btoa('Updated brief')});
 // The old checkpoint still matches its own files, but a new session also checks newly attached inputs.
 expect((await engine.request('venture.runs.get',{runId:run.id}) as RunDetail).agentProgress?.canResume).toBe(true);
 await expect(engine.request('venture.runs.resume',{runId:run.id})).rejects.toMatchObject({code:'RUN_RESTART_REQUIRED'});
 const row=(await engine.request('venture.queue.list',{scope:'all'}) as QueueList).rows.find(row=>row.id.startsWith(`runctl:${run.id}:`))!;
 await engine.request('venture.queue.decide',{id:row.id,digest:row.digest,action:'run-again'});
 const newest=(await engine.request('venture.delivery.list') as DeliveryLite[])[0]!;expect(newest.id).not.toBe(run.id);expect(newest.orderId).toBe(order.id);
 const detail=await engine.request('venture.runs.get',{runId:newest.id}) as RunDetail;expect(detail.agentProgress?.messages).toEqual([]);expect(detail.steer).toBeUndefined();
});
it('Pause all stops native fake work immediately and cannot restart it while paused',async()=>{
 const {engine,run}=await activeJob();await engine.request('venture.runs.steer',{runId:run.id,text:'Continue with a shorter reply.'});
 const next=await engine.request('venture.runs.resume',{runId:run.id}) as RunControlResult;
 await engine.request('venture.business.pause',{paused:true,stopRunning:true});
 expect((await engine.request('venture.runs.get',{runId:next.run.runId}) as RunDetail).stop?.state).toBe('stopped');
 await expect(engine.request('venture.runs.resume',{runId:next.run.runId})).rejects.toMatchObject({code:'BUSINESS_PAUSED'});
});

it('fake AI jobs require this client permission, have progress, and never use turn previews',async()=>{
 const engine=await connected();const order=(await engine.request('venture.order.list') as OrderLite[])[0]!;
 await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_REQUIRED'});
 const consent=await engine.request('venture.client.aiConsent.get',{clientId:order.clientId}) as ClientAiConsentView;
 await engine.request('venture.client.aiConsent.agree',{clientId:order.clientId,disclosureDigest:consent.disclosureDigest});
 const started=await engine.request('venture.delivery.run',{orderId:order.id}) as DeliveryLite&{preview:unknown};
 expect(started.status).toBe('waiting-for-you');expect(started.awaitingYou).toBe(false);expect(started.preview).toBeNull();expect(started.deliverable).toBeNull();
 const run=await engine.request('venture.runs.get',{runId:started.id}) as RunDetail;expect(run.state).toBe('active');expect(run.agentProgress).toEqual({messages:[],tools:[]});expect(run.steps.some(step=>step.state==='done')).toBe(false);
 await engine.request('venture.client.aiConsent.withdraw',{clientId:order.clientId});
 const stopped=await engine.request('venture.runs.get',{runId:started.id}) as RunDetail;expect(stopped.state).toBe('failed');
 await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_REQUIRED'});
});
it('built-in outlines require no AI consent and never ask for a model turn approval',async()=>{
 const engine=new FakeEngine(),order=(await engine.request('venture.order.list') as OrderLite[])[0]!;
 const run=await engine.request('venture.delivery.run',{orderId:order.id,useTemplate:true}) as DeliveryLite&{preview:unknown};
 expect(run.status).toBe('ready-for-review');expect(run.servedBy).toBe('template');expect(run.preview).toBeNull();expect(run.deliverable?.title).toBe('Reply outline');
 expect(run.renderedText).toContain('# Reply outline');expect(run.renderedText).toContain('## Summary');
 const accepted=await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'}) as DeliveryLite;expect(accepted.status).toBe('accepted');
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'})).rejects.toMatchObject({code:'DELIVERY_NOT_READY'});
 expect((await engine.request('venture.client.aiConsent.get',{clientId:order.clientId}) as ClientAiConsentView).status).toBe('required');
});
