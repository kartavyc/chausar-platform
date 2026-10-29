// Original permission and week-one boundaries, catalogue X6. IT Act sections 43/66 inform the permission requirement; no external code copied.
import {check} from './core.ts';
export type DevPermission={owner:string;system:string;startsAt:string;endsAt:string;writtenFileId:string;writtenDigest:string};
export type DevOffer='maintenance-retainer'|'qa-service'|'security-review';
const instant=(value:string)=>{check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'INVALID_VENTURE_REQUEST','Use an exact UTC date and time.');return Date.parse(value);};
/** The approval is a current written source for one exact repository; live-system testing is never supported. */
export function assertDevPermission(permission:DevPermission|null,input:{system:string;now:string;writtenFileId:string;writtenDigest:string;liveTarget?:boolean}):true{
 check(input.liveTarget!==true,'DEV_LIVE_TARGET_REFUSED','Only a local source copy can be reviewed. Live-system testing is not supported.');
 check(permission&&typeof permission.owner==='string'&&permission.owner.trim().length>0&&permission.owner.length<=200,'PERMISSION_REQUIRED','Record the code owner and their written permission before security work.');
 check(permission.system===input.system&&permission.writtenFileId===input.writtenFileId&&permission.writtenDigest===input.writtenDigest&&/^[a-f0-9]{64}$/.test(permission.writtenDigest),'PERMISSION_REQUIRED','The written permission must cover this exact current source and repository.');
 const now=instant(input.now),start=instant(permission.startsAt),end=instant(permission.endsAt);check(end>start&&now>=start&&now<end,'PERMISSION_REQUIRED','Written permission is outside its approved window.');return true;
}
/** Week one is seven full elapsed days, starting at the recorded retainer start. */
export function assertMaintenanceChange(offer:DevOffer,startedAt:string,now:string,action:'report'|'patch'|'push'):void{
 const start=instant(startedAt),at=instant(now);check(at>=start,'INVALID_VENTURE_REQUEST','The review cannot precede the recorded service start.');
 check(offer!=='maintenance-retainer'||action==='report'||at-start>=7*24*60*60*1000,'FIRST_WEEK_REPORT_ONLY','The first week is report only. Changes and push handoffs become available after seven full days.');
}
