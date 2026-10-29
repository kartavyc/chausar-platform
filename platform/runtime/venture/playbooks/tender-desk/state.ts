// Shared owner desk and demo transitions. Callers supply source-bound rows and authenticated authors.
import {check,digest} from '../../../portable.ts';
import {reassignTenderQuestion,setTenderAnswer,tenderControls,TENDER_KINDS,type TenderKind,type TenderQuestion} from './questions.ts';
import type {TenderQuestionBody} from './records.ts';
export function prepareTenderRows(input:{orderId:string;clientId:string;sourceDigest:string;selection:TenderQuestionBody['selection'];questions:readonly TenderQuestion[]}):TenderQuestionBody[]{
 check(input.orderId&&input.clientId&&input.sourceDigest&&input.questions.length>0&&input.questions.length<=500,'TENDER_INPUT_INVALID','Choose a client order and bounded source questions.');
 check(new Set(input.questions.map(row=>row.id)).size===input.questions.length,'TENDER_INPUT_INVALID','Each source question needs its own identity.');
 return input.questions.map(question=>({orderId:input.orderId,clientId:input.clientId,sourceDigest:input.sourceDigest,selection:structuredClone(input.selection),question:structuredClone(question),controls:{lengthWords:200,tone:'professional'},approval:null,aiRequest:null,aiCallIds:[]}));
}
export function changeTenderAnswer<T extends TenderQuestionBody>(row:T,answer:string,author:'owner'|'agent'):T{return {...row,question:setTenderAnswer(row.question,answer,author),approval:null,aiRequest:null};}
export function changeTenderType<T extends TenderQuestionBody>(row:T,kind:TenderKind):T{return {...row,question:reassignTenderQuestion(row.question,kind),approval:null,aiRequest:null};}
export function changeTenderControls<T extends TenderQuestionBody>(row:T,controls:unknown):T{return {...row,controls:tenderControls(controls),approval:null,aiRequest:null};}
function approvalOf(row:TenderQuestionBody){return digest({orderId:row.orderId,clientId:row.clientId,sourceDigest:row.sourceDigest,selection:row.selection,question:row.question,controls:row.controls});}
export function tenderApproved(row:TenderQuestionBody):boolean{return row.approval!==null&&row.approval===approvalOf(row);}
function forType(rows:readonly TenderQuestionBody[],kind:TenderKind){
 check(TENDER_KINDS.includes(kind),'TENDER_INPUT_INVALID','Choose an offered question type.');
 const selected=rows.filter(row=>row.question.kind===kind);
 check(selected.length>0,'TENDER_ANSWER_REQUIRED','This type has no answers to approve.');
 check(new Set(selected.map(row=>row.orderId+'|'+row.clientId+'|'+row.sourceDigest)).size===1,'TENDER_INPUT_INVALID','Approve answers from one current client order.');
 return selected;
}
export function tenderTypeDigest(rows:readonly TenderQuestionBody[],kind:TenderKind):string{return digest(forType(rows,kind).map(approvalOf));}
/** Validate the complete type before returning any signed row. Grounding is computed from current source bytes. */
export function approveTenderType<T extends TenderQuestionBody>(rows:readonly T[],kind:TenderKind,approvedDigest:string,grounded:(row:T)=>boolean):T[]{
 check(approvedDigest===tenderTypeDigest(rows,kind),'APPROVAL_CHANGED','Review these exact answers and their current sources before approving.');
 for(const row of rows.filter(row=>row.question.kind===kind)){
  check(row.question.answer.trim()&&row.question.authoredBy,'TENDER_ANSWER_REQUIRED','Write an answer for every question in this type.');
  check(row.question.answer.trim().split(/\s+/u).length<=row.controls.lengthWords,'TENDER_LENGTH_EXCEEDED','Shorten the answer to the selected word limit.');
  check(!row.question.ownerOnly||row.question.authoredBy==='owner','PRICING_OWNER_ONLY','Only the owner writes commercial and pricing answers.');
  check(grounded(row),'TENDER_GROUNDING_REQUIRED','Resolve the source gaps and unsupported claims before approving.');
 }
 return rows.map(row=>row.question.kind===kind?{...row,approval:approvalOf(row)}:{...row});
}
