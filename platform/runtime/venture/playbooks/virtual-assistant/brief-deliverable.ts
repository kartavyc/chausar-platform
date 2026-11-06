// Original exact approved-brief copy, shared by native delivery and browser rehearsal.
import type {RoomBrief} from '../kit/client-room-core.ts';
/** The built-in option is an exact brief copy, not invented completed client work. */
export function vaBriefDeliverable(brief:RoomBrief){
 const text=[brief.fields.scope,brief.fields.deliverable,brief.fields.deadline].join('\n');
 return {title:'Approved client brief',sections:[{heading:'Brief',parts:[{kind:'text' as const,text},{kind:'figure' as const,receiptId:brief.price.receiptId,figureKey:'total'}]},{heading:'Work notes',parts:[{kind:'text' as const,text:'This is the approved brief only. Prepare the requested work from its sources. Nothing has been sent or bought.'}]}],questionsForClient:[]};
}
