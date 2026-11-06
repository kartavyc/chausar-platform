// Original Chausar export adapters use shared OOXML, report and caption renderers. No external upload or save.
import {check} from '../../../portable.ts';
import {writeDocx} from '../kit/ooxml/docx.ts';
import {translationHtml} from './html.ts';
import {pdfOf} from '../kit/report/pdf.ts';
import {linesOf,toSrt,toVtt,validateCues,type CaptionCue} from '../kit/captions.ts';
import type {VentureDeps} from '../../contracts.ts';
import {translationView,type TranslationState} from './state.ts';
/** Use the shared caption timing profile on an exact sentence mapping, never merged target sentences. */
export function translationCues(job:TranslationState):CaptionCue[]{check(job.format==='subtitles','TRANSLATION_INPUT_INVALID','Choose a subtitle job.');return job.segments.map(s=>({id:s.id,startMs:s.startMs!,endMs:s.endMs!,lines:linesOf(s.target.split(/\s+/u),'web'),words:null}));}
/** Pause checks stay explicitly unavailable without word alignment. */
export function subtitleCheck(job:TranslationState){const cues=translationCues(job);return {...validateCues(cues,'web'),cues,sourceDigest:translationView(job).checks.sourceDigest};}
/** Returns bytes for a reviewed local save. A PDF fallback never pretends a PDF exists. */
export async function translationExport(deps:Pick<VentureDeps,'host'|'print'>,job:TranslationState,format:unknown){
 check(['html','docx','pdf','srt','vtt'].includes(String(format)),'TRANSLATION_INPUT_INVALID','Choose a supported export format.');check(translationView(job).canExport,'TRANSLATION_APPROVAL_REQUIRED','Approve this exact translation with the client before exporting.');
 let bytes:Uint8Array,mime:string,name:string,note:string|null=null;
 if(format==='srt'||format==='vtt'){const result=subtitleCheck(job);check(result.findings.length===0,'TRANSLATION_CHECK_FAILED','Fix subtitle timing and reading speed before export.');bytes=Buffer.from(format==='srt'?toSrt(result.cues):toVtt(result.cues),'utf8');mime=format==='srt'?'application/x-subrip':'text/vtt';name='translation.'+format;}
 else if(format==='docx'){bytes=writeDocx({cover:{title:'Translation'},sections:job.segments.map(s=>({heading:'',paragraphs:[s.target]}))});mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';name='translation.docx';}
 else {const html=translationHtml(job);const pdf=format==='pdf'?await pdfOf(deps,html):null;bytes=pdf?.pdf??Buffer.from(html,'utf8');note=pdf?.note??null;mime=pdf?.pdf?'application/pdf':'text/html';name=pdf?.pdf?'translation.pdf':'translation.html';}
 return {name,mime,contentBase64:Buffer.from(bytes).toString('base64'),note,saved:false,sent:false};
}
