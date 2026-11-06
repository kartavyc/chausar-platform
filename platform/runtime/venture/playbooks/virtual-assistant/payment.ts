// Original payment refusal and exact manual purchase arithmetic. No payment credentials are retained.
import {check,digest} from '../../../portable.ts';
import {formatMinor,currencyMinorDigits} from '../../../currency.ts';
export function paymentFieldAllowed(_input:unknown):never{
 check(false,'PAYMENT_FIELD_REFUSED','Chausar never types payment details. Pay it yourself.');
}
export function purchaseHandoff(input:{item:string;quantity:string;unitMinor:string;currency:string}){
 check(input&&typeof input.item==='string'&&input.item.trim().length>0&&input.item.length<=1000,'INVALID_VENTURE_REQUEST','Name the exact item to buy.');
 check(typeof input.quantity==='string'&&/^[1-9]\d{0,5}$/.test(input.quantity)&&typeof input.unitMinor==='string'&&/^\d{1,18}$/.test(input.unitMinor)&&/^[A-Z]{3}$/.test(input.currency)&&currencyMinorDigits(input.currency)===2,'INVALID_VENTURE_REQUEST','Use whole quantities and a price in minor units.');
 const totalMinor=String(BigInt(input.quantity)*BigInt(input.unitMinor));
 const receipt={operation:'multiply' as const,inputs:[input.quantity,input.unitMinor],result:totalMinor,unit:'minor' as const};
 return {...input,totalMinor,display:formatMinor(BigInt(totalMinor),input.currency),receipt,receiptId:digest({input,receipt}),purchased:false as const,line:'Review this exact item and total, then buy it yourself.'};
}
