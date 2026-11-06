// Original Chausar adapter. Zoho Books v3 invoice/credit-note OpenAPI checked 28 October 2026.
// Draft preparation returns exact secret-free bytes. The engine owns journal claims and owner approval.
import {check,ChausarError,digest} from '../../portable.ts';
import {zohoMaterialDigest} from './zoho-material.ts';
import {decimalMinor} from '../../currency.ts';
import {createZohoTransport,type ZohoWriteConnection} from './zoho-transport.ts';
import type {PoliteNet} from '../../venture/build/fetch-policy.ts';
import {parseExactJson,object,array,requiredText} from './common.ts';

import {booksFinancialDigest,validateBooksExisting,type PostingDecision,type ExistingBooksRecord} from '../../venture/playbooks/bookkeeping-cfo/posting-core.ts';
import {prepareZohoDraft,validatePrepared,zohoTaxRows} from './zoho-write-payload.ts';
import type {ZohoDraftMapping,ZohoPreparedDraft} from './zoho-write-types.ts';
export type {ZohoDraftMapping,ZohoPreparedDraft} from './zoho-write-types.ts';
export type {ZohoWriteConnection} from './zoho-transport.ts';
function numericId(value:unknown):string{check(typeof value==='string'&&/^\d{1,100}$/.test(value),'BOOKS_READ_FAILED','The accounting source needs a numeric provider ID.');return value;}
function amount(value:unknown):string{check(typeof value==='string','BOOKS_READ_FAILED','The accounting source omitted an exact amount.');const minor=decimalMinor(value,'INR');check(BigInt(minor)>=0n,'BOOKS_READ_FAILED','The accounting source returned a negative document total.');return minor;}
function financialDetails(source:Record<string,unknown>,credit=false):string|null{
 try{const lines=array(source.line_items).map(value=>{const line=object(value);return {sku:numericId(line.item_id),itemId:numericId(line.item_id),amountMinor:amount(line.item_total)};});
  const totalMinor=amount(source.total),taxMinor=amount(source.tax_total),shippingMinor=amount(credit&&source.shipping_charge===undefined?'0':source.shipping_charge);
  check(lines.reduce((sum,line)=>sum+BigInt(line.amountMinor),0n)+BigInt(taxMinor)+BigInt(shippingMinor)===BigInt(totalMinor),'BOOKS_READ_FAILED','The original accounting details do not tie.');
  return booksFinancialDigest({totalMinor,taxMinor,shippingMinor,lines});
 }catch{return null;}
}
/** The connection is snapshotted, pinned to a documented provider host and never follows redirects. */
export function createZohoWriteAdapter(raw:ZohoWriteConnection,net:PoliteNet={}){
 const transport=createZohoTransport(raw,net),connectionIdentity=transport.connectionIdentity,config=Object.freeze({...raw});
 async function get(path:string,query:Record<string,string>={}){const value=await transport.get(path,query);for(const source of [...['contact','item','tax_group','invoice','creditnote'].filter(key=>value[key]!==undefined).map(key=>object(value[key])),...(value.tax===undefined?[]:zohoTaxRows(value.tax))])if(source.organization_id!==undefined)check(source.organization_id===config.organizationId,'BOOKS_READ_FAILED','The provider evidence belongs to another company.');return value;}
 async function readExisting(externalIds:readonly string[]):Promise<ExistingBooksRecord[]>{
  try{
   check(Array.isArray(externalIds)&&externalIds.length>0&&externalIds.length<=400&&new Set(externalIds).size===externalIds.length&&externalIds.every(id=>/^chausar-[a-f0-9]{32}(?:-refund)?$/.test(id)),'BOOKS_READ_FAILED','Read bounded distinct Chausar external identities.');
   const rows:ExistingBooksRecord[]=[];
   for(const externalId of [...externalIds]){
    const resource=externalId.endsWith('-refund')?'creditnotes':'invoices',key=resource==='invoices'?'invoice':'creditnote',idKey=key+'_id';let finished=false;const found=new Set<string>();
    for(let page=1;page<=20;page++){
     const result=await get(resource,{...(resource==='creditnotes'?{search_text:externalId}:{reference_number:externalId}),page:String(page),per_page:'200'});
     for(const value of array(result[resource])){const summary=object(value);if(resource==='creditnotes'&&summary.reference_number!==externalId)continue;const id=numericId(summary[idKey]);check(summary.reference_number===externalId&&!found.has(id)&&found.size===0,'BOOKS_READ_FAILED','The external accounting reference is ambiguous.');found.add(id);
      rows.push(detailRecord(object((await get(resource+'/'+id))[key]),resource,id,externalId));
     }
     const pages=Array.isArray(result.page_context)?array(result.page_context):[result.page_context];check(pages.length===1,'BOOKS_READ_FAILED','The accounting pagination evidence is ambiguous.');const context=object(pages[0]);check(typeof context.has_more_page==='boolean','BOOKS_READ_FAILED','The accounting read did not prove its final page.');if(!context.has_more_page){finished=true;break;}
    }
    check(finished,'BOOKS_READ_FAILED','The accounting lookup exceeded its bounded page limit.');
   }
   return rows;
  }catch{throw new ChausarError('BOOKS_READ_FAILED','The existing books could not be read completely. Nothing was proposed or written.');}
 }
 function detailRecord(detail:Record<string,unknown>,resource:'invoices'|'creditnotes',id:string,externalId:string):ExistingBooksRecord{
  const key=resource==='invoices'?'invoice':'creditnote';check(detail[key+'_id']===id&&detail.reference_number===externalId&&detail.currency_code==='INR','BOOKS_READ_FAILED','The accounting document identity or currency changed.');
  if(detail.organization_id!==undefined)check(detail.organization_id===config.organizationId,'BOOKS_READ_FAILED','The accounting document belongs to another company.');
  const status=requiredText(detail.status);check(['draft','sent','open','closed','paid','overdue','unpaid','partially_paid','viewed'].includes(status),'BOOKS_READ_FAILED','Inspect the unsupported accounting document state.');
  const postingDate=typeof detail.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(detail.date)?detail.date:null;
  const originalIds=resource==='creditnotes'?array(detail.line_items??[]).map(value=>object(value).invoice_id):[];
  const originalId=originalIds.length>0&&originalIds.every(value=>typeof value==='string'&&/^\d{1,100}$/.test(value)&&value===originalIds[0])?'invoices:'+originalIds[0]:null;
  const recipientId=typeof detail.customer_id==='string'&&/^\d{1,100}$/.test(detail.customer_id)?detail.customer_id:null;
  const result:ExistingBooksRecord={externalId,id:resource+':'+id,status:status==='draft'?'draft':'issued',totalMinor:amount(detail.total),financialDigest:financialDetails(detail,resource==='creditnotes'),postingDate,document:resource==='creditnotes'?'credit-note':'invoice',originalId,recipientId,materialDigest:zohoMaterialDigest(detail,resource==='creditnotes'?'credit-note':'invoice')};validateBooksExisting([result],new Set([externalId]));return result;
 }
 const post=transport.post;
 /** Reading mappings never sends a draft. The result can be persisted and reviewed across restart. */
 async function prepareDraft(row:PostingDecision,mapping:ZohoDraftMapping){return prepareZohoDraft(connectionIdentity,get,row,mapping);}
 /** Rebuild from current evidence, then send the approved exact bytes at the pinned transport boundary. */
 async function sendDraft(input:ZohoPreparedDraft,beforeSend:()=>void){
  validatePrepared(input,connectionIdentity);const prepared=structuredClone(input),fresh=await prepareDraft(prepared.decision,prepared.mapping);check(fresh.digest===prepared.digest,'APPROVAL_STALE','The customer, item or tax mapping changed. Prepare and review a new draft.');await post(prepared.path,prepared.query,prepared.body,beforeSend);
 }
 /** Mark sent/open is separate from email, applying credit or paying any refund. */
 async function issue(input:ExistingBooksRecord,beforeSend:()=>void){
  validateBooksExisting([input],new Set([input.externalId]));const existing=structuredClone(input),match=/^(invoices|creditnotes):(\d{1,100})$/.exec(existing.id);check(match&&existing.status==='draft'&&existing.postingDate!==null&&existing.financialDigest!==null&&existing.recipientId!==null&&existing.materialDigest!==null,'APPROVAL_STALE','Review an identified exact draft and recipient before issuing.');
  const resource=match[1] as 'invoices'|'creditnotes',id=match[2]!,key=resource==='invoices'?'invoice':'creditnote';check((resource==='creditnotes')===(existing.document==='credit-note')&&(resource==='creditnotes')===existing.externalId.endsWith('-refund'),'APPROVAL_STALE','The document kind does not match this draft.');
  const live=detailRecord(object((await get(resource+'/'+id))[key]),resource,id,existing.externalId);check(digest(live)===digest(existing),'APPROVAL_STALE','The exact draft changed before issue.');await post(resource+'/'+id+'/status/'+(resource==='invoices'?'sent':'open'),{},'{}',beforeSend);
 }
 return {connectionIdentity,readExisting,prepareDraft,sendDraft,issue};
}
