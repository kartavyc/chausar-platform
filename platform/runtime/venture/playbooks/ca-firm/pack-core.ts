// CA12 original typed data-pack validation. MIT itr-prep-skill informed the checklist, never arithmetic or storage.
import {ReceiptBuilder} from './receipt.ts';
export function packReceipt(input:{figures:PackFigure[]}){const builder=new ReceiptBuilder('data-pack');for(const row of input.figures)builder.step(row.key,`${row.key}: ${row.source}`,BigInt(row.amountMinor));return builder.build(input,{sources:input.figures.map(row=>({key:row.key,source:row.source}))},'Exact owner-supplied source figures, converted by code to rupees. No income classification or tax eligibility is implied.');}
export type PackFigure={key:string;amountMinor:string;source:string};
export type PackFacts={clientId:string;assessmentYear:string;pan:string|null;aadhaar:string|null;figures:PackFigure[]};
export type PackSelection={packId:string;digest:string;fields:string[];unmask:string[];requestedBy:string;purpose:string};
export class PackError extends Error {code:string;constructor(code:string,message:string){super(message);this.code=code;}}
function ok(value:unknown,message:string):asserts value {if(!value)throw new PackError('CA_PACK_INVALID',message);}
/** Only owner-typed facts are admitted by the app; no reader or model extraction is implied. */
export function packFacts(raw:unknown):PackFacts{
 const p=raw as PackFacts;ok(p&&typeof p==='object'&&!Array.isArray(p),'Give typed return facts.');
 ok(Object.keys(p).every(key=>['clientId','assessmentYear','pan','aadhaar','figures'].includes(key)),'Give only the requested return fields.');
 ok(typeof p.clientId==='string'&&p.clientId.length>0&&['2026-27','2027-28'].includes(p.assessmentYear),'Choose a client and supported assessment year.');
 ok(p.pan===null||(typeof p.pan==='string'&&/^[A-Z]{5}\d{4}[A-Z]$/.test(p.pan)),'Type a valid PAN or leave it empty.');
 ok(p.aadhaar===null||(typeof p.aadhaar==='string'&&/^[2-9]\d{11}$/.test(p.aadhaar)),'Type twelve Aadhaar digits or leave it empty.');
 ok(Array.isArray(p.figures)&&p.figures.length>0&&p.figures.length<=100,'Add between one and one hundred source figures.');
 const keys=new Set<string>();for(const row of p.figures){ok(row&&Object.keys(row).every(key=>['key','amountMinor','source'].includes(key))&&typeof row.key==='string'&&/^[a-z][a-z0-9-]{0,59}$/.test(row.key)&&!['pan','aadhaar','assessment-year'].includes(row.key)&&!keys.has(row.key),'Use distinct named figures.');keys.add(row.key);ok(typeof row.amountMinor==='string'&&/^\d{1,15}$/.test(row.amountMinor),'Use whole paise from the source.');ok(typeof row.source==='string'&&row.source.trim().length>=3&&row.source.length<=240,'Name where the typed figure came from.');}
 return structuredClone(p);
}
/** Selection includes every intentional disclosure and the named recipient/purpose; approval hashes this object. */
export function packSelection(raw:unknown,pack:PackFacts):PackSelection{
 const p=raw as PackSelection;ok(p&&typeof p==='object'&&Object.keys(p).every(key=>['packId','digest','fields','unmask','requestedBy','purpose'].includes(key)),'Review the exact export selection.');
 ok(typeof p.packId==='string'&&typeof p.digest==='string','Select the saved pack.');
 const allowed=['assessment-year',...(pack.pan?['pan']:[]),...(pack.aadhaar?['aadhaar']:[]),...pack.figures.map(row=>row.key)];
 ok(Array.isArray(p.fields)&&p.fields.length>0&&p.fields.every(key=>allowed.includes(key))&&new Set(p.fields).size===p.fields.length,'Choose distinct saved fields.');
 ok(Array.isArray(p.unmask)&&new Set(p.unmask).size===p.unmask.length&&p.unmask.every(key=>['pan','aadhaar'].includes(key)&&p.fields.includes(key)),'Reveal only a selected identity field required by the form.');
 for(const key of ['requestedBy','purpose'] as const)ok(typeof p[key]==='string'&&p[key].trim().length>=3&&p[key].length<=240,'Name who needs the export and why.');
 return structuredClone(p);
}
/** Mask a saved identity even when it appears in incidental filenames or review notes. */
function privateText(text:string,p:PackFacts,unmask:readonly string[]=[]){for(const key of ['pan','aadhaar'] as const){const identity=p[key];if(identity&&!unmask.includes(key)){const pattern=key==='aadhaar'?identity.split('').join('[ -]*'):identity; text=text.replace(new RegExp(pattern,'gi'),(key==='pan'?'******':'********')+identity.slice(-4));}}return text;}
/** Normal desk reads always mask identifiers, including when a disclosure is being previewed. */
export function maskedPack(p:PackFacts){return {...p,figures:p.figures.map(row=>({...row,source:privateText(row.source,p)})),pan:p.pan?`******${p.pan.slice(-4)}`:null,aadhaar:p.aadhaar?`********${p.aadhaar.slice(-4)}`:null};}
/** The workbook discloses only the selected fields. Money cells remain exact minor units until XML serialization. */
export function packRows(facts:PackFacts,selection:PackSelection):(string|null|{money:string})[][]{
 const rows:(string|null|{money:string})[][]=[['Return preparation data pack','Not a filed return'],['Requested by',privateText(selection.requestedBy,facts,selection.unmask)],['Purpose',privateText(selection.purpose,facts,selection.unmask)],['Field','Value','Source']];
 for(const key of selection.fields){if(key==='assessment-year')rows.push([key,facts.assessmentYear,'Owner typed']);else if(key==='pan'||key==='aadhaar')rows.push([key,selection.unmask.includes(key)?facts[key]:maskedPack(facts)[key],'Owner typed; disclosure explicitly approved']);else {const figure=facts.figures.find(row=>row.key===key)!;rows.push([privateText(key,facts,selection.unmask),{money:figure.amountMinor},privateText(figure.source,facts,selection.unmask)]);}}
 return rows;
}
