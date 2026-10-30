// Browser-safe binding of exact owner mappings to the client setup source.
import {check} from '../../../portable.ts';
import {booksDate} from './books-input.ts';
import type {setupDraft} from './setup.ts';
import type {ZohoSetupMasterInput,ZohoOpeningInput} from '../../../adapters/accounting/zoho-setup-types.ts';
import type {SetupMasterOutcome} from './setup-posting-types.ts';
export function setupMasterKey(input:ZohoSetupMasterInput){return (input.kind==='account'?'category':input.contactType)+':'+input.sourceId;}
export function setupMappings(setup:ReturnType<typeof setupDraft>,raw:unknown):ZohoSetupMasterInput[]{
 check(Array.isArray(raw)&&raw.length>0&&raw.length<=200,'BOOKS_MAPPING_REQUIRED','Map every supported setup row, up to two hundred masters.');
 const expected=new Map([...setup.customers.map(row=>['customer:'+row.id,row.name] as const),...setup.vendors.map(row=>['vendor:'+row.id,row.name] as const),...setup.categories.map(row=>['category:'+row.id,row.name] as const)]),seen=new Set<string>(),numbers=new Set<string>();
 for(const value of raw){check(value&&typeof value==='object'&&!Array.isArray(value)&&(value.kind==='contact'||value.kind==='account'),'BOOKS_MAPPING_REQUIRED','Use exact owner master mappings.');const input=value as ZohoSetupMasterInput,key=setupMasterKey(input);check(expected.get(key)===input.name&&!seen.has(key),'BOOKS_MAPPING_REQUIRED','Each mapping must match its exact source identity and name.');seen.add(key);const number=(input.kind==='contact'?input.number:input.code);check(typeof number==='string'&&number.trim().length>0,'BOOKS_MAPPING_REQUIRED','Choose an explicit stable contact number or account code.');const identity=input.kind+':'+number.trim().toLocaleLowerCase('en');check(!numbers.has(identity),'BOOKS_MAPPING_REQUIRED','Do not map different source rows to the same provider identity.');numbers.add(identity);}
 check(seen.size===expected.size,'BOOKS_MAPPING_REQUIRED','Map every customer, vendor and category in the client source.');return structuredClone(raw) as ZohoSetupMasterInput[];
}
export function setupOpeningInput(setup:ReturnType<typeof setupDraft>,masters:SetupMasterOutcome[],date:unknown):ZohoOpeningInput{
 booksDate(date);check(date>=setup.cycle.from&&date<=setup.cycle.to,'BOOKS_CYCLE_INVALID','Use the migration date in this source finance cycle.');
 const accounts=new Map(masters.filter(value=>value.input.kind==='account').map(value=>[value.input.sourceId,value]));const currency=new Set(masters.map(value=>value.input.currencyId));check(currency.size===1,'BOOKS_MAPPING_UNSUPPORTED','Use one verified INR currency for this setup.');
 const lines=setup.opening.map(value=>{const mapped=accounts.get(value.accountId);check(mapped?.record&&['existing','created'].includes(mapped.state),'BOOKS_MAPPING_REQUIRED','Read back every actual account before opening balances.');return {accountId:mapped.record.id,debitMinor:value.debitMinor,creditMinor:value.creditMinor};});
 check(lines.length>=2&&lines.length<=200,'BOOKS_MAPPING_UNSUPPORTED','Use the manual path for a setup without supported opening rows.');return {migrationDate:date,locationId:null,currencyId:[...currency][0]!,lines};
}
