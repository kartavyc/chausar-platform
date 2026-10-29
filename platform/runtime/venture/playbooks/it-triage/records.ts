// Original one-channel client evidence. Credentials never enter this durable body.
import type {TriageMessage,triageSummary} from './summary.ts';
export type TriageChannelBody={orderId:string;clientId:string;orderDigest:string;channel:string;adminConfirmedAt:string;messages:TriageMessage[];summary:ReturnType<typeof triageSummary>|null;approved:string|null;importedAt:string|null;handoffs:{at:string;digest:string;sent:false}[]};
