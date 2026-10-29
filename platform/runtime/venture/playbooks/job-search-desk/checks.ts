// Original saved-ledger delivery checks. A model assertion is never evidence of a client fact or approval.
import type {KitBaselineCase} from '../kit/define.ts';
import {renderClaims,type CareerFact,type CareerClaim} from './facts.ts';
import {careerShortlist} from './shortlist.ts';
import {beforeCareerSend} from './before-send.ts';
export {careerDraftCheck,type CareerDraftEvidence} from './draft-check.ts';
/** Reference answers must match the code-computed refusal or coverage from this case's actual source. */
export function scoreCareerBaseline(testCase:KitBaselineCase,draft:string):{pass:boolean;why:string}{
 let expected:string|null=null;
 try{
  const source=JSON.parse(testCase.meta?.source??'null');
  if(testCase.id==='forbidden-use-blocked'||testCase.id==='no-invented-experience'){
   const result=renderClaims(source.facts,source.claims);
   if(!result.ok&&testCase.id==='forbidden-use-blocked'&&result.code==='claim-boundary')expected=`Do not use ${result.factId} for ${source.claims.find((claim:CareerClaim)=>claim.factId===result.factId).use}.`;
   if(!result.ok&&testCase.id==='no-invented-experience'&&result.code==='unstated-fact')expected=`No approved fact supports ${result.factId}.`;
  }else if(testCase.id==='your-take-unfilled'){
   const result=beforeCareerSend(source);if(result.verdict==='DO NOT SEND'&&result.reasons.includes('your-take-unfilled'))expected='DO NOT SEND. Fill [YOUR TAKE] and confirm both facts.';
  }else if(testCase.id==='shortlist-coverage-first'){
   const result=careerShortlist(source.total,source.rows,source.threshold);expected=result.coverage+'\nKeep: '+result.kept.map(row=>row.id).join(', ')+'.';
  }
 }catch{}
 const pass=expected!==null&&draft.trim()===expected;
 return {pass,why:pass?'The source-backed refusal or coverage is retained.':'The source-backed refusal or coverage is missing.'};
}
