// Original career fact proposal state. Approval binds the complete proposal and previous accepted value.
import {check,digest} from '../../../portable.ts';
import {careerNeed,factChange,validateFact,type CareerFact} from './facts.ts';
export type CareerFactState={approved:CareerFact|null;proposal:CareerFact|null};
/** Only adding forbidden uses to an approved fact can take effect without a new owner decision. */
export function proposeCareerFact(state:CareerFactState|null,value:CareerFact):CareerFactState{
 validateFact(value);
 const prior=state?.approved??null,identity=prior?.id??state?.proposal?.id;
 careerNeed(identity===undefined||identity===value.id,'A proposal cannot replace another fact.');
 if(prior&&!factChange(prior,value).approvalRequired)return {approved:structuredClone(value),proposal:null};
 return {approved:prior?structuredClone(prior):null,proposal:structuredClone(value)};
}
/** Called only behind the app owner boundary; an old view cannot approve a replacement proposal. */
export function approveCareerFact(state:CareerFactState,expected:string):CareerFactState{
 check(expected===digest(state),'APPROVAL_STALE','Review the current fact and its exact restrictions.');
 careerNeed(state.proposal,'This fact has no pending proposal.');validateFact(state.proposal);
 return {approved:structuredClone(state.proposal),proposal:null};
}
/** Pending proposals never become usable evidence. */
export function currentCareerFacts(states:readonly CareerFactState[]):CareerFact[]{
 careerNeed(Array.isArray(states)&&states.length<=200,'Use a bounded client fact ledger.');
 const facts=states.flatMap(state=>state.approved?[structuredClone(state.approved)]:[]);facts.forEach(validateFact);
 careerNeed(new Set(facts.map(f=>f.id)).size===facts.length,'A client fact may appear only once.');
 return facts;
}
