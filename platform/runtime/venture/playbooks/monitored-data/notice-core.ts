// Source-derived alert text is shared by native Today and browser rehearsal.
import {digest} from '../../../portable.ts';
import type {WatchSourceBody} from './records.ts';
export function watchNotice(row:WatchSourceBody&{id:string}){
 const alert=row.alerts.at(-1),failed=!!row.lastError;
 if(!failed&&!alert)return null;
 const createdAt=failed?row.lastCheckedAt:alert?.at;if(!createdAt)return null;
 return{subject:'watch-source:'+row.id,version:digest({at:createdAt,error:row.lastError,alert:alert?.digest??null}),createdAt,title:failed?'Review a source read problem':'Review changed source values',line:failed?'This source could not be checked. Review its permissions and selected values.':'Selected values changed on the source. Review the measured values and their receipts before sharing.',link:'#/work?watchSource='+encodeURIComponent(row.id)};
}
