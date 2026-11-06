import test from 'node:test';import assert from 'node:assert/strict';
import { montagePlan, hookVariation } from '../runtime/venture/playbooks/social/montage.ts';
test('montage checks in-clip moments, snaps only inside owner beat grid, uses captions and requires contact end card',()=>{
 const input={clips:[{id:'v1',durationMs:6000,startMs:1000,endMs:5000}],beatMap:[0,1000,2000,3000,4000,5000,6000],contact:'Call the shop',words:[{text:'Fresh coffee',startMs:0,endMs:1000}]};
 const p=montagePlan(input);assert.equal(p.cuts[0].durationMs,4000);assert.equal(p.endCard.contact,'Call the shop');assert.ok(p.captions.includes('Fresh coffee'));
 assert.throws(()=>montagePlan({...input,contact:''}),{code:'CONTACT_REQUIRED'});assert.throws(()=>montagePlan({...input,clips:[{...input.clips[0],endMs:7000}]}),{code:'CLIP_RANGE_INVALID'});
 assert.throws(()=>montagePlan({...input,words:[]}),{code:'SOCIAL_INPUT_INVALID'});
 const variant=hookVariation(p,'A new opening',p.cuts);assert.deepEqual(variant.cuts,p.cuts);assert.throws(()=>hookVariation(p,'A new opening',[{...p.cuts[0],durationMs:2000}]),{code:'HOOK_CUT_CHANGED'});
});
