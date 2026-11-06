// Chausar playbook: the sign-off desk (wave 6, 6E5). Two record kinds on venture.desk.*: 'professional' (the licensed
// professional of record for each profession, with the rules and switch-offs that apply) and 'paper' (each regulated
// draft, where it stands, and the send, sign and return actions). Signing needs the registration number of the
// professional the papers were sent to; the gate (kit/signoff-gate.ts) lets only signed papers be accepted, shared or
// posted. Nothing here files, stamps or sends anything outside Chausar. Written for Chausar.
import type {DeskHandlers,DeskKindTypes} from '../desk-types.ts';
import {check} from '../../../contracts.ts';
import type {DeliveryRunRecord,VentureRecord} from '../../contracts.ts';
import type {State} from '../../../contracts.ts';
import {digest,exactPayload,identifier,listRecords,readVenture,requireAppChannel,ventureAction} from '../../records.ts';
import {papersDigestOf} from '../kit/signoff-core.ts';
import {deskBlock,deskStage,decisionOf,papersReady,noteInput,professionalInput,professionalOf,requestsOf,sentOf,signerMatches,type SignoffRow} from './core.ts';
import {PROFESSION_SPECS,SIGNOFF_RULES,professionSpec,type ProfessionSpec} from './professions.ts';
import {signoffDeskSpec} from './gate.ts';

export type SignoffDeskDeskTypes={professional:DeskKindTypes;paper:DeskKindTypes};
const P='signoff-desk';
const rowsOf=(state:State,ventureId:string)=>listRecords(state,'venture-signoff',ventureId) as unknown as SignoffRow[];
function request(raw:unknown,op:'list'|'get'|'act',kind:string){
 const p=exactPayload(raw,op==='list'?['playbook','kind','filter']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload','digest'],op==='list'?['playbook','kind']:op==='get'?['playbook','kind','id']:['playbook','kind','id','action','payload']);
 check(p.playbook===P&&p.kind===kind,'INVALID_VENTURE_REQUEST','Choose the sign-off desk.');
 if(op==='list')check(p.filter===undefined,'INVALID_VENTURE_REQUEST','This list takes no filter.');
 return p;
}

function professionalView(rows:readonly SignoffRow[],spec:ProfessionSpec){
 const named=professionalOf(rows,spec.id);
 return {profession:spec.id,label:spec.label,signer:spec.signer,registryLabel:spec.registry.label,hint:spec.registry.hint,offer:spec.offer,
  professional:named?{name:named.name,registrationNumber:named.registrationNumber,at:named.at}:null,
  switchedOff:spec.refusedTools.map(item=>({tool:item.tool,line:item.line,ruleId:item.ruleId})),
  rules:SIGNOFF_RULES.filter(rule=>rule.profession===spec.id).map(rule=>({id:rule.id,title:rule.title,line:rule.line,url:rule.url,checked:rule.checked}))};
}

type PaperRun=DeliveryRunRecord;
function paperView(state:State,venture:VentureRecord,rows:readonly SignoffRow[],run:PaperRun,spec:ProfessionSpec){
 const stage=deskStage(rows,spec,run),wanted=papersDigestOf(run),current=requestsOf(rows,run.id).filter(item=>item.workingDigest===wanted).at(-1)??null;
 const sent=current?sentOf(rows,current.id):null,decision=current?decisionOf(rows,current.id):null,named=professionalOf(rows,spec.id);
 return {runId:run.id,orderId:run.orderId,title:run.deliverable?.title??'Draft',status:run.status,profession:spec.id,signer:spec.signer,registryLabel:spec.registry.label,
  professional:named?{name:named.name,registrationNumber:named.registrationNumber}:null,stage,line:deskBlock(rows,spec,run),papersDigest:wanted,
  request:current?{id:current.id,at:current.at,sent:sent?{name:sent.name,at:sent.at}:null,decision:decision?{decision:decision.decision,name:decision.name,at:decision.at,note:decision.note}:null}:null};
}
function regulatedRuns(state:State,venture:VentureRecord){
 return listRecords(state,'venture-delivery-run',venture.id).filter(run=>!['rejected','failed','stopped','cancelled'].includes(run.status)&&!run.practice).flatMap(run=>{const spec=signoffDeskSpec(state,venture,run.orderId);return spec?[{run,spec}]:[];});
}
function paperOf(state:State,venture:VentureRecord,runId:string){
 const found=regulatedRuns(state,venture).find(item=>item.run.id===runId);
 check(found,'SIGNOFF_NOT_FOUND','That draft is not a regulated paper of this business.');
 return {...found,view:paperView(state,venture,rowsOf(state,venture.id),found.run,found.spec)};
}

export const SIGNOFF_DESK_DESK:DeskHandlers=Object.freeze({
 professional:{
  async list(deps,ctx,raw){request(raw,'list','professional');const {state,venture}=readVenture(deps,ctx),rows=rowsOf(state,venture.id);
   return {playbook:P,kind:'professional',rows:PROFESSION_SPECS.map(spec=>professionalView(rows,spec)),line:'The licensed professional who signs each kind of paper.'};},
  async get(deps,ctx,raw){const p=request(raw,'get','professional'),spec=professionSpec(p.id);check(spec,'INVALID_VENTURE_REQUEST','Choose a profession.');const {state,venture}=readVenture(deps,ctx);const item=professionalView(rowsOf(state,venture.id),spec);return {playbook:P,kind:'professional',item,digest:digest(item)};},
  async act(deps,ctx,raw){requireAppChannel(ctx,'venture.desk.act');const p=request(raw,'act','professional'),spec=professionSpec(p.id);check(spec,'INVALID_VENTURE_REQUEST','Choose a profession.');
   check(p.action==='name','INVALID_VENTURE_REQUEST','Choose a sign-off desk action.');const named=professionalInput(spec,exactPayload(p.payload,['name','registrationNumber'],['name','registrationNumber']));
   return ventureAction(deps,ctx,'approve','signoff.professional',tx=>{tx.put({...tx.base('venture-signoff'),entry:'professional',profession:spec.id,...named});tx.emit('desk.changed',{playbook:P});tx.emit('queue.changed',{});
    return {playbook:P,kind:'professional',id:spec.id,result:professionalView(rowsOf(tx.state,tx.venture!.id),spec),line:`${named.name} signs every ${spec.label.toLowerCase()} paper from now on.`};});}
 },
 paper:{
  async list(deps,ctx,raw){request(raw,'list','paper');const {state,venture}=readVenture(deps,ctx),rows=rowsOf(state,venture.id);
   return {playbook:P,kind:'paper',rows:regulatedRuns(state,venture).map(({run,spec})=>{const view=paperView(state,venture,rows,run,spec);return {runId:view.runId,orderId:view.orderId,title:view.title,profession:view.profession,stage:view.stage,line:view.line};}),line:'Every regulated paper waits for its professional\'s signature.'};},
  async get(deps,ctx,raw){const p=request(raw,'get','paper'),{state,venture}=readVenture(deps,ctx);const {view}=paperOf(state,venture,identifier(p.id,'Draft'));return {playbook:P,kind:'paper',item:view,digest:digest(view)};},
  async act(deps,ctx,raw){requireAppChannel(ctx,'venture.desk.act');const p=request(raw,'act','paper'),runId=identifier(p.id,'Draft');
   check(['send','sign','return'].includes(p.action as string),'INVALID_VENTURE_REQUEST','Choose a sign-off desk action.');
   const body=p.action==='sign'?exactPayload(p.payload,['registrationNumber'],['registrationNumber']):p.action==='return'?exactPayload(p.payload,['note'],[]):exactPayload(p.payload,[],[]);
   const note=p.action==='return'?noteInput(body.note):null;
   // Read the run's view for its own checks first; it never includes the signature, which is what this desk decides.
   const {runView}=await import('../../delivery/runs.ts');
   return ventureAction(deps,ctx,'approve','signoff.'+p.action,tx=>{
    const venture=tx.venture!,{run,spec,view}=paperOf(tx.state,venture,runId),rows=rowsOf(tx.state,venture.id);
    check(p.digest===digest(view),'APPROVAL_CHANGED','These papers changed. Read them again.');
    let line:string;
    if(p.action==='send'){
     const named=professionalOf(rows,spec.id);check(named,'SIGNOFF_SIGNER_REQUIRED',`Name ${spec.signer} first.`);
     check(['not-asked','unsent','changed'].includes(view.stage),'SIGNOFF_DECIDED','These papers were sent or decided already.');
     check(papersReady(run,runView(run,venture,Date.parse(tx.now)).canAccept),'SIGNOFF_PAPERS_NOT_READY','These papers are not ready to sign. Resolve the draft\'s checks first.');
     const asked=view.request&&!view.request.decision?view.request.id:tx.put({...tx.base('venture-signoff'),entry:'request',profession:spec.id,deliveryId:run.id,orderId:run.orderId,clientId:tx.find('venture-order',run.orderId)?.clientId??'',workingDigest:view.papersDigest,title:view.title.slice(0,140)}).id;
     tx.put({...tx.base('venture-signoff'),entry:'sent',requestId:asked,name:named.name,registrationNumber:named.registrationNumber});line=`Waiting for ${named.name} to sign.`;
    }else{
     check(view.stage==='sent'&&view.request,'SIGNOFF_NOT_FOUND','These papers are not waiting for a signature.');
     const sent=sentOf(rows,view.request!.id)!;
     if(p.action==='sign')signerMatches(sent,body.registrationNumber,spec);
     tx.put({...tx.base('venture-signoff'),entry:'decision',requestId:view.request!.id,decision:p.action==='sign'?'signed':'returned',name:sent.name,registrationNumber:sent.registrationNumber,workingDigest:view.papersDigest,note});
     line=p.action==='sign'?`Signed by ${sent.name}.`:'Returned. Draft the papers again.';
    }
    tx.emit('desk.changed',{playbook:P});tx.emit('queue.changed',{});
    return {playbook:P,kind:'paper',id:run.id,result:paperOf(tx.state,venture,run.id).view,line};
   });}
 }
});
