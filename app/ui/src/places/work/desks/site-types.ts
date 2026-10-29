import type {SiteRequirementBody,SiteReleaseBody} from '../../../../../../platform/runtime/venture/playbooks/website-studio/records';
export type SiteView=SiteRequirementBody&{id:string;stale:boolean;counts:{all:number;pass:number;fail:number;inconclusive:number;unverified:number};ship:{line:string;reason:string};releases?:Array<SiteReleaseBody&{id:string;digest:string}>};
export type SiteAct=(id:string,action:string,payload:unknown,digest?:string)=>Promise<{id:string;result:unknown;line:string}|null>;
export type SiteProps={item:SiteView;digest:string;busy:boolean;act:SiteAct};
