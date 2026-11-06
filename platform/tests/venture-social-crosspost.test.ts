import test from 'node:test';import assert from 'node:assert/strict';
import { crossPostPlan, approveCrossPost, crossPostFiles } from '../runtime/venture/playbooks/social/cross-post.ts';
test('only owned videos with rights can crosspost, each exact platform text needs both approvals',()=>{
 const input={video:{id:'v1',digest:'bytes',kind:'client' as const},rights:{basis:'own-footage',holder:'Client'},posts:[{platform:'instagram',text:'Local coffee'},{platform:'youtube-shorts',text:'Coffee short'}]};
 assert.throws(()=>crossPostPlan({...input,rights:null}),{code:'RIGHTS_REQUIRED'});
 const p=crossPostPlan(input);assert.equal(p.upload,'planned');assert.throws(()=>crossPostFiles(p),{code:'SOCIAL_APPROVAL_REQUIRED'});
 let yes=p;for(const item of p.posts){yes=approveCrossPost(yes,item.platform,'owner',item.text);yes=approveCrossPost(yes,item.platform,'client',item.text);}assert.equal(crossPostFiles(yes).files.length,2);assert.equal(crossPostFiles(yes).posted,false);
 assert.throws(()=>approveCrossPost(p,'instagram','owner','different'),{code:'APPROVAL_STALE'});
});
