// Browser rehearsal of the sign-off desk (wave 6, 6E5). The engine's own pure rules (signoff-desk/core.ts and
// professions.ts, kit/signoff-core.ts) with the engine desk's request grammar, codes and words. signoffBlock is the
// gate the fake's Accept asks, as the engine's kit/signoff-gate.ts does.
import {check,digest} from '../../../../platform/runtime/portable';
import {exactTender as exact} from '../../../../platform/runtime/venture/playbooks/tender-desk/sources-core';
import {papersDigestOf} from '../../../../platform/runtime/venture/playbooks/kit/signoff-core';
import {deskBlock,deskStage,decisionOf,papersReady,noteInput,professionalInput,professionalOf,requestsOf,sentOf,signerMatches,type DeskRun,type SignoffRow} from '../../../../platform/runtime/venture/playbooks/signoff-desk/core';
import {PROFESSION_SPECS,SIGNOFF_RULES,professionOfOffer,professionSpec,type ProfessionSpec} from '../../../../platform/runtime/venture/playbooks/signoff-desk/professions';
import {roomGuard} from './fake-client-room';
import type {FakePlaybookDesk} from './fake-playbooks';
import type {W4DeskHost} from './fake-w4';
import type {OrderLite} from './types';

const P='signoff-desk';
type Run=DeskRun&{status:string;practice:boolean;canAccept?:boolean;deliverable:{title?:string}|null};
const identifier=(value:unknown,field:string)=>{check(typeof value==='string'&&/^[A-Za-z0-9_.:-]{3,80}$/.test(value),'INVALID_VENTURE_REQUEST',`${field} must be a known identifier.`);return value as string;};

export function fakeSignoffDeskDesk(host:W4DeskHost):FakePlaybookDesk&{signoffBlock(run:Run):string|null}{
 const spaces=new Map<string,SignoffRow[]>();let seq=0;
 const rows=()=>spaces.get(host.current())??[],put=(row:Record<string,unknown>)=>{const made={...row,id:'signoff_'+(++seq),at:host.now()} as SignoffRow;spaces.set(host.current(),[...rows(),made]);return made;};
 const deskBusiness=()=>(host.ask('venture.blueprint.get',{}) as {playbook?:{id?:string}|null}|null)?.playbook?.id===P;
 const specOf=(orderId:string):ProfessionSpec|null=>{
  if(!deskBusiness())return null;const order=(host.ask('venture.order.list',{}) as OrderLite[]).find(row=>row.id===orderId);if(!order)return null;
  const offers=host.acceptedOffers?.()??[];return professionOfOffer(offers.find(row=>row.id===order.offerId)?.playbookOffer)??offers.map(row=>professionOfOffer(row.playbookOffer)).find(Boolean)??null;};
 const runs=()=>(host.ask('venture.delivery.list',{}) as Run[]).map(run=>({...run,renderedText:run.renderedText??null,editedText:run.editedText??null,servedBy:run.servedBy??'model'}));
 const request=(raw:unknown,op:'list'|'get'|'act',kind:string)=>{const p=exact(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);check(p.playbook===P&&p.kind===kind,'INVALID_VENTURE_REQUEST','Choose the sign-off desk.');if(op==='list')check(p.filter===undefined,'INVALID_VENTURE_REQUEST','This list takes no filter.');return p;};
 const professionalView=(spec:ProfessionSpec)=>{const named=professionalOf(rows(),spec.id);return {profession:spec.id,label:spec.label,signer:spec.signer,registryLabel:spec.registry.label,hint:spec.registry.hint,offer:spec.offer,
  professional:named?{name:named.name,registrationNumber:named.registrationNumber,at:named.at}:null,switchedOff:spec.refusedTools.map(item=>({tool:item.tool,line:item.line,ruleId:item.ruleId})),
  rules:SIGNOFF_RULES.filter(rule=>rule.profession===spec.id).map(rule=>({id:rule.id,title:rule.title,line:rule.line,url:rule.url,checked:rule.checked}))};};
 const paperView=(run:Run,spec:ProfessionSpec)=>{const all=rows(),stage=deskStage(all,spec,run),wanted=papersDigestOf(run),current=requestsOf(all,run.id).filter(item=>item.workingDigest===wanted).at(-1)??null,sent=current?sentOf(all,current.id):null,decision=current?decisionOf(all,current.id):null,named=professionalOf(all,spec.id);
  return {runId:run.id,orderId:run.orderId,title:run.deliverable?.title??'Draft',status:run.status,profession:spec.id,signer:spec.signer,registryLabel:spec.registry.label,professional:named?{name:named.name,registrationNumber:named.registrationNumber}:null,stage,line:deskBlock(all,spec,run),papersDigest:wanted,
   request:current?{id:current.id,at:current.at,sent:sent?{name:sent.name,at:sent.at}:null,decision:decision?{decision:decision.decision,name:decision.name,at:decision.at,note:decision.note}:null}:null};};
 const regulated=()=>runs().filter(run=>!['rejected','failed','stopped','cancelled'].includes(run.status)&&!run.practice).flatMap(run=>{const spec=specOf(run.orderId);return spec?[{run,spec}]:[];});
 const paperOf=(runId:string)=>{const found=regulated().find(item=>item.run.id===runId);check(found,'SIGNOFF_NOT_FOUND','That draft is not a regulated paper of this business.');return {...found,view:paperView(found.run,found.spec)};};
 const emit=()=>host.emit({type:'desk.changed',businessId:host.current(),at:host.now()} as never);
 return {playbook:P,
  signoffBlock(run){const spec=specOf(run.orderId);return spec?deskBlock(rows(),spec,{...run,renderedText:run.renderedText??null,editedText:run.editedText??null,servedBy:run.servedBy??'model'}):null;},
  forgetPeople(people){const clients=new Set(people.flatMap(p=>p.clientId?[p.clientId]:[])),handles=people.flatMap(p=>[...p.names,...p.emails,...p.phones,...p.urls??[]]).filter(h=>h.length>=3),named=(v:unknown)=>handles.some(h=>JSON.stringify(v).toLowerCase().includes(h.toLowerCase()));
   const gone=new Set(rows().filter(row=>row.entry==='request'&&(clients.has(row.clientId)||named(row))).map(row=>row.id));if(!gone.size)return;spaces.set(host.current(),rows().filter(row=>!gone.has(row.id)&&!('requestId' in row&&gone.has(row.requestId))));emit();},
  kinds:{
   professional:{
    list:raw=>roomGuard(()=>{request(raw,'list','professional');return {playbook:P,kind:'professional',rows:PROFESSION_SPECS.map(professionalView),line:'The licensed professional who signs each kind of paper.'};}),
    get:raw=>roomGuard(()=>{const p=request(raw,'get','professional'),spec=professionSpec(p.id);check(spec,'INVALID_VENTURE_REQUEST','Choose a profession.');const item=professionalView(spec);return {playbook:P,kind:'professional',item,digest:digest(item)};}),
    act:raw=>roomGuard(()=>{const p=request(raw,'act','professional'),spec=professionSpec(p.id);check(spec,'INVALID_VENTURE_REQUEST','Choose a profession.');check(p.action==='name','INVALID_VENTURE_REQUEST','Choose a sign-off desk action.');
     const named=professionalInput(spec,exact(p.payload,['name','registrationNumber'],['name','registrationNumber']));put({entry:'professional',profession:spec.id,...named});emit();
     return {playbook:P,kind:'professional',id:spec.id,result:professionalView(spec),line:`${named.name} signs every ${spec.label.toLowerCase()} paper from now on.`};}),
   },
   paper:{
    list:raw=>roomGuard(()=>{request(raw,'list','paper');return {playbook:P,kind:'paper',rows:regulated().map(({run,spec})=>{const view=paperView(run,spec);return {runId:view.runId,orderId:view.orderId,title:view.title,profession:view.profession,stage:view.stage,line:view.line};}),line:'Every regulated paper waits for its professional\'s signature.'};}),
    get:raw=>roomGuard(()=>{const p=request(raw,'get','paper'),{view}=paperOf(identifier(p.id,'Draft'));return {playbook:P,kind:'paper',item:view,digest:digest(view)};}),
    act:raw=>roomGuard(()=>{const p=request(raw,'act','paper'),runId=identifier(p.id,'Draft');check(['send','sign','return'].includes(p.action as string),'INVALID_VENTURE_REQUEST','Choose a sign-off desk action.');
     const body=p.action==='sign'?exact(p.payload,['registrationNumber'],['registrationNumber']):p.action==='return'?exact(p.payload,['note'],[]):exact(p.payload,[],[]);
     const note=p.action==='return'?noteInput(body.note):null;
     const {run,spec,view}=paperOf(runId),all=rows();check(p.digest===digest(view),'APPROVAL_CHANGED','These papers changed. Read them again.');let line:string;
     if(p.action==='send'){
      const named=professionalOf(all,spec.id);check(named,'SIGNOFF_SIGNER_REQUIRED',`Name ${spec.signer} first.`);
      check(['not-asked','unsent','changed'].includes(view.stage),'SIGNOFF_DECIDED','These papers were sent or decided already.');
      check(papersReady(run,run.canAccept!==false),'SIGNOFF_PAPERS_NOT_READY','These papers are not ready to sign. Resolve the draft\'s checks first.');
      const order=(host.ask('venture.order.list',{}) as OrderLite[]).find(row=>row.id===run.orderId);
      const asked=view.request&&!view.request.decision?view.request.id:put({entry:'request',profession:spec.id,deliveryId:run.id,orderId:run.orderId,clientId:order?.clientId??'',workingDigest:view.papersDigest,title:view.title.slice(0,140)}).id;
      put({entry:'sent',requestId:asked,name:named.name,registrationNumber:named.registrationNumber});line=`Waiting for ${named.name} to sign.`;
     }else{
      check(view.stage==='sent'&&view.request,'SIGNOFF_NOT_FOUND','These papers are not waiting for a signature.');
      const sent=sentOf(all,view.request!.id)!;if(p.action==='sign')signerMatches(sent,body.registrationNumber,spec);
      put({entry:'decision',requestId:view.request!.id,decision:p.action==='sign'?'signed':'returned',name:sent.name,registrationNumber:sent.registrationNumber,workingDigest:view.papersDigest,note});
      line=p.action==='sign'?`Signed by ${sent.name}.`:'Returned. Draft the papers again.';
     }
     emit();return {playbook:P,kind:'paper',id:run.id,result:paperOf(run.id).view,line};
    }),
   },
  }};
}
