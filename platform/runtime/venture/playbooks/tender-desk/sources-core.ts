// Original current-byte source policy shared by native and browser tender desks. Ports only decode formats.
import {check,digest} from '../../../portable.ts';
import type {TenderSourceSelection} from './records.ts';
import type {IssuerTenderRow} from './export-core.ts';
export type TenderSourceOrder={id:string;clientId:string;status:string;intake?:{fields?:Record<string,unknown>}|null};
export type TenderSourceFile={id:string;name:string;format:string;contentBase64:string;digest:string;scope:{kind:string;orderId?:string}};
export type TenderSourceReader={find(kind:'venture-order',id:string):TenderSourceOrder|undefined;find(kind:'venture-upload',id:string):TenderSourceFile|undefined};
export type TenderSourcePorts={decode(value:string):Uint8Array;pdfText(file:TenderSourceFile):Promise<string>;readXlsx(bytes:Uint8Array):Promise<{sheets:{name:string;rows:string[][]}[]}>;readIssuer(bytes:Uint8Array,map:unknown):Promise<IssuerTenderRow[]>};
/** Exact public payload grammar shared with the rehearsal desk. */
export function exactTender(raw:unknown,allowed:readonly string[],required:readonly string[]=[]):Record<string,unknown>{check(raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&[Object.prototype,null].includes(Object.getPrototypeOf(raw)),'INVALID_VENTURE_REQUEST','Send one request object.');const p=raw as Record<string,unknown>;check(Object.keys(p).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(p,k)),'INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');return p;}
const exactPayload=exactTender;
function equal(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function selection(raw:unknown):TenderSourceSelection{
 const p=exactPayload(raw,['rfpFileId','documentFileIds','issuerFileId','mapping'],['rfpFileId','documentFileIds','issuerFileId','mapping']);
 check([p.rfpFileId,p.issuerFileId].every(id=>id===null||typeof id==='string'&&id.length>0&&id.length<=100),'TENDER_SOURCE_REQUIRED','Choose source files attached to this order.');
 check(Array.isArray(p.documentFileIds)&&p.documentFileIds.length>0&&p.documentFileIds.length<=10&&new Set(p.documentFileIds).size===p.documentFileIds.length&&p.documentFileIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=100),'TENDER_SOURCE_REQUIRED','Choose one to ten distinct client source documents.');
 check(!p.documentFileIds.includes(p.rfpFileId)&&!p.documentFileIds.includes(p.issuerFileId),'TENDER_SOURCE_REQUIRED','The RFP and issuer workbook cannot be their own evidence. Choose separate client documents.');
 return structuredClone(p) as TenderSourceSelection;
}
export async function loadTenderSourcesCore(ports:TenderSourcePorts,read:TenderSourceReader,orderId:string,raw:unknown){
 const selected=selection(raw),original=read.find('venture-order',orderId);
 check(original&&original.status!=='cancelled'&&original.clientId,'ORDER_NOT_FOUND','Choose a current client tender order.');
 const order=structuredClone(original);
 const files=new Map<string,TenderSourceFile>();let total=0;
 function file(id:string){const old=files.get(id);if(old)return old;const found=read.find('venture-upload',id);check(found&&found.scope.kind==='order'&&found.scope.orderId===orderId,'TENDER_SOURCE_REQUIRED','Use only files attached to this client order.');
  const bytes=ports.decode(found.contentBase64);total+=bytes.length;check(bytes.length>0&&bytes.length<=1500000&&total<=5000000,'TENDER_SOURCE_REQUIRED','Keep the tender source bucket within five megabytes.');const snapshot=structuredClone(found);files.set(id,snapshot);return snapshot;}
 async function text(upload:TenderSourceFile){const bytes=ports.decode(upload.contentBase64);let value:string;
  if(upload.format==='pdf'){value=await ports.pdfText({...upload,digest:digest(upload.contentBase64)});}
  else if(upload.format==='xlsx')value=(await ports.readXlsx(bytes)).sheets.flatMap(sheet=>[sheet.name,...sheet.rows.map(row=>row.join(' | '))]).join('\n');
  else{check(['csv','transcript'].includes(upload.format),'TENDER_SOURCE_REQUIRED','Use text, CSV, XLSX or a readable PDF on desktop.');try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{check(false,'TENDER_SOURCE_REQUIRED','Use readable UTF-8 source text.');}}
  check(value!.trim()&&value!.length<=200000,'TENDER_SOURCE_REQUIRED','Use readable source text below two hundred thousand characters.');return value!;}
 const documents=[];for(const id of selected.documentFileIds)documents.push({id,text:await text(file(id))});
 check(documents.reduce((count,document)=>count+document.text.length,0)<=1000000,'TENDER_SOURCE_REQUIRED','Keep the source documents within one million text characters.');
 let rfpText=typeof order.intake?.fields?.rfpText==='string'?order.intake.fields.rfpText.trim():'';
 let mappedRows:IssuerTenderRow[]=[];
 const rfp=selected.rfpFileId?file(selected.rfpFileId):null,issuer=selected.issuerFileId?file(selected.issuerFileId):null;
 check(selected.documentFileIds.every(id=>[rfp,issuer].every(source=>!source||!equal(ports.decode(file(id).contentBase64),ports.decode(source.contentBase64)))),'TENDER_SOURCE_REQUIRED','A copy of the RFP cannot prove its own requirements. Choose separate client evidence.');
 if(rfp){check(!rfpText,'TENDER_SOURCE_REQUIRED','Choose pasted RFP text or an RFP file, not both.');if(rfp.format==='xlsx'){check(selected.mapping,'TENDER_COLUMN_MAP_REQUIRED','Map the question and answer columns before importing this workbook.');mappedRows=await ports.readIssuer(ports.decode(rfp.contentBase64),selected.mapping);rfpText=mappedRows.map(row=>row.question).join('\n');}else rfpText=await text(rfp);}
 if(issuer){check(issuer.format==='xlsx'&&selected.mapping,'TENDER_COLUMN_MAP_REQUIRED','Choose an XLSX issuer workbook and map its question and answer columns.');const issuerRows=await ports.readIssuer(ports.decode(issuer.contentBase64),selected.mapping);check(!rfpText||rfp?.id===issuer.id,'TENDER_INPUT_INVALID','When filling an issuer workbook, import its mapped questions as the RFP.');mappedRows=issuerRows;rfpText=issuerRows.map(row=>row.question).join('\n');}
 check(rfpText.trim()&&rfpText.length<=200000,'TENDER_SOURCE_REQUIRED','Paste the RFP questions or choose their source file.');
 check(documents.every(document=>document.text.trim()!==rfpText.trim()),'TENDER_SOURCE_REQUIRED','The RFP questions cannot be their own source evidence.');
 const current=read.find('venture-order',orderId);
 check(current&&digest(current)===digest(order),'DERIVED_STALE','The client order changed while its sources were being read. Read them again.');
 for(const snapshot of files.values()){const currentFile=read.find('venture-upload',snapshot.id);check(currentFile&&digest(currentFile)===digest(snapshot),'DERIVED_STALE','A source file changed while it was being read. Read the current sources again.');}
 const sourceDigest=digest({orderId,clientId:order.clientId,intake:order.intake,selection:selected,files:[...files.values()].map(item=>({id:item.id,name:item.name,format:item.format,scope:item.scope,bytes:item.contentBase64}))});
 return {order,selection:selected,documents,rfpText,mappedRows,issuer,digest:sourceDigest};
}
