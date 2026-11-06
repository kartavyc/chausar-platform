// Independent provider review against the documented Get a tax response shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createZohoWriteAdapter} from '../runtime/adapters/accounting/zoho-write.ts';
import type {PinnedSender} from '../runtime/venture/core/net-guard.ts';
const externalId='chausar-'+'b'.repeat(32);
const row={orderId:'order',source:'source.csv',externalId,originalId:null,postingDate:'2026-10-28',action:'create-draft' as const,reason:'paid-unposted-order',totalMinor:'11800',taxMinor:'1800',shippingMinor:'0',lines:[{sku:'service',itemId:'99',amountMinor:'10000'}],receiptId:'receipt'};
const mapping={customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer' as const,gstNo:null,taxSpecification:'inter' as const,lineMode:'aggregate-non-inventory' as const,lines:[{itemId:'99',taxId:'88',taxKind:'tax' as const}]};
test('review: documented tax-array response is read as exact tax evidence before preparation',async()=>{
 const send:PinnedSender=async target=>{assert.equal(target.method,'GET');const path=target.url.pathname;const data=path.endsWith('/contacts/77')?{contact:{contact_id:'77',contact_type:'customer',status:'active',currency_code:'INR',place_of_contact:'MH',gst_treatment:'consumer',gst_no:'',is_taxable:true}}:path.endsWith('/items/99')?{item:{item_id:'99',sku:'service',status:'active',item_type:'sales',is_taxable:true,product_type:'service',hsn_or_sac:'9983',item_tax_preferences:[{tax_id:'88',tax_specification:'inter'}]}}:{tax:[{tax_id:'88',tax_type:'tax',tax_specific_type:'igst',tax_percentage:18}]};return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...data}))};};
 const adapter=createZohoWriteAdapter({dataCenter:'in',organizationId:'123',accessToken:'test-only owner session',revision:'one'},{resolve:async()=>[{address:'93.184.216.34',family:4}],send});
 const prepared=await adapter.prepareDraft(row,mapping);assert.match(prepared.body,/"tax_id":"88"/);assert.equal(prepared.decision.taxMinor,'1800');
});
