// Seller review regressions, original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSellerRows } from '../runtime/venture/playbooks/online-seller/source.ts';
import { sellerWorkReceipt } from '../runtime/venture/playbooks/online-seller/receipt.ts';
import { sellerExample } from './fixtures/venture/seller-fixture.ts';
const sample = sellerExample();
const tax = {tcsRule:sample.tcsRule,tdsRule:sample.tdsRule};
test('listing CSV cannot omit or invent packaged-goods status to bypass declarations', () => {
  const row = {marketplace:'amazon-in',title:'Cup',bullets:'Steel',description:'Cup',sellingMinor:'10000',mrpMinor:'12000',countryOfOrigin:'India',sellerDetails:'Owner shop'};
  for (const packaged of [undefined, '', 'maybe']) assert.throws(() => analyseSellerRows('listing', [{...row,...(packaged === undefined ? {} : {packaged})}], {rehearsal:true},tax), {code:'SELLER_INPUT_INVALID'});
});
test('negative contribution percentage has one sign and two decimal places', () => {
  const receipt = sellerWorkReceipt({result:{figures:{contributionBps:'-4664'}},runRef:{kind:'delivery',runId:'run'},sourceId:'file',sourceName:'costs.csv',sourceDigest:'digest'});
  assert.equal(receipt.figures[0].display,'-46.64%');
});
test('ads source boundary accepts evidenced economics rows and uses the named sales basis', () => {
  const economics = Object.entries(sample).filter(([key]) => !['tcsRule','tdsRule'].includes(key)).map(([field, value])=>({field,...value}));
  const row={spendMinor:'8000',salesMinor:'99900',reportedAcosBps:'801',basis:'gst-inclusive',source:'Owner export',observedAt:'2026-10-27T10:00:00Z'};
  const result=analyseSellerRows('ads',[row],{rehearsal:true},tax,[],economics as any) as any;
  assert.deepEqual(result.breakEven,{bps:'2854',basis:'gst-inclusive'});
});
import { kitBusiness } from './fixtures/venture/kit-business.ts';
import { SELLER_RULES } from '../runtime/venture/playbooks/online-seller/rules.ts';
test('owner ads inspection binds a positive break-even to both uploaded exports and its receipt', async () => {
  const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'A consulting service for shops'});
  const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0].id,request:'Check ads costs.'});
  const economics='field,type,value,source,observedAt\n'+Object.entries(sample).filter(([key])=>!['tcsRule','tdsRule'].includes(key)).map(([key,value])=>[key,(value as any).type,(value as any).value,(value as any).source,(value as any).observedAt].join(',')).join('\n');
  const rules=SELLER_RULES.filter(r=>['seller-tcs','seller-tds'].includes(r.id));
  const prior=rules.map(r=>r.confirmedBy);
  try {
    for(const rule of rules) rule.confirmedBy={name:'Test CA',on:'2026-10-27'};
    const result=await env.call('venture.desk.act',{playbook:'online-seller',kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'ads',name:'ads.csv',contentBase64:Buffer.from('spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n8000,99900,801,gst-inclusive,Owner export,2026-10-27T10:00:00Z').toString('base64'),economics:{name:'costs.csv',contentBase64:Buffer.from(economics).toString('base64')}}});
    assert.deepEqual(result.result.result.breakEven,{bps:'2854',basis:'gst-inclusive'});
    assert.equal(result.result.figures.find((f:any)=>f.key==='breakEvenBps').display,'28.54%');
    assert.deepEqual(result.result.receipt.inputs.tables.map((t:any)=>t.name),['ads.csv','costs.csv']);
  } finally { rules.forEach((rule,i)=>{rule.confirmedBy=prior[i];}); }
});
import { ONLINE_SELLER_TOOLS } from '../runtime/venture/delivery/harness/tools-online-seller.ts';
test('the ads tool can select an economics source but cannot supply invented money', () => {
  assert.deepEqual(Object.keys(ONLINE_SELLER_TOOLS['seller.ads'].input),['file','economicsFile']);
  assert.equal(ONLINE_SELLER_TOOLS['seller.ads'].input.economicsFile.required,false);
});
import { sellerSafetyChecks } from '../runtime/venture/playbooks/online-seller/checks.ts';
test('seller safety checks cover titles headings questions and reject positive instructions beside disclaimers',()=>{
 const check=(title:string,heading:string,text:string,questionsForClient:string[]=[])=>sellerSafetyChecks({deliverable:{title,sections:[{heading,parts:[{kind:'text',text}]}],questionsForClient}} as any);
 for(const result of [check('Buy reviews','Notes','Safe.'),check('Notes','Pay for reviews','Safe.'),check('Notes','Notes','Safe.',['Reward reviews?']),check('Notes','Notes','Do not buy reviews. But buy reviews for launch.')]) assert.equal(result.find(r=>r.check==='no-incentivised-reviews')?.outcome,'fail');
 assert.equal(check('Notes','Notes','Do not buy reviews. Never reward reviews.').find(r=>r.check==='no-incentivised-reviews')?.outcome,'pass');
 assert.equal(check('Book the claim as receivable','Notes','Estimate for review, not receivable.').find(r=>r.check==='estimate-not-receivable')?.outcome,'fail');
});
test('live listing uses trusted legal confirmation and still requires explicit packaged status',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'A consulting service for shops'});
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0].id,request:'Check the cup listing.'});
 const rule=SELLER_RULES.find(r=>r.id==='seller-india')!,prior=rule.confirmedBy;
 const payload={playbook:'online-seller' as const,kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'listing',name:'listing.csv',contentBase64:Buffer.from('marketplace,title,bullets,description,packaged,sellingMinor,mrpMinor,countryOfOrigin,sellerDetails\namazon-in,Steel cup,Steel,Stainless steel,yes,10000,12000,India,Owner shop').toString('base64')}};
 await assert.rejects(env.call('venture.desk.act',payload),{code:'RULE_UNCONFIRMED'});
 try {rule.confirmedBy={name:'Test lawyer',on:'2026-10-27'};const result=await env.call('venture.desk.act',payload);assert.equal(result.result.result.india.passed,true);}finally{rule.confirmedBy=prior;}
});
test('settlement receipt includes each named split under its own order index',()=>{
 const receipt=sellerWorkReceipt({result:{rows:[{orderId:'order-a',differenceMinor:'1000',differences:[{kind:'fee-slab',minor:'250'},{kind:'unknown',minor:'750'}]},{orderId:'order-b',differenceMinor:'0',differences:[{kind:'return-deduction',minor:'0'}]}]},runRef:{kind:'delivery',runId:'run'},sourceId:'file',sourceName:'settlements.csv',sourceDigest:'digest'});
 assert.deepEqual(receipt.figures.map(f=>[f.key,f.minor]),[['differenceMinor1','1000'],['differencePart1_1Minor','250'],['differencePart1_2Minor','750'],['differenceMinor2','0'],['differencePart2_1Minor','0']]);
});
