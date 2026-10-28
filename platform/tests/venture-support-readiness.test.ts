// Mail readiness ideas from ResolveHQ (source-available); independent tests against the resolver seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mailReadiness } from '../runtime/venture/playbooks/support-desk/readiness.ts';
test('MX, SPF, owner DKIM selector and DMARC each show evidence and a fix line',async()=>{
 const asked:string[]=[];
 const view=await mailReadiness('shop.example.com','mail',{async mx(name){asked.push(name);return [{exchange:'mx.example.com',priority:10}];},async txt(name){asked.push(name);return name.startsWith('_dmarc')?[['v=DMARC1; p=none']]:name.includes('_domainkey')?[['v=DKIM1; p=abc']]:[['v=spf1 -all']];}});
 assert.deepEqual(view.checks.map(c=>c.state),['ready','ready','ready','ready']);
 assert.ok(asked.includes('mail._domainkey.shop.example.com'));
 assert.equal(view.recheck,true);
});
test('failed DNS lookup is unknown, not a claim that a record is missing',async()=>{
 const view=await mailReadiness('shop.example.com','mail',{async mx(){throw new Error('timeout');},async txt(){return [];}});
 assert.equal(view.checks[0]!.state,'unknown');
 assert.equal(view.checks[1]!.state,'missing');
 assert.match(view.line,/failed lookup does not mean the record is missing/);
 assert.ok(view.checks.every(c=>c.fix.length>0));
});
