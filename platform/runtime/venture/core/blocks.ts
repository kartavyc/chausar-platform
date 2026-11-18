// Chausar venture launcher, core: the block library a composed plan was built from (onboarding v2).
// Plain frozen data, read for a plan a vault already holds: who does each step, the approval words, and which
// pricing an offer may use are decided here, by code, never by a model.
import type { BlueprintStep, PricingModel, StepCapability } from '../contracts.ts';
import type { ApprovalBlockId, OfferBlockId, StepBlockId } from '../onboarding-contracts.ts';

export type OfferBlock = { allowed: readonly PricingModel[] };
export type StepBlock = { doneBy: BlueprintStep['doneBy']; capability: StepCapability; note: string };
export type ApprovalBlock = { words: string; required: boolean };

function frozen<K extends string, V>(entries: Record<K, V>): Readonly<Record<K, Readonly<V>>> {
  for (const value of Object.values(entries)) Object.freeze(value);
  return Object.freeze(entries);
}

export const OFFER_BLOCKS: Readonly<Record<OfferBlockId, Readonly<OfferBlock>>> = frozen<OfferBlockId, OfferBlock>({
  retainer: { allowed: Object.freeze(['monthly'] as const) },
  subscription: { allowed: Object.freeze(['monthly'] as const) },
  'one-off-project': { allowed: Object.freeze(['project'] as const) },
  package: { allowed: Object.freeze(['project'] as const) },
  audit: { allowed: Object.freeze(['project'] as const) },
  setup: { allowed: Object.freeze(['project'] as const) },
  session: { allowed: Object.freeze(['hourly', 'project'] as const) },
  course: { allowed: Object.freeze(['project'] as const) },
  'hourly-help': { allowed: Object.freeze(['hourly'] as const) },
  'done-for-you': { allowed: Object.freeze(['project', 'monthly'] as const) },
});

/** Who does each step is code's decision. Only hands-on-work may name the playbook's agent work step. */
export const STEP_BLOCKS: Readonly<Record<StepBlockId, Readonly<StepBlock>>> = frozen<StepBlockId, StepBlock>({
  'collect-inputs': { doneBy: 'you', capability: 'planned',
    note: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.' },
  'book-time': { doneBy: 'you', capability: 'planned',
    note: 'You agree a time with the client. Booking it for you is planned.' },
  'meet-client': { doneBy: 'you', capability: 'yours',
    note: 'You meet the client in person or on a call. No agent takes part.' },
  'hands-on-work': { doneBy: 'you', capability: 'planned',
    note: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.' },
  'in-person-work': { doneBy: 'you', capability: 'yours',
    note: 'You do this work yourself, in person. No agent does it.' },
  'draft-reply': { doneBy: 'agent-then-you', capability: 'drafts-now',
    note: "An agent drafts a reply from the client's message. You check it." },
  send: { doneBy: 'you', capability: 'planned',
    note: 'You send it to the client. Sending for you is planned.' },
  'deliver-files': { doneBy: 'you', capability: 'planned',
    note: 'You hand over the finished files. Handing them over for you is planned.' },
  'follow-up': { doneBy: 'you', capability: 'planned',
    note: 'You follow up with the client. Reminders for you are planned.' },
  'get-paid': { doneBy: 'you', capability: 'yours',
    note: 'Chausar makes the invoice from your price. You send it and record the payment.' },
});

export const APPROVAL_BLOCKS: Readonly<Record<ApprovalBlockId, Readonly<ApprovalBlock>>> = frozen<ApprovalBlockId, ApprovalBlock>({
  'each-draft': { words: 'Each reply an agent drafts, before it goes to a client.', required: true },
  'prices-invoices': { words: 'Every price and invoice, before a client sees it.', required: false },
  'posts-in-your-name': { words: 'Anything posted or sent in your name.', required: false },
  'client-files': { words: "Which of a client's files an agent may read.", required: false },
});

/** Plain words for the pricing an offer may use: 'per month', 'per project or per hour'. */
export const PRICING_WORDS: Readonly<Record<PricingModel, string>> = Object.freeze({ monthly: 'per month', project: 'per project', hourly: 'per hour' });
export function allowedPricingWords(allowed: readonly PricingModel[]): string {
  return allowed.map(model => PRICING_WORDS[model]).join(' or ');
}
