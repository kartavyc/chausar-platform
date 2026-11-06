// Browser-safe dub records. No credentials or raw source recordings enter a quote.
import type {DubGroup} from './dub-core.ts';import type {NarrationQuote} from '../narration-studio/records.ts';
export type StoredDubGroup=DubGroup&{orderDigest:string;createdAt:string;consents:{id:string;digest:string}[];pending:Record<string,{binding:string;expiresAt:string;keyDigest:string;quote:NarrationQuote}>;halted:string|null};
