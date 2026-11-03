// Chausar playbook kit (wave 6, 6E5): the one gate every accept, share, post and report path asks before regulated
// papers leave Chausar. The CA firm's gate (CA of record, ICAI number) and the sign-off desk's (advocate, doctor,
// SEBI-registered adviser, company secretary, CA) both run on kit/signoff-core.ts. Reads only. Written for Chausar.
import type {State} from '../../../contracts.ts';
import type {DeliveryRunRecord,VentureRecord} from '../../contracts.ts';
import {caSignoffBlock} from '../ca-firm/signoff-gate.ts';
import {signoffDeskBlock} from '../signoff-desk/gate.ts';

type GateRun=Pick<DeliveryRunRecord,'id'|'status'|'renderedText'|'deliverable'|'editedText'|'orderId'|'servedBy'>;

/** The refusal for unsigned regulated papers, with its code, or null when the papers may leave. */
export function regulatedSignoff(state:State,venture:VentureRecord,run:GateRun):{code:'CA_SIGNOFF_REQUIRED'|'SIGNOFF_REQUIRED';line:string}|null{
 const ca=caSignoffBlock(state,venture,run);
 if(ca)return {code:'CA_SIGNOFF_REQUIRED',line:ca};
 const desk=signoffDeskBlock(state,venture,run);
 return desk?{code:'SIGNOFF_REQUIRED',line:desk}:null;
}
/** The words of regulatedSignoff, or null. */
export function regulatedSignoffBlock(state:State,venture:VentureRecord,run:GateRun):string|null{return regulatedSignoff(state,venture,run)?.line??null;}
