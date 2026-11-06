// Original fact-ledger and sentence coverage checks after podcast-to-article (MIT), ideas only.
import type {ArticleParagraph} from './prep.ts';
import {requireArticle} from './core.ts';
export type ArticleFact={id:string;topic:string;paragraphId:string;speaker:string|null;timecode:string|null;startMs:number|null;text:string};
const sentences=(text:string)=>[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(s=>s.segment.trim()).filter(Boolean);
/** Every initial fact is a literal sentence from the cleaned transcript, never an inferred claim. */
export function factLedger(paragraphs:readonly ArticleParagraph[]):ArticleFact[]{const facts:ArticleFact[]=[];for(const p of paragraphs)for(const text of sentences(p.text)){facts.push({id:'L'+(facts.length+1),topic:text.split(/\s+/).slice(0,7).join(' ').slice(0,100),paragraphId:p.id,speaker:p.speaker,timecode:p.timecode,startMs:p.startMs,text});}requireArticle(facts.length>0&&facts.length<=30000,'ARTICLE_SOURCE_REQUIRED','The transcript needs readable evidence.');return facts;}
export type CitedSentence={text:string;ids:string[]};
/** A marker belongs to exactly one sentence. Dangling words, unknown IDs and uncited endings fail closed. */
export function checkLedgerCitations(text:string,ledger:readonly ArticleFact[]){const ids=new Set(ledger.map(f=>f.id)),found:CitedSentence[]=[],errors:string[]=[];let cursor=0;const pattern=/\[(L\d+(?:\s*,\s*L\d+)*)\]/g;for(const match of text.matchAll(pattern)){const words=text.slice(cursor,match.index).trim(),refs=match[1]!.split(/\s*,\s*/);if(!words||sentences(words).length!==1)errors.push('one-citation-per-sentence');if(refs.some(id=>!ids.has(id)))errors.push('unknown-ledger-id');found.push({text:words,ids:refs});cursor=match.index!+match[0].length;}if(text.slice(cursor).trim()||!found.length)errors.push('uncited-sentence');return {pass:errors.length===0,sentences:found,errors:[...new Set(errors)]};}
