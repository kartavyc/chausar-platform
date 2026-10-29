// Original private report from actual saved browser records. It never calls a model or sends a message.
import {digest} from '../../../../platform/runtime/portable';import type {W4DeskHost} from './fake-w4';import type {MailThreadsView,MonitorsView} from './types';
export function vaFakeReport(host:W4DeskHost,kind:'morning'|'weekly'):string{const now=Date.parse(host.now()),since=now-(kind==='morning'?1:7)*86400000,lines:string[]=[];
 const threads=(host.ask('venture.mail.threads',{}) as MailThreadsView).threads;
 for(const thread of threads){const found=host.supportThread?.(thread.id);if(found?.held)continue;for(const mail of found?.messages??[]){if(Date.parse(mail.date)<since||Date.parse(mail.date)>now)continue;lines.push(mail.subject+' [source mail:'+mail.messageId+'; digest '+digest(mail)+']');}}
 for(const m of (host.ask('venture.monitors.list',{}) as MonitorsView).monitors.filter(m=>!m.removed).slice(0,20))lines.push(m.url+': '+(m.failing?'Last check failed':m.lastCheckedAt?'Saved monitor status available':'Waiting for the first check')+' [source monitor:'+m.id+'; digest '+digest(m)+']');
 for(const row of host.rows().filter(r=>r.businessId===host.current()&&!r.id.startsWith('routine:')).slice(0,100))lines.push(row.title+' [source today:'+row.id+'; digest '+row.digest+']'+[...new Set([...(row.price?[row.price.receiptId]:[]),...(row.amounts??[]).flatMap(a=>a.receiptId?[a.receiptId]:[])])].map(id=>' [receipt '+id+']').join(''));
 return lines.join('\n')||'No saved records in this report window.';
}
