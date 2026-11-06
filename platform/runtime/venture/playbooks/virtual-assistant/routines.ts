// Original private reports from saved records. OpenMuse and Open Duet inform the workflow; no source code copied.
import {check,type Context} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {digest,listRecords,readVenture} from '../../records.ts';
import {queueListHandler} from '../../views/queue.ts';
import {vaReportSourcesValid} from './checks.ts';
import {type VaReportKind} from './routines-core.ts';
export {vaRoutinePreset,VA_REPORT_PROMPTS,type VaReportKind} from './routines-core.ts';
export type VaReportLine={text:string;source:{kind:'mail'|'monitor'|'today';id:string;digest:string};receiptIds:string[]};
export async function vaRecordReport(deps:VentureDeps,ctx:Context,kind:VaReportKind){
 check(kind==='morning'||kind==='weekly','INVALID_VENTURE_REQUEST','Choose a morning brief or weekly report.');
 const {state,venture}=readVenture(deps,ctx),now=deps.clock(),since=now.getTime()-(kind==='morning'?1:7)*86400000;
 const mail=listRecords(state,'venture-inbound',venture.id).filter(r=>Date.parse(r.date)>=since&&Date.parse(r.date)<=now.getTime()&&r.screen?.status!=='quarantined').slice(-100),monitors=listRecords(state,'venture-monitor',venture.id).filter(r=>r.removedAt===null).slice(-20);
 const queue=await queueListHandler(deps,ctx,{scope:'current'}),live=deps.store.read();
 for(const r of [...mail,...monitors])check(listRecords(live,r.kind,venture.id).some(current=>current.id===r.id&&digest(current)===digest(r)),'APPROVAL_STALE','The source records changed. Read the report again.');
 const lines:VaReportLine[]=[...mail.map(r=>({text:r.subject,source:{kind:'mail' as const,id:r.id,digest:digest(r)},receiptIds:[]})),...monitors.map(r=>({text:r.url+': '+(r.lastError?'Last check failed':r.seeded?'Saved monitor status available':'Waiting for the first check'),source:{kind:'monitor' as const,id:r.id,digest:digest(r)},receiptIds:[]})),...queue.rows.filter(r=>!r.id.startsWith('routine:')).slice(0,100).map(r=>({text:r.title,source:{kind:'today' as const,id:r.id,digest:r.digest},receiptIds:[...new Set([...(r.price?[r.price.receiptId]:[]),...(r.amounts??[]).flatMap(a=>a.receiptId?[a.receiptId]:[])])]}))];
 const sources=new Map<string,string>([...mail.map(r=>['mail:'+r.id,digest(r)] as const),...monitors.map(r=>['monitor:'+r.id,digest(r)] as const),...queue.rows.map(r=>['today:'+r.id,r.digest] as const)]);
 check(vaReportSourcesValid(lines,sources),'APPROVAL_STALE','A report line lost its source. Read the records again.');
 return {kind,asOf:now.toISOString(),revision:live.revision,private:true as const,lines,text:lines.map(l=>l.text+' [source '+l.source.kind+':'+l.source.id+'; digest '+l.source.digest+']'+l.receiptIds.map(id=>' [receipt '+id+']').join('')).join('\n'),empty:lines.length===0};
}
