// Canonical browser-safe types, shared by the engine and renderer.
import type { WatchTerms } from '../../../../shared/venture/playbooks/monitored-data/extract.ts';
import type { WatchField } from '../../../../shared/venture/playbooks/monitored-data/extract.ts';
import type { watchCandidates } from '../../../../shared/venture/playbooks/monitored-data/extract.ts';
import type { extractMonitored } from '../../../../shared/venture/playbooks/monitored-data/extract.ts';

export type WatchSourceBody={orderId:string;clientId:string;orderDigest:string;url:string;terms:WatchTerms;fields:WatchField[];enabled:boolean;inspection:ReturnType<typeof watchCandidates>|null;receiptId:string|null;observation:ReturnType<typeof extractMonitored>|null;lastCheckedAt:string|null;nextCheckAt:string|null;failures:number;lastError:string|null;alerts:{at:string;digest:string}[]};
