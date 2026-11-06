// Original career file renderer uses the kit's real DOCX and desktop PDF ports. No file is sent or saved outside Chausar.
import {createHash} from 'node:crypto';
import type {VentureDeps} from '../../contracts.ts';
import {writeDocx} from '../kit/ooxml/docx.ts';
import {pdfOf} from '../kit/report/pdf.ts';
import type {CareerPackKind} from './pack.ts';
import type {CareerPackFile} from './file-types.ts';
import type {CareerResearchPackInput} from './research-pack.ts';
const escaped=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const file=(name:string,mime:string,bytes:Uint8Array):CareerPackFile=>({name,mime,contentBase64:Buffer.from(bytes).toString('base64'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
export async function renderCareerFiles(deps:Pick<VentureDeps,'host'|'print'>,kind:CareerPackKind|CareerResearchPackInput['kind'],text:string){
 const docx=writeDocx({cover:{title:'Career pack'},sections:[{heading:'Approved evidence',paragraphs:text.split('\n')}]});
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>Career pack</title><body><h1>Career pack</h1>'+text.split('\n').map(line=>'<p>'+escaped(line)+'</p>').join('')+'</body></html>';
 const pdf=await pdfOf(deps,html);
 return {files:[file(kind+'.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx),pdf.pdf?file(kind+'.pdf','application/pdf',pdf.pdf):file(kind+'.html','text/html',Buffer.from(html,'utf8'))],note:pdf.note};
}
