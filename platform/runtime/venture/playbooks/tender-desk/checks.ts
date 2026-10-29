// Original final-artifact check. The owner desk holds answers and exports; a delivery run cannot rewrite them.
import {check,digest} from '../../../portable.ts';
import type {TenderQuestionBody} from './records.ts';
import {tenderApproved} from './state.ts';
import type {ArticleDelivery,ArticleOutput,ArticleToolCall} from '../podcast-to-article/delivery-types.ts';
export function tenderDelivery(rows:readonly TenderQuestionBody[]):ArticleOutput{
 check(rows.length>0&&rows.every(tenderApproved),'TENDER_APPROVAL_REQUIRED','Approve every current answer by type in the tender desk.');
 return {title:'Tender response pack',sections:[{heading:'Review',parts:[{kind:'text',text:'The current answers have owner approval by type. Open the tender desk to review and export the source-bound pack. Portal submission remains with the owner.'}]}],questionsForClient:[]};
}
export function tenderChecks(input:{deliverable:ArticleDelivery;toolCalls?:readonly ArticleToolCall[];tenderRows?:readonly TenderQuestionBody[]}){
 let pass=false;try{const held=[...(input.toolCalls??[])].reverse().find(call=>call.tool==='tender.ground'&&call.envelope.ok)?.envelope.result as {rows?:TenderQuestionBody[]}|undefined;
  pass=!!held?.rows&&(!Object.hasOwn(input,'tenderRows')||digest(held.rows)===digest(input.tenderRows))&&digest(input.deliverable)===digest(tenderDelivery(held.rows));
 }catch{}return [{playbook:'tender-desk',check:'tender-source',outcome:pass?'pass' as const:'fail' as const,detail:pass?'The report names the current approved tender pack.':'Use the current owner-approved desk pack without extra claims.'}];
}
