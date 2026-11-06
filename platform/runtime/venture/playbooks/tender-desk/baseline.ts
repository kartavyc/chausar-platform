// Source-executed tender baseline. Original code after Countersign workflow ideas, no AGPL code.
import type {KitBaselineCase} from '../kit/define.ts';
import {groundTenderAnswer} from './ground.ts';
import {extractTenderQuestions,setTenderAnswer} from './questions.ts';
export function scoreTenderBaseline(item:KitBaselineCase,draft:string){let pass=false;try{
 const source=JSON.parse(item.meta?.source??'null');if(!source||!Array.isArray(source.documents))throw Error('Source required');
 const question=extractTenderQuestions(source.question,'baseline')[0]!;
 if(item.id==='gap-not-yes'){const result=groundTenderAnswer(source.question,source.answer,source.documents);pass=result.gap&&result.affirmativeGap&&/source gap/i.test(draft);}
 if(item.id==='iso-number-not-in-docs'){const result=groundTenderAnswer(source.question,source.answer,source.documents);pass=result.claims.some(claim=>!claim.matched&&claim.kind==='certification')&&/unsupported/i.test(draft);}
 if(item.id==='pricing-left-to-owner'){try{setTenderAnswer(question,source.answer,'agent');}catch(error){pass=(error as {code?:string}).code==='PRICING_OWNER_ONLY'&&/owner/i.test(draft);}}
 }catch{pass=false;}return {pass,why:pass?'The source-bound refusal ran.':'The expected source boundary was not demonstrated.'};}
