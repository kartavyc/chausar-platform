// Canonical browser-safe types, shared by the engine and renderer.
import type { TriageMessage } from '../../../../shared/venture/playbooks/it-triage/summary.ts';
import type { triageSummary } from '../../../../shared/venture/playbooks/it-triage/summary.ts';

export type TriageChannelBody={orderId:string;clientId:string;orderDigest:string;channel:string;adminConfirmedAt:string;messages:TriageMessage[];summary:ReturnType<typeof triageSummary>|null;approved:string|null;importedAt:string|null;handoffs:{at:string;digest:string;sent:false}[]};
