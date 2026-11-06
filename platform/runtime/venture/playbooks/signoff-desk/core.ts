// Chausar playbook: the sign-off desk (wave 6, 6E5). Pure rules over the desk's entries, shared by the engine
// (desk.ts, gate.ts) and the browser fake, so both answer the same codes and words: who the professional of record is,
// where a run's papers stand (kit/signoff-core.ts), and the checks on naming, sending and signing. Written for Chausar.
import {check} from '../../../portable.ts';
import {gateBlock,gateStage,papersDigestOf,papersEdit,type GateStage,type PapersRun} from '../kit/signoff-core.ts';
import {registrationKey,signoffWords,type ProfessionSpec,type SignoffProfession} from './professions.ts';
import type {SignoffBody} from './records.ts';

export type SignoffRow=SignoffBody&{id:string;at:string};
type Of<E extends SignoffBody['entry']>=Extract<SignoffRow,{entry:E}>;
const of=<E extends SignoffBody['entry']>(rows:readonly SignoffRow[],entry:E)=>rows.filter(row=>row.entry===entry) as Of<E>[];
export type DeskRun=PapersRun&{orderId:string;servedBy:string;practice?:boolean};

/** The newest professional of record for a profession, or null. */
export function professionalOf(rows:readonly SignoffRow[],profession:SignoffProfession):Of<'professional'>|null{return of(rows,'professional').filter(row=>row.profession===profession).at(-1)??null;}
export function requestsOf(rows:readonly SignoffRow[],runId:string):Of<'request'>[]{return of(rows,'request').filter(row=>row.deliveryId===runId);}
export function sentOf(rows:readonly SignoffRow[],requestId:string):Of<'sent'>|null{return of(rows,'sent').filter(row=>row.requestId===requestId).at(-1)??null;}
export function decisionOf(rows:readonly SignoffRow[],requestId:string):Of<'decision'>|null{return of(rows,'decision').filter(row=>row.requestId===requestId).at(-1)??null;}

/** Where a run's papers stand with its professional. */
export function deskStage(rows:readonly SignoffRow[],spec:ProfessionSpec,run:DeskRun):GateStage{
 const edited=papersEdit(run)!==null;
 return gateStage({edited,servedByModel:run.servedBy==='model',wanted:edited||run.servedBy==='model'?papersDigestOf(run):'',hasSigner:!!professionalOf(rows,spec.id),
  requests:requestsOf(rows,run.id),decision:id=>decisionOf(rows,id)?.decision??null,sent:id=>!!sentOf(rows,id)});
}
/** Why the run's papers cannot be accepted, shared or posted yet, or null once the professional signed these exact papers. */
export function deskBlock(rows:readonly SignoffRow[],spec:ProfessionSpec,run:DeskRun):string|null{return gateBlock(deskStage(rows,spec,run),papersEdit(run)!==null,signoffWords(spec));}

/** Checks a professional of record before it is saved. */
export function professionalInput(spec:ProfessionSpec,raw:Record<string,unknown>):{name:string;registrationNumber:string}{
 const name=typeof raw.name==='string'?raw.name.trim().replace(/\s+/g,' '):'';
 check(name.length>=3&&name.length<=120&&!/[\u0000-\u001f]/.test(name),'INVALID_VENTURE_REQUEST','Write the professional\'s full name.');
 const registrationNumber=registrationKey(raw.registrationNumber);
 check(spec.registry.pattern.test(registrationNumber),'SIGNOFF_REGISTRATION_INVALID',`That is not a ${spec.registry.label}. ${spec.registry.hint}`);
 return {name,registrationNumber};
}

/** Papers can go to the professional once they are a real draft: ready and passing, or the owner's edit; never practice. */
export function papersReady(run:DeskRun&{status:string},canAccept:boolean):boolean{
 if(run.practice)return false;
 if(run.status==='edited')return !!run.editedText;
 return run.status==='ready-for-review'&&run.servedBy==='model'&&canAccept;
}

/** The typed number must be the one of the professional the papers were sent to. */
export function signerMatches(sent:{name:string;registrationNumber:string},typed:unknown,spec:ProfessionSpec):void{
 check(registrationKey(typed)===sent.registrationNumber,'SIGNOFF_SIGNER_MISMATCH',`That is not the ${spec.registry.label} of ${sent.name}, who these papers were sent to.`);
}

/** The professional's note when returning papers: optional, one line, at most four hundred characters. */
export function noteInput(raw:unknown):string|null{
 if(raw===undefined||raw===null||raw==='')return null;
 const text=typeof raw==='string'?raw.trim():'';
 check(text.length>=1&&text.length<=400&&!/[\u0000-\u001f\u007f]/.test(text),'INVALID_VENTURE_REQUEST','Keep the note to one line of four hundred characters.');
 return text;
}
