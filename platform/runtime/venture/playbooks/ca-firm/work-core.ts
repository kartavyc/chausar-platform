// C2 original review state shared by the owner desk and demo. No tax rule is inferred here.
import type {CaReceipt} from './receipt.ts';
import type {VoucherDraft} from './doc-entry-types.ts';
export type CaFindingDecision={findingId:string;decision:'confirmed'|'dismissed';evidence:string[];note:string;caName:string;membershipNumber:string;at:string};
export type CaWorkingBody={clientId:string;orderId:string|null;receiptId:string;receiptDigest:string;mode:'what-if'|'document'|'health';receipt:CaReceipt;decisions:CaFindingDecision[];vouchers:(Omit<VoucherDraft,'state'> & {state:'draft'|'approved';approvedAt?:string})[];postedExternally:false};
export function validateFinding(raw:unknown,receipt:CaReceipt){
 const p=raw as {findingId:string;decision:string;evidence:string[];note:string;membershipNo:string};
 const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
 if(!p||!['confirmed','dismissed'].includes(p.decision)||typeof p.note!=='string'||p.note.trim().length<3||p.note.length>400)fail('CA_FINDING_INVALID','Choose a finding decision and explain the evidence.');
 const finding=(receipt.working as {findings?:{id:string;evidence:string[]}[]}).findings?.find(row=>row.id===p.findingId);
 if(!finding)fail('CA_FINDING_UNKNOWN','Choose a finding in this working.');
 if(!Array.isArray(p.evidence)||!p.evidence.length||new Set(p.evidence).size!==p.evidence.length||p.evidence.some(id=>!finding!.evidence.includes(id)))fail('CA_FINDING_EVIDENCE_REQUIRED','Select source evidence belonging to this finding.');
 return {findingId:p.findingId,decision:p.decision as 'confirmed'|'dismissed',evidence:[...p.evidence],note:p.note.trim()};
}
