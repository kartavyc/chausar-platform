// Original final article checks. A model cannot add claims in headings, companions or delivery notes.
import type {ArticleOutput,ArticleCheckInput,ArticleCheckResult} from './delivery-types.ts';

import type {ArticleLedgerBody,ArticleBundle} from './records.ts';
import {parseArticleBundle,checkArticleBundle} from './state.ts';
import {articleDeliveryNote} from './notes.ts';
import {articleAngles} from './angles.ts';
export function articleNoteText(record:ArticleLedgerBody){const note=articleDeliveryNote(record);return [note.perspective,note.backgroundAdded,note.factsNotVerified,...note.framesToCapture.map(frame=>[frame.timecode,frame.source,frame.line].join(' ')),...note.manualChecks].filter(Boolean).join('\n');}
export function articleDeliverable(record:ArticleLedgerBody,bundle:ArticleBundle):ArticleOutput{return {title:bundle.title,sections:[...bundle.sections,{heading:'Show notes',text:bundle.showNotes},{heading:'Newsletter blurb',text:bundle.newsletterBlurb},{heading:'Delivery note',text:articleNoteText(record)}].map(section=>({heading:section.heading,parts:[{kind:'text',text:section.text}]})),questionsForClient:[]};}
export const articleChecks=(input:ArticleCheckInput):ArticleCheckResult[]=>{
 const call=[...(input.toolCalls??[])].reverse().find(call=>call.tool==='article.ledger'&&call.envelope.ok),result=call?.envelope.ok?call.envelope.result as {record?:ArticleLedgerBody}:null,record=result?.record;
 const fail=(detail:string):ArticleCheckResult[]=>[{playbook:'podcast-to-article',check:'article-evidence',outcome:'fail',detail}];
 if(Object.hasOwn(input,'articleRecord')){const current=input.articleRecord,identity=(row:ArticleLedgerBody)=>({orderId:row.orderId,clientId:row.clientId,source:row.source,intake:row.intakeDigest,facts:row.facts,selection:row.selection});if(!current||!record||JSON.stringify(identity(current))!==JSON.stringify(identity(record)))return fail('The episode or approved outline changed after the tool read it. Read the current source before drafting.');}
 if(input.stageId==='angles'){if(!record)return fail('Read the current episode ledger before proposing directions.');try{articleAngles(record,input.deliverable);return [{playbook:'podcast-to-article',check:'article-evidence',outcome:'pass',detail:'The proposed directions and reasons cite the current episode. Owner choice is still required.'}];}catch{return fail('Resolve source citations and attribution in the proposed directions.');}}
 if(!record?.selection)return fail('Read this order episode ledger and approved outline before drafting.');
 try{const d=input.deliverable,n=record.selection.sections.length,parts=d.sections;
  if(parts.length!==n+3||parts.some(section=>section.parts.length!==1||section.parts[0]?.kind!=='text')||d.questionsForClient.length||d.attachments?.length||d.estimate||d.quoteFixes?.length)return fail('Use the exact approved outline and plain source-cited text, with no additional claims.');
  const body=(index:number)=>{const part=parts[index]!.parts[0]!;return part.kind==='text'?part.text??'':'';};
  if(parts[n]!.heading!=='Show notes'||parts[n+1]!.heading!=='Newsletter blurb'||parts[n+2]!.heading!=='Delivery note'||body(n+2)!==articleNoteText(record))return fail('Keep the code-generated delivery note and the named companion sections.');
  const bundle=parseArticleBundle({title:d.title,sections:parts.slice(0,n).map((section,index)=>({heading:section.heading,text:body(index)})),showNotes:body(n),newsletterBlurb:body(n+1)}),checks=checkArticleBundle(record,bundle);
  return [{playbook:'podcast-to-article',check:'article-evidence',outcome:checks.pass?'pass':'fail',detail:checks.pass?'Every article sentence and companion uses the episode ledger and the approved structure.':'Resolve episode citations, speaker attribution, exact quotations and house-style checks.'}];
 }catch{return fail('The current episode evidence could not validate this article.');}
};
