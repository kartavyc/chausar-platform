// Wave 5 integration: real browser rule routing must not erase a landed kit's register.
import {it,expect} from 'vitest';
import {rulesListFor} from '../../src/engine/fixtures-rules';
import {FakeWiringDesk} from '../../src/engine/fake-wiring';
const ids=['seo-visibility','online-seller','support-desk','recruiting-desk','job-search-desk','translation-studio','bookkeeping-cfo','podcast-to-article','lead-generation','newsletter-studio','tender-desk','website-studio','narration-studio','virtual-assistant'];
for(const id of ids)it(id+' exposes its real dated rules in browser rehearsal',()=>{
 const current=rulesListFor({id,label:id},'2026-10-29');
 expect(current.playbook?.id).toBe(id);expect(current.rules.length).toBeGreaterThan(0);
 expect(current.rules.every(r=>r.sources.length>0)).toBe(true);
 const old=rulesListFor({id,label:id},'2028-10-29');
 expect(old.rules.every(r=>r.stale)).toBe(true);
 expect(old.rules.map(r=>r.id)).toEqual(current.rules.map(r=>r.id));
});
it('public fake rules use the business day in India and reject extra request fields',()=>{
 const playbook={id:'lead-generation',label:'Lead generation'},now='2027-01-25T20:00:00Z';
 const desk=new FakeWiringDesk({current:()=> 'business',now:()=>now,emit:()=>{},hosted:()=>false,ask:()=>({playbook})});
 expect(desk.request('venture.rules.list',{})).toEqual(rulesListFor(playbook,'2027-01-26'));
 expect(()=>desk.request('venture.rules.list',{invented:true})).toThrowError(expect.objectContaining({code:'INVALID_VENTURE_REQUEST'}));
});
