// Demo writing uses the real deterministic service checks and current owner sources. No provider or media success is invented.
import {EngineError,type DeliveryLite,type OrderLite,type QueueRow,type QueueItemView,type WorkReceiptLite} from './types';
import type {WorkHost} from './fake-work';
import {digest} from '../../../../platform/runtime/portable';
import {isYoutubeService} from '../../../../platform/runtime/venture/playbooks/youtube/service-fields';
import {YOUTUBE_SERVICE_SECTIONS} from '../../../../platform/runtime/venture/playbooks/youtube/service-data';
import type {ServiceDraft} from '../../../../platform/runtime/venture/playbooks/youtube/service-check-core';
import type {YoutubeResearchBody} from '../../../../platform/runtime/venture/playbooks/youtube/research-state';
import {fakeYoutubeRights} from './fake-youtube-rights';
type Source={body:YoutubeResearchBody;receipt:WorkReceiptLite&{inputs:{tables:{id:string;digest:string}[]}}};
type Pin={order:OrderLite;service:keyof typeof YOUTUBE_SERVICE_SECTIONS;source:Source|null};
type Run=Omit<DeliveryLite,'deliverable'>&{deliverable:ServiceDraft|null;preview:{digest:string;input:unknown}|null;workflow:{steps:{id:string}[]}};
type Hooks={orders():OrderLite[];deliveries():DeliveryLite[];files(id:string):{format:string;contentBase64:string}[];keep(row:DeliveryLite):void};
const required:Record<string,string>={'after-publish-review':'after-publish','niche-report':'niche','channel-audit':'outliers','comment-triage':'comments','comment-insights':'comments'};
const need=(yes:unknown,code:string,line:string):void=>{if(!yes)throw new EngineError(code,line);};
const exact=(p:Record<string,unknown>,keys:string[],required=keys)=>need(Object.keys(p).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(p,key)),'INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
export class FakeYoutubeServiceRun{
 private pins=new Map<string,Pin>();
 constructor(private host:WorkHost,private hooks:Hooks){}
 private key(id:unknown){return this.host.current()+':'+String(id);}
 handles(id:unknown){return this.pins.has(this.key(id));}
 preflight(order:OrderLite){this.current(order);}
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
 request(method:string,p:Record<string,unknown>):DeliveryLite{
  exact(p,['runId','verdict','reason','editedText'],['runId','verdict']);need(typeof p.verdict==='string'&&['accepted','edited','rejected'].includes(p.verdict),'INVALID_VENTURE_REQUEST','Choose accept, edit or reject.');if(p.reason!==undefined)need(typeof p.reason==='string'&&['wrong-fact','missing-fact','missing-section','off-brief','tone','format','too-long','too-short','wrong-number','late','claims-work-not-done','other','not-needed'].includes(p.reason),'INVALID_VENTURE_REQUEST','Choose a reason from the list.');need(p.verdict==='edited'?typeof p.editedText==='string'&&!!p.editedText.trim()&&p.editedText.length<=20000:p.editedText===undefined,'INVALID_VENTURE_REQUEST','Only an edit carries new text.');need(p.verdict!=='accepted'||p.reason===undefined,'INVALID_VENTURE_REQUEST','An accepted draft needs no reason.');need(p.verdict!=='rejected'||p.reason!==undefined,'INVALID_VENTURE_REQUEST','Choose why you reject this draft.');
  const run=this.hooks.deliveries().find(row=>row.id===p.runId)as Run|undefined;need(run&&this.handles(p.runId),'DELIVERY_NOT_FOUND','That draft reply was not found.');const r=run!,pin=this.pins.get(this.key(r.id))!,order=this.hooks.orders().find(row=>row.id===r.orderId);need(order,'ORDER_NOT_FOUND','That order was not found.');
  need(r.status==='ready-for-review','DELIVERY_NOT_READY','This draft reply is not ready for review.');
  if(p.verdict!=='rejected')need(digest(this.current(order!))===digest(pin),'DERIVED_STALE','The source analysis or order changed. Prepare this draft again.');

  if(p.verdict==='accepted')need(r.canAccept,'INVALID_VENTURE_REQUEST','Resolve the service checks before accepting this draft.');r.status=p.verdict as 'accepted'|'edited'|'rejected';if(p.verdict==='edited')r.editedText=String(p.editedText).trim();r.verdict={choice:r.status,at:this.host.now()};r.awaitingYou=false;this.clear(r.id);return structuredClone(r);
 }
 eraseOrders(businessId:string,ids:readonly string[]){for(const [key,pin]of this.pins)if(key.startsWith(businessId+':')&&ids.includes(pin.order.id)){this.pins.delete(key);if(this.host.current()===businessId)this.clear(key.slice(businessId.length+1));}}
 private clear(id:string){this.host.setRows?.((this.host.rows?.()??[]).filter(row=>!row.id.startsWith('youtube-service:'+id+':')));}
 queueView(kind:unknown,id:unknown):QueueItemView|null{if(kind!=='draft'||!this.handles(id))return null;const run=this.hooks.deliveries().find(row=>row.id===id)as Run|undefined;if(!run)return null;return{kind:'draft',id:run.id,businessName:this.host.current(),title:'Demo service draft',line:'Demo content. Nothing is sent or published.',sections:[{heading:'Current source',lines:[run.renderedText??JSON.stringify(run.preview?.input)]}]};}
 decide(row:QueueRow,action:string):string|null{if(!row.id.startsWith('youtube-service:')||action!=='approve')return null;const run=this.hooks.deliveries().find(candidate=>candidate.id===row.viewRef?.id)as Run|undefined;if(!run)return null;this.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});return'Done';}
}
