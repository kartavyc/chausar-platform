// Native job controls and independent irreversible-post safety. No per-turn model preview fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Context} from '../runtime/contracts.ts';
import type {BrowserPort,BrowserPostResult,VentureDeps} from '../runtime/venture/contracts.ts';
import {findRecord,listRecords,ventureAction} from '../runtime/venture/records.ts';
import {handlers as views} from '../runtime/venture/views/index.ts';
import {decidePost,proposePost} from '../runtime/venture/build/posting.ts';
import {VentureTestStore} from './venture-test-store.ts';
import {seedPostDraft} from './venture-post-drafts.ts';
import {setup,seedBlueprint,seedOrder,seedRun,owner,phone,code} from './venture-views-env.ts';
import {createNativeJob} from '../runtime/venture/agent-runtime/native-job.ts';
import {registerAgentJob} from '../runtime/venture/agent-runtime/lifecycle.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
import {agreeClientAiConsent,getClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
import {runsStopHandler,runsResumeHandler,businessPauseHandler} from '../runtime/venture/delivery/run-controls.ts';
import {queueListHandler,queueDecideHandler} from '../runtime/venture/views/queue.ts';

async function nativeFixture() {
 const env=await setup(), blueprint=await seedBlueprint(env),{client,order}=await seedOrder(env,blueprint),run=await seedRun(env,order,{});
 env.models.connected=true; await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 await ventureAction(env.deps,owner,'prepare','test.ready',tx=>tx.touch({launchStage:'approve-each'}));
 const consent=await getClientAiConsent(env.deps,owner,{clientId:client.id});await agreeClientAiConsent(env.deps,owner,{clientId:client.id,disclosureDigest:consent.disclosureDigest});
 const options={agentId:'delivery',sections:['Reply'],check:()=>undefined};
 const job=await createNativeJob(env.deps,owner,run.id,options);
 env.deps.agentRoute=async()=>({settings:{model:'fixture-model',effort:'high',autoReview:true,network:false,webSearch:false,shell:false},driver:{async open(){return {async run(){return {status:'interrupted',text:''};},async interrupt(){},async close(){}};}}});
 return {...env,blueprint,client,order,run,job,options};
}

test('native controls enforce app authority, exact fields and named refusal states',async t=>{
 const env=await nativeFixture();t.after(()=>env.job.close());
 await assert.rejects(runsStopHandler(env.deps,phone,{runId:env.run.id}),code('APP_APPROVAL_REQUIRED'));
 await assert.rejects(runsResumeHandler(env.deps,phone,{runId:env.run.id}),code('APP_APPROVAL_REQUIRED'));
 await assert.rejects(runsStopHandler(env.deps,owner,{runId:'missing'}),code('RUN_NOT_FOUND'));
 await assert.rejects(runsResumeHandler(env.deps,owner,{runId:env.run.id}),code('RUN_NOT_STOPPED'));
 await assert.rejects(runsStopHandler(env.deps,owner,{runId:env.run.id,force:'yes'}),code('INVALID_VENTURE_REQUEST'));
 await runsStopHandler(env.deps,owner,{runId:env.run.id});
 await assert.rejects(runsStopHandler(env.deps,owner,{runId:env.run.id}),code('RUN_ALREADY_STOPPED'));
 await assert.rejects(runsResumeHandler(env.deps,owner,{runId:env.run.id}),code('RUN_RESTART_REQUIRED'));
 for(const status of ['accepted','failed'] as const){await ventureAction(env.deps,owner,'prepare','test.closed',tx=>tx.replace({...tx.find('venture-delivery-run',env.run.id)!,status}));await assert.rejects(runsStopHandler(env.deps,owner,{runId:env.run.id}),code('RUN_NOT_RUNNING'));}
});

test('pause stops every active native job immediately, while unpause restarts none',async t=>{
 const env=await nativeFixture();t.after(()=>env.job.close());
 const secondOrder=await seedOrder(env,env.blueprint),second=await seedRun(env,secondOrder.order,{});
 const permission=await getClientAiConsent(env.deps,owner,{clientId:secondOrder.client.id});await agreeClientAiConsent(env.deps,owner,{clientId:secondOrder.client.id,disclosureDigest:permission.disclosureDigest});
 const job=await createNativeJob(env.deps,owner,second.id,env.options);t.after(()=>job.close());
 let stops=0;t.after(registerAgentJob(env.store,env.job.capability.scope,()=>stops++));t.after(registerAgentJob(env.store,job.capability.scope,()=>stops++));
 const paused=await businessPauseHandler(env.deps,owner,{paused:true,stopRunning:true});assert.equal(paused.stopped,2);assert.equal(stops,2);
 const unpaused=await businessPauseHandler(env.deps,owner,{paused:false});assert.equal(unpaused.stopped,0);
 assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.status,'stopped');assert.equal(findRecord(env.store.read(),'venture-delivery-run',second.id)!.status,'stopped');
});

for(const choice of ['resume','run-again'] as const)test('Today routes '+choice+' once to a new native session',async t=>{
 const env=await nativeFixture();t.after(()=>env.job.close());
 if(choice==='resume')await ventureAction(env.deps,owner,'prepare','test.checkpoint',tx=>{const run=tx.find('venture-delivery-run',env.run.id)!;tx.replace({...run,agentJob:{...run.agentJob!,ownerNotes:[{text:'Use short sentences',at:tx.now,by:owner.memberId}]}});});
 await runsStopHandler(env.deps,owner,{runId:env.run.id});
 const queue=await queueListHandler(env.deps,owner,{scope:'current'}),row=queue.rows.find(row=>row.viewRef?.id===env.run.id)!;
 assert.ok(row.actions.some(action=>action.id===choice));if(choice==='run-again')assert.ok(!row.actions.some(action=>action.id==='resume'));
 const decision={id:row.id,digest:row.digest,action:choice,viewed:true};
 const before=listRecords(env.store.read(),'venture-delivery-run').length;
 const done=await queueDecideHandler(env.deps,owner,decision);assert.equal(done.outcome,'done');
 const newest=listRecords(env.store.read(),'venture-delivery-run').at(-1)!;await waitForAgentWork(env.store,newest.id);
 assert.equal(listRecords(env.store.read(),'venture-delivery-run').length,before+1);assert.notEqual(newest.id,env.run.id);assert.equal(newest.preview,null);
 await queueDecideHandler(env.deps,owner,decision).catch(()=>undefined);assert.equal(listRecords(env.store.read(),'venture-delivery-run').length,before+1);
});

const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };

for (const ending of ['posted', 'throw'] as const) {
  test(`stop all while a post is mid-send (${ending}): the post settles as its journal says and is never sent again`, async () => {
    const jobs: string[] = [];
    const held: { release: (() => void) | null } = { release: null };
    const port: BrowserPort = {
      async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
      async post(job) {
        jobs.push(job.postId);
        await new Promise<void>(resolve => { held.release = resolve; });
        if (ending === 'throw') throw new Error('browser crashed');
        return { outcome: 'posted', line: 'X showed the post.', url: null } satisfies BrowserPostResult;
      },
    };
    let tick = 0;
    const store = new VentureTestStore();
    const deps = { store, clock: () => new Date(Date.UTC(2026, 9, 21, 10, 0, tick++)), host: 'desktop', connectors: { browser: port, appReviewed: [], postTimeoutMs: 5000 } } as unknown as VentureDeps;
    await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
      ...tx.base('venture-record'), idea: 'Social media for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
      serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    } as any), { create: true });
    const draft = await seedPostDraft(deps, ['X: Fresh pastries at 8.']);
    const post = await proposePost(deps, agentCtx, { connectorId: 'x', draftId: draft.id });
    const sending = decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }).then(value => value, error => error);
    while (!held.release) await new Promise(resolve => setImmediate(resolve));
    const handler = (method: string) => (views as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<unknown>>)[method];
    const paused = await handler('venture.business.pause')(deps, owner, { paused: true, stopRunning: true }) as { stopped: number };
    assert.equal(paused.stopped, 0, 'a post is not a run');
    await assert.rejects(handler('venture.runs.stop')(deps, owner, { runId: draft.id, force: true }), code('RUN_NOT_RUNNING'));
    held.release!();
    await sending;
    const settled = listRecords(store.read(), 'venture-connector-post').find(item => item.id === post.id)!;
    assert.equal(settled.state, ending === 'posted' ? 'applied' : 'outcome_unknown');
    await assert.rejects(decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }), (error: any) => typeof error?.code === 'string');
    assert.deepEqual(jobs, [post.id], 'sent once, never again');
  });
}
