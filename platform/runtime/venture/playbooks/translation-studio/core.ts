// Original Chausar checks. Index-Translate (Apache-2.0), easyread and Mimi (MIT) informed constraints, not copied code.
import {translationLanguageOptions} from './providers.ts';
import {check,digest} from '../../../portable.ts';
export type TranslationSegment={id:string;page:number;type:'paragraph'|'heading'|'sentence';source:string;target:string;probes:string[];ownerHash:string|null;startMs?:number;endMs?:number};
export type GlossaryTerm={source:string;target:string};
export type TranslationFinding={segmentId:string;code:string;detail:string};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const bounded=(s:unknown):s is string=>typeof s==='string'&&s.length<=50000;
const protectedParts=/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$|```[\s\S]*?```|`[^`\n]*`)/gu;
const prose=(s:string)=>s.split(protectedParts).filter((_,i)=>i%2===0).join(' ');
function spans(text:string,term:string,locale:string):{start:number;end:number}[]{
 check(bounded(text)&&typeof term==='string'&&term.trim().length>0&&term.length<=200,'TRANSLATION_INPUT_INVALID','Use bounded text and a nonempty term.');
 const words=[...new Intl.Segmenter(locale,{granularity:'word'}).segment(text)];
 const starts=new Set(words.filter(w=>w.isWordLike).map(w=>w.index)),ends=new Set(words.filter(w=>w.isWordLike).map(w=>w.index+w.segment.length));
 const out:{start:number;end:number}[]=[];let at=0;
 while((at=text.indexOf(term,at))>=0){if(starts.has(at)&&ends.has(at+term.length))out.push({start:at,end:at+term.length});at+=term.length;}
 return out;
}
/** Unicode word segmentation includes combining marks and rejects partial Hindi words. */
export function termCount(text:string,term:string,locale:string):number{return spans(text.normalize('NFC'),term.normalize('NFC'),locale).length;}
/** A source sentence is kept once, in source order; no model sentence boundary decides coverage. */
export function sourceSentences(text:string,locale:string):string[]{check(bounded(text),'TRANSLATION_INPUT_INVALID','Use bounded source text.');return [...new Intl.Segmenter(locale,{granularity:'sentence'}).segment(text)].map(s=>s.segment.trim()).filter(Boolean);}
/** Structural repair cannot remove, move, retype or empty a source block. */
export function repairSegments(original:readonly TranslationSegment[],repaired:readonly TranslationSegment[]):TranslationSegment[]{
 check(Array.isArray(repaired)&&repaired.length===original.length&&original.length>0&&original.length<=500,'TRANSLATION_REPAIR_LOSS','Keep every source block in order.');
 original.forEach((s,i)=>{const r=repaired[i];check(r&&r.id===s.id&&r.type===s.type&&r.page===s.page&&r.source===s.source&&r.startMs===s.startMs&&r.endMs===s.endMs&&bounded(r.target)&&(!s.source.trim()||r.target.trim())&&same(r.probes,s.probes),'TRANSLATION_REPAIR_LOSS','Keep the source identity, timing, probes and nonempty translation.');});
 return repaired.map(s=>({...s,probes:[...s.probes]}));
}
function keysOf(text:string):string[]|null{try{const root:unknown=JSON.parse(text);const out:string[]=[];const walk=(v:unknown,path:string)=>{if(Array.isArray(v)){out.push(path+'[]:'+v.length);v.forEach((x,i)=>walk(x,path+'['+i+']'));}else if(v&&typeof v==='object'){for(const key of Object.keys(v).sort()){const p=path+'/'+key;out.push(p);walk((v as Record<string,unknown>)[key],p);}}};walk(root,'');return out;}catch{return null;}}
/** Deterministic structure and explicit source probes only. Meaning still needs human and model review. */
export function checkTranslation(source:readonly TranslationSegment[],candidate:readonly TranslationSegment[],glossary:readonly GlossaryTerm[],sourceLocale:string,targetLocale:string):{pass:boolean;findings:TranslationFinding[];untranslatedPages:number[];meaning:'not-verified';sourceDigest:string}{
 const findings:TranslationFinding[]=[];try{repairSegments(source,candidate);}catch{return {pass:false,findings:source.map(s=>({segmentId:s.id,code:'TRANSLATION_REPAIR_LOSS',detail:'Keep every source block and nonempty translation.'})),untranslatedPages:[...new Set(source.map(s=>s.page))],meaning:'not-verified',sourceDigest:digest(source)};}
 for(let i=0;i<source.length;i++){const s=source[i]!,t=candidate[i]!.target;const fail=(code:string,detail:string)=>findings.push({segmentId:s.id,code,detail});
  for(const g of glossary){if(termCount(s.source,g.source,sourceLocale)>0&&termCount(t,g.target,targetLocale)===0)fail('TRANSLATION_GLOSSARY_MISSING',g.target);}
  const probes=[...s.probes,...s.source.matchAll(/[\p{N}]+(?:[.,:/-][\p{N}]+)*|\b[A-Z]{2,}[A-Z\d_-]*\b/gu)].map(v=>typeof v==='string'?v:v[0]);
  for(const p of new Set(probes))if(!t.includes(p))fail('TRANSLATION_PROBE_MISSING',p);
  const numbers=(x:string)=>[...x.matchAll(/[\p{N}]+(?:[.,:/-][\p{N}]+)*/gu)].map(m=>m[0]).sort();if(!same(numbers(s.source),numbers(t)))fail('TRANSLATION_NUMBERS','Keep each exact source number and occurrence.');
  if(s.type==='sentence'){
   if(sourceSentences(s.source,sourceLocale).length!==1||sourceSentences(t,targetLocale).length!==1)fail('TRANSLATION_SENTENCE_COUNT','Keep one target sentence for each source sentence.');
   const negation=(x:string,language:string)=>{const words=language.startsWith('hi')?['न','नहीं','मत']:language.startsWith('en')?['not','no','never','without']:[];return words.some(word=>termCount(x.toLocaleLowerCase(language),word,language)>0);};
   if(/^(en|hi)(-|$)/u.test(sourceLocale)&&/^(en|hi)(-|$)/u.test(targetLocale)&&negation(s.source,sourceLocale)!==negation(t,targetLocale))fail('TRANSLATION_NEGATION','Review the source negation before shortening.');
  }
  const sourceKeys=keysOf(s.source);if(/^[\s]*[\[{]/u.test(s.source)&&sourceKeys===null)fail('TRANSLATION_SOURCE_INVALID','The source looks like structured data but cannot be read as JSON. Ask the client to correct it.');if(sourceKeys&&!same(sourceKeys,keysOf(t)))fail('TRANSLATION_JSON_KEYS','Keep JSON keys and array lengths.');
  const tags=(x:string)=>[...x.matchAll(/<\/?[A-Za-z][^>]*>/gu)].map(v=>v[0]);if(!same(tags(s.source),tags(t)))fail('TRANSLATION_HTML_TAGS','Keep HTML tags and attributes in order.');
  const layout=(x:string)=>x.split('\n').map(line=>line.match(/^[\t ]*/u)![0]);if(!same(layout(s.source),layout(t)))fail('TRANSLATION_LAYOUT','Keep line breaks and indentation.');
  const social=(x:string)=>[...x.matchAll(/[#@][\p{L}\p{M}\p{N}_]+/gu)].map(v=>v[0]);if(!same(social(s.source),social(t)))fail('TRANSLATION_SOCIAL','Keep hashtags and mentions in order.');
 }
 return {pass:findings.length===0,findings,untranslatedPages:[...new Set(findings.map(f=>source.find(s=>s.id===f.segmentId)!.page))],meaning:'not-verified',sourceDigest:digest(source)};
}
/** Count-matched term repair touches prose only and never an owner-edited paragraph. */
export function swapTerm(input:{source:string;target:string;sourceTerm:string;oldTerm:string;preferred:string;longerTerms:string[];sourceLocale:string;targetLocale:string;ownerHash:string|null}):{target:string;changed:boolean}{
 const unchanged={target:input.target,changed:false};if(input.ownerHash!==null)return unchanged;
 const parts=input.target.split(protectedParts);const usable=(s:string)=>input.longerTerms.filter(t=>t!==input.oldTerm&&t.includes(input.oldTerm)).sort((a,b)=>b.length-a.length).reduce((v,t)=>v.replaceAll(t,' '.repeat(t.length)),s);
 const count=parts.filter((_,i)=>i%2===0).reduce((n,s)=>n+termCount(usable(s),input.oldTerm,input.targetLocale),0);
 if(count===0||count!==termCount(prose(input.source),input.sourceTerm,input.sourceLocale))return unchanged;
 const target=parts.map((part,i)=>{if(i%2)return part;let out=part;for(const hit of spans(usable(part),input.oldTerm,input.targetLocale).reverse())out=out.slice(0,hit.start)+input.preferred+out.slice(hit.end);return out;}).join('');return {target,changed:target!==input.target};
}
/** No current Chausar model route is certified local. Manual text stays on this device. */
export function providerRoute(input:{private:boolean;provider:string;source:string;target:string;declared:readonly string[]}):{support:'manual'|'unknown';leavesDevice:boolean;line:string}{
 check(!input.private||input.provider==='manual-local','PRIVATE_NEEDS_LOCAL','This private job needs a local model. Use the local review sheet meanwhile.');
 const languages=translationLanguageOptions(input.provider);check(languages===null||languages.includes(input.source)&&languages.includes(input.target),'TRANSLATION_LANGUAGE_UNSUPPORTED','Choose languages supported by this translation provider.');
 if(input.provider==='manual-local')return {support:'manual',leavesDevice:false,line:'Paste a translation made locally; no model is called.'};
 return {support:'unknown',leavesDevice:true,line:'Model language support is unknown. Check your service documentation.'};
}
