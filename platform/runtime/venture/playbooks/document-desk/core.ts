// Chausar playbook: the document desk (wave 6, 6E4). Pure rules shared by the engine (desk.ts) and the browser fake:
// the document types and their outlines, the figures table computed by code with BigInt (every amount a document
// shows comes from its receipt, never from model or owner arithmetic), the money check on section text (kit/documents/
// money.ts, the extractor the tender desk uses too), the two approvals, taking an accepted draft's sections, and the
// export pack (kit/documents/pack.ts, the tender desk's pack). Written for Chausar; nothing here is learned elsewhere.
import {check,digest} from '../../../portable.ts';
import {currencyMinorDigits,decimalMinor,formatMinor} from '../../../currency.ts';import {formatMoney} from '../../../owner-format.ts';
import {moneyAmounts} from '../kit/documents/money.ts';
import {figureWords} from '../../delivery/template-outline.ts';
import {csvText,docxEntries,xlsxEntries,type PackSection} from '../kit/documents/pack.ts';
import type {ZipEntry} from '../kit/ooxml/zip-core.ts';
import {DOCUMENT_TYPES,type DocumentBody,type DocumentFigures,type DocumentSection,type DocumentType} from './records.ts';

export const DOCUMENT_TYPE_LABELS:Readonly<Record<DocumentType,string>>=Object.freeze({handbook:'Handbook',sop:'Standard operating procedure','project-report':'Project report (DPR or CMA)',estimate:'Estimate','thesis-edit':'Thesis editing',technical:'Technical document'});
const outline=(...rows:[string,string][])=>rows.map(([heading,brief])=>({heading,brief}));
/** The outline each document type starts from. The owner can change every heading and brief. */
export const DOCUMENT_OUTLINES:Readonly<Record<DocumentType,readonly {heading:string;brief:string}[]>>=Object.freeze({
 handbook:outline(['Purpose and scope','Who the handbook covers and why.'],['Working hours and leave','Hours, leave and holidays from the client policies.'],['Conduct','Expected conduct and what happens when it is broken.'],['Pay and benefits','How pay and benefits work, without amounts unless the figures table holds them.'],['Raising a concern','How staff raise a grievance.'],['Acknowledgement','A line for staff to sign.']),
 sop:outline(['Purpose','What the procedure achieves.'],['Scope','Where and to whom it applies.'],['Responsibilities','Who does what.'],['Procedure','The steps in order.'],['Records','What is recorded and kept.'],['Review','When the procedure is reviewed.']),
 'project-report':outline(['Promoter and business','Who the promoters are and what the business does.'],['Project','What the project is and where it runs.'],['Market','Demand and competition from the client sources.'],['Cost of project','The cost table comes from the figures receipt.'],['Means of finance','Own funds and the loan asked for, from the figures receipt.'],['Risks','The main risks and how they are handled.']),
 estimate:outline(['Scope of work','What the estimate covers.'],['Basis of estimate','Drawings, rates and sources used.'],['Bill of quantities','The quantities and amounts come from the figures receipt.'],['Exclusions','What is not included.'],['Validity','How long the estimate stands.']),
 'thesis-edit':outline(['Editing scope','What was asked: language, structure, references.'],['Changes','The edits, chapter by chapter.'],['Queries for the author','Points only the author can decide.'],['Style notes','The style followed.']),
 technical:outline(['Overview','What the product or system is.'],['Audience','Who the document is for.'],['Setup','How to set it up.'],['Use','How to use it, step by step.'],['Troubleshooting','Common problems and fixes.']),
});

const READABLE=/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
function words(value:unknown,min:number,max:number,line:string):string{const text=typeof value==='string'?value.trim():'';check(text.length>=min&&text.length<=max&&READABLE.test(text),'DOCUMENT_INPUT_INVALID',line);return text;}

/** The client files a document rests on, as id and digest; the digest binds them, so a changed file makes it stale. */
export function sourceDigestOf(files:readonly {id:string;digest:string}[]):string{return digest(files.map(file=>({id:file.id,digest:file.digest})));}

export function newDocument(input:{orderId:string;clientId:string;docType:unknown;title:unknown;files:readonly {id:string;digest:string}[]}):DocumentBody{
 check((DOCUMENT_TYPES as readonly unknown[]).includes(input.docType),'DOCUMENT_INPUT_INVALID','Choose a document type.');
 const docType=input.docType as DocumentType,title=words(input.title,3,200,'Give the document a title.');
 check(input.files.length>=1&&input.files.length<=20,'DOCUMENT_SOURCE_REQUIRED','Choose one to twenty client files the document rests on.');
 return {orderId:input.orderId,clientId:input.clientId,docType,title,sourceFileIds:input.files.map(file=>file.id),sourceDigest:sourceDigestOf(input.files),
  sections:DOCUMENT_OUTLINES[docType].map((row,index)=>({id:'section-'+(index+1),heading:row.heading,brief:row.brief,text:'',authoredBy:null})),figures:null,briefApproval:null,approval:null,takenFromRun:null};
}

const changed=(body:DocumentBody,patch:Partial<DocumentBody>):DocumentBody=>({...structuredClone(body),...patch,briefApproval:null,approval:null});

/** New client files: the brief and the document wait for new approvals. */
export function rebindSources(body:DocumentBody,files:readonly {id:string;digest:string}[]):DocumentBody{
 check(files.length>=1&&files.length<=20,'DOCUMENT_SOURCE_REQUIRED','Choose one to twenty client files the document rests on.');
 return changed(body,{sourceFileIds:files.map(file=>file.id),sourceDigest:sourceDigestOf(files)});
}

/** The owner's outline: one to thirty sections. A kept heading keeps its text. */
export function setOutline(body:DocumentBody,raw:unknown):DocumentBody{
 check(Array.isArray(raw)&&raw.length>=1&&raw.length<=30,'DOCUMENT_INPUT_INVALID','Keep one to thirty sections.');
 const rows=(raw as unknown[]).map(row=>{check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='brief,heading','DOCUMENT_INPUT_INVALID','Each section has a heading and a brief.');const value=row as {heading:unknown;brief:unknown};return {heading:words(value.heading,2,120,'Give each section a heading.'),brief:typeof value.brief==='string'&&value.brief.trim()===''?'':words(value.brief,1,400,'Keep each brief to four hundred characters.')};});
 const keys=rows.map(row=>row.heading.toLocaleLowerCase('en'));check(new Set(keys).size===keys.length,'DOCUMENT_INPUT_INVALID','Each section needs its own heading.');
 const sections:DocumentSection[]=rows.map((row,index)=>{const kept=body.sections.find(old=>old.heading.toLocaleLowerCase('en')===keys[index]);return {id:'section-'+(index+1),heading:row.heading,brief:row.brief,text:kept?.text??'',authoredBy:kept?.authoredBy??null};});
 return changed(body,{sections});
}

/** Quantity times unit amount, rounded half up to a whole minor unit, with BigInt only. */
export function lineAmount(quantity:string,unitMinor:string):string{
 const [whole,fraction='']=quantity.split('.'),scale=10n**BigInt(fraction.length),scaled=BigInt(whole!+fraction);
 return String((scaled*BigInt(unitMinor)*2n+scale)/(2n*scale));
}

/** The figures table: code computes every line and the total, and names the receipt that proves them. Empty clears it. */
export function computeFigures(raw:unknown):DocumentFigures|null{
 check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')==='currency,lines','DOCUMENT_INPUT_INVALID','Send the currency and the lines.');
 const value=raw as {currency:unknown;lines:unknown};
 check(typeof value.currency==='string'&&/^[A-Z]{3}$/.test(value.currency),'DOCUMENT_INPUT_INVALID','Choose a currency.');currencyMinorDigits(value.currency);
 check(Array.isArray(value.lines)&&value.lines.length<=200,'DOCUMENT_INPUT_INVALID','Keep the figures to two hundred lines.');
 if(!(value.lines as unknown[]).length)return null;
 const lines=(value.lines as unknown[]).map((row,index)=>{
  check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='label,quantity,unit','DOCUMENT_INPUT_INVALID','Each line has a label, a quantity and a unit amount.');
  const line=row as {label:unknown;quantity:unknown;unit:unknown};
  check(typeof line.quantity==='string'&&/^\d{1,9}(?:\.\d{1,3})?$/.test(line.quantity),'DOCUMENT_INPUT_INVALID','Write each quantity as a number with at most three decimal places.');
  check(typeof line.unit==='string'&&/^\d{1,13}(?:\.\d{1,4})?$/.test(line.unit),'DOCUMENT_INPUT_INVALID','Write each unit amount as a plain number, like 450.50.');
  let unitMinor='';try{unitMinor=decimalMinor(line.unit,value.currency as string);}catch{check(false,'DOCUMENT_INPUT_INVALID','A unit amount has more decimal places than its currency.');}
  return {id:'line-'+(index+1),label:words(line.label,1,200,'Give each line a label.'),quantity:line.quantity,unitMinor,lineMinor:lineAmount(line.quantity,unitMinor)};
 });
 const totalMinor=String(lines.reduce((sum,line)=>sum+BigInt(line.lineMinor),0n)),rule='Each line is quantity times unit amount in minor units, rounded half up; the total adds the lines. BigInt only.';
 return {currency:value.currency,lines,totalMinor,rule,receiptId:'document_figures_'+digest({currency:value.currency,lines,totalMinor,rule})};
}
export function setFigures(body:DocumentBody,raw:unknown):DocumentBody{return changed(body,{figures:computeFigures(raw)});}

/** Every amount the figures receipt proves: each unit amount, line amount and the total, in its currency. */
function receipted(figures:DocumentFigures|null):Set<string>{
 if(!figures)return new Set();
 return new Set([figures.totalMinor,...figures.lines.flatMap(line=>[line.unitMinor,line.lineMinor])].map(minor=>figures.currency+':'+minor));
}
/** The amounts in a text that the figures receipt does not prove. */
export function unreceiptedAmounts(text:string,figures:DocumentFigures|null):string[]{
 const proven=receipted(figures);
 return moneyAmounts(text).filter(amount=>amount.minor===null||!proven.has(amount.currency+':'+amount.minor)).map(amount=>amount.text);
}
function requireReceipted(text:string,figures:DocumentFigures|null){const loose=unreceiptedAmounts(text,figures);check(!loose.length,'DOCUMENT_FIGURE_UNRECEIPTED',`Every amount comes from the figures table. Not on its receipt: ${loose.slice(0,5).join(', ')}.`);}

export function setSection(body:DocumentBody,sectionId:unknown,raw:unknown,author:'owner'|'agent'):DocumentBody{
 const section=body.sections.find(row=>row.id===sectionId);check(section,'DOCUMENT_NOT_FOUND','Choose a section of this document.');
 const text=typeof raw==='string'?raw.trim():'';check(text.length<=20000&&READABLE.test(text),'DOCUMENT_INPUT_INVALID','Keep a section to twenty thousand characters.');
 requireReceipted(text,body.figures);
 return {...structuredClone(body),sections:body.sections.map(row=>row.id===section.id?{...row,text,authoredBy:text?author:null}:{...row}),approval:null};
}

/** What the owner approves before AI work: the type, title, outline, sources and figures. */
export function briefDigestOf(body:DocumentBody):string{return digest({orderId:body.orderId,clientId:body.clientId,docType:body.docType,title:body.title,sourceFileIds:body.sourceFileIds,sourceDigest:body.sourceDigest,outline:body.sections.map(row=>({heading:row.heading,brief:row.brief})),figures:body.figures});}
export function briefApproved(body:DocumentBody):boolean{return body.briefApproval!==null&&body.briefApproval===briefDigestOf(body);}
export function approveBrief(body:DocumentBody):DocumentBody{return {...structuredClone(body),briefApproval:briefDigestOf(body)};}

/** What the owner approves before export: the brief and every section's words. */
export function documentDigestOf(body:DocumentBody):string{return digest({brief:briefDigestOf(body),sections:body.sections.map(row=>({id:row.id,text:row.text}))});}
export function documentApproved(body:DocumentBody):boolean{return briefApproved(body)&&body.approval!==null&&body.approval===documentDigestOf(body);}
export function approveDocument(body:DocumentBody):DocumentBody{
 check(briefApproved(body),'DOCUMENT_BRIEF_REQUIRED','Approve the outline, sources and figures first.');
 const empty=body.sections.filter(row=>!row.text.trim());check(!empty.length,'DOCUMENT_SECTION_REQUIRED',`Write every section first. Empty: ${empty.map(row=>row.heading).join(', ')}.`);
 for(const row of body.sections)requireReceipted(row.text,body.figures);
 return {...structuredClone(body),approval:documentDigestOf(body)};
}

/** An accepted edit is plain text: a line that is one of the outline's headings starts that section. */
export function sectionsFromText(text:string,headings:readonly string[]):{heading:string;parts:{kind:'text';text:string}[]}[]{
 const keys=new Map(headings.map(heading=>[heading.toLocaleLowerCase('en'),heading])),out:{heading:string;parts:{kind:'text';text:string}[]}[]=[];
 for(const line of text.split(/\r?\n/)){const heading=keys.get(line.trim().replace(/^#+\s*/,'').toLocaleLowerCase('en'));if(heading){out.push({heading,parts:[]});continue;}if(out.length&&line.trim())out.at(-1)!.parts.push({kind:'text',text:line.trim()});}
 return out;
}

/** A draft's words as lines: each section heading on its own line, then its text parts. Figure parts stay with the draft. */
export function draftLines(deliverable:{sections:readonly {heading:string;parts:readonly {kind:string;text?:string}[]}[]}):string{
 return deliverable.sections.flatMap(section=>[section.heading,...section.parts.flatMap(part=>part.kind==='text'&&typeof part.text==='string'?[part.text]:[])]).join('\n');
}

/** The accepted draft's words, matched to the outline: a line that is an outline heading starts that section. */
export function takeDraft(body:DocumentBody,runId:string,text:string):DocumentBody{
 check(briefApproved(body),'DOCUMENT_BRIEF_REQUIRED','Approve the outline, files and figures first.');
 const found=new Map(sectionsFromText(text,body.sections.map(row=>row.heading)).map(row=>[row.heading,row.parts.map(part=>part.text).join('\n').trim()]));
 const matched=body.sections.filter(row=>found.get(row.heading));
 check(matched.length>0,'DOCUMENT_SECTION_REQUIRED','The draft has none of the outline headings.');
 let next=structuredClone(body);
 for(const row of matched)next=setSection(next,row.id,found.get(row.heading),'agent');
 return {...next,takenFromRun:runId,approval:null};
}

/** The figures as lines of words, made by code from minor units: the owner form on the desk, the exact form in the exported document, which holds no engine label (C4 task 16: the receipt travels in the pack). */
export function figureLines(figures:DocumentFigures,form:'owner'|'exact'='owner'):string[]{
 const show=(minor:string)=>form==='exact'?formatMinor(minor,figures.currency):formatMoney(minor,figures.currency);
 return [...figures.lines.map(line=>`${line.label}: ${line.quantity} at ${show(line.unitMinor)} is ${show(line.lineMinor)}`),...(form==='exact'?[figureWords('Total',show(figures.totalMinor))]:[`Total: ${show(figures.totalMinor)}`,`Receipt ${figures.receiptId}`])];
}

/** The export pack's parts: the Word document, and the figures workbook, CSV and receipt when the document has figures. */
export function documentExportParts(body:DocumentBody):{docx:ZipEntry[];xlsx:ZipEntry[]|null;csv:string|null;receipt:string|null}{
 check(documentApproved(body),'DOCUMENT_APPROVAL_REQUIRED','Approve the finished document before exporting it.');
 const sections:PackSection[]=body.sections.map(row=>({heading:row.heading,paragraphs:row.text.split(/\n{2,}/).map(part=>part.trim()).filter(Boolean)}));
 if(body.figures)sections.push({heading:'Figures',paragraphs:figureLines(body.figures,'exact')});
 const cover=[DOCUMENT_TYPE_LABELS[body.docType],'Prepared for the owner\'s review. Every amount comes from the figures receipt.'];
 if(!body.figures)return {docx:docxEntries(body.title,cover,sections),xlsx:null,csv:null,receipt:null};
 const f=body.figures,digits=currencyMinorDigits(f.currency);
 const rows=[['Line','Quantity',`Unit (${f.currency})`,`Amount (${f.currency})`],...f.lines.map(line=>[line.label,line.quantity,formatMinor(line.unitMinor,f.currency),formatMinor(line.lineMinor,f.currency)]),['Total','','',formatMinor(f.totalMinor,f.currency)]];
 return {docx:docxEntries(body.title,cover,sections),
  xlsx:xlsxEntries([{name:'Figures',rows:[rows[0]!,...f.lines.map(line=>[line.label,line.quantity,{money:line.unitMinor,digits},{money:line.lineMinor,digits}]),['Total',null,null,{money:f.totalMinor,digits}]]}]),
  csv:csvText(rows),receipt:JSON.stringify({id:f.receiptId,currency:f.currency,lines:f.lines,totalMinor:f.totalMinor,rule:f.rule},null,2)};
}
