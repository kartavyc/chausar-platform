// SEO4 contract, independently written from loamwright (Apache-2.0) ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintArticle, stripCompetitors } from '../runtime/venture/playbooks/seo-visibility/lint.ts';
import { corroborateClaims } from '../runtime/venture/playbooks/seo-visibility/corroborate.ts';
import type { PinnedSender } from '../runtime/venture/core/net-guard.ts';
const resolve=async()=>[{address:'93.184.216.34',family:4 as const}];
test('each numeric occurrence must match its adjacent marker declared number, even when a marker is reused',async()=>{
 const text='35% [claim:c1] of visitors. An invented 99% [claim:c1] conversion rate.';
 const send:PinnedSender=async target=>({status:200,headers:{},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'35% of visitors.')});
 assert.equal(lintArticle({text,local:null}).pass,false);
 assert.equal((await corroborateClaims({text,claims:[{id:'c1',number:'35%',urls:['https://one.example/a','https://two.example/a']}],competitors:[]},{resolve,send})).pass,false);
 assert.equal((await corroborateClaims({text:'35% [claim:c1] and 35% [claim:c1].',claims:[{id:'c1',number:'35%',urls:['https://one.example/a','https://two.example/a']}],competitors:[]},{resolve,send})).pass,true);
});
test('numbers need claim markers, stock phrases block and local evidence must appear in the page',()=>{
 assert.equal(lintArticle({text:'We helped 35% of visitors.',local:null}).checks.find(c=>c.id==='claim-markers')?.pass,false);
 assert.equal(lintArticle({text:'We helped 35% [claim:c1] of visitors.',local:null}).checks.find(c=>c.id==='claim-markers')?.pass,true);
 assert.equal(lintArticle({text:'Delve into a game changer. '.repeat(10),local:null}).checks.find(c=>c.id==='ai-tell')?.pass,false);
 const local={programme:'City licence',caseOrPress:'Clinic case',landmark:'River bridge',priceOrLogistics:'Walk in'};
 assert.equal(lintArticle({text:'Generic page.',local}).checks.find(c=>c.id==='doorway-page')?.pass,false);
 assert.equal(lintArticle({text:Object.values(local).join('. ')+'.',local}).checks.find(c=>c.id==='doorway-page')?.pass,true);
 const cleaned=stripCompetitors('Read [them](https://blog.rival.co.in/a) and https://safe.example/a.', ['https://rival.co.in']);
 assert.ok(!cleaned.includes('rival.co.in'));assert.ok(cleaned.includes('safe.example'));
});
test('corroboration fetches independent domains, exact numbers, excludes competitors and obeys robots',async()=>{
 const requests:string[]=[];
 const send:PinnedSender=async target=>{requests.push(target.url.href);return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nDisallow: /private':target.url.hostname==='false.example'?'135% of people':'35% of people')};};
 const run=(urls:string[],competitors:string[]=[])=>corroborateClaims({text:'35% [claim:c1] of people.',claims:[{id:'c1',number:'35%',urls}],competitors},{resolve,send});
 assert.equal((await run(['https://news.example/a','https://other.example/a'])).claims[0]?.status,'corroborated');
 assert.equal((await run(['https://a.company.co.in/a','https://b.company.co.in/b'])).claims[0]?.status,'single-source');
 assert.equal((await run(['https://news.example/a','https://false.example/a'])).claims[0]?.status,'single-source');
 assert.equal((await run(['https://news.example/a','https://rival.example/a'],['https://rival.example'])).claims[0]?.status,'single-source');
 const before=requests.length;assert.equal((await run(['https://news.example/a','https://other.example/private'])).claims[0]?.status,'single-source');assert.ok(!requests.slice(before).includes('https://other.example/private'));
});


test('per-article reservations share a cap across retries before the monthly reservation is written',async()=>{
 const {ventureAction}=await import('../runtime/venture/records.ts');const {VentureTestStore}=await import('./venture-test-store.ts');const {reserveSpend}=await import('../runtime/venture/money/spend.ts');
 const store=new VentureTestStore(),ctx={memberId:'owner',role:'owner',epoch:1,channel:'desktop'} as const,deps={store,clock:()=>new Date('2026-10-27T12:00:00.000Z')} as any;
 await ventureAction(deps,ctx,'admin','seed',tx=>{tx.put({...tx.base('venture-record'),idea:'SEO agency',status:'build',country:null} as any);},{create:true});
 await ventureAction(deps,ctx,'admin','seed',tx=>{tx.put({...tx.base('venture-order'),id:'order_article',intake:{fields:{articleLimitUsd:'0.001'}}} as any);tx.put({...tx.base('venture-delivery-run'),id:'run_article',orderId:'order_article',callId:'call_article'} as any);});
 const rate={item:'model:test',unit:'per-call',microsPerCall:'600',source:'test',checkedOn:'2026-10-27',confirmed:true,by:'owner'} as any;
 await ventureAction(deps,ctx,'approve','test.reserve',tx=>reserveSpend(tx,{key:'first',item:'model:test',label:'Article',payer:'owner',draftDigest:'one',ref:'call_article',rate,estimateMicros:'600'}));
 await assert.rejects(ventureAction(deps,ctx,'approve','test.reserve',tx=>reserveSpend(tx,{key:'second',item:'model:test',label:'Article',payer:'owner',draftDigest:'two',ref:'call_article',rate,estimateMicros:'600'})),{code:'ARTICLE_SPEND_CAP'});
});
