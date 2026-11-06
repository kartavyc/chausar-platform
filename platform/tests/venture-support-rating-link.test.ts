// Public rating tokens and single-use form, ResolveHQ (source-available) ideas only; original integration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_DESK_DESK } from '../runtime/venture/playbooks/support-desk/desk.ts';
import { supportRatingEntry } from '../runtime/venture/playbooks/support-desk/rating-link.ts';
import { setup,owner,code } from './venture-views-env.ts';
import { ventureAction,listRecords } from '../runtime/venture/records.ts';
test('a rating link is opaque, GET records nothing, and exactly one customer rating can be submitted',async()=>{
 const env=await setup();const deps={...env.deps,host:'hosted-web' as const,publicUrl:'https://app.example.com'};const h=SUPPORT_DESK_DESK.ticket!;
 const p=await h.act!(deps,owner,{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:'rating_thread',customerEmail:'buyer@example.com',subject:'A private issue',language:'en',blocked:false}});
 await ventureAction(deps,owner,'prepare','seed.sent',tx=>tx.replace({...tx.find('venture-support-ticket',p.id)!,proposal:null,sentAt:tx.now}));
 const view=await h.get!(deps,owner,{playbook:'support-desk',kind:'ticket',id:p.id});
 const invite=await h.act!(deps,owner,{playbook:'support-desk',kind:'ticket',id:p.id,action:'rating-link',payload:{},digest:view.digest});
 const url=(invite.result as any).url as string;const token=url.split('/').at(-1)!;
 assert.match(token,/^[A-Za-z0-9_-]{32}$/);
 assert.ok(!JSON.stringify(env.store.read()).includes(token));
 const page=await supportRatingEntry(deps,owner,token,{operation:'page'});
 assert.equal(page?.answered,false);
 assert.ok(!JSON.stringify(page).includes('A private issue'));
 assert.equal(listRecords(env.store.read(),'venture-support-rating').length,0);
 await supportRatingEntry(deps,owner,token,{operation:'rate',score:5});
 assert.equal(listRecords(env.store.read(),'venture-support-rating').length,1);
 await assert.rejects(supportRatingEntry(deps,owner,token,{operation:'rate',score:1}),code('SUPPORT_RATING_EXISTS'));
 assert.equal(await supportRatingEntry(deps,owner,'x'.repeat(32),{operation:'page'}),null);
});
