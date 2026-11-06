import assert from 'node:assert/strict';
import {test} from 'node:test';
import {youtubePublicRequest,youtubeQuotaDay,reserveYoutubeQuota} from '../runtime/venture/playbooks/youtube/public-state.ts';
test('public request preview validates exact fields and counts each page in the correct Pacific day bucket',()=>{
 assert.deepEqual(youtubePublicRequest({kind:'search',query:'shop accounting'}),{kind:'search',query:'shop accounting'});
 assert.throws(()=>youtubePublicRequest({kind:'videos',ids:['abcdefghijk'],token:'hidden'}));
 assert.throws(()=>youtubePublicRequest({kind:['search'],query:'shop'}));
 assert.equal(youtubeQuotaDay('2026-10-29T06:59:59Z'),'2026-10-28');assert.equal(youtubeQuotaDay('2026-10-29T07:00:00Z'),'2026-10-29');
 const old=[{project:'same-project',day:'2026-10-28',shared:3,search:99}],next=reserveYoutubeQuota(old,'same-project','2026-10-28','search');
 assert.equal(next[0]?.search,100);assert.equal(old[0]?.search,99);assert.throws(()=>reserveYoutubeQuota(next,'same-project','2026-10-28','search'),{code:'QUOTA_REACHED'});
 assert.equal(reserveYoutubeQuota(next,'same-project','2026-10-29','search').at(-1)?.search,1);
 assert.equal(reserveYoutubeQuota(next,'same-project','2026-10-28','shared')[0]?.shared,4);
});
