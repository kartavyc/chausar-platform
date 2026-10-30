// Pure exact-text slot checks shared by real approval and browser rehearsal.
import {actualSocialPosts,type ActualSocialPost} from './post-label.ts';
import {readPostPlan,postPlanLines,type PostPlan} from './post-plan.ts';
import {socialSlots} from './slot-kinds.ts';
import {hookVariety} from './hook-variety.ts';
import {planCalendar,type CalendarInput} from './calendar-core.ts';
export type SocialHookHistory={runId:string;postId:string;textDigest:string;hookFormula:string;approvedAt:string};
export type SocialSlotContext={now:string;runId:string|null;history:SocialHookHistory[]};
export type SocialPlanIntake={fields?:Record<string,unknown>;calendar?:CalendarInput}|null|undefined;
type Post=ActualSocialPost;
type Result={check:string;outcome:'pass'|'fail';detail:string};
function analyse(posts:Post[],lines:string[],intake:SocialPlanIntake,context:SocialSlotContext):{checks:Result[];plan:PostPlan[]}{
 const failure=(detail:string)=>({checks:['selling-share','one-goal','hook-variety'].map(check=>({check,outcome:'fail' as const,detail})),plan:[]});
 try{
  const plan=readPostPlan(lines,posts.map(post=>post.id));
  const raw=intake?.fields?.sellingCap;
  const cap=raw===undefined?20:typeof raw==='string'&&/^\d{1,3}$/.test(raw)?Number(raw):NaN;
  const dates=new Map<string,string>();
  let slots=plan.map(row=>({id:row.postId,kind:row.kind,goals:row.goals,actions:row.actions}));
  if(intake?.calendar){
   const calendar=planCalendar(intake.calendar),used=new Set<string>();
   slots=slots.map((slot,index)=>{const matching=calendar.find(item=>item.channel===posts[index]!.channel&&!used.has(item.id));if(!matching)throw new Error('Each post must fill one code-created calendar slot.');used.add(matching.id);dates.set(plan[index]!.postId,matching.date+'T00:00:00.000Z');return {...slot,id:matching.id};});
   if(used.size!==calendar.length)throw new Error('Every code-created calendar slot needs exactly one post and plan.');
  }
  const checked=socialSlots(slots,cap);
  const history=context.history.map(item=>({formula:item.hookFormula,at:item.approvedAt}));
  let hooks=true;
  const inPack:{formula:string;at:string}[]=[];
  for(const row of [...plan].sort((a,b)=>(dates.get(a.postId)??context.now).localeCompare(dates.get(b.postId)??context.now))){
   const at=dates.get(row.postId)??context.now;
   if(!hookVariety(row.hookFormula,history,context.now).passed||!hookVariety(row.hookFormula,inPack,at).passed)hooks=false;
   inPack.push({formula:row.hookFormula,at});
  }
  return {plan,checks:[{check:'selling-share',outcome:checked.findings.some(f=>f.check==='selling-share')?'fail':'pass',detail:checked.findings.find(f=>f.check==='selling-share')?.line??'The actual post plan is within the owner selling cap.'},{check:'one-goal',outcome:checked.findings.some(f=>f.check==='one-goal')?'fail':'pass',detail:checked.findings.find(f=>f.check==='one-goal')?.line??'Each actual post has one goal and one reader action.'},{check:'hook-variety',outcome:hooks?'pass':'fail',detail:hooks?'These hooks do not repeat approved client hooks within seven days.':'Use different hook formulas from this pack and the client posts approved in the past seven days.'}]};
 }catch(error){return failure((error as Error).message);}
}
export function analyseSocialPostPlan(text:string,intake:SocialPlanIntake,context:SocialSlotContext){
 const posts=actualSocialPosts(text);return {...analyse(posts,postPlanLines(text),intake,context),posts};
}
