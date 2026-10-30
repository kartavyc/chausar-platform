// The actual owner desk, secret shelf, provider adapter and journal working together against a test server port.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {BOOKS_SOURCE_COLUMNS} from '../runtime/venture/playbooks/bookkeeping-cfo/posting-source.ts';
import {listRecords} from '../runtime/venture/records.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {networkForget} from '../runtime/venture/network/forget.ts';
import {withNetworkKey,emptyShelf} from './venture-network-env.ts';
const desk={playbook:'bookkeeping-cfo',kind:'posting'};
test('a new client company can connect for setup before any customer or item exists',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});env.deps.secrets=emptyShelf();
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Set up client books',intake:{fields:{'data-consent':true,period:'October 2026'}}}),cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const result=await env.call('venture.desk.act',{...desk,id:cycle.id,action:'configure-zoho-account',payload:{dataCenter:'in',accessToken:'owner setup session'}});assert.equal(result.result.connected,true);assert.equal(JSON.stringify(result).includes('owner setup session'),false);
 await assert.rejects(env.call('venture.desk.act',{...desk,id:cycle.id,action:'stage',payload:{orderId:order.id,uploadId:'missing'}}),{code:'BOOKS_MAPPING_REQUIRED'});
});
test('owner configures a client account and approves exact provider bytes before draft and separate issue',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const secrets=new Map<string,string>();env.deps.secrets={get:key=>secrets.get(key)??null,set:(key,value)=>{secrets.set(key,value);},delete:key=>{secrets.delete(key);},has:key=>secrets.has(key),clear:()=>secrets.clear()};
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep client books',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const csv=BOOKS_SOURCE_COLUMNS.join(',')+'\nshop,one,Order export,2026-10-28T10:00:00Z,Asia/Kolkata,paid,true,INR,100,0,0,100,0,18,118,service,99,100';
 const upload=await env.call('venture.files.add',{orderId:order.id,name:'orders.csv',contentBase64:Buffer.from(csv).toString('base64')});let invoice:any=null;const writes:string[]=[];
 env.deps.net={resolve:async()=>[{address:'93.184.216.34',family:4}],send:async target=>{
  const path=target.url.pathname.replace('/books/v3/','');assert.equal(target.url.hostname,'www.zohoapis.in');assert.equal(target.url.searchParams.get('organization_id'),'12345');let data:object;
  if(target.method==='POST'){writes.push(path);if(path==='invoices'){const body=JSON.parse(String(target.body));assert.equal(body.send,false);assert.equal(body.line_items[0].rate,100);invoice={...body,invoice_id:'123',currency_code:'INR',status:'draft',total:118,tax_total:18,shipping_charge:0,line_items:[{...body.line_items[0],item_total:100,discount_amount:0}]};}else{assert.equal(path,'invoices/123/status/sent');invoice.status='sent';}data={};}
  else if(path==='contacts/77')data={contact:{contact_id:'77',contact_type:'customer',status:'active',currency_code:'INR',place_of_contact:'MH',gst_treatment:'consumer',gst_no:'',is_taxable:true}};
  else if(path==='items/99')data={item:{item_id:'99',sku:'service',status:'active',item_type:'sales',is_taxable:true,product_type:'service',hsn_or_sac:'9983',item_tax_preferences:[{tax_id:'88',tax_specification:'inter'}]}};
  else if(path==='settings/taxes/88')data={tax:[{tax_id:'88',tax_type:'tax',tax_specific_type:'igst',tax_percentage:18}]};
  else if(path==='invoices/123')data={invoice};
  else if(path==='invoices')data={invoices:invoice?[{invoice_id:'123',reference_number:invoice.reference_number}]:[],page_context:{has_more_page:false}};
  else{assert.equal(path,'creditnotes');data={creditnotes:[],page_context:{has_more_page:false}};}
  return {status:target.method==='POST'?201:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...data}))};
 }};
 const config={dataCenter:'in',accessToken:'owner private session value',customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer',gstNo:null,taxSpecification:'inter',lineMode:'aggregate-non-inventory',lines:[{itemId:'99',taxId:'88',taxKind:'tax'}]};
 const connected=await env.call('venture.desk.act',{...desk,id:cycle.id,action:'configure-zoho',payload:config});assert.equal(connected.result.connected,true);assert.ok(!JSON.stringify(connected).includes(config.accessToken));assert.ok(!JSON.stringify(env.deps.store.read()).includes(config.accessToken));
 const staged=await env.call('venture.desk.act',{...desk,id:cycle.id,action:'stage',payload:{orderId:order.id,uploadId:upload.id}});assert.equal(writes.length,0);assert.match(staged.result.entry.prepared[0].body,/"rate":100\.00/);
 const run=await env.call('venture.delivery.run',{orderId:order.id});const {BOOKKEEPING_CFO_TOOLS}=await import('../runtime/venture/delivery/harness/tools-bookkeeping-cfo.ts');const linked=await BOOKKEEPING_CFO_TOOLS['books.write'].run({deps:env.deps,ventureId:staged.result.ventureId,memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:run.id},files:[],tables:[],receipts:[],dictionary:[],sandbox:undefined,now:()=> '2026-10-28T12:00:00Z',allowed:[]},{postingId:staged.id});assert.equal((linked.result as any).posted,false);assert.equal((linked.result as any).reviewDigest,staged.result.entry.reviewDigest);assert.equal(writes.length,0);
 const shown=await env.call('venture.desk.get',{...desk,id:staged.id});const made=await env.call('venture.desk.act',{...desk,id:staged.id,action:'apply',digest:shown.digest,payload:{}});assert.equal(made.result.entry.state,'drafted');assert.deepEqual(writes,['invoices']);
 const beforeIssue=await env.call('venture.desk.get',{...desk,id:staged.id});const issued=await env.call('venture.desk.act',{...desk,id:staged.id,action:'issue',digest:beforeIssue.digest,payload:{externalId:staged.result.entry.batch.rows[0].externalId}});assert.equal(issued.result.entry.outcomes[0].state,'issued');assert.deepEqual(writes,['invoices','invoices/123/status/sent']);
 assert.equal(listRecords(env.deps.store.read(),'venture-journal-entry').filter(row=>row.operation?.startsWith('books-')).length,2);
 await env.call('venture.desk.act',{...desk,id:cycle.id,action:'disconnect',payload:{}});const disconnected=await env.call('venture.desk.get',{...desk,id:cycle.id});assert.equal(disconnected.item.connected,false);
});
test('Forget deletes the client accounting session credential as well as its cycles',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});env.deps.secrets=emptyShelf();
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Client books',intake:{fields:{'data-consent':true,period:'October'}}});
 const cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 await env.call('venture.desk.act',{...desk,id:cycle.id,action:'configure-zoho',payload:{dataCenter:'in',accessToken:'owner private session value',customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer',gstNo:null,taxSpecification:'inter',lineMode:'aggregate-non-inventory',lines:[{itemId:'99',taxId:'88',taxKind:'tax'}]}});
 const {booksSecretName}=await import('../runtime/venture/playbooks/bookkeeping-cfo/connection-core.ts');const cycleRow=listRecords(env.deps.store.read(),'venture-books-posting')[0]!;const secret=booksSecretName(cycleRow.ventureId,env.client.id,'12345');assert.equal(env.deps.secrets.has(secret),true);
 const person=await ventureAction(env.deps,owner,'approve','test.person',tx=>tx.put({...tx.base('venture-person'),name:'Account contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:env.client.id,history:[]}));
 withNetworkKey(env.deps.secrets);await networkForget(env.deps,owner,{id:person.id});assert.equal(env.deps.secrets.has(secret),false);assert.equal(listRecords(env.deps.store.read(),'venture-books-posting').length,0);
});
