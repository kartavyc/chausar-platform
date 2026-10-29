// Public setup route uses the documented synthetic provider, real owner approval and durable records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
import {setupProvider} from './fixtures/venture/zoho-setup.ts';
import {emptyShelf} from './venture-network-env.ts';
export async function setupPublicFixture(){
 const provider=setupProvider(),env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});env.deps.net={resolve:provider.resolve,send:provider.send};env.deps.secrets=emptyShelf();
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Set up these books.',intake:{fields:{'data-consent':true,period:'October 2026'}}}),finance={playbook:'bookkeeping-cfo',kind:'finance'},cycle=await env.call('venture.desk.act',{...finance,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const upload=await env.call('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:Buffer.from('kind,id,name,source,debitRupees,creditRupees\ncategory,cash,Cash,Chart,,\ncategory,capital,Capital,Chart,,\nopening,cash,,Trial balance,100,0\nopening,capital,,Trial balance,0,100').toString('base64')}),row=await env.call('venture.desk.act',{...finance,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:upload.id}});
 const mappings=[{kind:'account',sourceId:'cash',name:'Cash',code:'CASH',accountType:'cash',currencyId:'66'},{kind:'account',sourceId:'capital',name:'Capital',code:'CAPITAL',accountType:'equity',currencyId:'66'}];
 const act=(action:string,payload:unknown={},seal?:string)=>env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'setup',id:row.id,action,payload,...(seal?{digest:seal}:{})});return {provider,env,order,cycle,row,mappings,act};
}
test('public setup creates masters then separately approves organization opening with actual IDs',async()=>{
 const f=await setupPublicFixture();await f.env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'posting',id:f.cycle.id,action:'configure-zoho-account',payload:{dataCenter:'in',accessToken:'owner session token'}});
 const staged=await f.act('stage-masters',{mappings:f.mappings});assert.deepEqual(f.provider.writes,[]);const masters=await f.act('apply-masters',{},staged.result.entry.posting.reviewDigest);assert.equal(masters.result.entry.posting.state,'masters-done');assert.deepEqual(f.provider.writes,['chartofaccounts','chartofaccounts']);
 const opening=await f.act('stage-opening',{migrationDate:'2026-04-01'},masters.result.entry.posting.reviewDigest);assert.deepEqual(opening.result.entry.posting.opening.input.lines.map((row:any)=>row.accountId),['200','201']);const done=await f.act('apply-opening',{},opening.result.entry.posting.reviewDigest);assert.equal(done.result.entry.posting.state,'complete');assert.equal(f.provider.writes.length,3);assert.equal(JSON.stringify(done).includes('owner session token'),false);
});
