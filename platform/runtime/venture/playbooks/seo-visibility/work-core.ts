// SEO monthly work contracts shared with the fake. Original Chausar code, catalogue SEO4-SEO8 ideas only.
import {seoNeed} from './content-core.ts';
export const SEO_WORK_OPERATIONS=['content','meta','impact','refresh','local','strategy'] as const;
export type SeoWorkOperation=typeof SEO_WORK_OPERATIONS[number];
export type SeoWorkBody={orderId:string;clientId:string;operation:SeoWorkOperation;uploadId:string;sourceDigest:string;result:any;receipt:string;checkedAt:string;state:'checked'|'approved'|'muted'|'resolved';appliedEditId:string|null;acceptance:{checkedOn:string;receipt:string}|null};
export type SeoWorkItem=SeoWorkBody&{id:string;stale:boolean};
/** Desk payloads never silently discard unexpected fields. */
export function seoExact(raw:unknown,keys:string[],required=keys):Record<string,any>{seoNeed(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_VENTURE_REQUEST','Send one request object.');const p=raw as Record<string,any>;seoNeed(Object.keys(p).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(p,key)),'INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');return p;}
export function seoOperation(value:unknown):SeoWorkOperation {seoNeed(SEO_WORK_OPERATIONS.includes(value as SeoWorkOperation),'SEO_INPUT_INVALID','Choose an available search work check.');return value as SeoWorkOperation;}
export function requireFreshWork(item:SeoWorkItem){seoNeed(!item.stale,'SEO_SOURCE_CHANGED','The order or source file changed. Run this check again before approving it.');}
