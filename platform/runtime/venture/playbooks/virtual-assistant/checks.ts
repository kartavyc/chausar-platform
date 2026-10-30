// Original code checks. A fluent draft cannot stand in for the saved owner approval.
import type {KitBaselineCase} from '../kit/define.ts';
import {roomBrief,approveRoomBrief,type RoomBrief} from '../kit/client-room-core.ts';
import {paymentFieldAllowed} from './payment.ts';
export function vaReportSourcesValid(lines:readonly {text:string;source:{kind:string;id:string;digest:string}}[],sources:ReadonlyMap<string,string>){return lines.every(line=>typeof line.text==='string'&&['mail','monitor','today'].includes(line.source?.kind)&&/^[a-f0-9]{64}$/.test(line.source.digest)&&sources.get(line.source.kind+':'+line.source.id)===line.source.digest);}
export {roomApproved,vaBriefCheck} from './brief-check.ts';
export function scoreVaBaseline(item:KitBaselineCase,draft:string,meta:Readonly<Record<string,string>>){
 try{
  const data=JSON.parse(meta.source??'null');let actual='';
  if(item.id==='card-field-refused'){try{paymentFieldAllowed(data);}catch(error){actual=(error as {code:string}).code;}return{pass:actual===draft,why:'The actual payment-field guard determines the refusal.'};}
  if(item.id==='brief-version-changed'){const first=roomBrief(data.first,null),approved=approveRoomBrief(first,first.digest,'owner','2026-10-29T10:00:00Z'),next=roomBrief(data.next,approved);try{approveRoomBrief(next,first.digest,'owner','2026-10-29T10:01:00Z');actual='approved';}catch(error){actual=(error as {code:string}).code;}return{pass:actual===draft,why:'The actual version guard determines whether approval is stale.'};}
  if(item.id==='morning-brief-sources'){const valid=Array.isArray(data.lines)&&data.lines.length>0&&Array.isArray(data.sources)&&vaReportSourcesValid(data.lines,new Map(data.sources));return{pass:(valid?'sourced':'missing-source')===draft,why:'Each report line needs a matching saved source identity and digest.'};}
 }catch{return{pass:false,why:'The supplied evidence is invalid.'};}
 return{pass:false,why:'Unknown baseline case.'};
}
