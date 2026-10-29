// Zoho v3 customer payments: record actual cash received, never invent fee expenses or tax withholding.
// Official customer-payments and chart-of-accounts API documentation checked 28 October 2026.
import {check,digest} from '../../portable.ts';
import {decimalMinor} from '../../currency.ts';
import type {PoliteNet} from '../../venture/build/fetch-policy.ts';
import {array,object} from './common.ts';
import {createZohoTransport,type ZohoWriteConnection} from './zoho-transport.ts';
import {zohoMaterialDigest} from './zoho-material.ts';
import {booksExact,booksDate,booksText,booksMinor} from '../../venture/playbooks/bookkeeping-cfo/books-input.ts';
import type {SettlementPayment} from '../../venture/playbooks/bookkeeping-cfo/settlement-payments.ts';
import type {ZohoPreparedPayment,ZohoPaymentEvidence} from './zoho-settlement-types.ts';
const id=(value:unknown)=>{check(typeof value==='string'&&/^\d{1,100}$/.test(value),'BOOKS_READ_FAILED','Read an exact provider ID.');return value;};
const minor=(value:unknown)=>{check(typeof value==='string','BOOKS_READ_FAILED','Read exact provider amounts.');const result=decimalMinor(value,'INR');booksMinor(result);return result;};
const decimal=(value:string)=>{const amount=booksMinor(value);return `${amount/100n}.${String(amount%100n).padStart(2,'0')}`;};
function projection(value:Record<string,unknown>){
 try{const invoices=array(value.invoices);check(invoices.length===1&&value.currency_code==='INR'&&value.status==='success','BOOKS_READ_FAILED','Read one confirmed INR payment.');const invoice=object(invoices[0]);
  check(minor(value.bank_charges)==='0'&&minor(value.amount_refunded)==='0'&&minor(invoice.tax_amount_withheld)==='0'&&typeof value.exchange_rate==='string'&&/^1(?:\.0+)?$/.test(value.exchange_rate),'BOOKS_READ_FAILED','Unexpected charges, withholding, refund or exchange rate.');booksDate(value.date);booksText(value.reference_number);booksText(value.payment_mode);
  return {customerId:id(value.customer_id),accountId:id(value.account_id),invoiceId:id(invoice.invoice_id),externalId:value.reference_number,date:value.date,paymentMode:value.payment_mode,amountMinor:minor(value.amount),appliedMinor:minor(invoice.amount_applied)};
 }catch{return null;}
}
export function createZohoSettlementAdapter(config:ZohoWriteConnection,net:PoliteNet={}){
 const transport=createZohoTransport(config,net),identity=transport.connectionIdentity;
 const company=(value:Record<string,unknown>)=>{check(value.organization_id===undefined||value.organization_id===config.organizationId,'BOOKS_READ_FAILED','The provider evidence belongs to another company.');return value;};
 async function listed(path:'invoices'|'customerpayments',reference:string,key:string){
  const rows:Record<string,unknown>[]=[],seen=new Set<string>();let complete=false;
  for(let page=1;page<=20;page++){const result=await transport.get(path,{reference_number:reference,page:String(page),per_page:'200'});for(const raw of array(result[key])){const row=company(object(raw)),providerId=id(row[path==='invoices'?'invoice_id':'payment_id']);check(!seen.has(providerId),'BOOKS_READ_FAILED','The provider repeated a document identity.');seen.add(providerId);rows.push(row);check(rows.length<=1,'BOOKS_READ_FAILED','The accounting reference is ambiguous.');}const context=object(result.page_context);check(typeof context.has_more_page==='boolean','BOOKS_READ_FAILED','Read complete accounting pagination.');if(!context.has_more_page){complete=true;break;}}
  check(complete,'BOOKS_READ_FAILED','The accounting lookup did not finish.');return rows;
 }
 async function readPayment(externalId:string):Promise<ZohoPaymentEvidence|null>{
  check(typeof externalId==='string'&&/^chausar-settlement-[a-f0-9]{32}$/.test(externalId),'BOOKS_READ_FAILED','Use the stable settlement identity.');const rows=await listed('customerpayments',externalId,'customer_payments');if(rows.length===0)return null;const paymentId=id(rows[0]!.payment_id),detail=company(object((await transport.get('customerpayments/'+paymentId)).payment));check(detail.payment_id===paymentId&&detail.reference_number===externalId,'BOOKS_READ_FAILED','The payment identity changed.');const material=projection(detail);return {id:paymentId,externalId,materialDigest:material?digest(material):null};
 }
 async function preparePayment(raw:SettlementPayment,customerId:string):Promise<ZohoPreparedPayment>{
  booksExact(raw,['externalId','invoiceReference','orderId','source','postingDate','paymentMode','accountId','amountMinor','unappliedDifferenceMinor']);const row=structuredClone(raw);id(customerId);id(row.accountId);booksDate(row.postingDate);booksText(row.orderId);booksText(row.source);
  check(/^chausar-settlement-[a-f0-9]{32}$/.test(row.externalId)&&/^chausar-[a-f0-9]{32}$/.test(row.invoiceReference)&&typeof row.paymentMode==='string'&&['banktransfer','bankremittance','cash','check','creditcard','others'].includes(row.paymentMode)&&booksMinor(row.amountMinor)>0n&&typeof row.unappliedDifferenceMinor==='string'&&/^-?(?:0|[1-9]\d{0,15})$/.test(row.unappliedDifferenceMinor),'BOOKS_SETUP_INVALID','Use an exact reconciled payment proposal.');
  check(await readPayment(row.externalId)===null,'BOOKS_ALREADY_SENT','This settlement reference already exists. Check its receipt before doing anything else.');
  const found=await listed('invoices',row.invoiceReference,'invoices');check(found.length===1&&found[0]!.reference_number===row.invoiceReference,'BOOKS_READ_FAILED','Read the matching issued source invoice.');const invoiceId=id(found[0]!.invoice_id),invoice=company(object((await transport.get('invoices/'+invoiceId)).invoice));
  check(invoice.invoice_id===invoiceId&&invoice.reference_number===row.invoiceReference&&invoice.customer_id===customerId&&invoice.currency_code==='INR'&&['sent','open','overdue','unpaid','partially_paid','viewed'].includes(String(invoice.status)),'BOOKS_MAPPING_UNSUPPORTED','Use the same customer issued INR invoice.');
  const material=zohoMaterialDigest(invoice,'invoice');check(material!==null&&BigInt(minor(invoice.balance))>=BigInt(row.amountMinor),'BOOKS_MAPPING_UNSUPPORTED','The invoice evidence or unpaid balance does not support this payment.');
  // GET chartofaccounts/{id} returns the account at the response root in the official schema.
  const account=company(await transport.get('chartofaccounts/'+row.accountId));check(account.account_id===row.accountId&&account.is_active===true&&account.currency_code==='INR'&&['bank','cash'].includes(String(account.account_type)),'BOOKS_MAPPING_UNSUPPORTED','Choose the verified active INR cash or bank account.');
  const amount=decimal(row.amountMinor),quote=JSON.stringify;
  const body=`{"customer_id":${quote(customerId)},"payment_mode":${quote(row.paymentMode)},"amount":${amount},"date":${quote(row.postingDate)},"reference_number":${quote(row.externalId)},"account_id":${quote(row.accountId)},"invoices":[{"invoice_id":${quote(invoiceId)},"amount_applied":${amount},"tax_amount_withheld":0}],"exchange_rate":1,"bank_charges":0,"contact_persons":[]}`;
  const expected={customerId,accountId:row.accountId,invoiceId,externalId:row.externalId,date:row.postingDate,paymentMode:row.paymentMode,amountMinor:row.amountMinor,appliedMinor:row.amountMinor};
  const prepared:ZohoPreparedPayment={kind:'settlement-payment',connectionIdentity:identity,payment:row,customerId,invoiceId,method:'POST',path:'customerpayments',query:{},body,evidenceDigest:digest({invoice:material,balance:minor(invoice.balance),account:{id:account.account_id,type:account.account_type,currency:account.currency_code,active:account.is_active}}),materialDigest:digest(expected),digest:''};prepared.digest=digest(prepared);return prepared;
 }
 async function sendPayment(input:ZohoPreparedPayment,beforeSend:()=>void){
  check(input&&input.kind==='settlement-payment'&&input.connectionIdentity===identity&&input.digest===digest({...input,digest:''}),'APPROVAL_STALE','Read the exact settlement proposal again.');const prepared=structuredClone(input),fresh=await preparePayment(prepared.payment,prepared.customerId);check(fresh.digest===prepared.digest,'APPROVAL_STALE','The invoice or payment account changed. Review a new proposal.');await transport.post(prepared.path,prepared.query,prepared.body,beforeSend);
 }
 return {connectionIdentity:identity,preparePayment,sendPayment,readPayment};
}
