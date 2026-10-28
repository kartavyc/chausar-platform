// Original Chausar typed baseline cases call the same source checks as the saved desk.
import {checkTranslation,type TranslationSegment} from './core.ts';
import type {KitBaselineCase,KitCheck} from '../kit/define.ts';
import {subtitleCheck} from './export.ts';
import {newTranslation} from './state.ts';
const row=(source:string,target:string):TranslationSegment=>({id:'p1',page:1,type:'paragraph',source,target,probes:[],ownerHash:null});
const cases=[
 ['glossary-term-missing',row('Invoice 42','बिल 42'),[{source:'Invoice',target:'बिल'}]],
 ['subtitle-merged-sentences',row('Do not pay 42.','42 का भुगतान न करें।'),[]],
 ['number-dropped',row('Invoice 42','बिल 42'),[]],
 ['hindi-legal-letter',row('Please acknowledge notice 42.','कृपया नोटिस 42 की प्राप्ति स्वीकार करें।'),[]],
] as const;
export const TRANSLATION_CASES:KitBaselineCase[]=cases.map(([id,segment,glossary])=>({id,request:'Keep every source block and its protected facts.',draft:JSON.stringify([segment]),meta:{source:JSON.stringify([segment]),glossary:JSON.stringify(glossary)}}));
const subtitleRows=[{...row('Do not pay 42.','42 का भुगतान न करें।'),id:'s1',type:'sentence' as const,startMs:0,endMs:4000},{...row('Wait here.','यहाँ प्रतीक्षा करें।'),id:'s2',type:'sentence' as const,startMs:4200,endMs:6500}];
Object.assign(TRANSLATION_CASES[1]!,{draft:JSON.stringify(subtitleRows),meta:{source:JSON.stringify(subtitleRows),glossary:'[]',format:'subtitles'}});
export function scoreTranslationBaseline(_test:KitBaselineCase,draft:string,meta:Readonly<Record<string,string>>){try{const source=JSON.parse(meta.source??'') as TranslationSegment[],target=JSON.parse(draft) as TranslationSegment[],out=checkTranslation(source,target,JSON.parse(meta.glossary??''),'en','hi');let pass=out.pass;if(pass&&meta.format==='subtitles'){const job=newTranslation({orderId:'baseline',clientId:'sample',rights:'own-footage',sourceLocale:'en',targetLocale:'hi',private:true,format:'subtitles',source:source.map(({target:_target,ownerHash:_owner,...s})=>s)});pass=subtitleCheck({...job,segments:target}).findings.length===0;}return {pass,why:pass?'Source structure and locked terms are present.':'A source block, protected fact or glossary term changed.'};}catch{return {pass:false,why:'The typed source or translation is invalid.'};}}
/** Generic drafts cannot certify the saved translation; tools and the owner must check source-bound rows. */
export const translationDraftCheck:KitCheck=()=>[{playbook:'translation-studio',check:'translation-source-review',outcome:'fail',detail:'This generic run is a planning artifact only. Prepare and review the source-bound bilingual sheet before any client delivery.'}];
