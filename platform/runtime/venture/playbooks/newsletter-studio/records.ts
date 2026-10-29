// Original newsletter desk contract and records. Effects require exact owner approval.
import type {NewsletterDraft} from './presend.ts';
import type {NewsletterContactState} from './import.ts';
import type {NewsletterStatsSource} from './stats.ts';
export type NewsletterSource={fileId:string;fingerprint:string};
export type NewsletterContactBody={listId:string;clientId:string;email:string;firstName:string;engagement:number;state:NewsletterContactState;everSent:boolean;ignoredIssues:number;lastEngagedAt:string;lastChanceSentAt:string|null;source:NewsletterSource;consentedAt:string;suppressed:boolean};
export type NewsletterSlice={id:string;contactIds:string[];exportedAt:string;draftDigest:string;sent:false;reported:{source:NewsletterSource;stats:NewsletterStatsSource;at:string}|null};
export type NewsletterIssueBody={orderId:string;clientId:string;listId:string;intakeDigest:string;purpose:'issue'|'lastChance';sourceNotes:string;language:'en'|'hi';aiRequest:{preview:NewsletterModelPreview;binding:string}|null;aiCallIds:string[];aiEvidence:{text:string;sourceIds:string[]}[];draft:NewsletterDraft|null;defaults:{fromAddress:string;postalAddress:string;tool:string};slices:NewsletterSlice[];state:'write'|'review'|'send';pricing:{input:import('./sponsors.ts').NewsletterPriceInput;quote:ReturnType<typeof import('./sponsors.ts').newsletterPriceQuote>}|null};
export type NewsletterContactView=NewsletterContactBody&{id:string};

export type NewsletterModelPreview={callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;expiresAt:string;payer?:string};
