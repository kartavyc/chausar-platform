// Original Cloudflare KV staging tests. Official REST contract; no third-party source copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareKvTarget } from '../runtime/venture/build/edge-overrides.ts';
import { contentDigest, stageSiteEdit, applySiteEdit, rollbackSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import type { PinnedSender } from '../runtime/venture/core/net-guard.ts';
const resolve = async()=>[{address:'93.184.216.34',family:4 as const}];
test('KV overrides stage exact content then apply and rollback through the existing journal',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'SEO agency for clinics'});let value='old value',puts=0;
 const send:PinnedSender=async request=>{assert.equal(request.url.hostname,'api.cloudflare.com');assert.match(request.headers.authorization,/^Bearer /);if(request.method==='PUT'){value=String(request.body);puts++;return {status:200,headers:{},body:Buffer.from('{"success":true}')};}return {status:200,headers:{},body:Buffer.from(value)};};
 const target=cloudflareKvTarget({accountId:'a'.repeat(32),namespaceId:'b'.repeat(32),token:'fixture'+' token'},{resolve,send});
 const edit=await stageSiteEdit(env.deps,owner,target,{path:'clinic/home',after:'new value',summary:'Update clinic description'});assert.equal(puts,0);assert.equal(edit.target.kind,'cloudflare-kv');
 await assert.rejects(applySiteEdit(env.deps,{...owner,channel:'agent'} as any,target,{editId:edit.id,planDigest:edit.planDigest}),{code:'APP_APPROVAL_REQUIRED'});
 const applied=await applySiteEdit(env.deps,owner,target,{editId:edit.id,planDigest:edit.planDigest});assert.equal(applied.state,'applied');assert.equal(value,'new value');assert.equal(puts,1);
 const reverted=await rollbackSiteEdit(env.deps,owner,target,{editId:edit.id,planDigest:edit.planDigest});assert.equal(reverted.state,'rolled-back');assert.equal(value,'old value');assert.equal(puts,2);
});
test('KV refuses stale source before write and never claims eventual readback is verified',async()=>{
 let value='other value',puts=0;const send:PinnedSender=async request=>{if(request.method==='PUT'){puts++;return {status:200,headers:{},body:Buffer.from('{"success":true}')};}return {status:200,headers:{},body:Buffer.from(value)};};
 const target=cloudflareKvTarget({accountId:'a'.repeat(32),namespaceId:'b'.repeat(32),token:'fixture'+' token'},{resolve,send});
 await assert.rejects(target.replace('clinic/home','new value',contentDigest('old value')),{code:'SITE_CHANGED_SINCE_REVIEW'});assert.equal(puts,0);
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'SEO agency for clinics'});const edit=await stageSiteEdit(env.deps,owner,target,{path:'clinic/home',after:'new value',summary:'Update clinic description'});
 assert.equal((await applySiteEdit(env.deps,owner,target,{editId:edit.id,planDigest:edit.planDigest})).state,'needs-inspection');assert.equal(puts,1);
 await assert.rejects(applySiteEdit(env.deps,owner,target,{editId:edit.id,planDigest:edit.planDigest}));assert.equal(puts,1);
});
