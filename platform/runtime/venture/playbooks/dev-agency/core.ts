// Original browser-safe validation errors for the developer agency. No third-party code copied.
export class DevError extends Error{readonly code:string;constructor(code:string,message:string){super(message);this.name='DevError';this.code=code;}}
/** Fail closed with the same code in native and fake desk paths. */
export function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)throw new DevError(code,message);}
export function devObject(value:unknown,keys:readonly string[]):Record<string,unknown>{check(typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,'INVALID_VENTURE_REQUEST','Use an object with the listed fields.');const row=value as Record<string,unknown>;check(Object.keys(row).every(k=>keys.includes(k)),'INVALID_VENTURE_REQUEST','Use only the listed fields.');return row;}
