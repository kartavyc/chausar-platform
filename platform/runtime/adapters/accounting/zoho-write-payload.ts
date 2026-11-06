// Original Chausar payload checks against Zoho Books v3 docs, checked 28 October 2026.
// Only explicit India mappings enter a request. Unsupported cases keep the manual Zoho path.
import {check,digest} from '../../portable.ts';
import {object,array,parseExactJson} from './common.ts';
import {zohoMaterialDigest} from './zoho-material.ts';
import {decimalMinor} from '../../currency.ts';
import {booksFinancialDigest,type PostingDecision} from '../../venture/playbooks/bookkeeping-cfo/posting-core.ts';
import {booksDate} from '../../venture/playbooks/bookkeeping-cfo/books-input.ts';

import type {ZohoDraftMapping,ZohoPreparedDraft} from './zoho-write-types.ts';
export type {ZohoDraftMapping,ZohoPreparedDraft} from './zoho-write-types.ts';
export type ZohoGet=(path:string,query?:Record<string,string>)=>Promise<Record<string,unknown>>;
const manual='Use the reviewed manual draft in Zoho for this mapping. Chausar cannot verify this India accounting case.';
export function supported(value:unknown):asserts value {check(value,'BOOKS_MAPPING_UNSUPPORTED',manual);}
export function zohoId(value:unknown):string{supported(typeof value==='string'&&/^\d{1,100}$/.test(value));return value;}
function exact(value:unknown,keys:readonly string[]){supported(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));}
function paise(value:unknown):bigint{supported(typeof value==='string'&&/^(?:0|[1-9]\d{0,15})$/.test(value));const amount=BigInt(value);supported(amount<=1_000_000_000_000_000n);return amount;}
function decimal(value:unknown):string {const n=paise(value);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;}
function providerPaise(value:unknown):string{supported(typeof value==='string');return decimalMinor(value,'INR');}
const stateCodes=new Set('AN AP AR AS BR CH CG DD DL GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD PY PB RJ SK TN TS TR UP UK WB'.split(' '));

/** This is an exact wire formatter for the two documented numeric fields, not a general JSON serializer. */
function lineJson(fields:Record<string,string>,rateMinor:string|null):string{
 const pieces=Object.entries(fields).map(([key,value])=>JSON.stringify(key)+':'+JSON.stringify(value));
 pieces.push('"quantity":1');if(rateMinor!==null)pieces.push('"rate":'+decimal(rateMinor));return '{'+pieces.join(',')+'}';
}
function bodyJson(fields:Record<string,string|boolean>,lines:string[]):string{return '{'+Object.entries(fields).map(([key,value])=>JSON.stringify(key)+':'+JSON.stringify(value)).concat('"line_items":['+lines.join(',')+']').join(',')+'}';}
function validate(row:PostingDecision,map:ZohoDraftMapping){
 exact(row,['orderId','source','externalId','originalId','postingDate','action','reason','totalMinor','taxMinor','shippingMinor','lines','receiptId']);
 supported(['create-draft','create-refund-draft'].includes(row.action)&&/^chausar-[a-f0-9]{32}(?:-refund)?$/.test(row.externalId));booksDate(row.postingDate);
 supported((row.action==='create-refund-draft')===row.externalId.endsWith('-refund'));supported(row.action==='create-draft'?row.originalId===null:typeof row.originalId==='string'&&/^invoices:\d{1,100}$/.test(row.originalId));
 supported(paise(row.shippingMinor)===0n);supported(Array.isArray(row.lines)&&row.lines.length>0&&row.lines.length<=200);
 for(const line of row.lines){exact(line,['sku','itemId','amountMinor']);zohoId(line.itemId);supported(typeof line.sku==='string'&&line.sku.length>0&&line.sku.length<=200);paise(line.amountMinor);}
 supported(row.lines.reduce((sum,line)=>sum+paise(line.amountMinor),0n)+paise(row.taxMinor)===paise(row.totalMinor));
 exact(map,['customerId','placeOfSupply','gstTreatment','gstNo','taxSpecification','lineMode','lines']);zohoId(map.customerId);
 supported(stateCodes.has(map.placeOfSupply)&&['business_gst','business_none','consumer'].includes(map.gstTreatment)&&['intra','inter'].includes(map.taxSpecification)&&map.lineMode==='aggregate-non-inventory');
 supported(map.gstTreatment==='business_gst'?typeof map.gstNo==='string'&&/^[0-9]{2}[A-Z0-9]{13}$/.test(map.gstNo):map.gstNo===null);
 supported(Array.isArray(map.lines)&&map.lines.length===row.lines.length);
 map.lines.forEach((line,index)=>{exact(line,['itemId','taxId','taxKind']);zohoId(line.itemId);zohoId(line.taxId);supported(line.itemId===row.lines[index]!.itemId&&['tax','tax_group'].includes(line.taxKind));});
}
type Tax={id:string;kind:string;rate:string};
/** Get a tax documents a collection. Never guess the first row or silently accept duplicate IDs. */
export function zohoTaxRows(value:unknown):Record<string,unknown>[]{supported(Array.isArray(value)&&value.length>0&&value.length<=200);const rows=value.map(row=>object(row));const ids=rows.map(row=>zohoId(row.tax_id));supported(new Set(ids).size===ids.length);return rows;}
async function component(get:ZohoGet,id:string):Promise<Tax>{const rows=zohoTaxRows((await get('settings/taxes/'+zohoId(id))).tax),matches=rows.filter(row=>row.tax_id===id);supported(matches.length===1);const source=matches[0]!;supported(source.tax_type==='tax'&&typeof source.tax_percentage==='string'&&/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(source.tax_percentage));supported(['igst','cgst','sgst','nil'].includes(String(source.tax_specific_type)));const rate=decimalMinor(source.tax_percentage,'INR');supported(BigInt(rate)<=10000n);return {id,kind:String(source.tax_specific_type),rate};}
async function taxes(get:ZohoGet,line:ZohoDraftMapping['lines'][number],spec:ZohoDraftMapping['taxSpecification']):Promise<Tax[]>{
 let result:Tax[];
 if(line.taxKind==='tax')result=[await component(get,line.taxId)];
 else {const group=object((await get('settings/taxgroups/'+line.taxId)).tax_group);supported(group.tax_group_id===line.taxId);const ids=array(group.taxes).map(value=>zohoId(object(value).tax_id));supported(ids.length===2&&new Set(ids).size===2);result=[];for(const id of ids)result.push(await component(get,id));supported(providerPaise(group.tax_group_percentage)===String(result.reduce((sum,tax)=>sum+BigInt(tax.rate),0n)));}
 const kinds=result.map(tax=>tax.kind).sort().join(',');supported(kinds==='nil'&&result[0]!.rate==='0'||spec==='inter'&&kinds==='igst'||spec==='intra'&&kinds==='cgst,sgst'&&result[0]!.rate===result[1]!.rate);return result;
}
/** Fetch only mapping evidence, then prepare secret-free exact bytes for the owner's dry run. */
export async function prepareZohoDraft(identity:string,get:ZohoGet,input:PostingDecision,mapping:ZohoDraftMapping):Promise<ZohoPreparedDraft>{
 validate(input,mapping);const row=structuredClone(input),map=structuredClone(mapping);
 const contact=object((await get('contacts/'+map.customerId)).contact);
 supported(contact.contact_id===map.customerId&&contact.contact_type==='customer'&&contact.status==='active'&&contact.currency_code==='INR'&&contact.place_of_contact===map.placeOfSupply&&contact.gst_treatment===map.gstTreatment&&(contact.gst_no??'')===(map.gstNo??'')&&contact.is_taxable===true);
 const evidence:unknown[]=[{customerId:map.customerId,currency:'INR',place:contact.place_of_contact,gst:contact.gst_treatment,gstNo:contact.gst_no??'',taxable:true}];
 let original:Record<string,unknown>|null=null;let originalLines:Record<string,unknown>[]=[];
 if(row.action==='create-refund-draft'){
  original=object((await get('invoices/'+row.originalId!.slice(9))).invoice);originalLines=array(original.line_items).map(value=>object(value));supported(new Set(originalLines.map(line=>zohoId(line.line_item_id))).size===originalLines.length);
  supported(original.invoice_id===row.originalId!.slice(9)&&original.reference_number===row.externalId.slice(0,-7)&&original.customer_id===map.customerId&&original.currency_code==='INR'&&['sent','open','paid','overdue','partially_paid','viewed','unpaid'].includes(String(original.status))&&original.is_inclusive_tax===false&&original.gst_treatment===map.gstTreatment&&original.place_of_supply===map.placeOfSupply&&(original.gst_no??'')===(map.gstNo??''));
  supported(originalLines.length===row.lines.length&&providerPaise(original.total)===row.totalMinor&&providerPaise(original.tax_total)===row.taxMinor&&providerPaise(original.shipping_charge)==='0');
 }
 let taxTotal=0n;const lines:string[]=[];
 for(let i=0;i<row.lines.length;i++){
  const line=row.lines[i]!,mapped=map.lines[i]!,item=object((await get('items/'+mapped.itemId)).item);
  supported(item.item_id===mapped.itemId&&item.sku===line.sku&&item.status==='active'&&['sales','sales_and_purchases'].includes(String(item.item_type))&&item.is_taxable===true);
  const prefs=array(item.item_tax_preferences).map(value=>object(value)).filter(value=>value.tax_specification===map.taxSpecification);supported(prefs.length===1&&prefs[0]!.tax_id===mapped.taxId);
  supported(typeof item.hsn_or_sac==='string'&&/^\d{4,8}$/.test(item.hsn_or_sac)&&['goods','service','services'].includes(String(item.product_type)));
  const rates=await taxes(get,mapped,map.taxSpecification);
  for(const rate of rates){const numerator=paise(line.amountMinor)*BigInt(rate.rate);supported(numerator%10000n===0n);taxTotal+=numerator/10000n;}
  const fields:Record<string,string>={item_id:mapped.itemId,tax_id:mapped.taxId,hsn_or_sac:item.hsn_or_sac};
  if(original){const prior=originalLines[i]!;supported(prior.item_id===mapped.itemId&&prior.quantity==='1'&&providerPaise(prior.rate)===line.amountMinor&&providerPaise(prior.item_total)===line.amountMinor&&providerPaise(prior.discount_amount)==='0'&&prior.tax_id===mapped.taxId);fields.invoice_id=row.originalId!.slice(9);fields.invoice_item_id=zohoId(prior.line_item_id);evidence.push({originalId:fields.invoice_id,lineId:fields.invoice_item_id,rate:prior.rate,quantity:prior.quantity,taxId:prior.tax_id});}
  lines.push(lineJson(fields,original?null:line.amountMinor));evidence.push({itemId:item.item_id,sku:item.sku,type:item.item_type,hsn:item.hsn_or_sac,productType:item.product_type,preference:prefs[0],rates});
 }
 supported(taxTotal===paise(row.taxMinor));booksFinancialDigest(row);
 const fields:Record<string,string|boolean>={customer_id:map.customerId,reference_number:row.externalId,date:row.postingDate,place_of_supply:map.placeOfSupply,gst_treatment:map.gstTreatment,is_inclusive_tax:false};if(map.gstNo)fields.gst_no=map.gstNo;
 const refund=row.action==='create-refund-draft';if(refund)fields.is_draft=true;else fields.send=false;
 const query:Record<string,string>=refund?{invoice_id:row.originalId!.slice(9)}:{send:'false'};
 const body=bodyJson(fields,lines),shape=object(parseExactJson(body));const materialDigest=zohoMaterialDigest({...shape,currency_code:'INR',total:decimal(row.totalMinor),tax_total:decimal(row.taxMinor),shipping_charge:'0',line_items:array(shape.line_items).map((value,index)=>({...object(value),rate:decimal(row.lines[index]!.amountMinor),item_total:decimal(row.lines[index]!.amountMinor),...(refund?{discount:'0'}:{discount_amount:'0'})}))},refund?'credit-note':'invoice');supported(materialDigest!==null);
 const value:ZohoPreparedDraft={kind:'zoho-draft',connectionIdentity:identity,decisionDigest:digest(row),mappingDigest:digest(map),lineMode:'aggregate-non-inventory',decision:row,mapping:map,method:'POST',path:refund?'creditnotes':'invoices',query,body,materialDigest,evidenceDigest:digest(evidence),digest:''};
 value.digest=digest({...value,digest:''});return value;
}
/** Reject edited or extra fields before any mapping read or outside-effect callback. */
export function validatePrepared(value:ZohoPreparedDraft,identity:string){exact(value,['kind','connectionIdentity','decisionDigest','mappingDigest','lineMode','decision','mapping','method','path','query','body','materialDigest','evidenceDigest','digest']);supported(value.kind==='zoho-draft'&&value.connectionIdentity===identity&&value.method==='POST'&&value.lineMode==='aggregate-non-inventory'&&value.decisionDigest===digest(value.decision)&&value.mappingDigest===digest(value.mapping)&&value.digest===digest({...value,digest:''}));supported(typeof value.body==='string'&&Buffer.byteLength(value.body)<=1_000_000);parseExactJson(value.body);}
