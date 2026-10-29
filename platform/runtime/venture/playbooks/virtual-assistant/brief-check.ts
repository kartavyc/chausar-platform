// Original pure approved-brief checks shared by native delivery and browser rehearsal.
import {digest} from '../../../portable.ts';
import type {RoomBrief} from '../kit/client-room-core.ts';
type BriefCheckInput={roomBrief?:RoomBrief|null;deliverable:{sections:readonly {parts:readonly {kind:string;text?:string;iso?:string;receiptId?:string;figureKey?:string}[]}[]}};
export function roomApproved(brief:RoomBrief|null|undefined):brief is RoomBrief{
 if(!brief?.approved||brief.approved.digest!==brief.digest)return false;
 const {digest:expected,approved:_,...content}=brief,{digest:approvedDigest,by:_by,at:_at,...approvedContent}=brief.approved;
 return digest(content)===expected&&digest(approvedContent)===approvedDigest;
}
export const vaBriefCheck=(input:BriefCheckInput)=>{
 const brief=input.roomBrief,text=input.deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:p.kind==='date'?[p.iso]:[])).join('\n');
 const approved=roomApproved(brief),bounded=approved&&[brief.fields.scope,brief.fields.deliverable,brief.fields.deadline].every(word=>text.includes(word))&&input.deliverable.sections.some(s=>s.parts.some(p=>p.kind==='figure'&&p.receiptId===brief.price.receiptId&&p.figureKey==='total'));
 const unauthorized=/\b(?:I|we|Chausar)\s+(?:have\s+)?(?:paid|purchased|bought|sent the (?:email|message))\b/i.test(text);
 return [{playbook:'virtual-assistant',check:'brief-bounded',outcome:bounded&&!unauthorized?'pass' as const:'fail' as const,detail:bounded&&!unauthorized?'The current approved brief and price receipt are present.':'Use the current approved scope, deliverable, deadline and price receipt. Never claim an unapproved send or purchase.'}];
};
