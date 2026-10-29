// Owner accounting writes begin with exact, fail-closed existing-record evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createZohoWriteAdapter} from '../runtime/adapters/accounting/zoho-write.ts';
import type {PinnedSender} from '../runtime/venture/core/net-guard.ts';
const externalId='chausar-'+'a'.repeat(32),resolve=async()=>[{address:'93.184.216.34',family:4 as const}];
const config={dataCenter:'in' as const,organizationId:'12345',accessToken:'owner session token',revision:'connection-one'};
test('Zoho existing lookup reads exact references and complete detail without losing paise',async()=>{
 const calls:string[]=[];const send:PinnedSender=async target=>{calls.push(target.url.pathname);assert.equal(target.method,'GET');assert.equal(target.url.searchParams.get('organization_id'),'12345');return {status:200,headers:{},body:Buffer.from(target.url.pathname.endsWith('/invoices/123')?'{"code":0,"invoice":{"invoice_id":"123","reference_number":"'+externalId+'","currency_code":"INR","status":"sent","total":118.01,"tax_total":18.01,"shipping_charge":0,"line_items":[{"item_id":"99","item_total":100}]}}':JSON.stringify({code:0,invoices:[{invoice_id:'123',reference_number:externalId}],page_context:{has_more_page:false}}))};};
 const adapter=createZohoWriteAdapter(config,{resolve,send});const rows=await adapter.readExisting([externalId]);
 assert.equal(rows[0]!.totalMinor,'11801');assert.equal(rows[0]!.id,'invoices:123');assert.equal(rows[0]!.status,'issued');assert.match(rows[0]!.financialDigest!,/^[a-f0-9]{64}$/);assert.equal(calls.length,2);
});
test('Zoho failed, paginated-ambiguous or wrong-reference reads never become an empty lookup',async()=>{
 for(const body of [{code:0,invoices:[]},{code:0,invoices:[{invoice_id:'123',reference_number:'wrong'}],page_context:{has_more_page:false}},{code:9,message:'not authorized'}]){
  const send:PinnedSender=async()=>({status:200,headers:{},body:Buffer.from(JSON.stringify(body))});await assert.rejects(createZohoWriteAdapter(config,{resolve,send}).readExisting([externalId]),{code:'BOOKS_READ_FAILED'});
 }
 let calls=0;const send:PinnedSender=async()=>{calls++;return {status:302,headers:{location:'https://other.example/'},body:Buffer.from('')}};
 await assert.rejects(createZohoWriteAdapter(config,{resolve,send}).readExisting([externalId]),{code:'BOOKS_READ_FAILED'});assert.equal(calls,1);
});

// Write fixtures describe provider responses, never real account credentials.
const draftRow={orderId:'one',source:'owner.csv',externalId,originalId:null,postingDate:'2026-10-28',action:'create-draft' as const,reason:'paid-unposted-order',totalMinor:'11800',taxMinor:'1800',shippingMinor:'0',lines:[{sku:'shirt',itemId:'99',amountMinor:'10000'}],receiptId:'books_test'};
const draftMapping={customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer' as const,gstNo:null,taxSpecification:'inter' as const,lineMode:'aggregate-non-inventory' as const,lines:[{itemId:'99',taxId:'88',taxKind:'tax' as const}]};
function provider(){
 const docs:Record<string,unknown>={
  'contacts/77':{contact:{contact_id:'77',contact_type:'customer',status:'active',currency_code:'INR',place_of_contact:'MH',gst_treatment:'consumer',gst_no:'',is_taxable:true}},
  'items/99':{item:{item_id:'99',sku:'shirt',status:'active',item_type:'sales',is_taxable:true,product_type:'goods',hsn_or_sac:'6109',item_tax_preferences:[{tax_id:'88',tax_specification:'inter'}]}},
  'settings/taxes/88':{tax:[{tax_id:'88',tax_type:'tax',tax_specific_type:'igst',tax_percentage:18}]},
  'invoices/123':{invoice:{invoice_id:'123',reference_number:externalId,customer_id:'77',currency_code:'INR',status:'sent',date:'2026-10-28',total:118,tax_total:18,shipping_charge:0,is_inclusive_tax:false,gst_treatment:'consumer',place_of_supply:'MH',gst_no:'',line_items:[{line_item_id:'456',item_id:'99',quantity:1,rate:100,item_total:100,discount_amount:0,tax_id:'88',hsn_or_sac:'6109'}]}},
 };
 const calls:{method:string;path:string;query:string;body:string}[]=[];let postStatus=201;
 const send:PinnedSender=async target=>{assert.equal(target.address,'93.184.216.34');assert.equal(target.url.hostname,'www.zohoapis.in');assert.equal(target.url.searchParams.get('organization_id'),'12345');const path=target.url.pathname.replace('/books/v3/','');calls.push({method:target.method,path,query:target.url.search,body:String(target.body??'')});if(target.method==='POST')return {status:postStatus,headers:{},body:Buffer.from('{"code":0}')};return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...docs[path] as object}))};};
 return {docs,calls,send,setStatus:(n:number)=>postStatus=n};
}
test('Zoho preparation binds exact aggregate payload and fresh mapping evidence before any write',async()=>{
 const p=provider(),adapter=createZohoWriteAdapter({...config,revision:'connection-one'}, {resolve,send:p.send});const prepared=await adapter.prepareDraft(draftRow,draftMapping);
 assert.equal(p.calls.every(c=>c.method==='GET'),true);assert.equal(prepared.decisionDigest.length,64);assert.equal(prepared.mappingDigest.length,64);assert.equal(prepared.lineMode,'aggregate-non-inventory');assert.equal(JSON.stringify(prepared).includes(config.accessToken),false);assert.match(prepared.body,/"rate":100\.00/);assert.match(prepared.body,/"quantity":1/);assert.match(prepared.body,/"send":false/);assert.equal(prepared.query.send,'false');let approved=0;await adapter.sendDraft(JSON.parse(JSON.stringify(prepared)),()=>approved++);assert.equal(approved,1);const posted=p.calls.filter(c=>c.method==='POST');assert.equal(posted.length,1);assert.equal(posted[0]!.body,prepared.body);
});
test('Zoho exact numeric JSON retains large paise without binary rounding',async()=>{
 const p=provider(),row={...draftRow,totalMinor:'999999999999999',taxMinor:'0',lines:[{...draftRow.lines[0]!,amountMinor:'999999999999999'}]};p.docs['settings/taxes/88']={tax:[{tax_id:'88',tax_type:'tax',tax_specific_type:'nil',tax_percentage:0}]};const prepared=await createZohoWriteAdapter({...config,revision:'one'},{resolve,send:p.send}).prepareDraft(row,draftMapping);assert.match(prepared.body,/"rate":9999999999999\.99/);
});
test('Zoho refuses shipping, inventory, wrong GST, tax mismatch and ambiguous mapping before approval',async()=>{
 for(const mutate of [(p:ReturnType<typeof provider>)=>{(p.docs['items/99'] as any).item.item_type='inventory';},(p:ReturnType<typeof provider>)=>{(p.docs['contacts/77'] as any).contact.place_of_contact='TN';},(p:ReturnType<typeof provider>)=>{(p.docs['settings/taxes/88'] as any).tax[0].tax_percentage=12;},(p:ReturnType<typeof provider>)=>{(p.docs['settings/taxes/88'] as any).tax[0].tax_specific_type='cgst';}]){const p=provider();mutate(p);await assert.rejects(createZohoWriteAdapter({...config,revision:'one'},{resolve,send:p.send}).prepareDraft(draftRow,draftMapping),{code:'BOOKS_MAPPING_UNSUPPORTED'});assert.equal(p.calls.some(c=>c.method==='POST'),false);}
 const p=provider(),adapter=createZohoWriteAdapter({...config,revision:'one'},{resolve,send:p.send});await assert.rejects(adapter.prepareDraft({...draftRow,shippingMinor:'1'},draftMapping),{code:'BOOKS_MAPPING_UNSUPPORTED'});await assert.rejects(adapter.prepareDraft(draftRow,{...draftMapping,lines:[]}),{code:'BOOKS_MAPPING_UNSUPPORTED'});
});
test('Zoho stale prepared bytes, connection, and provider evidence refuse without owner callback',async()=>{
 const p=provider(),adapter=createZohoWriteAdapter({...config,revision:'one'},{resolve,send:p.send}),prepared=await adapter.prepareDraft(draftRow,draftMapping);let approved=0;
 await assert.rejects(adapter.sendDraft({...prepared,body:prepared.body.replace('100.00','99.00')},()=>approved++));await assert.rejects(createZohoWriteAdapter({...config,revision:'two'},{resolve,send:p.send}).sendDraft(prepared,()=>approved++));(p.docs['items/99'] as any).item.hsn_or_sac='6110';await assert.rejects(adapter.sendDraft(prepared,()=>approved++));assert.equal(approved,0);assert.equal(p.calls.some(c=>c.method==='POST'),false);
});
test('Zoho callback runs after DNS and a failed callback or redirect never sends twice',async()=>{
 const p=provider();let callbacks=0;const adapter=createZohoWriteAdapter({...config,revision:'one'},{resolve:async()=>{assert.equal(callbacks,0);return resolve();},send:p.send}),prepared=await adapter.prepareDraft(draftRow,draftMapping);await assert.rejects(adapter.sendDraft(prepared,()=>{callbacks++;throw Error('owner revoked');}));assert.equal(p.calls.some(c=>c.method==='POST'),false);
 const q=provider();q.setStatus(302);const second=createZohoWriteAdapter({...config,revision:'one'},{resolve,send:q.send}),next=await second.prepareDraft(draftRow,draftMapping);await assert.rejects(second.sendDraft(next,()=>{}));assert.equal(q.calls.filter(c=>c.method==='POST').length,1);
});
test('Zoho credit drafts bind original invoice line identity and issue only the status endpoint',async()=>{
 const p=provider(),adapter=createZohoWriteAdapter({...config,revision:'one'},{resolve,send:p.send});const row={...draftRow,externalId:externalId+'-refund',originalId:'invoices:123',action:'create-refund-draft' as const};const prepared=await adapter.prepareDraft(row,draftMapping);const body=JSON.parse(prepared.body);assert.equal(body.is_draft,true);assert.equal(body.line_items[0].invoice_item_id,'456');assert.equal(body.line_items[0].invoice_id,'123');assert.equal(prepared.query.invoice_id,'123');assert.equal(Object.hasOwn(body,'invoices'),false);await adapter.sendDraft(prepared,()=>{});assert.equal(p.calls.filter(c=>c.method==='POST')[0]!.path,'creditnotes');
 const invoice=(p.docs['invoices/123'] as any).invoice;invoice.status='draft';p.docs.invoices={invoices:[{invoice_id:'123',reference_number:externalId}],page_context:{has_more_page:false}};await adapter.issue((await adapter.readExisting([externalId]))[0]!,()=>{});assert.equal(p.calls.filter(c=>c.method==='POST').at(-1)!.path,'invoices/123/status/sent');assert.equal(p.calls.some(c=>/email|refunds|\/invoices$/.test(c.path)&&c.method==='POST'),false);
});
test('Zoho credit search uses supported search_text and ignores unrelated references across pages',async()=>{
 const refund=externalId+'-refund';let pages=0;const send:PinnedSender=async target=>{if(target.url.pathname.endsWith('/creditnotes')){assert.equal(target.url.searchParams.get('search_text'),refund);assert.equal(target.url.searchParams.has('reference_number'),false);pages++;return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,creditnotes:pages===1?[{creditnote_id:'1',reference_number:'unrelated'}]:[],page_context:{has_more_page:pages===1}}))};}throw Error('Unrelated search match must not be fetched');};assert.deepEqual(await createZohoWriteAdapter({...config,revision:'one'},{resolve,send}).readExisting([refund]),[]);assert.equal(pages,2);
});

test('Zoho rejects provider evidence explicitly returned from another organization',async()=>{
 const p=provider();(p.docs['contacts/77'] as any).contact.organization_id='different-company';await assert.rejects(createZohoWriteAdapter(config,{resolve,send:p.send}).prepareDraft(draftRow,draftMapping));assert.equal(p.calls.some(c=>c.method==='POST'),false);
});
test('Zoho refuses duplicate original invoice line identities before a reversal is prepared',async()=>{
 const p=provider(),original=(p.docs['invoices/123'] as any).invoice;original.total=236;original.tax_total=36;original.line_items.push({...original.line_items[0]});const row={...draftRow,externalId:externalId+'-refund',originalId:'invoices:123',action:'create-refund-draft' as const,totalMinor:'23600',taxMinor:'3600',lines:[draftRow.lines[0]!,{...draftRow.lines[0]!}]};await assert.rejects(createZohoWriteAdapter(config,{resolve,send:p.send}).prepareDraft(row,{...draftMapping,lines:[draftMapping.lines[0]!,{...draftMapping.lines[0]!}]}),{code:'BOOKS_MAPPING_UNSUPPORTED'});
});
test('Zoho prepares a verified intrastate tax group and refuses fractional-paise tax',async()=>{
 const p=provider();(p.docs['items/99'] as any).item.item_tax_preferences=[{tax_id:'90',tax_specification:'intra'}];p.docs['settings/taxgroups/90']={tax_group:{tax_group_id:'90',tax_group_percentage:18,taxes:[{tax_id:'91'},{tax_id:'92'}]}};p.docs['settings/taxes/91']={tax:[{tax_id:'91',tax_type:'tax',tax_specific_type:'cgst',tax_percentage:9}]};p.docs['settings/taxes/92']={tax:[{tax_id:'92',tax_type:'tax',tax_specific_type:'sgst',tax_percentage:9}]};const adapter=createZohoWriteAdapter(config,{resolve,send:p.send}),mapping={...draftMapping,taxSpecification:'intra' as const,lines:[{itemId:'99',taxId:'90',taxKind:'tax_group' as const}]};const result=await adapter.prepareDraft(draftRow,mapping);assert.equal(JSON.parse(result.body).line_items[0].tax_id,'90');await assert.rejects(adapter.prepareDraft({...draftRow,totalMinor:'11801',lines:[{...draftRow.lines[0]!,amountMinor:'10001'}]},mapping),{code:'BOOKS_MAPPING_UNSUPPORTED'});
});
test('Zoho credit evidence supplies date, original identity and exact totals without an undocumented shipping field',async()=>{
 const refund=externalId+'-refund',p=provider();p.docs.creditnotes={creditnotes:[{creditnote_id:'444',reference_number:refund}],page_context:{has_more_page:false}};p.docs['creditnotes/444']={creditnote:{creditnote_id:'444',reference_number:refund,customer_id:'77',currency_code:'INR',status:'draft',date:'2026-10-28',total:118,tax_total:18,is_inclusive_tax:false,gst_treatment:'consumer',place_of_supply:'MH',gst_no:'',line_items:[{item_id:'99',item_total:100,invoice_id:'123',invoice_item_id:'456',quantity:1,rate:100,discount:0,tax_id:'88',hsn_or_sac:'6109'}]}};const adapter=createZohoWriteAdapter(config,{resolve,send:p.send}),read=await adapter.readExisting([refund]);assert.equal(read[0]!.postingDate,'2026-10-28');assert.equal(read[0]!.originalId,'invoices:123');assert.match(read[0]!.financialDigest!,/^[a-f0-9]{64}$/);await adapter.issue(read[0]!,()=>{});assert.equal(p.calls.at(-1)!.path,'creditnotes/444/status/open');
});


test('Zoho tax collections require a bounded unique exact ID match and retain the organization fence',async()=>{
 const tax={tax_id:'88',tax_type:'tax',tax_specific_type:'igst',tax_percentage:18};
 for(const value of [[],[{...tax,tax_id:'89'}],[tax,{...tax}],Array.from({length:201},(_,i)=>({...tax,tax_id:String(i+1)})),[tax,{...tax,tax_id:'89',organization_id:'another-company'}]]){
  const p=provider();p.docs['settings/taxes/88']={tax:value};await assert.rejects(createZohoWriteAdapter(config,{resolve,send:p.send}).prepareDraft(draftRow,draftMapping));assert.equal(p.calls.some(c=>c.method==='POST'),false);
 }
 const p=provider();p.docs['settings/taxes/88']={tax:[{...tax,tax_id:'89',tax_percentage:12},tax]};const result=await createZohoWriteAdapter(config,{resolve,send:p.send}).prepareDraft(draftRow,draftMapping);assert.equal(result.decision.taxMinor,'1800');
});

test('Zoho readback retains exact recipient and refuses changed or absent recipient before issue',async()=>{
 const p=provider();p.docs.invoices={invoices:[{invoice_id:'123',reference_number:externalId}],page_context:{has_more_page:false}};const invoice=(p.docs['invoices/123'] as any).invoice;invoice.status='draft';const adapter=createZohoWriteAdapter(config,{resolve,send:p.send}),read=await adapter.readExisting([externalId]);assert.equal(read[0]!.recipientId,'77');let sends=0;invoice.customer_id='7788';await assert.rejects(adapter.issue(read[0]!,()=>sends++),{code:'APPROVAL_STALE'});assert.equal(sends,0);delete invoice.customer_id;const missing=await adapter.readExisting([externalId]);assert.equal(missing[0]!.recipientId,null);await assert.rejects(adapter.issue(missing[0]!,()=>sends++),{code:'APPROVAL_STALE'});assert.equal(sends,0);
});
