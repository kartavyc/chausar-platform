// Demo writing uses the real deterministic service checks and current owner sources. No provider or media success is invented.
import {EngineError,type DeliveryLite,type OrderLite,type QueueRow,type QueueItemView,type WorkReceiptLite} from './types';
import type {WorkHost} from './fake-work';
import {digest} from '../../../../platform/runtime/portable';
import {isYoutubeService} from '../../../../platform/runtime/venture/playbooks/youtube/service-fields';
import {YOUTUBE_SERVICE_SECTIONS} from '../../../../platform/runtime/venture/playbooks/youtube/service-data';
import {youtubeServiceCheckCore,AFTER_PUBLISH_WORDS,type ServiceDraft,type ServiceCall} from '../../../../platform/runtime/venture/playbooks/youtube/service-check-core';
import type {YoutubeResearchBody} from '../../../../platform/runtime/venture/playbooks/youtube/research-state';
import type {SourceComment} from '../../../../platform/runtime/venture/playbooks/youtube/comments';
import {fakeYoutubeRights} from './fake-youtube-rights';
type Source={body:YoutubeResearchBody;receipt:WorkReceiptLite&{inputs:{tables:{id:string;digest:string}[]}}};
type Pin={order:OrderLite;service:keyof typeof YOUTUBE_SERVICE_SECTIONS;source:Source|null};
type Run=Omit<DeliveryLite,'deliverable'>&{deliverable:ServiceDraft|null;preview:{digest:string;input:unknown}|null;workflow:{steps:{id:string}[]}};
type Hooks={orders():OrderLite[];deliveries():DeliveryLite[];files(id:string):{format:string;contentBase64:string}[];keep(row:DeliveryLite):void};
const required:Record<string,string>={'after-publish-review':'after-publish','niche-report':'niche','channel-audit':'outliers','comment-triage':'comments','comment-insights':'comments'};
const tools:Record<string,string>={'after-publish-review':'youtube.afterPublish','niche-report':'youtube.niche','channel-audit':'youtube.outliers','comment-triage':'youtube.comments','comment-insights':'youtube.comments'};
const need=(yes:unknown,code:string,line:string):void=>{if(!yes)throw new EngineError(code,line);};
const exact=(p:Record<string,unknown>,keys:string[],required=keys)=>need(Object.keys(p).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(p,key)),'INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
export class FakeYoutubeServiceRun{
 private pins=new Map<string,Pin>();
 constructor(private host:WorkHost,private hooks:Hooks){}
 private key(id:unknown){return this.host.current()+':'+String(id);}
 handles(id:unknown){return this.pins.has(this.key(id));}
 private current(order:OrderLite):Pin|null{
  if(this.host.plan()?.playbook?.id!=='youtube')return null;
  const service=this.host.plan()?.blueprint.offers.find(row=>row.id===order.offerId)?.playbookOffer;if(!isYoutubeService(service))return null;
  fakeYoutubeRights({ask:(m,p)=>this.host.ask?.(m,p),now:()=>this.host.now()},order.id);
  let source:Source|null=null;
  try{const found=this.host.ask?.('venture.desk.get',{playbook:'youtube',kind:'research',id:order.id}) as {item:YoutubeResearchBody};if(found?.item){const receipt=this.host.ask?.('venture.work.get',{id:found.item.receiptId}) as Source['receipt'];source={body:found.item,receipt};}}
  catch(error){if(required[service!]||!(error instanceof Error)||!('code'in error)||error.code!=='YOUTUBE_RESEARCH_NOT_FOUND')throw error;}
  need(!required[service!]||source?.body.mode===required[service!],'YOUTUBE_SOURCE_REQUIRED','Prepare the source analysis this exact service uses.');
  return {order:structuredClone(order),service:service as Pin['service'],source};
 }
 start(order:OrderLite,id:string,p:Record<string,unknown>):Run|null{
  const pin=this.current(order);if(!pin)return null;exact(p,['orderId','useTemplate'],['orderId']);need(p.useTemplate===undefined||typeof p.useTemplate==='boolean','INVALID_VENTURE_REQUEST','Choose whether to use the template.');
  const ids=pin.service==='screencast-tutorial'?['intake','clarify','probe','find','score','edit','assemble',pin.service,'verify','review','publish']:['intake','clarify',pin.service,'verify','review','publish'];
  const input={order:pin.order,service:pin.service,source:pin.source?.body??null},run:Run={id,at:this.host.now(),orderId:order.id,status:'waiting-for-you',practice:false,deliverable:null,verdict:null,awaitingYou:true,preview:{digest:digest(input),input},workflow:{steps:ids.map(id=>({id}))}};
  this.pins.set(this.key(id),pin);this.hooks.keep(run);this.row(run);return structuredClone(run);
 }
 private draft(pin:Pin):ServiceDraft{
  const result=pin.source?.body.result as Record<string,unknown>|undefined,values:Record<string,string[]>={};
  if(pin.service==='after-publish-review'){values['One directive']=[AFTER_PUBLISH_WORDS[String(result?.directive)]!];values.Thresholds=['The current source receipt records the selected thresholds.'];values.Coverage=['Only the supplied Studio export was reviewed. Missing information remains unavailable.'];}
  if(pin.service==='weekly-plan'){values.Anchor=['Main tutorial: 90 minutes'];values['Cheap piece']=['Quick recap: 30 minutes'];values['Three Shorts']=['First clip: 20 minutes','Second clip: 20 minutes','Third clip: 20 minutes'];values['Drop first']=['Third clip'];values['Time allowance']=['model estimate: review these demo estimates against your available hours.'];}
  if(pin.service==='channel-audit'){values['One fix']=['Demo proposal: review the opening of the selected source video.'];values['Three things to keep']=['Demo proposal: keep the clear speech.','Demo proposal: keep sourced examples.','Demo proposal: keep captions.'];values['Not yet']=['Demo proposal: do not buy new equipment.'];values.Coverage=['These demo proposals need owner review against the actual source sample.'];}
  if(pin.service==='niche-report'){values.Coverage=['Only the supplied sample is covered.'];values.Observed=['The receipt below contains the actual measured source figures.'];values.Interpretation=['Inferred: this demo makes no recommendation about future performance.'];values.Caveats=['The sample is incomplete. Missing source counts remain unavailable.'];}
  if(pin.service==='comment-insights'){values['Repeated questions']=((result?.ideas??[])as {question:string}[]).map(row=>row.question);values['Idea suggestions']=['Review these source questions before adding an idea.'];values['Source coverage']=['Only the supplied comments are covered.'];}
  if(pin.service==='comment-triage'){const piles=(result?.piles??{})as Record<string,SourceComment[]>;for(const [key,label]of [['questions','Questions'],['praise','Praise'],['actionable','Actionable feedback'],['bait','Held bait']]as const)values[label]=(piles[key]??[]).map(row=>row.id+': '+row.text);values.Replies=((result?.replies??[])as {id:string;reply:string}[]).map(row=>row.id+': '+row.reply);values.Pin=typeof result?.pinId==='string'?[result.pinId]:[];}
  const draft:ServiceDraft={title:'Demo service draft',sections:YOUTUBE_SERVICE_SECTIONS[pin.service].map(heading=>({heading,parts:(values[heading]??['Demo placeholder: write this section from the current client evidence.']).map(text=>({kind:'text' as const,text}))})),questionsForClient:[],...(pin.service==='weekly-plan'?{estimate:true}:{})};
  if(pin.source){const target=draft.sections.find(row=>row.heading==='Source evidence'||row.heading==='Counts'||row.heading==='Observed')??draft.sections.at(-1)!;for(const figure of pin.source.receipt.figures)target.parts.push({kind:'figure',receiptId:pin.source.body.receiptId,figureKey:figure.key});}
  return draft;
 }
 request(method:string,p:Record<string,unknown>):DeliveryLite{
  if(method==='venture.delivery.approve'){exact(p,['runId','digest']);need(typeof p.digest==='string'&&/^[a-f0-9]{64}$/.test(p.digest),'INVALID_VENTURE_REQUEST','Send the digest of the text you approved.');}
  else{exact(p,['runId','verdict','reason','editedText'],['runId','verdict']);need(typeof p.verdict==='string'&&['accepted','edited','rejected'].includes(p.verdict),'INVALID_VENTURE_REQUEST','Choose accept, edit or reject.');if(p.reason!==undefined)need(typeof p.reason==='string'&&['wrong-fact','missing-fact','missing-section','off-brief','tone','format','too-long','too-short','wrong-number','late','claims-work-not-done','other'].includes(p.reason),'INVALID_VENTURE_REQUEST','Choose a reason from the list.');need(p.verdict==='edited'?typeof p.editedText==='string'&&!!p.editedText.trim()&&p.editedText.length<=20000:p.editedText===undefined,'INVALID_VENTURE_REQUEST','Only an edit carries new text.');need(p.verdict!=='accepted'||p.reason===undefined,'INVALID_VENTURE_REQUEST','An accepted draft needs no reason.');need(p.verdict!=='rejected'||p.reason!==undefined,'INVALID_VENTURE_REQUEST','Choose why you reject this draft.');}
  const run=this.hooks.deliveries().find(row=>row.id===p.runId)as Run|undefined;need(run&&this.handles(p.runId),'DELIVERY_NOT_FOUND','That draft reply was not found.');const r=run!,pin=this.pins.get(this.key(r.id))!,order=this.hooks.orders().find(row=>row.id===r.orderId);need(order,'ORDER_NOT_FOUND','That order was not found.');
  if(method==='venture.delivery.approve'){need(r.status==='waiting-for-you'&&r.preview,'DELIVERY_NOT_WAITING','This draft reply is not waiting for your approval.');need(r.preview?.digest===p.digest,'APPROVAL_STALE','This changed since you read it. Read it again.');}
  else need(r.status==='ready-for-review','DELIVERY_NOT_READY','This draft reply is not ready for review.');
  if(p.verdict!=='rejected')need(digest(this.current(order!))===digest(pin),'DERIVED_STALE','The source analysis or order changed. Prepare this draft again.');
  if(method==='venture.delivery.approve'){
   r.deliverable=this.draft(pin);const calls:ServiceCall[]=pin.source?[{tool:tools[pin.service]??'',outcome:'succeeded',envelope:{ok:true,result:{analysis:pin.source.body.result,source:pin.source.body.source}}}]:[];
   r.playbookChecks=youtubeServiceCheckCore({offerKey:pin.service,deliverable:r.deliverable,intake:order!.intake??null,toolCalls:calls,receipts:pin.source?[pin.source.receipt]:[],files:this.hooks.files(r.orderId),rightsValid:true}).map(row=>({...row,playbook:'youtube'}));r.canAccept=r.playbookChecks.every(row=>row.outcome==='pass');r.renderedText=r.deliverable.title+'\n\n'+r.deliverable.sections.map(row=>row.heading+'\n'+row.parts.map(part=>part.kind==='text'?part.text:part.kind==='date'?part.iso:'['+part.receiptId+':'+part.figureKey+']').join('\n')).join('\n\n');r.status='ready-for-review';r.writtenBy='Demo draft';r.preview=null;this.row(r);return structuredClone(r);
  }
  if(p.verdict==='accepted')need(r.canAccept,'INVALID_VENTURE_REQUEST','Resolve the service checks before accepting this draft.');r.status=p.verdict as 'accepted'|'edited'|'rejected';if(p.verdict==='edited')r.editedText=String(p.editedText).trim();r.verdict={choice:r.status,at:this.host.now()};r.awaitingYou=false;this.clear(r.id);return structuredClone(r);
 }
 eraseOrders(businessId:string,ids:readonly string[]){for(const [key,pin]of this.pins)if(key.startsWith(businessId+':')&&ids.includes(pin.order.id)){this.pins.delete(key);if(this.host.current()===businessId)this.clear(key.slice(businessId.length+1));}}
 private clear(id:string){this.host.setRows?.((this.host.rows?.()??[]).filter(row=>!row.id.startsWith('youtube-service:'+id+':')));}
 private row(run:Run){this.clear(run.id);const row:QueueRow={id:`youtube-service:${run.id}:${run.status}`,businessId:this.host.current(),businessName:this.host.current(),kind:'draft',title:run.preview?'Preview the demo service draft':'Review the demo service draft',line:'Demo content. Nothing is sent or published.',createdAt:this.host.now(),digest:digest(run),viewRef:{kind:'draft',id:run.id},actions:[{id:'read',label:'Read',primary:false},{id:'approve',label:run.preview?'Approve':'Accept',primary:true,requiresView:true}]};this.host.setRows?.([...(this.host.rows?.()??[]),row]);}
 queueView(kind:unknown,id:unknown):QueueItemView|null{if(kind!=='draft'||!this.handles(id))return null;const run=this.hooks.deliveries().find(row=>row.id===id)as Run|undefined;if(!run)return null;return{kind:'draft',id:run.id,businessName:this.host.current(),title:'Demo service draft',line:'Demo content. Nothing is sent or published.',sections:[{heading:'Current source',lines:[run.renderedText??JSON.stringify(run.preview?.input)]}]};}
 decide(row:QueueRow,action:string):string|null{if(!row.id.startsWith('youtube-service:')||action!=='approve')return null;const run=this.hooks.deliveries().find(candidate=>candidate.id===row.viewRef?.id)as Run|undefined;if(!run)return null;this.request(run.preview?'venture.delivery.approve':'venture.delivery.review',run.preview?{runId:run.id,digest:run.preview.digest}:{runId:run.id,verdict:'accepted'});return'Done';}
}
