// Original Chausar offline translation document. No external assets, scripts or implied calculated figures.
import type {TranslationState} from './state.ts';
export const translationEscape=(value:string)=>value.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Source-derived translation is a quotation, not a new computed financial claim. Notes never enter the body. */
export function translationHtml(job:TranslationState):string{return '<!doctype html><html lang="'+translationEscape(job.targetLocale)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Translation</title></head><body><main>'+job.segments.map(s=>'<blockquote><p>'+translationEscape(s.target).replaceAll('\n','<br>')+'</p></blockquote>').join('')+'</main></body></html>\n';}
