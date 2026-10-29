// Engine authority wrapper around the shared deterministic service checks.
import type {FlagshipCheckInput} from '../draft-checks.ts';
import {requireRights} from '../../delivery/rights.ts';
import {youtubeServiceCheckCore} from './service-check-core.ts';
export {AFTER_PUBLISH_WORDS} from './service-check-core.ts';
export function youtubeServiceChecks(input:Pick<FlagshipCheckInput,'offerKey'|'deliverable'|'intake'|'toolCalls'|'receipts'|'files'>&{today?:string}){
 let rightsValid=false;try{rightsValid=!!requireRights({id:'youtube-service',clipping:true},input.intake,input.today??'9999-12-31');}catch{}
 return youtubeServiceCheckCore({...input,offerKey:input.offerKey??'',rightsValid,receipts:input.receipts.flatMap(receipt=>'operation'in receipt&&receipt.operation==='youtube.compute'?[{id:receipt.id,operation:receipt.operation,inputs:receipt.inputs,figures:receipt.figures}]:[])});
}
