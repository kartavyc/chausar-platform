// Actual SEO tool contracts, independent Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_VISIBILITY_TOOLS as tools } from '../runtime/venture/delivery/harness/tools-seo-visibility.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
function env(text:string){return {files:[{id:'file_one',name:'source.csv',format:'csv',bytes:Buffer.byteLength(text),contentBase64:Buffer.from(text).toString('base64')}],tables:[],receipts:[],ventureId:'venture_test',runRef:{kind:'delivery',runId:'run_test'},memberId:'owner',epoch:1,currency:'INR',now:()=> '2026-10-27T12:00:00.000Z',deps:{net:{}}} as unknown as ToolEnv;}
test('refresh reads an actual order file and returns a receipt with the plan; missing files cannot be invented',async()=>{
 const result=await tools['seo.refresh'].run(env('Query,Page,Clicks,Impressions,Position\ncare,https://clinic.example/a,1,100,4'),{file:'f1'});
 assert.equal((result.result as any).data.kind,'plan-only');assert.equal(result.receipts?.length,1);
 await assert.rejects(tools['seo.refresh'].run(env(''),{file:'f2'}));
});
test('article lint is a real tool, binds its exact input and refuses malformed source manifests',async()=>{
 const result=await tools['seo.lint'].run(env(JSON.stringify({text:'Care without invented figures.',local:null})),{file:'f1'});
 assert.equal((result.result as any).data.pass,true);assert.match((result.result as any).data.artifactDigest,/^[0-9a-f]{64}$/);
 await assert.rejects(tools['seo.lint'].run(env('{broken'),{file:'f1'}),{code:'SEO_INPUT_INVALID'});
});
