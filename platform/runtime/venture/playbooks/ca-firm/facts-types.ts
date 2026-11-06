// Small structural inputs for the CA missing-facts checks, without importing store or delivery authority.
import type {Json} from '../../../portable.ts';
export type {Json} from '../../../portable.ts';
export type FactsHandoffInput={to:string;turn:number;question:string;answer:unknown;answeredBy:string|null};
export type FactsCallInput={tool:string;turn:number;envelope:{ok:true;result:unknown}|{ok:false;error:{code:string;message:string;details?:Json}}};
