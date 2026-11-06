// SEO6 refresh router, loamwright Apache-2.0 ideas only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPlan } from '../runtime/venture/playbooks/seo-visibility/refresh.ts';
test('GSC CSV routes by code to plans, never live edits',()=>{
 const csv='Query,Page,Clicks,Impressions,CTR,Position\ncare,https://clinic.example/a,1,100,1%,4\ncare,https://clinic.example/b,1,100,1%,14\ndentist,https://clinic.example/c,10,100,10%,12';
 const plan=refreshPlan({csv,gaps:['evening clinic'],missingAi:['family care']});
 assert.equal(plan.kind,'plan-only');for(const action of ['title-meta','depth-rewrite','consolidate','new-article','ai-overview'])assert.ok(plan.rows.some(r=>r.action===action));
 assert.throws(()=>refreshPlan({csv:'Query,Clicks\ncare,1',gaps:[],missingAi:[]}),{code:'GSC_EXPORT_INVALID'});
 assert.throws(()=>refreshPlan({csv:csv.replace(',1,100,1%,4',',-1,100,1%,4'),gaps:[],missingAi:[]}),{code:'GSC_EXPORT_INVALID'});
});
