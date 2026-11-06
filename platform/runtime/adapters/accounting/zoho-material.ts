// Original browser-safe projection of the exact supported Zoho document fields.
import {digest} from '../../portable.ts';
import {decimalMinor} from '../../currency.ts';
import {booksDate} from '../../venture/playbooks/bookkeeping-cfo/books-input.ts';
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('object');return value as Record<string,unknown>;};
const id=(value:unknown)=>{if(typeof value!=='string'||!/^\d{1,100}$/.test(value))throw Error('id');return value;};
const money=(value:unknown)=>{if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value))throw Error('money');return decimalMinor(value,'INR');};
/** Null means incomplete or unsupported evidence, never permission to issue. Numeric values arrive as exact strings. */
export function zohoMaterialDigest(value:unknown,document:'invoice'|'credit-note'):string|null{try{
 const row=object(value);booksDate(row.date);if(row.currency_code!=='INR'||typeof row.reference_number!=='string'||!/^chausar-[a-f0-9]{32}(?:-refund)?$/.test(row.reference_number)||typeof row.place_of_supply!=='string'||!/^[A-Z]{2}$/.test(row.place_of_supply)||!['business_gst','business_none','consumer'].includes(String(row.gst_treatment))||typeof row.gst_treatment!=='string'||row.is_inclusive_tax!==false)throw Error('profile');
 const gstNo=row.gst_no===undefined&&row.gst_treatment!=='business_gst'?'':row.gst_no;if(typeof gstNo!=='string'||(row.gst_treatment==='business_gst'?!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstNo):gstNo!==''))throw Error('GST');
 if(!Array.isArray(row.line_items)||row.line_items.length<1||row.line_items.length>200)throw Error('lines');
 const lines=row.line_items.map(value=>{const line=object(value);if(typeof line.hsn_or_sac!=='string'||!/^\d{4,8}$/.test(line.hsn_or_sac)||typeof line.quantity!=='string'||!/^1(?:\.0+)?$/.test(line.quantity))throw Error('line profile');
 const discount=document==='invoice'?money(line.discount_amount):(typeof line.discount==='string'&&/^0(?:\.0+)?%?$/.test(line.discount)?'0':null);if(discount!=='0')throw Error('discount');const amount=money(line.item_total),rate=money(line.rate);if(amount!==rate)throw Error('rate');
 return {itemId:id(line.item_id),taxId:id(line.tax_id),hsn:line.hsn_or_sac,quantity:'1',rate,amount,discount,invoiceId:document==='credit-note'?id(line.invoice_id):null,invoiceItemId:document==='credit-note'?id(line.invoice_item_id):null};});
 const total=money(row.total),tax=money(row.tax_total),shipping=document==='credit-note'&&row.shipping_charge===undefined?'0':money(row.shipping_charge);if(shipping!=='0'||lines.reduce((n,line)=>n+BigInt(line.amount),0n)+BigInt(tax)!==BigInt(total))throw Error('total');
 return digest({profile:'zoho-aggregate-inr-v1',document,recipientId:id(row.customer_id),reference:row.reference_number,date:row.date,currency:'INR',place:row.place_of_supply,gstTreatment:row.gst_treatment,gstNo,inclusive:false,total,tax,shipping,lines});
 }catch{return null;}}
