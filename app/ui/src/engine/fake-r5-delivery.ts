// Original source-bound source-service delivery with current evidence. No model send or client effect is invented.
import {digest} from '../../../../platform/runtime/portable';
import {watchDelivery,watchChecks} from '../../../../platform/runtime/venture/playbooks/monitored-data/report';
import {triageDelivery,triageChecks} from '../../../../platform/runtime/venture/playbooks/it-triage/report';
import {roomExact} from './fake-client-room';
import {EngineError,type DeliveryLite,type OrderLite,type QueueRow,type QueueItemView,type ModelStatusLite} from './types';
import type {WorkHost} from './fake-work';
type Run=Omit<DeliveryLite,'deliverable'>&{deliverable:ReturnType<typeof watchDelivery>};
type Hooks={deliveries():DeliveryLite[];keep(run:DeliveryLite):void};
const need=(value:unknown,code:string,line:string)=>{if(!value)throw new EngineError(code,line);};
export class FakeR5Delivery {
 private bindings=new Map<string,{orderId:string;digest:string}>();
 constructor(private host:WorkHost,private hooks:Hooks){}
 private key(id:string){return this.host.current()+':'+id;}
 handles(id:unknown){return this.bindings.has(this.key(String(id)));}
 start(order:OrderLite,id:string,p:Record<string,unknown>):Run|null{
  if(!['monitored-data','it-triage'].includes(this.host.plan()?.playbook?.id??''))return null;
  roomExact(p,['orderId','useTemplate'],['orderId']);need(p.useTemplate===undefined||typeof p.useTemplate==='boolean','INVALID_VENTURE_REQUEST','useTemplate must be true or false.');
  const report=this.host.r5Report!(order.id);
  const deliverable='sources'in report?watchDelivery(report):triageDelivery(report),checks='sources'in report?watchChecks({watchReport:report,deliverable}):triageChecks({triageReport:report,deliverable}),run:Run={id,orderId:order.id,at:this.host.now(),status:'ready-for-review',practice:false,practiceNow:false,servedBy:'template',deliverable,verdict:null,awaitingYou:true,checks:[],playbookChecks:checks,canAccept:checks.every(c=>c.outcome==='pass'),acceptBlocked:null,writtenBy:null,renderedText:deliverable.sections.map(s=>s.heading+'\n'+s.parts.map(p=>p.kind==='text'?p.text:'').join('\n')).join('\n\n')};
  this.bindings.set(this.key(id),{orderId:order.id,digest:report.digest});this.hooks.keep(run);this.queue(run);return structuredClone(run);
 }
 request(method:string,p:Record<string,unknown>):DeliveryLite{
  roomExact(p,method==='venture.delivery.approve'?['runId','digest']:['runId','verdict','reason','editedText'],method==='venture.delivery.approve'?['runId','digest']:['runId','verdict']);
  if(method==='venture.delivery.review'){
   need(['accepted','edited','rejected'].includes(String(p.verdict))&&typeof p.verdict==='string','INVALID_VENTURE_REQUEST','Choose accept, edit or reject.');
   if(p.reason!==undefined)need(typeof p.reason==='string'&&['wrong-fact','missing-fact','missing-section','off-brief','tone','format','too-long','too-short','wrong-number','late','claims-work-not-done','other'].includes(p.reason),'INVALID_VENTURE_REQUEST','Choose a reason from the list.');
   if(p.verdict==='edited')need(typeof p.editedText==='string'&&p.editedText.trim().length>0&&p.editedText.length<=20000,'INVALID_VENTURE_REQUEST','Add a bounded edited draft.');else need(p.editedText===undefined,'INVALID_VENTURE_REQUEST','Only an edit carries new text.');
   if(p.verdict==='rejected')need(p.reason!==undefined,'INVALID_VENTURE_REQUEST','Choose why you reject this draft.');if(p.verdict==='accepted')need(p.reason===undefined,'INVALID_VENTURE_REQUEST','An accepted draft needs no reason.');
  }
  const run=this.hooks.deliveries().find(r=>r.id===p.runId) as Run|undefined;need(run,'DELIVERY_NOT_FOUND','That draft reply was not found.');const r=run!;
  if(method==='venture.delivery.approve')throw new EngineError('DELIVERY_NOT_WAITING','This draft reply is not waiting for your approval.');
  need(r.status==='ready-for-review','DELIVERY_NOT_READY','This draft reply is not ready for review.');const binding=this.bindings.get(this.key(r.id))!;
  if(p.verdict!=='rejected')need(this.host.r5Report!(binding.orderId).digest===binding.digest&&p.verdict!=='edited','DERIVED_STALE','Review the current source evidence in its desk and prepare a new report.');
  if(p.verdict==='accepted')need(r.canAccept,'DELIVERY_CHECK_FAILED','Resolve the checks before accepting this draft.');
  r.status=p.verdict as 'accepted'|'edited'|'rejected';r.verdict={choice:r.status,at:this.host.now()};r.awaitingYou=false;r.editedText=p.verdict==='edited'?String(p.editedText):null;this.clear(r.id);this.host.emit({type:'run.done',businessId:this.host.current(),runId:r.id,at:this.host.now()});return structuredClone(r);
 }
 eraseOrders(biz:string,ids:readonly string[]){for(const [key,binding]of this.bindings)if(key.startsWith(biz+':')&&ids.includes(binding.orderId)){this.bindings.delete(key);if(biz===this.host.current())this.clear(key.slice(biz.length+1));}}
 private clear(id:string){this.host.setRows?.((this.host.rows?.()??[]).filter(r=>!r.id.startsWith('source-report:'+id+':')));}
 private queue(run:Run){const row:QueueRow={id:'source-report:'+run.id+':review',businessId:this.host.current(),businessName:this.host.current(),kind:'draft',title:'Read the approved source report',line:'A source-bound code report. No client message or system change has been made.',createdAt:this.host.now(),digest:digest(run),viewRef:{kind:'draft',id:run.id},actions:[{id:'read',label:'Read',primary:false},{id:'approve',label:'Accept',primary:true,requiresView:true}]};this.host.setRows?.([...(this.host.rows?.()??[]),row]);this.host.emit({type:'queue.changed',businessId:this.host.current(),at:this.host.now()});}
 queueView(kind:unknown,id:unknown):QueueItemView|null{if(kind!=='draft'||!this.handles(id))return null;const run=this.hooks.deliveries().find(r=>r.id===id);return run?{kind:'draft',id:run.id,businessName:this.host.current(),title:'Approved source report',line:'No client message or system change has been made.',sections:[{heading:'Review',lines:[run.renderedText??'']}]}:null;}
 decide(row:QueueRow,action:string):string|null{if(!row.id.startsWith('source-report:')||action!=='approve')return null;this.request('venture.delivery.review',{runId:row.viewRef?.id,verdict:'accepted'});return 'Done';}
}
