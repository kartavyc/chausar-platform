import { articleDeliverable } from '../../../../platform/runtime/venture/playbooks/podcast-to-article/checks';
import type { ArticleLedgerBody } from '../../../../platform/runtime/venture/playbooks/podcast-to-article/records';
/** Explicit model completion sample for desk import/check tests, never a shipped fake model. */
export function completedArticleFixture(record: ArticleLedgerBody, stage: 1 | 2) {
  const facts = stage === 1 ? record.facts : record.selection!.sections.map(topic => record.facts.find(fact => fact.topic === topic)!);
  const deliverable = stage === 1 ? { title:'Episode directions',sections:facts.slice(0,3).map((f,i)=>({heading:'Direction '+(i+1),parts:[{kind:'text' as const,text:(f.speaker?f.speaker+': ':'')+f.topic+'. ['+f.id+']'},{kind:'text' as const,text:(f.speaker?f.speaker+': ':'')+f.text+' ['+f.id+']'}]})),questionsForClient:[] } : articleDeliverable(record, {title:record.selection!.title,sections:facts.map((f,i)=>({heading:record.selection!.sections[i]!,text:(f.speaker?f.speaker+': ':'')+(i<3?'"'+f.text.split(' ').slice(0,8).join(' ')+'" '+f.text.split(' ').slice(8).join(' '):f.text)+' ['+f.id+']'})),showNotes:(facts[0]!.speaker?facts[0]!.speaker+': ':'')+facts[0]!.text+' ['+facts[0]!.id+']',newsletterBlurb:(facts[1]!.speaker?facts[1]!.speaker+': ':'')+facts[1]!.text+' ['+facts[1]!.id+']'});
  return {id:'fixture-article-'+stage,orderId:record.orderId,status:'ready-for-review',chainStage:stage,deliverable,harness:{toolCalls:[{tool:'article.ledger',envelope:{ok:true as const,result:{record:structuredClone(record)}}}]}};
}
