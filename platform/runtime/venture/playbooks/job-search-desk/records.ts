// Chausar playbook: Job-search and career desk (Ink v2 wave 5, packages 5I). The bodies of its own records, as
// contracts.ts types each one (RecordBase<kind> & Body). Package 5-0 named each record; this package fills
// it with the record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned
// from an outside source.

/** venture-career-fact: source-bound career evidence. */
import type {CareerFactState} from './state.ts';
export type CareerFactBody = {orderId:string;clientId:string;state:CareerFactState};
/** venture-career-listing: source-bound career evidence. */
export type CareerListingBody = {orderId:string;clientId:string;url:string;text:string;revision:string;sourceKind:'static-page'|'owner-paste'|'public-board';capturedOn:string};
import type {CareerStoredPack} from './thread-state.ts';
export type CareerAiPreview={callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;expiresAt:string;payer?:string};
/** A manual career thread; a stored pack carries exact source and rendered-file approval. */
export type CareerThreadBody={orderId:string;clientId:string;category:'pack'|'application';state:'draft'|'waiting'|'replied'|'applied'|'interview'|'closed';lastTouch:string|null;nextTouch:string|null;listingId:string|null;humanPath:string;pack:CareerStoredPack|null;aiRequest?:{preview:CareerAiPreview;binding:string}|null;aiCallIds?:string[]};
