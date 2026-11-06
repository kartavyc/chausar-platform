// Original Chausar social tool boundaries, catalogue S2/S5; every result is computed from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolSpec } from '../runtime/venture/delivery/harness/tools.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
const source = 'Claim: We bake daily.\nNumber: We serve 40 families.\nStory: Our family started the shop.\nMistake: We forgot to label a box.';
const srt = source.split('\n').map((line, index) => (index + 1) + '\n00:00:0' + (index * 2) + ',000 --> 00:00:0' + (index * 2 + 1) + ',000\n' + line).join('\n\n');
const env = { ventureId: 'venture_test', memberId: 'owner', epoch: 1, currency: 'INR', receipts: [], now: () => '2026-10-27T12:00:00Z', files: [{ id: 'upload_source', name: 'source.srt', format: 'transcript', bytes: source.length, digest: 'source-digest', contentBase64: Buffer.from(srt).toString('base64'), clientData: true }], runRef: { kind: 'rehearsal', scenarioId: 'source', episode: 1 }, intake: null } as unknown as ToolEnv;
test('inventory tool is built, counts the bound source and refuses thin or invented source', async () => {
 const output = await toolSpec('social.inventory')!.run(env, { source: 'f1' });
 assert.equal((output.result as any).counts.total, 4);
 assert.equal(output.receipts?.[0].figures.find(item => item.key === 'total')?.minor, '4');
 await assert.rejects(toolSpec('social.inventory')!.run(env, { source: 'Invented material.' }), { code: 'SOCIAL_SOURCE_INVALID' });
 const thin = { ...env, files: [{ ...env.files[0], contentBase64: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nOne short fact.').toString('base64') }] } as ToolEnv;
 await assert.rejects(toolSpec('social.inventory')!.run(thin, { source: 'f1' }), { code: 'SOURCE_THIN' });
});
test('format tools derive media availability and slots use the owner cap', async () => {
 const output = await toolSpec('social.formats')!.run(env, { channels: ['linkedin', 'instagram', 'x'] });
 assert.equal((output.result as any).formats.find((row: any) => row.channel === 'instagram').ready, false);
 const slots = Array.from({length: 5}, (_, n) => ({ id: 'slot-' + n, kind: n < 2 ? 'sell' : 'value', goals: ['teach'], actions: ['reply'] }));
 const result = await toolSpec('social.slots')!.run(env, { slots });
 assert.equal((result.result as any).passed, false);
 assert.equal((result.result as any).capPercent, 20);
});

test('transcript cue numbers and timecodes never inflate the source inventory', async () => {
 const one = { ...env, files: [{ ...env.files[0], contentBase64: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nWe bake daily.\n\n2\n00:00:04,000 --> 00:00:06,000\nWe bake daily.').toString('base64') }] } as ToolEnv;
 await assert.rejects(toolSpec('social.inventory')!.run(one, { source: 'f1' }), { code: 'SOURCE_THIN' });
});
test('the actual social intake step can hold its three built content tools', async () => {
 const { flagshipDelivery } = await import('../runtime/venture/playbooks/steps.ts');
 const { toolCeiling } = await import('../runtime/venture/delivery/harness/patches.ts');
 const tools = flagshipDelivery('social-agency')!.steps.find(step => step.id === 'intake')!.tools!;
 for (const name of ['social.inventory','social.formats','social.slots'] as const) {
  assert.ok(tools.includes(name));
  assert.ok(toolCeiling('agency','social-agency').includes(name));
  assert.equal(toolCeiling('agency',null).includes(name), false);
 }
});

test('delivery inventory reads only the pinned source and verifies live bytes', async () => {
 const {digest}=await import('../runtime/venture/records.ts');
 const bound={...env.files[0],digest:digest(env.files[0].contentBase64),kind:'venture-upload',ventureId:env.ventureId,scope:{kind:'order',orderId:'order_source'}};
 const order={kind:'venture-order',id:'order_source',ventureId:env.ventureId,request:source,intake:{fields:{sourceFile:bound.id}}};
 const run={kind:'venture-delivery-run',id:'run_source',ventureId:env.ventureId,orderId:order.id};
 const other={...bound,id:'upload_other'};
 const state={conversations:[bound,other,order,run]};
 const live={...env,runRef:{kind:'delivery',runId:run.id},intake:order.intake,files:[bound,other],deps:{store:{read:()=>state}}} as unknown as ToolEnv;
 await assert.rejects(toolSpec('social.inventory')!.run(live,{source:'f2'}),{code:'SOCIAL_SOURCE_INVALID'});
 assert.equal((await toolSpec('social.inventory')!.run(live,{source:'f1'})).receipts?.[0].inputs.tables[0].id,bound.id);
 bound.contentBase64=Buffer.from(srt+' changed').toString('base64');
 await assert.rejects(toolSpec('social.inventory')!.run({...live,files:[{...bound,contentBase64:env.files[0].contentBase64}]},{source:'f1'}),{code:'SOCIAL_SOURCE_INVALID'});
 await assert.rejects(toolSpec('social.inventory')!.run(live,{source}),{code:'SOCIAL_SOURCE_INVALID'});
});
