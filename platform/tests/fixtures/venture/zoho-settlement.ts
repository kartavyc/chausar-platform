import assert from 'node:assert/strict';
import type {PinnedSender} from '../../../runtime/venture/core/net-guard.ts';
export const config={dataCenter:'in' as const,organizationId:'12345',accessToken:'owner session fixture',revision:'one'};
export const resolve=async()=>[{address:'93.184.216.34',family:4 as const}];
export const row={externalId:'chausar-settlement-'+'a'.repeat(32),invoiceReference:'chausar-'+'b'.repeat(32),orderId:'one',source:'Settlement export',postingDate:'2026-10-28',paymentMode:'banktransfer' as const,accountId:'100',amountMinor:'9900',unappliedDifferenceMinor:'100'};
export function provider(){
 const invoice:any={invoice_id:'123',reference_number:row.invoiceReference,customer_id:'77',status:'sent',currency_code:'INR',date:'2026-10-27',balance:100,total:100,tax_total:0,shipping_charge:0,is_inclusive_tax:false,gst_treatment:'consumer',place_of_supply:'MH',line_items:[{item_id:'99',quantity:1,rate:100,item_total:100,discount_amount:0,tax_id:'88',hsn_or_sac:'9983'}]};
 const account:any={account_id:'100',account_type:'bank',currency_code:'INR',is_active:true};let payment:any=null;const calls:{method:string;path:string;body:string}[]=[];
 const send:PinnedSender=async target=>{const path=target.url.pathname.replace('/books/v3/','');calls.push({method:target.method,path,body:String(target.body??'')});assert.equal(target.url.searchParams.get('organization_id'),'12345');let result:any;
  if(target.method==='POST'){const body=JSON.parse(String(target.body));payment={...body,payment_id:'333',currency_code:'INR',amount_refunded:0,status:'success'};result={payment};}
  else if(path==='invoices')result={invoices:[{invoice_id:'123',reference_number:invoice.reference_number}],page_context:{has_more_page:false}};
  else if(path==='invoices/123')result={invoice};else if(path==='chartofaccounts/100')result=account;
  else if(path==='customerpayments')result={customer_payments:payment?[{payment_id:'333'}]:[],page_context:{has_more_page:false}};
  else if(path==='customerpayments/333')result={payment};else throw Error(path);
  return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...result}))};
 };
 return {invoice,account,calls,send,get payment(){return payment;},set payment(value:any){payment=value;}};
}
