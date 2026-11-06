// Original question ledger after Countersign's AGPL workflow ideas. No source code copied.
import {check,digest} from '../../../portable.ts';
import {hasTenderMoney} from './money.ts';
export const TENDER_KINDS=['narrative','technical','compliance','commercial'] as const;
export type TenderKind=typeof TENDER_KINDS[number];
export const TENDER_TONES=['consultative','formal','professional','technical'] as const;
export type TenderTone=typeof TENDER_TONES[number];
export type TenderQuestion={id:string;sourceRef:string;question:string;kind:TenderKind;classifiedAs:TenderKind;ownerOnly:boolean;answer:string;authoredBy:'owner'|'agent'|null};
function words(value:unknown,max:number,code='TENDER_INPUT_INVALID'):asserts value is string{
 check(typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),code,'Use bounded readable tender text.');
}
/** Commercial rules win even when a question also mentions a technical standard. */
export function classifyTenderQuestion(question:string):{kind:TenderKind;by:'code'}{
 words(question,20000);
 const kind:TenderKind=/\b(price|pricing|prices|cost|costs|quote|quotation|fee|fees|commercial|budget|payment terms|bid (?:amount|value)|discount|rate card|hourly rate|day rate|daily rate|unit rate|rate per unit)\b|कीमत|मूल्य|शुल्क|भुगतान|बोली राशि|प्रति (?:घंटा|इकाई|दिन) दर/iu.test(question)?'commercial':
  /^(?:\d+[.)]\s*)?(?:are|is|do|does|can|will|have|has)\b|\b(compliance|comply|certif(?:ied|ication)|yes\s*[/o]r?\s*no|ISO\s*\d|SOC\s*\d)\b|क्या|अनुपालन|प्रमाणित/iu.test(question)?'compliance':
  /\b(API|architecture|integration|encryption|security|database|technical|uptime|protocol|infrastructure|backup)\b|तकनीकी|सुरक्षा|एकीकरण/iu.test(question)?'technical':'narrative';
 return {kind,by:'code'};
}
/** Import one source question per nonempty line; spreadsheet rows use the separate explicit column map. */
export function extractTenderQuestions(text:string,sourceId:string):TenderQuestion[]{
 words(text,200000,'TENDER_SOURCE_REQUIRED');words(sourceId,200);
 const rows=text.split(/\r?\n/).flatMap((line,index)=>{const question=line.trim();if(!question)return [];words(question,4000);const sourceRef=sourceId+':'+(index+1),{kind}=classifyTenderQuestion(question);return [{id:'tender_q_'+digest({sourceRef,question}).slice(0,24),sourceRef,question,kind,classifiedAs:kind,ownerOnly:kind==='commercial',answer:'',authoredBy:null} satisfies TenderQuestion];});
 check(rows.length>0&&rows.length<=500,'TENDER_INPUT_INVALID','Use one to five hundred tender questions.');return rows;
}
/** A mapped issuer cell is one complete question, including every line and commercial qualifier. */
export function tenderQuestionFromCell(text:string,sourceRef:string):TenderQuestion{
 words(text,4000);words(sourceRef,200);const question=text.trim(),{kind}=classifyTenderQuestion(question);
 return {id:'tender_q_'+digest({sourceRef,question}).slice(0,24),sourceRef,question,kind,classifiedAs:kind,ownerOnly:kind==='commercial',answer:'',authoredBy:null};
}
/** Owner controls remain two fields, never a model instruction or a price. */
export function tenderControls(raw:unknown):{lengthWords:number;tone:TenderTone}{
 check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')==='lengthWords,tone','TENDER_INPUT_INVALID','Set only the answer length and tone.');
 const value=raw as {lengthWords:number;tone:TenderTone};
 check(Number.isSafeInteger(value.lengthWords)&&value.lengthWords>=20&&value.lengthWords<=1000&&TENDER_TONES.includes(value.tone),'TENDER_INPUT_INVALID','Choose twenty to one thousand words and an offered tone.');
 return {lengthWords:value.lengthWords,tone:value.tone};
}
function ownerOnly(row:TenderQuestion):boolean{return row.ownerOnly||row.classifiedAs==='commercial'||row.kind==='commercial'||classifyTenderQuestion(row.question).kind==='commercial';}
/** Reclassification changes presentation, never the owner-only provenance of a commercial question. */
export function reassignTenderQuestion(row:TenderQuestion,kind:TenderKind):TenderQuestion{
 check(TENDER_KINDS.includes(kind),'TENDER_INPUT_INVALID','Choose an offered question type.');
 return {...structuredClone(row),kind,ownerOnly:ownerOnly(row)||kind==='commercial',answer:'',authoredBy:null};
}
/** The caller supplies the authenticated author path; model arguments never grant owner authorship. */
export function setTenderAnswer(row:TenderQuestion,answer:string,author:'owner'|'agent'):TenderQuestion{
 words(answer,20000);check(author==='owner'||author==='agent','TENDER_INPUT_INVALID','Use the authenticated author path.');
 check(author==='owner'||!ownerOnly(row),'PRICING_OWNER_ONLY','Only the owner writes commercial and pricing answers.');
 check(author==='owner'||classifyTenderQuestion(answer).kind!=='commercial'&&!hasTenderMoney(answer),'PRICING_OWNER_ONLY','Only the owner writes commercial and pricing answers.');
 return {...structuredClone(row),ownerOnly:ownerOnly(row),answer:answer.trim(),authoredBy:author};
}
