import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { agreeClientAiConsent, getClientAiConsent, withdrawClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { queueListHandler } from '../runtime/venture/views/queue.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { ensurePlaybook, flagshipDraft } from '../runtime/venture/delivery/playbook.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { deliveryReviewHandler } from '../runtime/venture/delivery/runs.ts';
import { writeCapsToday } from '../runtime/venture/delivery/harness/write-caps.ts';

test('full draft check feedback stays available for repair while failed checks still block owner acceptance', async t => {
  const env=await fixture(t);await env.allow();
  let phase: 'fail'|'unchecked'|'not-checked'|'pass'='fail';
  const job=await createNativeJob(env.deps,owner,env.run.id,{...env.options,checkDraft:async()=>({
    checks:[{check:'claims-grounded',passed:phase!=='fail',...(phase==='not-checked'?{notChecked:true as const}:{}),detail:phase==='fail'?'Remove the unsupported claim.':phase==='not-checked'?'Review the source evidence.':'Claims match the supplied facts.'}],
    playbookChecks:[{playbook:'fixture',check:'source-review',outcome:phase==='unchecked'?'fail':'not-run',detail:phase==='unchecked'?'Review the source before proposing.':'This optional check did not run.'}],
  })});t.after(()=>job.close());const call=await agent(job);
  const draft={title:'Reply',sections:[{heading:'Reply',parts:[{kind:'text',text:'A calm voice sheet for Sunrise Bakery.',ref:''}]}],questionsForClient:[]};
  for(const current of ['fail','unchecked','not-checked','pass'] as const){
    phase=current;const saved=await call('draft_document',{draft});
    assert.equal(saved.checks[0].passed,current!=='fail');
    assert.equal(saved.playbookChecks[0].outcome,current==='unchecked'?'fail':'not-run');
    const stored=findRecord(env.store.read(),'venture-delivery-run',env.run.id)!;
    assert.ok(stored.deliverable);assert.deepEqual(stored.checks,saved.checks);
    const proposed:any=await job.service.handle(owner,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'propose_action',arguments:{kind:'send-handoff',draftId:saved.draftId,draftDigest:saved.digest,to:env.client.email,subject:'Your draft'}}});
    assert.equal(proposed.error,undefined,'an internal review card preserves the manual correction workflow');
    if(current==='fail'||current==='unchecked'){
      await ventureAction(env.deps,owner,'prepare','test.finished',tx=>{const run=tx.find('venture-delivery-run',env.run.id)!;tx.replace({...run,agentJob:{...run.agentJob!,reviewReady:true}});});
      await assert.rejects(deliveryReviewHandler(env.deps,owner,{runId:env.run.id,verdict:'accepted'}),error=>{
        assert.equal((error as any).code,'INVALID_VENTURE_REQUEST');
        assert.match((error as Error).message,current==='fail'?/unsupported claim/:/Review the source/);return true;
      });
    }
  }
});

test('native draft storage respects the current owner daily cap and keeps repeated edits within one draft', async t => {
  const env=await fixture(t);await env.allow();
  const job=await createNativeJob(env.deps,owner,env.run.id,env.options);t.after(()=>job.close());
  const call=await agent(job);
  const draft={title:'Reply',sections:[{heading:'Reply',parts:[{kind:'text',text:'A calm voice sheet for Sunrise Bakery.',ref:''}]}],questionsForClient:[]};
  await setSpendPolicy(env.deps,owner,{writeCaps:{drafts:0}});
  const refused:any=await job.service.handle(owner,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'draft_document',arguments:{draft}}});
  assert.equal(refused.error?.data?.code,'WRITE_CAP_REACHED');
  assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.deliverable,null);
  await setSpendPolicy(env.deps,owner,{writeCaps:{drafts:1}});
  await call('draft_document',{draft});await call('draft_document',{draft:{...draft,title:'Revised reply'}});
  assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.readyAt,env.deps.clock().toISOString());
});

test('draft feedback omits an absent optional playbook result and remains plain JSON',async t=>{
  const env=await fixture(t);await env.allow();
  const job=await createNativeJob(env.deps,owner,env.run.id,{...env.options,checkDraft:async()=>({checks:[],playbookChecks:undefined})});
  t.after(()=>job.close());const call=await agent(job);
  const saved=await call('draft_document',{draft:{title:'Reply',sections:[{heading:'Reply',parts:[{kind:'text',text:'A calm voice sheet.',ref:''}]}],questionsForClient:[]}});
  assert.deepEqual(saved.checks,[]);assert.equal(Object.hasOwn(saved,'playbookChecks'),false);
});

test('native drafting can cite a current attached filename without admitting foreign files or raw amounts',async t=>{
  const env=await fixture(t);await env.allow();
  await env.call('venture.files.add',{orderId:env.order.id,name:'policy.csv',contentBase64:Buffer.from('Topic,Amount\nSales,9999\n').toString('base64')});
  const job=await createNativeJob(env.deps,owner,env.run.id,env.options);t.after(()=>job.close());const call=await agent(job);
  const listed=await call('list_files');assert.ok(listed.files.some((file:any)=>file.name==='policy.csv'));
  const draft=(text:string)=>({title:'Reply',sections:[{heading:'Reply',parts:[{kind:'text',text,ref:''}]}],questionsForClient:[]});
  assert.ok((await call('draft_document',{draft:draft('Source: policy.csv.')})).draftId);
  const raw=async(text:string)=>job.service.handle(owner,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'draft_document',arguments:{draft:draft(text)}}});
  const foreign:any=await raw('Source: private-other-client.csv.');assert.equal(foreign.error?.data?.code,'DRAFT_CHECK_FAILED');
  const amount:any=await raw('Source: policy.csv. Sales were 9999 rupees.');assert.equal(amount.error?.data?.code,'MODEL_OUTPUT_REJECTED');
});

test('native handoff proposals respect the owner message cap and count the exact proposal once', async t => {
  const env=await fixture(t);await env.allow();
  const job=await createNativeJob(env.deps,owner,env.run.id,env.options);t.after(()=>job.close());
  const call=await agent(job),client=await call('read_client');
  const saved=await call('draft_document',{draft:{title:'Reply',sections:[{heading:'Reply',parts:[{kind:'text',text:'A calm voice sheet for Sunrise Bakery.',ref:''}]}],questionsForClient:[]}});
  const proposal={kind:'send-handoff',draftId:saved.draftId,draftDigest:saved.digest,to:client.email??'',subject:'Your draft'};
  await setSpendPolicy(env.deps,owner,{writeCaps:{messages:0}});
  const refused:any=await job.service.handle(owner,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'propose_action',arguments:proposal}});
  assert.equal(refused.error?.data?.code,'WRITE_CAP_REACHED');
  assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.agentJob!.proposal,null);
  await setSpendPolicy(env.deps,owner,{writeCaps:{messages:1}});
  await call('propose_action',proposal);await call('propose_action',proposal);
  const venture=findRecord(env.store.read(),'venture-record',env.run.ventureId)!;
  assert.equal(writeCapsToday(env.store.read(),venture,env.deps.clock().toISOString()).find(item=>item.kind==='messages')!.used,1);
});

test('native memory carries screened current-client notes and owner knowledge as data, and Forget revokes it', async t => {
  const env = await fixture(t); await env.allow();
  let noteId = '';
  await ventureAction(env.deps, owner, 'prepare', 'test.memory', tx => {
    const role = flagshipDelivery(env.playbook.flagship!)!.roles.find(role => role.kind === 'agent')!.id;
    const note = { ...tx.base('venture-agent-note'), agent: role, scope: 'agent' as const, load: 'always' as const,
      text: 'Voice sheets use calm wording.', source: { kind: 'owner-words' as const, quote: null, messageId: null }, captured: '2026-10-30', hash: 'fixture', forgotten: false };
    noteId = note.id; tx.put(note);
    tx.put({ ...note, ...tx.base('venture-agent-note'), scope: 'client:unrelated', load: 'topic', text: 'An unrelated client has a private voice sheet.' });
    const knowledge = { ...tx.base('venture-knowledge'), sourceKind: 'text' as const, title: 'Voice sheet style', text: 'Voice sheets use clear short sentences.', url: null, uploadId: null, runId: null, screen: null, removedAt: null };
    tx.put(knowledge);
    tx.put({ ...knowledge, ...tx.base('venture-knowledge'), sourceKind: 'past-work', runId: 'unrelated-run', text: 'A voice sheet with private past client work.' });
  });
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.close());
  const business = await (await agent(job))('read_business');
  assert.ok(business.notes.items.some((item: any) => item.id === noteId));
  assert.ok(business.knowledge.items.some((item: any) => item.text.includes('clear short sentences')));
  assert.ok(!JSON.stringify(business).includes('private'));
  assert.equal(business.notes.background, true); assert.equal(business.knowledge.background, true);
  assert.ok(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.agentJob?.recalled?.includes(noteId));
  await ventureAction(env.deps, owner, 'approve', 'test.forget', tx => tx.replace({ ...tx.find('venture-agent-note', noteId)!, text: '', forgotten: true }));
  assert.throws(() => job.capability.assert(), { code: 'JOB_SOURCE_CHANGED' });
});

async function fixture(t: { after(fn: () => void): void }) {
  t.after(installKitFixture());
  const env = await kitBusiness();
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const playbook = await ensurePlaybook(env.deps, owner);
  const run = await ventureAction(env.deps, owner, 'prepare', 'test.run', tx => {
    tx.touch({ launchStage: 'approve-each' });
    return tx.put({ ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: playbook.id, playbookHash: playbook.hash,
      status: 'waiting-for-you', servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null,
      renderedText: null, checks: [], verdict: null, editedText: null });
  });
  const options = { agentId: 'writer', sections: ['Reply'], check: () => undefined };
  const allow = async () => {
    const view = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
    await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: view.disclosureDigest });
  };
  return { ...env, order, run, options, allow, playbook };
}
async function agent(job: Awaited<ReturnType<typeof createNativeJob>>) {
  const service = job.service;
  await service.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scripted-agent', version: '1' } } });
  await service.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async (name: string, args: Record<string, unknown> = {}) => {
    const answer: any = await service.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    assert.equal(answer.error, undefined, JSON.stringify(answer.error));
    return answer.result.structuredContent.data;
  };
}
test('native toolbox requires consent, stores a receipt-backed proposal and surfaces it on Today without sending', async t => {
  const env = await fixture(t);
  await assert.rejects(createNativeJob(env.deps, owner, env.run.id, env.options), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  await env.allow();
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.capability.close());
  const call = await agent(job);
  const external: any = await job.service.handle(owner, { jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'external_tools', arguments: { serverId: '', query: '' } } });
  assert.equal(external.error, undefined, 'owner-added MCP tools are reachable only through the scoped proxy');
  assert.deepEqual(external.result.structuredContent.data.servers, []);
  const order = await call('read_order'); assert.equal(order.id, env.order.id);
  assert.deepEqual(order.intake, env.order.intake);
  const business = await call('read_business');
  const expected = flagshipDraft(env.playbook, env.offers[0].playbookOffer!, env.order.intake, env.order.chainStage);
  assert.deepEqual(business.workInstructions, expected!.guidance);
  const price = await call('calculate', { operation: 'order_price', arguments: {} });
  const ref = price.refs.figures.find((item: any) => item.figureKey === 'total').ref;
  const saved = await call('draft_document', { draft: { title: 'Your requested work', sections: [{ heading: 'Reply', parts: [
    { kind: 'text', text: 'Here is the agreed price for the work.', ref: '' }, { kind: 'figure', text: '', ref },
  ] }], questionsForClient: [] } });
  const client = await call('read_client');
  await call('propose_action', { kind: 'send-handoff', draftId: saved.draftId, draftDigest: saved.digest, to: client.email, subject: 'Your draft' });
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'ready-for-review');
  assert.equal(stored.agentJob?.proposal?.body, stored.renderedText);
  const today = await queueListHandler(env.deps, owner, { scope: 'current' });
  assert.ok(today.rows.some(row => row.viewRef?.id === env.run.id && row.kind === 'draft'));
  assert.equal(env.store.read().actions.length, 0);
  assert.equal(stored.verdict, null);
  await call('draft_document', { draft: { title: 'A revised draft', sections: [{ heading: 'Reply', parts: [
    { kind: 'text', text: 'Please review this revised draft.', ref: '' }, { kind: 'figure', text: '', ref },
  ] }], questionsForClient: [] } });
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'waiting-for-you');
});
test('withdrawal and regrant cannot revive an old running job', async t => {
  const env = await fixture(t); await env.allow();
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.capability.close());
  await withdrawClientAiConsent(env.deps, owner, { clientId: env.client.id });
  assert.throws(() => job.capability.assert(), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  await env.allow();
  assert.throws(() => job.capability.assert(), { code: 'CLIENT_AI_CONSENT_CHANGED' });
});

test('a changed external server configuration revokes the entire job even before another tool call', async t => {
  const env = await fixture(t); await env.allow();
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.close());
  const { settings } = await getAgentSettings(env.deps, owner, {});
  await setAgentSettings(env.deps, owner, { settings: { ...settings, mcpServers: [{ id: 'local', name: 'Local tools', transport: 'http', url: 'http://localhost:1234/mcp' }] }, approveMcpConfiguration: true });
  assert.throws(() => job.capability.assert(), { code: 'JOB_SOURCE_CHANGED' });
});

test('the native calculator sums attached source cells and saves a run-bound receipt', async t => {
  const env = await fixture(t); await env.allow();
  const file = await env.call('venture.files.add', { orderId: env.order.id, name: 'costs.csv',
    contentBase64: Buffer.from('Category,Amount\nTravel,12.34\nTools,5.66\n').toString('base64') });
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.capability.close());
  const call = await agent(job);
  const result = await call('calculate', { operation: 'sum_rows', arguments: { fileId: file.id, amountColumn: 'Amount' } });
  const figure = result.receipts[0].figures.find((item: any) => item.key === 'total');
  assert.equal(figure.minor, '1800');
  const saved = findRecord(env.store.read(), 'venture-work-receipt', result.receipts[0].id)!;
  assert.deepEqual(saved.runRef, { kind: 'delivery', runId: env.run.id });
  assert.equal(saved.inputs.tables[0].id, file.id);
  assert.equal(env.store.read().actions.length, 0);
  const denied: any = await job.service.handle(owner, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'calculate', arguments: { operation: 'sum_rows', arguments: { fileId: 'foreign-file', amountColumn: 'Amount' } },
  } });
  assert.equal(denied.error?.data?.code ?? denied.result?.structuredContent?.error?.code, 'JOB_FILE_FORBIDDEN');
  const grouped = await call('calculate', { operation: 'totals_by', arguments: { fileId: file.id, amountColumn: 'Amount', groupColumn: 'Category' } });
  assert.equal(grouped.receipts[0].figures.find((item: any) => item.key === 'total').minor, '1800');
});

test('approved desk sources stay scoped to the order and changes revoke the native job', async t => {
  const env = await fixture(t); await env.allow();
  let sourceId = '';
  await ventureAction(env.deps, owner, 'prepare', 'test.website-source', tx => {
    tx.replace({ ...env.playbook, flagship: 'website-studio' });
    const source = { ...tx.base('venture-site-requirement'), orderId: env.order.id, clientId: env.client.id,
      intakeDigest: 'synthetic-intake', brief: 'A public bakery contact page.', pages: 'Home', forms: 'Contact', domain: '',
      repo: { owner: '', name: '' }, host: '', connection: null, requirements: [], source: null, uiReport: null, care: null,
      preview: null, briefApproved: 'synthetic-approval', aiRequest: null, aiCallIds: [], capture: null };
    sourceId = source.id; tx.put(source as any);
    tx.put({ ...source, ...tx.base('venture-site-requirement'), orderId: 'another-order', brief: 'Unrelated client information.' } as any);
  });
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.capability.close());
  const business = await (await agent(job))('read_business');
  assert.equal(business.playbookEvidence.siteProject.brief, 'A public bakery contact page.');
  assert.ok(!JSON.stringify(business).includes('Unrelated client information'));
  await ventureAction(env.deps, owner, 'prepare', 'test.revoke-source', tx => tx.replace({ ...tx.find('venture-site-requirement', sourceId)!, briefApproved: null }));
  assert.throws(() => job.capability.assert(), { code: 'JOB_SOURCE_CHANGED' });
});


test('changing this client tax identity revokes an open job before another calculator call', async t => {
  const env = await fixture(t); await env.allow();
  const job = await createNativeJob(env.deps, owner, env.run.id, env.options); t.after(() => job.close());
  await ventureAction(env.deps, owner, 'prepare', 'test.client-tax', tx => {
    tx.replace({ ...tx.find('venture-client', env.client.id)!, taxId: '27ABCDE1234F1Z0' });
  });
  assert.throws(() => job.capability.assert(), { code: 'JOB_SOURCE_CHANGED' });
});
test('native memory excludes foreign media, poster and practice uploads while retaining current-order sources', async t => {
  const env = await fixture(t); await env.allow();
  for (const scope of [{kind:'media',orderId:'another-order'},{kind:'poster',orderId:'another-order'},{kind:'practice',scenarioId:'rehearsal'}] as const) {
    await ventureAction(env.deps, owner, 'prepare', 'test.scoped-memory', tx => {
      const file = {...tx.base('venture-upload'), scope, name:'voice.txt',format:'transcript', bytes:24,clientData:true};
      tx.put(file as any);
      tx.put({...tx.base('venture-knowledge'),sourceKind:'file',title:'Voice sheet private source',text:'Voice sheets contain private unrelated source wording.',url:null,uploadId:file.id,runId:null,screen:null,removedAt:null});
    });
  }
  await ventureAction(env.deps, owner, 'prepare', 'test.current-memory', tx => {
    const file={...tx.base('venture-upload'),scope:{kind:'media',orderId:env.order.id},name:'voice.txt',format:'transcript',bytes:24,clientData:true};
    tx.put(file as any);
    tx.put({...tx.base('venture-knowledge'),sourceKind:'file',title:'Voice sheet current source',text:'Voice sheets contain this order approved source wording.',url:null,uploadId:file.id,runId:null,screen:null,removedAt:null});
  });
  const job=await createNativeJob(env.deps,owner,env.run.id,env.options);t.after(()=>job.close());
  const business=await (await agent(job))('read_business');
  assert.ok(!JSON.stringify(business.knowledge).includes('private unrelated'));
  assert.ok(JSON.stringify(business.knowledge).includes('this order approved'));
});
