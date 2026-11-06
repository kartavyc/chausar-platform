// Original Chausar live social plan checks. Owner approval stamps minimal history inside its transaction.
import {check,type State} from '../../../contracts.ts';
import type {DeliveryRunRecord,OrderRecord,VentureRecord,PlaybookCheckResult} from '../../contracts.ts';
import {digest,listRecords,findRecord,type VentureTx} from '../../records.ts';
import type {FlagshipCheckInput} from '../draft-checks.ts';
import {clientDraft} from '../../build/draft-text.ts';
import {actualSocialPosts} from './post-label.ts';
import {analyseSocialPostPlan,type SocialHookHistory,type SocialSlotContext} from './slot-plan-core.ts';
export type {SocialHookHistory,SocialSlotContext} from './slot-plan-core.ts';
type Result=Omit<PlaybookCheckResult,'playbook'>;
const WEEK=7*86400000;
const postsOf=actualSocialPosts;
/** History is read only from current business/client orders; callers cannot supply it through a tool. */
export function socialSlotContext(state:State,venture:VentureRecord,order:OrderRecord,now:string,runId:string|null=null):SocialSlotContext{
 const history=listRecords(state,'venture-order',venture.id).filter(item=>item.clientId===order.clientId).flatMap(item=>item.socialPostHistory??[]).filter(item=>item.runId!==runId&&Date.parse(now)-Date.parse(item.approvedAt)<WEEK);
 return {now,runId,history};
}
/** Final drafts always run this check, even when the model did not call social.slots. */
export function socialSlotChecks(input:FlagshipCheckInput):Result[]{
 if(input.offerKey==='monthly-report'||input.stageId&&['voice','calendar','report'].includes(input.stageId))return [];
 const text=input.deliverable.sections.map(section=>'## '+section.heading+'\n'+section.parts.filter(part=>part.kind==='text').map(part=>part.text).join('\n')).join('\n');
 const posts=postsOf(text);if(!posts.length&&input.stageId!=='drafts')return [];
 return analyseSocialPostPlan(text,input.intake,input.socialSlotContext??{now:input.today+'T00:00:00.000Z',runId:null,history:[]}).checks;
}
/** Recheck exact accepted words against current history, then stamp the history atomically with approval. */
export function keepSocialPostPlan(tx:VentureTx,run:DeliveryRunRecord):void{
 if(run.practice||!['accepted','edited'].includes(run.status))return;
 const playbook=findRecord(tx.state,'venture-playbook',run.playbookId);if(playbook?.flagship!=='social-agency')return;
 const order=tx.find('venture-order',run.orderId);check(order&&order.ventureId===tx.venture!.id,'ORDER_NOT_FOUND','That order was not found.');
 const stage=order.socialChain?.stages[(run.chainStage??1)-1];if(stage&&['voice','calendar','report'].includes(stage))return;
 const text=clientDraft(run).text??'',posts=postsOf(text);if(!posts.length&&stage!=='drafts')return;
 const result=analyseSocialPostPlan(text,order.intake,socialSlotContext(tx.state,tx.venture!,order,tx.now,run.id));
 const failed=result.checks.find(item=>item.outcome==='fail');check(!failed,'SOCIAL_POST_PLAN_INVALID',failed?.detail??'Review the exact post plan.');
 const retained=(order.socialPostHistory??[]).filter(item=>item.runId!==run.id&&Date.parse(tx.now)-Date.parse(item.approvedAt)<WEEK);
 const added=result.plan.map((row,index)=>({runId:run.id,postId:row.postId,textDigest:digest({channel:posts[index].channel,text:posts[index].text}),hookFormula:row.hookFormula,approvedAt:tx.now}));
 check(retained.length+added.length<=1000,'SOCIAL_POST_PLAN_INVALID','The recent client hook history is full. Wait until older approvals leave the seven-day window.');
 for(const prior of listRecords(tx.state,'venture-order',tx.venture!.id)){
  if(prior.id===order.id||!prior.socialPostHistory?.length)continue;
  const recent=prior.socialPostHistory.filter(item=>Date.parse(tx.now)-Date.parse(item.approvedAt)<WEEK);
  if(recent.length!==prior.socialPostHistory.length)tx.replace({...prior,socialPostHistory:recent});
 }
 tx.replace({...order,socialPostHistory:[...retained,...added]});
}
