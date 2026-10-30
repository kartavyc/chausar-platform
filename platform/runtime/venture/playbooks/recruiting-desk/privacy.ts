// Original Chausar erasure of recruiting evidence and copied delivery authority.
import type {VentureTx} from '../../records.ts';
import {recruitSourceMail} from './source-mail.ts';
import {removeRecords} from '../../network/people.ts';
export function eraseRecruitingNaming(tx:VentureTx,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean):void{
 const named=(text:string)=>mentions(text)||[...handles].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));
 const candidates=tx.list('venture-recruit-candidate').filter(c=>named(JSON.stringify(c))),ids=new Set(candidates.map(c=>c.id)),roleIds=new Set(candidates.map(c=>c.roleId));
 const mailIds=new Set(recruitSourceMail(tx,candidates).map(m=>m.id));
 const orderIds=new Set(tx.list('venture-recruit-role').filter(r=>roleIds.has(r.id)).map(r=>r.serviceOrderId));
 const runs=tx.list('venture-delivery-run').filter(r=>orderIds.has(r.orderId)),runIds=new Set(runs.map(r=>r.id));
 const reportIds=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 const sourceIds=new Set(candidates.filter(c=>c.source.kind==='file').map(c=>c.source.id));
 const uploads=new Set(tx.list('venture-upload').filter(f=>sourceIds.has(f.id)||(f.scope.kind==='order'&&orderIds.has(f.scope.orderId)&&named(Buffer.from(f.contentBase64??'','base64').toString('utf8')))).map(f=>f.id));
 removeRecords(tx,r=>r.kind==='venture-recruit-candidate'&&ids.has(String(r.id))||(r.kind==='venture-recruit-touch'||r.kind==='venture-recruit-interview')&&(ids.has(String(r.candidateId))||named(JSON.stringify(r)))||r.kind==='venture-upload'&&uploads.has(String(r.id))||r.kind==='venture-inbound'&&mailIds.has(String(r.id))||r.kind==='venture-share-link'&&runIds.has(String(r.deliveryId))||r.kind==='venture-report'&&reportIds.has(String(r.id))||r.kind==='venture-report-share'&&reportIds.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&typeof r.runRef==='object'&&r.runRef!==null&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 if(ids.size)tx.emit('desk.changed',{playbook:'recruiting-desk'});
}
