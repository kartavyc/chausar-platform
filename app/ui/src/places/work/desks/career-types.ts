// Portable owner view types. Authority remains in the engine; local inputs never grant approval.
import type {Json} from '../../../../../../platform/runtime/portable';
import type {CareerFactBody,CareerListingBody,CareerThreadBody} from '../../../../../../platform/runtime/venture/playbooks/job-search-desk/records';
export type CareerRecord<T>=T&{id:string;kind:string;ventureId:string;memberId:string;epoch:number;at:string};
export type CareerFactRow=CareerRecord<CareerFactBody>;export type CareerListingRow=CareerRecord<CareerListingBody>;export type CareerThreadRow=CareerRecord<CareerThreadBody>&{ageDays:number};
export type CareerAction=(kind:'fact'|'listing'|'thread'|'research',id:string,action:string,payload:Json,expected?:string)=>Promise<{id:string;result:unknown}|null>;
export const careerLines=(text:string)=>text.split('\n').map(v=>v.trim()).filter(Boolean);
