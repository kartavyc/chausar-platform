// Original saved public-source authority and measured selector evidence. No raw page HTML is retained.
import type {WatchField,WatchTerms,extractMonitored,watchCandidates} from './extract.ts';
export type WatchSourceBody={orderId:string;clientId:string;orderDigest:string;url:string;terms:WatchTerms;fields:WatchField[];enabled:boolean;inspection:ReturnType<typeof watchCandidates>|null;receiptId:string|null;observation:ReturnType<typeof extractMonitored>|null;lastCheckedAt:string|null;nextCheckAt:string|null;failures:number;lastError:string|null;alerts:{at:string;digest:string}[]};
