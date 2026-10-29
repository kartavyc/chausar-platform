// Original accounting connection validation. Safe mapping data is separate from the session credential.
import {check,digest} from '../../../portable.ts';
import {booksExact} from './books-input.ts';
import type {ZohoDraftMapping} from '../../../adapters/accounting/zoho-write-types.ts';
export type BooksConnection={dataCenter:'com'|'eu'|'in'|'com.au'|'jp'|'ca'|'com.cn'|'sa';accessToken:string;mapping:ZohoDraftMapping|null};
export const booksSecretName=(ventureId:string,clientId:string,companyId:string): `books:${string}:zoho:${string}`=>`books:${ventureId}:zoho:${digest({clientId,companyId})}`;
export function zohoAccountInput(raw:unknown):BooksConnection{
 booksExact(raw,['dataCenter','accessToken']);
 check(typeof raw.dataCenter==='string'&&['com','eu','in','com.au','jp','ca','com.cn','sa'].includes(raw.dataCenter),'BOOKS_CONNECTION_INVALID','Choose the account data centre.');
 check(typeof raw.accessToken==='string'&&raw.accessToken.length>0&&raw.accessToken.length<=4096&&!/[\r\n]/.test(raw.accessToken),'BOOKS_CONNECTION_INVALID','Enter the current account access token.');
 return {dataCenter:raw.dataCenter as BooksConnection['dataCenter'],accessToken:raw.accessToken,mapping:null};
}
export function zohoConnectionInput(raw:unknown){
 booksExact(raw,['dataCenter','accessToken','customerId','placeOfSupply','gstTreatment','gstNo','taxSpecification','lineMode','lines']);const b=raw;
 check(typeof b.dataCenter==='string'&&['com','eu','in','com.au','jp','ca','com.cn','sa'].includes(b.dataCenter),'BOOKS_CONNECTION_INVALID','Choose the account data centre.');
 check(typeof b.accessToken==='string'&&b.accessToken.length>0&&b.accessToken.length<=4096&&!/[\r\n]/.test(b.accessToken),'BOOKS_CONNECTION_INVALID','Enter the current account access token.');
 check(typeof b.customerId==='string'&&/^\d{1,100}$/.test(b.customerId)&&typeof b.placeOfSupply==='string'&&/^[A-Z]{2}$/.test(b.placeOfSupply),'BOOKS_CONNECTION_INVALID','Enter the provider customer ID and state code.');
 check(typeof b.gstTreatment==='string'&&['business_gst','business_none','consumer'].includes(b.gstTreatment)&&(b.gstNo===null||typeof b.gstNo==='string'&&/^[A-Z0-9]{15}$/.test(b.gstNo))&&typeof b.taxSpecification==='string'&&['intra','inter'].includes(b.taxSpecification)&&b.lineMode==='aggregate-non-inventory','BOOKS_CONNECTION_INVALID','Choose the supported customer and tax mapping.');
 check(Array.isArray(b.lines)&&b.lines.length>0&&b.lines.length<=400,'BOOKS_CONNECTION_INVALID','Map each provider item and tax ID.');
 const lines=b.lines.map(value=>{booksExact(value,['itemId','taxId','taxKind']);const row=value;check(typeof row.itemId==='string'&&/^\d{1,100}$/.test(row.itemId)&&typeof row.taxId==='string'&&/^\d{1,100}$/.test(row.taxId)&&typeof row.taxKind==='string'&&['tax','tax_group'].includes(row.taxKind),'BOOKS_CONNECTION_INVALID','Use exact provider item and tax IDs.');return row as ZohoDraftMapping['lines'][number];});
 check(new Set(lines.map(row=>row.itemId)).size===lines.length,'BOOKS_CONNECTION_INVALID','Map each item only once.');
 return {dataCenter:b.dataCenter as 'com'|'eu'|'in'|'com.au'|'jp'|'ca'|'com.cn'|'sa',accessToken:b.accessToken,mapping:{customerId:b.customerId,placeOfSupply:b.placeOfSupply,gstTreatment:b.gstTreatment,gstNo:b.gstNo,taxSpecification:b.taxSpecification,lineMode:b.lineMode,lines} as ZohoDraftMapping};
}
