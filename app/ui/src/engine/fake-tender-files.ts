// Original browser format ports for tender sources and exports. No provider is contacted.
import {tenderMoneyReceipts} from '../../../../platform/runtime/venture/playbooks/tender-desk/money';
import {check} from '../../../../platform/runtime/portable';
import {EngineError,type OrderLite} from './types';
import type {W4DeskHost} from './fake-w4';
import {loadTenderSourcesCore,type TenderSourceReader} from '../../../../platform/runtime/venture/playbooks/tender-desk/sources-core';
import {tenderColumnMap,readIssuerTenderParts,fillIssuerTenderParts,tenderExportParts} from '../../../../platform/runtime/venture/playbooks/tender-desk/export-core';
import {unzipBrowser,storedZipBytes} from '../../../../platform/runtime/venture/playbooks/kit/ooxml/browser';
import {scanZip} from '../../../../platform/runtime/venture/playbooks/kit/ooxml/zip-core';
import {readXlsxParts} from '../../../../platform/runtime/venture/playbooks/kit/ooxml/read-parts';
import type {TenderQuestionBody} from '../../../../platform/runtime/venture/playbooks/tender-desk/records';
const encode=(bytes:Uint8Array)=>{let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);};
// Match Node's accepted base64 spellings for existing upload records, including omitted padding.
const decode=(value:string)=>{const clean=value.split('=')[0]!.replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/]/g,'');return Uint8Array.from(atob(clean.length%4===1?clean.slice(0,-1):clean),c=>c.charCodeAt(0));};
async function issuer(bytes:Uint8Array,map:unknown){tenderColumnMap(map);check(bytes.length>0&&bytes.length<=8000000,'TENDER_EXPORT_INVALID','Use an issuer workbook below eight megabytes.');const limits={maxEntries:1000,maxBytes:32000000};return {parts:await unzipBrowser(bytes,limits),count:scanZip(bytes,limits).count};}
/** Read live fake host files through exactly the native source policy. */
export async function fakeTenderSources(host:W4DeskHost,orderId:string,selection:unknown){
 const read={find:(kind:string,id:string)=>kind==='venture-order'?(host.ask('venture.order.list',{}) as OrderLite[]).find(o=>o.id===id):(host.orderFiles?.(orderId)??[]).map(f=>({...f,scope:{kind:'order',orderId}})).find(f=>f.id===id)} as TenderSourceReader;
 return loadTenderSourcesCore({decode,pdfText:async()=>{if(host.hosted())throw new EngineError('TIER_UNAVAILABLE',"The shared hosted server can't read PDFs: that needs Chausar's Python helper, which never runs there. Add the bills as CSV or XLSX, or use the desktop app.");throw new EngineError('TOOL_FAILED','Reading PDFs needs the Python helper, which is not set up on this computer.');},readXlsx:async bytes=>readXlsxParts(await unzipBrowser(bytes)),readIssuer:async(bytes,map)=>{const s=await issuer(bytes,map);return readIssuerTenderParts(s.parts,s.count,map);}},read,orderId,selection);
}
/** Genuine Office files with the same document content and issuer-cell refusal policy as native. */
export async function fakeTenderExport(rows:readonly TenderQuestionBody[],source:Awaited<ReturnType<typeof fakeTenderSources>>){
 const pack=tenderExportParts({title:'Tender response',coverLines:['Prepared for owner review and manual submission.','Commercial answers are written and priced by the owner.'],rows:rows.map(r=>({id:r.question.id,kind:r.question.kind,question:r.question.question,answer:r.question.answer}))});
 const files=[{name:'tender-response.docx',bytes:storedZipBytes(pack.docx)},{name:'tender-response.xlsx',bytes:storedZipBytes(pack.xlsx)},{name:'compliance-matrix.csv',bytes:new TextEncoder().encode(pack.csv)}];
 const receipts=rows.flatMap(r=>tenderMoneyReceipts(r.question.answer,source.documents).receipts.map(receipt=>({...receipt,questionId:r.question.id})));if(receipts.length)files.push({name:'price-receipts.json',bytes:new TextEncoder().encode(JSON.stringify(receipts,null,2))});
 if(source.issuer){check(source.mappedRows.length===rows.length,'DERIVED_STALE','The issuer question mapping changed. Import it again.');const parsed=await issuer(decode(source.issuer.contentBase64),source.selection.mapping);files.push({name:'issuer-filled.xlsx',bytes:storedZipBytes(fillIssuerTenderParts(parsed.parts,parsed.count,source.selection.mapping,source.mappedRows.map((r,i)=>({row:r.row,answer:rows[i]!.question.answer}))))});}
 return {files:files.map(f=>({name:f.name,bytes:f.bytes.length,contentBase64:encode(f.bytes)})),submitted:false,manualPath:'Review the exported pack and submit it yourself on the issuer portal.'};
}
