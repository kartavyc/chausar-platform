// Browser-safe owner desk data and callbacks. Native authority remains in the desk handlers.
import type {Json} from '../../../../../../platform/runtime/portable';
import type {NarrationSegmentBody} from '../../../../../../platform/runtime/venture/playbooks/narration-studio/records';
export type NarrationRow=NarrationSegmentBody&{id:string};
export type NarrationJob={orderId:string;rows:NarrationRow[];stale:boolean;connected:boolean;clientReady:boolean;disclosure:string;audio:{segmentId:string;name:string;contentBase64:string;digest:string}[]};
export type NarrationAct=(action:string,payload:Json)=>Promise<unknown|null>;
export type NarrationOutput={jobDigest:string;files:{name:string;bytes:number;contentBase64:string}[];finishedPrice?:{id:string;display:string;currency:string;minor:string;rule:string;inputs:unknown}|null;durationReceipt?:unknown;durationMs?:number};
