// SEO8 local checks. beyondseo MIT, independent implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLocal, localTemplates } from '../runtime/venture/playbooks/seo-visibility/local.ts';
test('owner listed citations compare normalised NAP, profile and review stay handoff',async()=>{
 const result=await auditLocal({name:'River Clinic',address:'12 River Road, Pune',phone:'+91 98765 43210',urls:['https://directory.example/clinic'],review:'Helpful team.'},{resolve:async()=>[{address:'93.184.216.34',family:4}],send:async target=>({status:200,headers:{},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<p>RIVER CLINIC. 12 River Road Pune. +91-98765-43210.</p>')})});
 assert.deepEqual(result.citations[0]?.matches,{name:true,address:true,phone:true});assert.equal(result.profile.mode,'handoff');assert.equal(result.review.mode,'handoff');
 assert.equal(localTemplates('clinic').length,4);
});
