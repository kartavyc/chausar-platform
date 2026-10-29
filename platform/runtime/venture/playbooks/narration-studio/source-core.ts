// Original current-byte manuscript and permission boundary shared by native and browser format adapters.
import {check,digest} from '../../../portable.ts';
export type NarrationSourceOrder={id:string;clientId:string;status:string;narrationFetched?:{fileId:string;url:string;finalUrl:string;digest:string};intake?:{fields?:Record<string,unknown>;rights?:{basis:string;holder:string;reference:string|null;scope:string|null;expiresOn:string|null}|null}|null};
export type NarrationSourceFile={id:string;name:string;format:string;contentBase64:string;scope:{kind:string;orderId?:string}};
export type NarrationSourceReader={find(kind:'venture-order',id:string):NarrationSourceOrder|undefined;find(kind:'venture-upload',id:string):NarrationSourceFile|undefined};
export type NarrationSourcePorts={decode(value:string):Uint8Array;docx(bytes:Uint8Array):Promise<{paragraphs:string[]}>};
/** A licence must expressly cover narration. A creator clip programme never supplies audiobook rights. */
export function narrationRights(order:NarrationSourceOrder,today:string){const r=order.intake?.rights;
 check(r&&typeof r.holder==='string'&&r.holder.trim()&&['own-footage','licence'].includes(r.basis),'RIGHTS_REQUIRED','Record the manuscript owner or a narration licence.');
 check(r.basis==='own-footage'||typeof r.reference==='string'&&r.reference.trim()&&typeof r.scope==='string'&&/narrat|audio\s?book|voice\s?over|वाचन|ऑडियो\s?बुक|कथन/iu.test(r.scope),'RIGHTS_REQUIRED','The written licence must cover narration or audiobooks.');
 check(r.expiresOn===null||/^\d{4}-\d{2}-\d{2}$/.test(r.expiresOn)&&Number.isFinite(Date.parse(r.expiresOn))&&new Date(r.expiresOn).toISOString().slice(0,10)===r.expiresOn&&r.expiresOn>=today,'RIGHTS_REQUIRED','The manuscript licence expired. Record current rights.');return r;
}
/** Format parsing cannot substitute for authority: recheck the original file and live client after every async read. */
export async function loadNarrationSource(ports:NarrationSourcePorts,read:NarrationSourceReader,orderId:string,fileId:string,today:string){
 const original=read.find('venture-order',orderId);check(original&&original.status!=='cancelled'&&original.clientId,'ORDER_NOT_FOUND','Choose a current narration order.');const order=structuredClone(original);narrationRights(order,today);
 const originalFile=read.find('venture-upload',fileId);check(originalFile&&originalFile.scope.kind==='order'&&originalFile.scope.orderId===orderId,'NARRATION_SOURCE_REQUIRED','Choose a manuscript attached to this client order.');const file=structuredClone(originalFile),bytes=ports.decode(file.contentBase64);check(bytes.length>0&&bytes.length<=2000000,'NARRATION_SOURCE_REQUIRED','Use a manuscript up to two megabytes.');let text:string;
 if(file.format==='docx'&&/\.docx$/i.test(file.name))text=(await ports.docx(bytes)).paragraphs.join('\n\n');
 else{check(['csv','transcript'].includes(file.format)&&/\.(txt|md|markdown)$/i.test(file.name),'NARRATION_SOURCE_REQUIRED','Use a TXT, Markdown or DOCX manuscript.');try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{check(false,'NARRATION_SOURCE_REQUIRED','Use readable UTF-8 manuscript text.');}}
 check(text!.trim()&&text!.length<=500000,'NARRATION_SOURCE_REQUIRED','Use a nonempty manuscript within the narration limit.');
 check(digest(read.find('venture-order',orderId)??null)===digest(order)&&digest(read.find('venture-upload',fileId)??null)===digest(file),'DERIVED_STALE','The manuscript, client or permissions changed while reading. Import again.');
 return {order,file,text:text!,digest:digest({order,bytes:Array.from(bytes)})};
}
