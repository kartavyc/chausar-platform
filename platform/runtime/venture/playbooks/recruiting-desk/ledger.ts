// Original Chausar candidate ledger; forward-only and daily-card ideas from recruiting-copilot (MIT).
import {need} from './criteria.ts';
export const LEDGER_COLUMNS=['name','role','stage','recommendation','source','noticeShownOn','lastTouch','nextStep'] as const;
export function ledgerEntry(candidate:{id:string;name:string;stage:string;recommendation:string|null;source:{kind:string;url:string|null};noticeShownOn:string|null;skipReason:string|null},role:{brief:{title:string}|null},touches:readonly {candidateId:string;state:string;sentOn:string|null}[]){const lastTouch=touches.filter(t=>t.candidateId===candidate.id&&t.state==='recorded'&&t.sentOn).map(t=>t.sentOn!).sort().at(-1)??null;return {name:candidate.name,role:role.brief?.title??'',stage:candidate.stage,recommendation:candidate.recommendation,source:candidate.source.url??candidate.source.kind,noticeShownOn:candidate.noticeShownOn,lastTouch,nextStep:candidate.skipReason?'waiting':candidate.stage==='sourced'?'screen':candidate.stage==='screened'?'greet':['joined','rejected','withdrawn'].includes(candidate.stage)?'closed':'follow-up'};}
export type CandidateStage='sourced'|'screened'|'contacted'|'replied'|`interview-${number}`|'offer'|'joined'|'rejected'|'withdrawn';
export type StageEvidence={stage:string;evidenceRef:string;on:string};
const TERMINAL=new Set(['joined','rejected','withdrawn']);
const ranks:Record<string,number>={sourced:0,screened:1,contacted:2,replied:3,offer:100,joined:101,rejected:102,withdrawn:102};
function rank(stage:string){const round=/^interview-([1-9]|10)$/.exec(stage);return round?3+Number(round[1]):ranks[stage];}
/** A known email identifies one person; otherwise only the name in the same role is a deduplication key. */
export function candidateKey(input:{email:string|null;name:string;roleId:string}):string {return input.email?.trim()? 'email:'+input.email.trim().toLowerCase():'name:'+input.name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')+'|role:'+input.roleId;}
/** Never infer a move from a draft or model verdict; only evidence can advance a saved candidate. */
export function moveCandidate<T extends {stage:string;history:StageEvidence[]}>(candidate:T,to:string,evidenceRef:string,on:string,ownerApproved=false):T{
 need(rank(to)!==undefined&&rank(candidate.stage)!==undefined,'INVALID_VENTURE_REQUEST','Choose a known candidate stage.');
 need(typeof evidenceRef==='string'&&!!evidenceRef.trim()&&evidenceRef.length<=500,'RECRUIT_EVIDENCE_REQUIRED','Record the evidence for this stage change.');
 need(!TERMINAL.has(candidate.stage),'RECRUIT_STAGE_TERMINAL','A closed candidate record cannot move to another stage.');
 need(rank(to)!>rank(candidate.stage)!,'RECRUIT_STAGE_BACKWARD','Candidates only move forward through their stages.');
 need(!['rejected','contacted','offer','joined'].includes(to)&&!to.startsWith('interview-')||ownerApproved,'RECRUIT_APPROVAL_REQUIRED','The owner must approve this exact candidate action.');
 return {...candidate,stage:to,history:[...candidate.history,{stage:to,evidenceRef:evidenceRef.trim(),on}]};
}
/** Batch consent binds one exact set of candidates, the shown payload and one current round. */
export function roundConsent(consent:{round:number;candidateIds:readonly string[];digest:string;used:boolean}|null,round:number,candidateIds:readonly string[],digest:string):boolean {return !!consent&&!consent.used&&consent.round===round&&consent.digest===digest&&new Set(candidateIds).size===candidateIds.length&&[...consent.candidateIds].sort().join('\n')===[...candidateIds].sort().join('\n');}
type LedgerPerson={id:string;roleId:string;name:string;stage:string;skipReason:string|null;at:string};
type LedgerTouch={candidateId:string;state:string;kind:string;at:string};
/** A screened person must have a recorded greeting or a visible reason, never a silently completed step. */
export function doneWhen(candidates:readonly LedgerPerson[],touches:readonly LedgerTouch[]){const waiting=candidates.filter(c=>c.stage==='screened'&&!c.skipReason&&!touches.some(t=>t.candidateId===c.id&&t.kind==='first-message'&&t.state==='recorded')).map(c=>({id:c.id,reason:'Approve a first message or record a skip reason.'}));return {pass:waiting.length===0,waiting};}
/** Counts are code-derived and contacts are omitted from client reports; the link opens the actual role desk. */
export function ledgerReport(candidates:readonly LedgerPerson[],touches:readonly LedgerTouch[],day:string,roleId:string){const rows=candidates.filter(c=>c.roleId===roleId),ids=new Set(rows.map(c=>c.id));const dayTouches=touches.filter(t=>ids.has(t.candidateId)&&t.state==='recorded'&&t.at.slice(0,10)===day);const pending=doneWhen(rows,touches).waiting;const waiting=rows.filter(c=>c.skipReason||pending.some(p=>p.id===c.id)).map(c=>({id:c.id,name:c.name,reason:c.skipReason??pending.find(p=>p.id===c.id)!.reason}));return {day,roleId,tiles:{newCandidates:rows.filter(c=>c.at.slice(0,10)===day).length,greeted:new Set(dayTouches.filter(t=>t.kind==='first-message').map(t=>t.candidateId)).size,replied:new Set(dayTouches.filter(t=>t.kind==='reply').map(t=>t.candidateId)).size,waiting:waiting.length},keyPeople:rows.filter(c=>['offer','joined'].includes(c.stage)||c.stage.startsWith('interview-')).slice(0,3).map(c=>({id:c.id,name:c.name,stage:c.stage})),waiting,rest:rows.map(c=>({id:c.id,name:c.name,stage:c.stage})),link:'#/work?recruitRole='+encodeURIComponent(roleId)};}
