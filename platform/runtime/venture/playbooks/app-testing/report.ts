// Original app test report renderer over the existing A5 DOCX and trusted PDF print ports.
import {createHash} from 'node:crypto';import type {VentureDeps} from '../../contracts.ts';import {writeDocx} from '../kit/ooxml/docx.ts';import {pdfOf} from '../kit/report/pdf.ts';import type {appTestReport} from './report-core.ts';
const escaped=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const file=(name:string,mime:string,bytes:Uint8Array)=>({name,mime,contentBase64:Buffer.from(bytes).toString('base64'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
/** Produce genuine files without sending, saving outside Chausar, or claiming a PDF when printing is unavailable. */
export async function renderAppTestReport(deps:Pick<VentureDeps,'host'|'print'>,report:ReturnType<typeof appTestReport>){
 const paragraphs=report.text.split('\n'),docx=writeDocx({cover:{title:'App test report'},sections:[{heading:'Reviewed test evidence',paragraphs}]}),html='<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>App test report</title><body><h1>App test report</h1>'+paragraphs.map(s=>'<p>'+escaped(s)+'</p>').join('')+'</body></html>',pdf=await pdfOf(deps,html);
 return {digest:report.digest,sourceDigest:report.sourceDigest,files:[file('app-test-report.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx),pdf.pdf?file('app-test-report.pdf','application/pdf',pdf.pdf):file('app-test-report.html','text/html',Buffer.from(html))],note:pdf.note};
}
