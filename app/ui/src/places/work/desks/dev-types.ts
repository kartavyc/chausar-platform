// Browser-only owner view of source reviews. Figures arrive formatted from native code.
import type {DevPermissionBody} from '../../../../../../platform/runtime/venture/playbooks/dev-agency/records';
export type DevView=DevPermissionBody&{id:string;sourcePaths:string[];coverage:{complete:boolean;readLines:number;totalLines:number;line:string};verdict:{verdict:string;basis:string};checksComplete:boolean};
export type DevAct=(id:string,action:string,payload:unknown,digest?:string)=>Promise<{id:string;result:unknown}|null>;
export type DevProps={item:DevView;digest:string;busy:boolean;act:DevAct};
