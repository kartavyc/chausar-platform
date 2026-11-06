// Original common CA demo refusal boundary, preserving engine codes.
import {EngineError} from './types';
export function caCheck(value:unknown,code:string,line:string):asserts value {if(!value)throw new EngineError(code,line);}
export function caExact(raw:unknown,keys:string[],required=keys){caCheck(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_VENTURE_REQUEST','Send an object.');const p=raw as Record<string,any>;caCheck(Object.keys(p).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(p,key)),'INVALID_VENTURE_REQUEST','Send exactly the requested fields.');return p;}
export function caCall<T>(fn:()=>T):T{try{return fn();}catch(e){throw new EngineError((e as {code?:string}).code??'TAX_INPUT_INVALID',(e as Error).message);}}
export const caOut=(kind:string,id:string,result:unknown)=>({playbook:'ca-firm',kind,id,result,line:'Preparation and review only. Nothing filed, sent or posted externally.'});
