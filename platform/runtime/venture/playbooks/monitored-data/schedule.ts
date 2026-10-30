// Bounded K16-style standing reads: desktop only, explicit source approval, one site-hour, no alert on initial seed.
import type {Context} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';import {digest} from '../../records.ts';import {watchRead,currentWatch} from './sources.ts';import {checkWatchedSource} from './check.ts';
export async function checkWatchedSourcesDue(deps:VentureDeps,ctx:Context,budget:{looks?:number;budgetMs?:number}={}){
 if(deps.host==='hosted-web')return;const started=Date.now(),maxLooks=budget.looks??5,maxMs=budget.budgetMs??45000;let count=0;
 try{const tx=watchRead(deps,ctx),now=Date.parse(tx.now),last=new Map<string,number>();for(const row of [...tx.list('venture-monitor'),...tx.list('venture-watch-source')])if(row.lastCheckedAt){const host=new URL(row.url).hostname;last.set(host,Math.max(last.get(host)??0,Date.parse(row.lastCheckedAt)));}
 const due=tx.list('venture-watch-source').filter(r=>r.enabled&&r.nextCheckAt&&Date.parse(r.nextCheckAt)<=now).sort((a,b)=>(a.lastCheckedAt??'').localeCompare(b.lastCheckedAt??'')||a.id.localeCompare(b.id));
 for(const row of due){if(count>=maxLooks||Date.now()-started>=maxMs)break;const host=new URL(row.url).hostname;if(now-(last.get(host)??0)<3600000)continue;try{const current=currentWatch(watchRead(deps,ctx),row.id);if(!current.enabled)continue;last.set(host,now);count++;await checkWatchedSource(deps,ctx,row.id,digest(current),true);}catch{/* Each checked source records its own safe failure. Revoked or stale source authority never grants a read. */}}
 }catch{/* Workspace closed or unavailable. A later Keeper sweep can retry still-approved due sources. */}
}
