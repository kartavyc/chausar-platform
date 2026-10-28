import {actualSocialPostLocations} from '../../../../platform/runtime/venture/playbooks/social/post-label';
import {ghostwritingTextChecks} from '../../../../platform/runtime/venture/playbooks/social/ghostwriting-core';
import {socialLegalBlock} from '../../../../platform/runtime/venture/playbooks/social/legal-confirmation';
import {repurposeCoverage} from '../../../../platform/runtime/venture/playbooks/social/repurpose-coverage';
// Demo writing stages share the engine stage order and report arithmetic. No model or publishing calls.
import {ghostwritingSections} from '../../../../platform/runtime/venture/playbooks/social/structures-data';
import {analyseSocialPostPlan,type SocialHookHistory,type SocialPlanIntake} from '../../../../platform/runtime/venture/playbooks/social/slot-plan-core';
import {planCalendar} from '../../../../platform/runtime/venture/playbooks/social/calendar-core';
import {HOOK_FORMULAS} from '../../../../platform/runtime/venture/playbooks/social/post-plan';
import {socialStages} from '../../../../platform/runtime/venture/playbooks/social/stages';
import {fakeSocialSteps as SOCIAL_STEPS} from './fake-social-plan';
import {createReportComputer,type ExportPlatform} from '../../../../platform/runtime/venture/playbooks/social/report-core';
import {csvRows} from '../../../../platform/runtime/csv';
import {EngineError,type DeliveryLite,type OrderLite,type OrderChainView,type QueueRow,type QueueItemView} from './types';
import type {FakeForgottenPerson} from './fake-playbooks';
import type {WorkHost} from './fake-work';
type Pin={offerKey:string;stages:string[];brand:string;stage:number;state:'running'|'done'|'stopped';since:string;voice:{runId:string;text:string;digest:string}|null};
type SocialRun=DeliveryLite&{chainStage:number;preview:{digest:string;input:Record<string,unknown>}|null};
type Source={id:string;name:string;format:string;contentBase64:string;digest:string};
type Hooks={orders():OrderLite[];deliveries():DeliveryLite[];files(orderId:string):Source[];keep(run:DeliveryLite):void;eraseFiles(ids:ReadonlySet<string>):void;next(orderId:string):void};
const exact=(p:Record<string,unknown>,allowed:string[],required:string[])=>{if(Object.keys(p).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(p,k)))throw new EngineError('INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');};
const clone=<T>(value:T):T=>structuredClone(value);
export class FakeSocialChain {
 private readonly history=new Map<string,(SocialHookHistory&{clientId:string;orderId:string})[]>();
 private readonly pins=new Map<string,Pin>();
 private readonly sourcePins=new Map<string,string>();
 private readonly reports=new Map<string,ReturnType<ReturnType<typeof createReportComputer>['monthlyReport']>>();
 constructor(private host:WorkHost,private hooks:Hooks){}
 private key(id:string){return this.host.current()+':'+id;}
 private digest(value:unknown){return this.host.fingerprint?.(JSON.stringify(value))??JSON.stringify(value);}
 private checkLegal(order:OrderLite){
  const venture=this.host.ask?.('venture.get',{}) as {venture?:{country?:{code?:string};launchStage?:string}}|null|undefined;
  const client=this.host.clients().find(row=>row.id===order.clientId);
  const reason=socialLegalBlock({countries:[venture?.venture?.country?.code,client?.countryCode],rehearsal:venture?.venture?.launchStage==='shadow',paid:order.intake?.paidPromotion===true,synthetic:order.intake?.aiVoice===true||order.intake?.aiPresenter===true});
  if(reason)throw new EngineError('RULE_UNCONFIRMED',reason);
 }
 private brand(clientId:string){
  const kit=this.host.ask?.('venture.brandKit.get',{clientId}) as {resolved?:unknown}|undefined;
  const voice=this.host.ask?.('venture.voice.get',{}) as {voices?:{on:boolean}[]}|undefined;
  return this.digest({kit:kit?.resolved??null,voice:voice?.voices?.filter(v=>v.on)??[]});
 }
 private pin(order:OrderLite):Pin|null{
  if(this.host.plan()?.playbook?.id!=='social-agency')return null;
  const known=this.pins.get(this.key(order.id)),brand=this.brand(order.clientId);if(known?.brand===brand)return known;
  if(known)for(const run of this.hooks.deliveries().filter(r=>r.orderId===order.id&&['waiting-for-you','ready-for-review','brief-waiting','needs-answer'].includes(r.status))){run.status='stopped';run.awaitingYou=false;(run as SocialRun).preview=null;this.clearRow(run.id);}
  const offerKey=this.host.plan()?.blueprint.offers.find(o=>o.id===order.offerId)?.playbookOffer;if(!offerKey)return null;
  const stages=known?.stages??[...socialStages(offerKey)];
  const reusable=this.hooks.orders().filter(o=>o.clientId===order.clientId).map(o=>this.pins.get(this.key(o.id))).find(p=>p?.brand===brand&&p.voice&&this.hooks.deliveries().some(r=>r.id===p.voice!.runId&&!r.practice&&['accepted','edited'].includes(r.status)));
  const voice=reusable?.voice??null,pin:Pin={offerKey,stages,brand,voice:clone(voice),stage:voice&&stages[0]==='voice'?2:1,state:'running',since:this.host.now()};
  this.pins.set(this.key(order.id),pin);return pin;
 }
 private report(order:OrderLite){
  const month=order.intake?.fields?.reportMonth;
  if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))throw new EngineError('SOCIAL_REPORT_MONTH_REQUIRED','Choose the export month as YYYY-MM.');
  const files=this.hooks.files(order.id);if(!files.length||files.length>2)throw new EngineError('SOCIAL_EXPORTS_REQUIRED','Add one supported CSV export per platform before writing the report.');
  const entries=files.map(file=>{
   if(file.format!=='csv')throw new EngineError('SOCIAL_EXPORTS_REQUIRED','Add the original Instagram or LinkedIn CSV export.');
   const text=new TextDecoder().decode(Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)));let header:string[]=[];
   try{header=csvRows(text)[0]??[];}catch{throw new EngineError('SOCIAL_EXPORTS_REQUIRED','The platform export CSV is malformed.');}
   const ig=header.includes('Post ID')&&header.includes('Publish time'),li=header.includes('Update link')&&header.includes('Created date');
   if(ig===li)throw new EngineError('SOCIAL_EXPORTS_REQUIRED','The export must have the exact headers of one supported platform.');
   return {file:{id:file.id,name:file.name,text},platform:(ig?'instagram':'linkedin') as ExportPlatform};
  });
  if(new Set(entries.map(e=>e.platform)).size!==entries.length)throw new EngineError('TOOL_FAILED','Give one export for each platform: each platform is worked out once for the month.');
  return createReportComputer({text:s=>this.host.fingerprint?.(s)??s,value:v=>this.digest(v),error:(code,message)=>new EngineError(code,message)}).monthlyReport({month,files:entries});
 }
 start(order:OrderLite,id:string):SocialRun|null{
  const pin=this.pin(order);if(!pin)return null;
  this.checkLegal(order);
  const report=pin.offerKey==='monthly-report'?this.report(order):null;
  const input={orderId:order.id,stageId:pin.stages[pin.stage-1],request:order.request,...(pin.voice?{approvedClientVoice:clone(pin.voice)}:{}),...(report?{report}:{})};
  const run:SocialRun={id,at:this.host.now(),orderId:order.id,status:'waiting-for-you',practice:false,deliverable:null,verdict:null,awaitingYou:true,chainStage:pin.stage,preview:{digest:this.digest(input).padStart(64,'0'),input}};
  this.sourcePins.set(this.key(id),this.digest(this.hooks.files(order.id).map(f=>({id:f.id,digest:f.digest}))));
  if(report)this.reports.set(this.key(id),report);
  this.hooks.keep(run);this.row(run);return clone(run);
 }
 view(orderId:string):OrderChainView|null{
  const order=this.hooks.orders().find(o=>o.id===orderId);if(!order||this.host.plan()?.playbook?.id!=='social-agency')return null;const offerKey=this.host.plan()?.blueprint.offers.find(o=>o.id===order.offerId)?.playbookOffer;if(!offerKey)return null;const pin=this.pins.get(this.key(orderId))??{offerKey,stages:[...socialStages(offerKey)],stage:1,state:'running' as const,since:null};
  const reportReady=this.hooks.deliveries().some(r=>r.orderId===orderId&&this.reports.has(this.key(r.id)));
  return {orderId,playbook:'social-agency',offerKey:pin.offerKey,stage:pin.stage,of:pin.stages.length,line:`Stage ${pin.stage} of ${pin.stages.length}`,state:pin.state,since:pin.since,note:null,stages:pin.stages.map((id,i)=>{const step=SOCIAL_STEPS.find(s=>s.id===id)!;return {n:i+1,stepId:id,title:step.title,produces:step.produces,state:pin.state==='done'||i+1<pin.stage?'done':i+1===pin.stage?'now':'not-started',manualPath:null};}),...(pin.offerKey==='monthly-report'?{prerequisites:[{stepId:'collect-exports',title:'Client exports',state:this.hooks.files(orderId).length?'done':'waiting'},{stepId:'figures',title:'Figures from code receipts',state:reportReady?'done':'waiting'}],approval:{stepId:'approve-report',title:'Owner approval',state:pin.state==='done'?'done':'waiting'}}:{})};
 }
 request(method:string,p:Record<string,unknown>):DeliveryLite{
  const run=this.hooks.deliveries().find(r=>r.id===p.runId) as SocialRun|undefined;
  if(!run||run.chainStage===undefined)throw new EngineError('DELIVERY_NOT_FOUND','That draft reply was not found.');
  const order=this.hooks.orders().find(o=>o.id===run.orderId)!;const pin=this.pins.get(this.key(order.id))!;
  if(p.verdict!=='rejected')this.checkLegal(order);
  if(p.verdict!=='rejected'&&pin.brand!==this.brand(order.clientId))throw new EngineError('SOCIAL_VOICE_CHANGED','The client brand or business voice changed. Start this order again to approve a fresh voice sheet.');
  if(method==='venture.delivery.approve'){
   exact(p,['runId','digest'],['runId','digest']);if(typeof p.digest!=='string'||!/^[a-f0-9]{64}$/.test(p.digest))throw new EngineError('INVALID_VENTURE_REQUEST','Send the digest of the text you approved.');
   if(run.status!=='waiting-for-you'||!run.preview)throw new EngineError('DELIVERY_NOT_WAITING','This draft reply is not waiting for your approval.');
   if(run.preview.digest!==p.digest)throw new EngineError('APPROVAL_STALE','This changed since you read it. Read it again.');
   if(this.sourcePins.get(this.key(run.id))!==this.digest(this.hooks.files(order.id).map(f=>({id:f.id,digest:f.digest}))))throw new EngineError('APPROVAL_STALE','The order files changed. Start a new run and read its preview.');
   const revision=run.preview.input.socialRevision as {n:number;originalText:string}|undefined;
   const stage=pin.stages[run.chainStage-1],title=`Demo ${stage}`;
   run.renderedText=stage==='voice'?'Demo voice sheet\nVoice: Warm, plain, and useful.\nPillars: Practical client guidance.\nWords to avoid: Inflated claims.':stage==='calendar'?'Demo calendar\nCalendar: Useful client topics.\nTopics and hooks: A practical first step.':stage==='report'?'Demo monthly report\nSummary: The figures come from the supplied export.\nWhat the figures show: Read the attached code receipts.\nWhat we will try next: Keep the next posts useful.':'Demo drafts\nLinkedIn: Share a useful practical lesson.';
   if(stage==='report'){const report=this.reports.get(this.key(run.id));run.renderedText+='\n'+(report?.receipts.map(r=>`${r.label}: ${r.display} [${r.id}]`).join('\n')??'');}
   if(['drafts','creative-briefs'].includes(stage!))run.renderedText=this.demoPosts(order,pin);
   if(revision){const location=actualSocialPostLocations(revision.originalText)[revision.n-1];if(!location)throw new EngineError('SOCIAL_REVISION_SHAPE','The selected post is missing.');const pieces=revision.originalText.split(/(\r\n|\n)/);const line=pieces[location.lineIndex*2]!;const prefix=/^(\s*[^:]+:\s*)/.exec(line)![1];pieces[location.lineIndex*2]=prefix+'Demo revision: '+location.text+(/\s*$/.exec(line)?.[0]??'');run.renderedText=pieces.join('');run.editedText=null;}
   const validation=this.plan(run,order,pin,run.renderedText??'');run.playbookChecks=validation?.checks.map(c=>({...c,playbook:'social-agency'}))??[];
   run.deliverable={title};run.status='ready-for-review';run.canAccept=!(run.playbookChecks.some(c=>c.outcome==='fail'));run.writtenBy='Demo draft';run.preview=null;
   const running=this.host.runs().find(r=>r.runId===run.id);if(running){running.state='waiting';running.progress={done:1,total:1};}
   this.row(run);return clone(run);
  }
  exact(p,['runId','verdict','reason','editedText'],['runId','verdict']);
  if(!['accepted','edited','rejected'].includes(String(p.verdict)))throw new EngineError('INVALID_VENTURE_REQUEST','Choose accept, edit or reject.');
  if(run.status!=='ready-for-review')throw new EngineError('DELIVERY_NOT_READY','This draft reply is not ready for review.');
  if(p.reason!==undefined&&(typeof p.reason!=='string'||!['wrong-fact','missing-fact','missing-section','off-brief','tone','format','too-long','too-short','wrong-number','late','claims-work-not-done','other'].includes(p.reason)))throw new EngineError('INVALID_VENTURE_REQUEST','Choose a reason from the list.');
  if(p.verdict==='rejected'&&!p.reason)throw new EngineError('INVALID_VENTURE_REQUEST','Choose why you reject this draft.');
  if(p.verdict==='edited'&&(typeof p.editedText!=='string'||!p.editedText.trim()||p.editedText.trim().length>20000))throw new EngineError('INVALID_VENTURE_REQUEST','Write the edited draft.');
  if(p.verdict!=='edited'&&p.editedText!==undefined||p.verdict==='accepted'&&p.reason!==undefined)throw new EngineError('INVALID_VENTURE_REQUEST','Send only fields for this decision.');
  const chosen=p.verdict==='edited'?(p.editedText as string).trim():run.editedText??run.renderedText??'';
  const validation=p.verdict==='rejected'?null:this.plan(run,order,pin,chosen);const failed=validation?.checks.find(c=>c.outcome==='fail');if(failed)throw new EngineError('SOCIAL_POST_PLAN_INVALID',failed.detail);
  if(validation){const kept=(this.history.get(this.host.current())??[]).filter(item=>item.runId!==run.id&&Date.parse(this.host.now())-Date.parse(item.approvedAt)<7*86400000);if(kept.filter(item=>item.orderId===order.id).length+validation.plan.length>1000)throw new EngineError('SOCIAL_POST_PLAN_INVALID','The recent client hook history is full. Wait until older approvals leave the seven-day window.');for(const row of validation.plan){const post=validation.posts.find(p=>p.id===row.postId)!;kept.push({clientId:order.clientId,orderId:order.id,runId:run.id,postId:post.id,textDigest:this.digest({channel:post.channel,text:post.text}),hookFormula:row.hookFormula,approvedAt:this.host.now()});}this.history.set(this.host.current(),kept);}
  run.status=p.verdict as 'accepted'|'edited'|'rejected';run.verdict={choice:run.status,at:this.host.now()};run.awaitingYou=false;
  if(run.status==='edited')run.editedText=(p.editedText as string).trim();this.clearRow(run.id);const running=this.host.runs().find(r=>r.runId===run.id);if(running)running.state='done';
  if(run.status!=='rejected'&&pin.stage===run.chainStage){
   if(pin.stages[pin.stage-1]==='voice')pin.voice={runId:run.id,text:run.editedText??run.renderedText??'',digest:this.digest(run.editedText??run.renderedText)};
   if(pin.stage<pin.stages.length){pin.stage++;this.hooks.next(order.id);}else pin.state='done';pin.since=this.host.now();
  }
  this.host.emit({type:'chain.changed',businessId:this.host.current(),at:this.host.now(),runId:run.id});return clone(run);
 }
 private recent(order:OrderLite,runId:string|null){return (this.history.get(this.host.current())??[]).filter(row=>row.clientId===order.clientId&&row.runId!==runId&&Date.parse(this.host.now())-Date.parse(row.approvedAt)<7*86400000);}
 private plan(run:SocialRun,order:OrderLite,pin:Pin,text:string){
  const stage=pin.stages[run.chainStage-1];if(!['drafts','creative-briefs'].includes(stage??''))return null;
  const result=analyseSocialPostPlan(text,order.intake as SocialPlanIntake,{now:this.host.now(),runId:run.id,history:this.recent(order,run.id)});
  if(pin.offerKey==='repurpose-pack')result.checks.push(repurposeCoverage(text,order.intake?.fields?.channels));
  if(pin.offerKey==='linkedin-ghostwriting')result.checks.push(...ghostwritingTextChecks(text,order.intake?.fields?.postCount));
  return result;
 }
 private demoPosts(order:OrderLite,pin:Pin):string{
  const intake=order.intake as SocialPlanIntake,ghost=pin.offerKey==='linkedin-ghostwriting';
  const headings=ghost?ghostwritingSections(intake):[];
  const channels=ghost?headings.map(()=> 'linkedin'):intake?.calendar?planCalendar(intake.calendar).map(slot=>slot.channel):Array.isArray(intake?.fields?.channels)?intake.fields.channels as string[]:['linkedin'];
  const history=new Set(this.recent(order,null).map(row=>row.hookFormula)),available=HOOK_FORMULAS.filter(h=>!history.has(h));
  const label=(channel:string)=>channel==='linkedin'?'LinkedIn':channel==='x'?'X':channel==='youtube-shorts'?'YouTube Shorts':channel.charAt(0).toUpperCase()+channel.slice(1);
  const posts=channels.map((channel,i)=>(ghost?'## '+headings[i]+'\n':'')+label(channel)+': Share a useful practical lesson.');
  const plans=channels.map((_,i)=>'Post '+(i+1)+' | Value | Goal: Teach a useful idea | Reader action: Try it | Hook: '+(available[i%Math.max(1,available.length)]??HOOK_FORMULAS[i%HOOK_FORMULAS.length]));
  return '# Demo drafts\n\n'+(ghost?'':'## Drafts\n')+posts.join('\n\n')+'\n\n## Post plan\n'+plans.join('\n')+(pin.offerKey==='repurpose-pack'?'\n\n## Newsletter blurb\nDemo newsletter: Share a useful practical lesson.':'');
 }
 forgetPeople(people:readonly FakeForgottenPerson[],erase:boolean):void{
  if(!erase)return;
            const parts = new Set<string>();
            for (const person of people)
                for (const raw of person.names) {
                    const name = raw.trim();
                    if (!name || name.includes('@') || name.startsWith('+') || name.startsWith('http'))
                        continue;
                    parts.add(name);
                    for (const word of name.split(/[\s,.]+/))
                        if ([...word].length >= 3)
                            parts.add(word);
                }
            const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sorted = [...parts].sort((a, b) => b.length - a.length);
            const patterns = [...sorted.filter(part => !/\s/.test(part)).map(part => escape(part) + '\\s+\\p{L}\\.'), ...sorted.map(escape)];
            const names = patterns.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + patterns.join('|') + ')(?![\\p{L}\\p{N}])', 'iu') : null;
            const handles = people.flatMap(p => [...p.emails, ...p.phones, ...(p.urls??[])]).map(s => s.toLowerCase()).filter(Boolean);
  const named=(text:string)=>!!names?.test(text)||handles.some(handle=>handle.length>=3&&text.toLowerCase().includes(handle));
  const orders=this.hooks.orders().filter(o=>this.pins.has(this.key(o.id))),affected=new Set<string>(),files=new Set<string>();
  for(const order of orders){const pin=this.pins.get(this.key(order.id))!;if(named(pin.voice?.text??'')||named(order.request))affected.add(order.id);for(const file of this.hooks.files(order.id)){const text=new TextDecoder().decode(Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)));if(named(file.name)||named(text)){files.add(file.id);affected.add(order.id);}}}
  for(const run of this.hooks.deliveries())if(orders.some(o=>o.id===run.orderId)&&(named(JSON.stringify(run))||named(JSON.stringify(this.reports.get(this.key(run.id))??{}))))affected.add(run.orderId);
  for(const order of orders)if(affected.has(order.id)){const pin=this.pins.get(this.key(order.id))!;pin.voice=null;pin.stage=1;pin.state='running';pin.since=this.host.now();if(named(order.request))order.request='This request was erased because it named someone you asked Chausar to forget.';}
  for(const run of this.hooks.deliveries())if(affected.has(run.orderId)){run.status='stopped';run.awaitingYou=false;run.canAccept=false;run.renderedText=null;run.editedText=null;run.deliverable=null;run.verdict=null;run.playbookChecks=[];(run as SocialRun).preview=null;this.reports.delete(this.key(run.id));this.sourcePins.delete(this.key(run.id));this.clearRow(run.id);const detail=this.host.runs().find(r=>r.runId===run.id);if(detail)detail.state='done';}
  this.history.set(this.host.current(),(this.history.get(this.host.current())??[]).filter(row=>!affected.has(row.orderId)));this.hooks.eraseFiles(files);
 }
 queueView(kind:unknown,id:unknown):QueueItemView|null{
  if(kind!=='draft'||typeof id!=='string')return null;const run=this.hooks.deliveries().find(r=>r.id===id) as SocialRun|undefined;if(!run||run.chainStage===undefined)return null;
  const report=this.reports.get(this.key(id));const input=run.preview?.input;
  return {kind:'draft',id,businessName:this.host.current(),title:run.deliverable?.title??'Demo writing preview',line:'Demo content. Sending and publishing ask separately.',sections:[{heading:input?String(input.stageId):'Draft',lines:input?[String(input.request),...(input.approvedClientVoice?[(input.approvedClientVoice as {text:string}).text]:[])]:[(run.editedText??run.renderedText)??'']},...(report?[{heading:'Figures from code receipts',lines:report.receipts.map(r=>r.label+': '+r.display+' ['+r.id+'] '+r.formula+' Source: '+r.inputs.fileName+'; rows '+r.inputs.rows.join(', '))},{heading:'Missing or excluded source values',lines:report.platforms.flatMap(p=>[...p.missing.map(m=>m.line),...p.excludedRows.map(r=>r.reason)])}]:[])]};
 }
 private clearRow(id:string){this.host.setRows?.((this.host.rows?.()??[]).filter(r=>!(r.id.startsWith('social-stage:')&&r.viewRef?.id===id)));}
 refreshRevision(run:DeliveryLite){this.row(run as SocialRun);}
 private row(run:SocialRun){
  if(!this.host.setRows)return;this.clearRow(run.id);const waiting=run.status==='waiting-for-you';
  const row:QueueRow={id:`social-stage:${run.id}:${run.status}`,businessId:this.host.current(),businessName:this.host.current(),kind:'draft',title:waiting?'Preview the demo writing stage':'Review the demo draft',line:'Demo content. Sending and publishing ask separately.',createdAt:this.host.now(),digest:this.digest(run),viewRef:{kind:'draft',id:run.id},actions:[{id:'read',label:'Read',primary:false},{id:'approve',label:waiting?'Approve':'Accept',primary:true,requiresView:true}]};this.host.setRows([...(this.host.rows?.()??[]),row]);
 }
 decide(row:QueueRow,action:string):string|null{
  if(!row.id.startsWith('social-stage:')||action!=='approve')return null;const run=this.hooks.deliveries().find(r=>r.id===row.viewRef?.id) as SocialRun|undefined;if(!run)return null;
  this.request(run.status==='waiting-for-you'?'venture.delivery.approve':'venture.delivery.review',run.preview?{runId:run.id,digest:run.preview.digest}:{runId:run.id,verdict:'accepted'});return 'Done';
 }
}
