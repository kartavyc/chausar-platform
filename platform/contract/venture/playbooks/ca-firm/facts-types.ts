// Canonical browser-safe types, shared by the engine and renderer.
import type { Json } from '../../../../shared/portable.ts';

export type FactsHandoffInput={to:string;turn:number;question:string;answer:unknown;answeredBy:string|null};

export type FactsCallInput={tool:string;turn:number;envelope:{ok:true;result:unknown}|{ok:false;error:{code:string;message:string;details?:Json}}};
