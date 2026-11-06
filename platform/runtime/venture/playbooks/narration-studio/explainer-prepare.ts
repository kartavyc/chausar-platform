// Shared exact fetched-source and quoted-line preparation.
import {sha256} from '@noble/hashes/sha2.js';import {bytesToHex} from '@noble/hashes/utils.js';import {check} from '../../../portable.ts';
import {explainerQuotes,type ExplainerQuote} from './explainer.ts';import {prepareNarrationRows} from './state.ts';import type {NarrationSourceOrder,NarrationSourceFile} from './source-core.ts';
export function prepareExplainerRows(source:{order:NarrationSourceOrder;file:NarrationSourceFile;text:string;digest:string},voice:string,language:string,raw:unknown){
 const saved=source.order.narrationFetched as {fileId?:unknown;url?:unknown;digest?:unknown}|undefined;
 const hash=bytesToHex(sha256(Uint8Array.from(atob(source.file.contentBase64),c=>c.charCodeAt(0))));check(saved&&saved.fileId===source.file.id&&typeof saved.url==='string'&&saved.digest===hash,'DERIVED_STALE','Fetch the current rights-cleared source before choosing quoted lines.');
 const quoted=explainerQuotes(source.text,raw as ExplainerQuote[]);check(quoted.lines.length<=30,'EXPLAINER_QUOTE_REQUIRED','Choose at most thirty short quoted lines.');
 return quoted.lines.map((quote,sequence)=>{check(!/[\\{}]|[\u0000-\u001f\u007f]/u.test(quote.text),'EXPLAINER_QUOTE_REQUIRED','Choose a plain quoted span without markup or subtitle controls.');const rows=prepareNarrationRows({orderId:source.order.id,clientId:source.order.clientId,sourceDigest:source.digest,fileId:source.file.id,destination:'client',source:quote.text,voice,language});const row=rows[0];check(rows.length===1&&row&&row.segment.text===quote.text,'EXPLAINER_QUOTE_REQUIRED','Choose one short, plain quoted span for each narration segment.');return {...row,sequence,explainer:{url:saved.url as string,quote}};});
}
