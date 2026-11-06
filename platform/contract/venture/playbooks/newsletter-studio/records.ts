// Canonical browser-safe types, shared by the engine and renderer.
import type { NewsletterDraft } from '../../../../shared/venture/playbooks/newsletter-studio/presend.ts';
import type { NewsletterStatsSource } from '../../../../shared/venture/playbooks/newsletter-studio/stats.ts';
import type { NewsletterContactState } from '../../../../shared/venture/playbooks/newsletter-studio/import.ts';

export type NewsletterIssueBody={orderId:string;clientId:string;listId:string;intakeDigest:string;purpose:'issue'|'lastChance';sourceNotes:string;language:'en'|'hi';aiRequest:{preview:NewsletterModelPreview;binding:string}|null;aiCallIds:string[];aiEvidence:{text:string;sourceIds:string[]}[];draft:NewsletterDraft|null;defaults:{fromAddress:string;postalAddress:string;tool:string};slices:NewsletterSlice[];state:'write'|'review'|'send';pricing:{input:import('../../../../shared/venture/playbooks/newsletter-studio/sponsors.ts').NewsletterPriceInput;quote:ReturnType<typeof import('../../../../shared/venture/playbooks/newsletter-studio/sponsors.ts').newsletterPriceQuote>}|null};

export type NewsletterModelPreview={clientAi?:import('../../../../shared/venture/clients/ai-consent-core.ts').ClientAiContextBinding;callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;payer?:string};

export type NewsletterSlice={id:string;contactIds:string[];exportedAt:string;draftDigest:string;sent:false;reported:{source:NewsletterSource;stats:NewsletterStatsSource;at:string}|null};

export type NewsletterSource={fileId:string;fingerprint:string};

export type NewsletterContactView=NewsletterContactBody&{id:string};

export type NewsletterContactBody={listId:string;clientId:string;email:string;firstName:string;engagement:number;state:NewsletterContactState;everSent:boolean;ignoredIssues:number;lastEngagedAt:string;lastChanceSentAt:string|null;source:NewsletterSource;consentedAt:string;suppressed:boolean};
