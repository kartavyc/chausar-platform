// Final completion is a record check, never a model assertion.
import {need} from './criteria.ts';
import {rulesReady} from './role-state.ts';
import {doneWhen} from './ledger.ts';
import type {RecruitRoleBody,RecruitCandidateBody,RecruitTouchBody,RecruitInterviewBody} from './records.ts';
export function recruitCompletion(role:RecruitRoleBody&{id:string},candidates:readonly (RecruitCandidateBody&{id:string;at:string})[],touches:readonly (RecruitTouchBody&{id:string;at:string})[],offerKey:string|null,interviews:readonly RecruitInterviewBody[]=[],digest?:(value:unknown)=>string){
 rulesReady(role);const rows=candidates.filter(c=>c.roleId===role.id),events=touches.filter(t=>t.roleId===role.id).map(t=>({...t,kind:t.touchType,at:t.sentOn??t.at}));if(offerKey==='role-intake')return;
 need(rows.length>0,'RECRUIT_STEP_PENDING','Add and screen candidates before writing a client report.');need(rows.every(c=>c.screenedRuleDigest===role.approvedDigest),'RECRUIT_STEP_PENDING','Screen every candidate against the current role rules.');need(doneWhen(rows,events).pass,'RECRUIT_STEP_PENDING','Every screened candidate needs a recorded greeting or skip reason before this run can finish.');
 if(offerKey==='success-fee')need(rows.some(c=>c.stage==='joined'&&c.history.some(h=>h.stage==='offer'&&!!h.evidenceRef.trim())&&c.history.some(h=>h.stage==='joined'&&!!h.evidenceRef.trim())),'RECRUIT_STEP_PENDING','Record the client offer letter and confirmed joining evidence before completing a hire fee.');
 if(offerKey==='interview-scheduling')need(rows.some(c=>interviews.some(i=>i.roleId===role.id&&i.candidateId===c.id&&i.state==='recorded'&&!!i.evidenceRef?.trim()&&!!digest&&i.sourceDigest===digest({role:role.approvedDigest,source:c.source,findings:c.findings,round:role.round})&&i.approvedDigest===digest({confirmation:i.confirmation,text:i.inviteText,source:i.sourceDigest}))), 'RECRUIT_STEP_PENDING','Approve an exact current interview pack and record sending it before completing interview scheduling.');
}
