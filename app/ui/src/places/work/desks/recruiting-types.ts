// Browser-safe recruiting desk view and action shapes.
import type {RecruitRoleBody,RecruitCandidateBody,RecruitTouchBody,RecruitInterviewBody} from '../../../../../../platform/runtime/venture/playbooks/recruiting-desk/records';
export type RecruitRoleView=RecruitRoleBody&{id:string;question:{id:string;question:string;suggestedAnswer:string}|null};
export type RecruitCandidateView=RecruitCandidateBody&{id:string;at:string;ledger?:{name:string;role:string;stage:string;recommendation:string|null;source:string;noticeShownOn:string|null;lastTouch:string|null;nextStep:string}};
export type RecruitTouchView=RecruitTouchBody&{id:string};
export type RecruitInterviewView=RecruitInterviewBody&{id:string};
export type RecruitAct=(kind:string,id:string,action:string,payload:Record<string,unknown>,digest?:string)=>Promise<{id:string;result:any}|null>;
