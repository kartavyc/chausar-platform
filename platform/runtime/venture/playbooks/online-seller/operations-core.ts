// Chausar seller operations validation. MIT/Apache commerce ideas, independently written.
import {exact,sellerInteger,sellerDay,sellerRefuse} from './model.ts';
export {exact,sellerInteger,sellerDay,sellerRefuse};
export function sellerText(value:unknown,name:string,max=500):string {if(typeof value!=='string'||!value.trim()||value.length>max)sellerRefuse('SELLER_INPUT_INVALID',name+' needs bounded text.');return value as string;}
export function sellerRows(value:unknown,name='Rows'):unknown[]{if(!Array.isArray(value)||value.length>10000)sellerRefuse('SELLER_INPUT_INVALID',name+' must be a bounded list.');return value as unknown[];}
export function sellerDate(value:unknown):string{if(!sellerDay(value))sellerRefuse('SELLER_INPUT_INVALID','Use a real calendar day.');return value as string;}
export function sellerCurrency(value:unknown):string{if(typeof value!=='string'||!/^[A-Z]{3}$/.test(value))sellerRefuse('SELLER_INPUT_INVALID','Name the three-letter currency.');return value as string;}
export function sellerSigned(value:unknown):bigint{if(typeof value!=='string'||! /^-?(0|[1-9]\d{0,17})$/.test(value))sellerRefuse('SELLER_INPUT_INVALID','A movement needs a whole signed quantity as text.');return BigInt(value as string);}
