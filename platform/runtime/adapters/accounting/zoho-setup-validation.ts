// Browser-safe exact setup mapping validation, shared with the real provider and demo boundary.
import {check} from '../../portable.ts';
import {booksExact,booksText} from '../../venture/playbooks/bookkeeping-cfo/books-input.ts';
import {ZOHO_SETUP_ACCOUNT_TYPES,type ZohoSetupMasterInput} from './zoho-setup-types.ts';
const states=new Set('AN AP AR AS BR CH CG DD DL GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD PY PB RJ SK TN TS TR UP UK WB'.split(' '));
function supported(value:unknown):asserts value {check(value,'BOOKS_MAPPING_UNSUPPORTED','This setup profile needs the bookkeeper manual path. Use explicit India INR records and supported account choices.');}
function id(value:unknown):string{check(typeof value==='string'&&/^\d{1,100}$/.test(value),'BOOKS_READ_FAILED','The accounting evidence needs an exact provider identity.');return value;}
export function validateSetupMaster(input:ZohoSetupMasterInput){
 booksExact(input,input?.kind==='contact'?['kind','sourceId','name','number','contactType','customerSubtype','gstTreatment','gstNo','placeOfContact','currencyId','openingBalanceMinor']:['kind','sourceId','name','code','accountType','currencyId']);
 supported(input.kind==='contact'||input.kind==='account');booksText(input.sourceId);booksText(input.name,200);id(input.currencyId);
 if(input.kind==='account'){booksText(input.code,50);check(input.code===input.code.trim(),'BOOKS_SETUP_INVALID','Use a stable account code without surrounding spaces.');supported(ZOHO_SETUP_ACCOUNT_TYPES.includes(input.accountType));}
 else{booksText(input.number,50);check(input.number===input.number.trim(),'BOOKS_SETUP_INVALID','Use a stable contact number without surrounding spaces.');supported(input.contactType==='customer'||input.contactType==='vendor');supported(input.contactType==='customer'?input.customerSubtype==='business'||input.customerSubtype==='individual':input.customerSubtype===null);supported(['business_gst','business_none','consumer'].includes(input.gstTreatment)&&typeof input.gstTreatment==='string');supported(input.contactType!=='vendor'||input.gstTreatment!=='consumer');supported(typeof input.placeOfContact==='string'&&states.has(input.placeOfContact));supported(input.gstTreatment==='business_gst'?typeof input.gstNo==='string'&&/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(input.gstNo):input.gstNo===null);supported(input.openingBalanceMinor==='0');}
}
