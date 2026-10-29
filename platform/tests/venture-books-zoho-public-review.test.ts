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
// Independent reviewer fixture, copied from the author's public integration test with controlled provider races.
async function fixture(){
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const secrets=new Map<string,string>();env.deps.secrets={get:key=>secrets.get(key)??null,set:(key,value)=>{secrets.set(key,value);},delete:key=>{secrets.delete(key);},has:key=>secrets.has(key),clear:()=>secrets.clear()};
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep client books',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const csv=BOOKS_SOURCE_COLUMNS.join(',')+'\nshop,one,Order export,2026-10-28T10:00:00Z,Asia/Kolkata,paid,true,INR,100,0,0,100,0,18,118,service,99,100';
 const upload=await env.call('venture.files.add',{orderId:order.id,name:'orders.csv',contentBase64:Buffer.from(csv).toString('base64')});let invoice:any=null;const writes:string[]=[];
 let onResolve:undefined|(()=>Promise<void>),onRequest:undefined|((path:string,method:string)=>void);env.deps.net={resolve:async()=>{await onResolve?.();return [{address:'93.184.216.34',family:4}];},send:async target=>{
  const path=target.url.pathname.replace('/books/v3/','');assert.equal(target.url.hostname,'www.zohoapis.in');assert.equal(target.url.searchParams.get('organization_id'),'12345');let data:object;onRequest?.(path,target.method);
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
 return {env,order,cycle,upload,config,writes,setInvoice:(change:Record<string,unknown>)=>{Object.assign(invoice,change);},setResolve:(fn?:()=>Promise<void>)=>{onResolve=fn;},setRequest:(fn?:(path:string,method:string)=>void)=>{onRequest=fn;}};
}

async function staged(f:Awaited<ReturnType<typeof fixture>>){await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'configure-zoho',payload:f.config});return f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'stage',payload:{orderId:f.order.id,uploadId:f.upload.id}});}
async function made(f:Awaited<ReturnType<typeof fixture>>){const row=await staged(f);return f.env.call('venture.desk.act',{...desk,id:row.id,action:'apply',digest:row.result.entry.reviewDigest,payload:{}});}
test('review: reconnect refreshes exact completed drafts for separate issue without authorizing draft resend',async()=>{
 const f=await fixture(),draft=await made(f),oldPrepared=structuredClone(draft.result.entry.prepared);await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'disconnect',payload:{}});await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'configure-zoho',payload:{...f.config,accessToken:'replacement session value'}});
 await assert.rejects(f.env.call('venture.desk.act',{...desk,id:draft.id,action:'issue',digest:draft.result.entry.reviewDigest,payload:{externalId:draft.result.entry.outcomes[0].externalId}}),{code:'APPROVAL_STALE'});
 const fresh=await f.env.call('venture.desk.act',{...desk,id:draft.id,action:'refresh-connection',digest:draft.result.entry.reviewDigest,payload:{}});assert.equal(fresh.result.entry.state,'drafted');assert.notEqual(fresh.result.entry.target,draft.result.entry.target);assert.deepEqual(fresh.result.entry.prepared,oldPrepared);assert.deepEqual(f.writes,['invoices']);
 await assert.rejects(f.env.call('venture.desk.act',{...desk,id:draft.id,action:'apply',digest:fresh.result.entry.reviewDigest,payload:{}}),{code:'APPROVAL_STALE'});
 const issued=await f.env.call('venture.desk.act',{...desk,id:draft.id,action:'issue',digest:fresh.result.entry.reviewDigest,payload:{externalId:fresh.result.entry.outcomes[0].externalId}});assert.equal(issued.result.entry.outcomes[0].state,'issued');assert.deepEqual(f.writes,['invoices','invoices/123/status/sent']);
});
test('review: connection refresh refuses changed remote evidence and uncompleted dry runs',async()=>{
 const f=await fixture(),draft=await made(f);await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'configure-zoho',payload:f.config});f.setInvoice({date:'2026-10-27'});await assert.rejects(f.env.call('venture.desk.act',{...desk,id:draft.id,action:'refresh-connection',digest:draft.result.entry.reviewDigest,payload:{}}),{code:'APPROVAL_STALE'});assert.deepEqual(f.writes,['invoices']);
 const g=await fixture(),stage=await staged(g);await assert.rejects(g.env.call('venture.desk.act',{...desk,id:stage.id,action:'refresh-connection',digest:stage.result.entry.reviewDigest,payload:{}}));assert.deepEqual(g.writes,[]);
});
test('review: disconnect at final physical-send DNS boundary stops the approved public draft without POST',async()=>{
 const f=await fixture(),stage=await staged(f);let taxReads=0,revoked=false;f.setRequest((path,method)=>{if(method==='GET'&&path==='settings/taxes/88'&&++taxReads===2)f.setResolve(async()=>{f.setResolve();revoked=true;await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'disconnect',payload:{}});});});
 const result=await f.env.call('venture.desk.act',{...desk,id:stage.id,action:'apply',digest:stage.result.entry.reviewDigest,payload:{}});assert.equal(revoked,true);assert.deepEqual(f.writes,[]);assert.equal(result.result.entry.state,'stopped');assert.equal(result.result.entry.outcomes[0].state,'not-sent');
});

test('review: malformed mapping enums are refused before replacing the session connection',async()=>{
 const f=await fixture();await f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'configure-zoho',payload:f.config});const {booksSecretName}=await import('../runtime/venture/playbooks/bookkeeping-cfo/connection-core.ts');const cycleRow=listRecords(f.env.deps.store.read(),'venture-books-posting')[0]!;const key=booksSecretName(cycleRow.ventureId,f.env.client.id,'12345'),saved=f.env.deps.secrets.get(key);
 for(const bad of [{...f.config,gstTreatment:['consumer']},{...f.config,taxSpecification:['inter']},{...f.config,lines:[{itemId:'99',taxId:'88',taxKind:['tax']}]}]){await assert.rejects(f.env.call('venture.desk.act',{...desk,id:f.cycle.id,action:'configure-zoho',payload:bad}),{code:'BOOKS_CONNECTION_INVALID'});assert.equal(f.env.deps.secrets.get(key),saved);}
});

test('review: session token is absent from every durable and public posting view',async()=>{
 const f=await fixture(),stage=await staged(f);const read=await f.env.call('venture.desk.get',{...desk,id:stage.id}),rows=await f.env.call('venture.desk.list',desk);for(const value of [f.env.store.read(),stage,read,rows])assert.equal(JSON.stringify(value).includes(f.config.accessToken),false);
});

test('review: staff and model channels cannot configure or approve posting',async()=>{
 const f=await fixture();const {handlers}=await import('../runtime/venture/playbooks/index.ts');await f.env.store.update(state=>{state.members.push({...state.members.find(row=>row.id==='owner')!,id:'staff',role:'accountant'});});const call=handlers['venture.desk.act']!;
 await assert.rejects(call(f.env.deps,{...owner,memberId:'staff',role:'accountant'},{...desk,id:f.cycle.id,action:'configure-zoho',payload:f.config}),{code:'FORBIDDEN'});
 await assert.rejects(call(f.env.deps,{...owner,channel:'mcp'},{...desk,id:f.cycle.id,action:'configure-zoho',payload:f.config}));assert.equal((await f.env.call('venture.desk.get',{...desk,id:f.cycle.id})).item.connected,false);
});

test('review: a provider draft moved to another customer cannot be issued under the old approval',async()=>{
 const f=await fixture(),draft=await made(f);f.setInvoice({customer_id:'7788'});
 await assert.rejects(f.env.call('venture.desk.act',{...desk,id:draft.id,action:'issue',digest:draft.result.entry.reviewDigest,payload:{externalId:draft.result.entry.outcomes[0].externalId}}),{code:'APPROVAL_STALE'});assert.deepEqual(f.writes,['invoices']);
});

test('review: same-total edits to provider tax or quantity cannot reuse the original issue approval',async()=>{
 for(const change of [{tax_id:'8899',quantity:1,rate:100},{tax_id:'88',quantity:2,rate:50}]){const f=await fixture(),draft=await made(f);f.setInvoice({line_items:[{item_id:'99',hsn_or_sac:'9983',item_total:100,discount_amount:0,...change}]});await assert.rejects(f.env.call('venture.desk.act',{...desk,id:draft.id,action:'issue',digest:draft.result.entry.reviewDigest,payload:{externalId:draft.result.entry.outcomes[0].externalId}}),{code:'APPROVAL_STALE'});assert.deepEqual(f.writes,['invoices']);}
});
