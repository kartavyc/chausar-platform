// Browser-safe Chausar value primitives. SHA-256 uses @noble/hashes (MIT); no runtime authority or IO is exported.
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export type ScreenNote={mode:'observe'|'enforce';status:'clean'|'flagged'|'quarantined'|'released';digest:string;findings:{kind:string;what:string;at?:string}[]};
export class ChausarError extends Error {
 code:string;
 constructor(code:string,message:string){super(message);this.name='ChausarError';this.code=code;}
}
export function check(condition:unknown,code:string,message:string):asserts condition {if(!condition)throw new ChausarError(code,message);}
export const hash=(value:unknown)=>bytesToHex(sha256(utf8ToBytes(typeof value==='string'?value:JSON.stringify(value))));
/** Canonical JSON matches the engine's established approval representation. */
export function canonical(value:unknown):string{
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){check(Number.isFinite(value),'INVALID_PAYLOAD','Numbers must be finite.');return JSON.stringify(value);}
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 check(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'INVALID_PAYLOAD','Payloads must contain plain JSON data.');
 return `{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
}
export const digest=(value:unknown)=>hash(canonical(value));
/** The same app-source boundary, without importing a store or filesystem into the browser. */
export function isAppChannel(ctx:{channel?:string;sourceTainted?:boolean}|undefined):boolean{return (ctx?.channel==='desktop'||ctx?.channel==='web')&&!ctx.sourceTainted;}
