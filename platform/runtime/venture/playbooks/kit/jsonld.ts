// 5A5 JSON-LD public API. The shared builder stays browser-safe; engine callers keep ChausarError codes.
import { ChausarError } from '../../../contracts.ts';
import {jsonLdObject as buildObject,jsonLdScript as buildScript,type JsonLdNode} from './jsonld-core.ts';
export {JSONLD_TYPES} from './jsonld-core.ts';
export type {JsonLdType,JsonLdInnerType,JsonLdObserved,JsonLdValue,JsonLdNode} from './jsonld-core.ts';
function engineError<T>(work:()=>T):T{try{return work();}catch(error){if(error instanceof Error&&'code'in error)throw new ChausarError(String(error.code),error.message);throw error;}}
/** Build structured data only from recorded observed values. */
export const jsonLdObject=(node:JsonLdNode):Record<string,unknown>=>engineError(()=>buildObject(node));
/** Escape a validated JSON-LD script without allowing markup injection. */
export const jsonLdScript=(node:JsonLdNode):string=>engineError(()=>buildScript(node));
