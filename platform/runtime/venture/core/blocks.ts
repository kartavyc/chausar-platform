// Chausar venture launcher, core: the checked block library a composed plan is built from (onboarding v2).
// Plain frozen data. The AI picks block ids and writes short words for them; who does each step, the approval and
// note words, and which pricing an offer may use are decided here, by code, never by the model.
import type { BlueprintStep, ConnectorCategory, InterviewField, PricingModel, StepCapability } from '../contracts.ts';
import {
  APPROVAL_BLOCK_IDS, NOTE_BLOCK_IDS, OFFER_BLOCK_IDS, PAGE_BLOCK_IDS, QUESTION_BLOCK_IDS, STEP_BLOCK_IDS, TOOL_BLOCK_IDS,
} from '../onboarding-contracts.ts';
import type {
  ApprovalBlockId, NoteBlockId, OfferBlockId, PageBlockId, QuestionBlockId, StepBlockId, ToolBlockId,
} from '../onboarding-contracts.ts';
import { catalogueEntry } from '../build/catalogue.ts';

export type OfferBlock = { means: string; allowed: readonly PricingModel[] };
export type StepBlock = { means: string; doneBy: BlueprintStep['doneBy']; capability: StepCapability; note: string };
export type ApprovalBlock = { words: string; required: boolean };
export type PageBlock = { means: string; required: boolean };
export type QuestionBlock = { means: string; field: InterviewField };
export type NoteBlock = { words: string };
export type ToolBlock = { name: string; category: ConnectorCategory };

function frozen<K extends string, V>(entries: Record<K, V>): Readonly<Record<K, Readonly<V>>> {
  for (const value of Object.values(entries)) Object.freeze(value);
  return Object.freeze(entries);
}

export const OFFER_BLOCKS: Readonly<Record<OfferBlockId, Readonly<OfferBlock>>> = frozen<OfferBlockId, OfferBlock>({
  retainer: { allowed: Object.freeze(['monthly'] as const), means: 'Ongoing work each month for the same client.' },
  subscription: { allowed: Object.freeze(['monthly'] as const), means: 'A regular service the client signs up for, such as weekly visits.' },
  'one-off-project': { allowed: Object.freeze(['project'] as const), means: 'One piece of work with a clear end.' },
  package: { allowed: Object.freeze(['project'] as const), means: 'A fixed bundle of work sold as one thing.' },
  audit: { allowed: Object.freeze(['project'] as const), means: "A check of the client's current setup, with a short list of what to fix." },
  setup: { allowed: Object.freeze(['project'] as const), means: 'Getting something set up for the client, once.' },
  session: { allowed: Object.freeze(['hourly', 'project'] as const), means: 'One session, lesson or call.' },
  course: { allowed: Object.freeze(['project'] as const), means: 'A set of lessons or sessions over a few weeks.' },
  'hourly-help': { allowed: Object.freeze(['hourly'] as const), means: 'Help charged by the hour.' },
  'done-for-you': { allowed: Object.freeze(['project', 'monthly'] as const), means: 'Doing a task for the client from start to finish.' },
});

/** Who does each step is code's decision. Only hands-on-work may name the playbook's agent work step. */
export const STEP_BLOCKS: Readonly<Record<StepBlockId, Readonly<StepBlock>>> = frozen<StepBlockId, StepBlock>({
  'collect-inputs': { doneBy: 'you', capability: 'planned', means: 'Gather what the client sends before the work starts.',
    note: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.' },
  'book-time': { doneBy: 'you', capability: 'planned', means: 'Agree a time with the client.',
    note: 'You agree a time with the client. Booking it for you is planned.' },
  'meet-client': { doneBy: 'you', capability: 'yours', means: 'Meet the client in person or on a call.',
    note: 'You meet the client in person or on a call. No agent takes part.' },
  'hands-on-work': { doneBy: 'you', capability: 'planned', means: 'The hands-on work at a desk, with files and tools.',
    note: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.' },
  'in-person-work': { doneBy: 'you', capability: 'yours', means: 'Work done in person, such as visits, walks, repairs or lessons.',
    note: 'You do this work yourself, in person. No agent does it.' },
  'draft-reply': { doneBy: 'agent-then-you', capability: 'drafts-now', means: "A reply drafted from the client's message, for the owner to check.",
    note: "An agent drafts a reply from the client's message. You check it." },
  send: { doneBy: 'you', capability: 'planned', means: 'Send the checked reply or work to the client.',
    note: 'You send it to the client. Sending for you is planned.' },
  'deliver-files': { doneBy: 'you', capability: 'planned', means: 'Hand over finished files.',
    note: 'You hand over the finished files. Handing them over for you is planned.' },
  'follow-up': { doneBy: 'you', capability: 'planned', means: 'Check in with the client after the work.',
    note: 'You follow up with the client. Reminders for you are planned.' },
  'get-paid': { doneBy: 'you', capability: 'yours', means: 'Send the invoice and record the payment.',
    note: 'Chausar makes the invoice from your price. You send it and record the payment.' },
});

export const APPROVAL_BLOCKS: Readonly<Record<ApprovalBlockId, Readonly<ApprovalBlock>>> = frozen<ApprovalBlockId, ApprovalBlock>({
  'each-draft': { words: 'Each reply an agent drafts, before it goes to a client.', required: true },
  'prices-invoices': { words: 'Every price and invoice, before a client sees it.', required: false },
  'posts-in-your-name': { words: 'Anything posted or sent in your name.', required: false },
  'client-files': { words: "Which of a client's files an agent may read.", required: false },
});

export const PAGE_BLOCKS: Readonly<Record<PageBlockId, Readonly<PageBlock>>> = frozen<PageBlockId, PageBlock>({
  home: { means: 'What the business does, in one line, with one button to start.', required: true },
  'offers-prices': { means: 'Each offer with its price exactly as Chausar gives it.', required: true },
  'how-it-works': { means: 'How work moves from the first message to the result, in a few short steps.', required: false },
  'start-request': { means: 'A short form to ask for the service.', required: false },
  booking: { means: 'A page to pick a time.', required: false },
  about: { means: 'Who runs the business.', required: false },
  faq: { means: 'Short answers to common questions.', required: false },
  portfolio: { means: 'Examples of past work, shared with permission.', required: false },
  'client-area': { means: 'A signed-in page where each client sees only their own requests.', required: false },
  'privacy-terms': { means: 'Headings only, for the owner to fill in.', required: false },
});

export const QUESTION_BLOCKS: Readonly<Record<QuestionBlockId, Readonly<QuestionBlock>>> = frozen<QuestionBlockId, QuestionBlock>({
  customer: { field: 'customer', means: 'Who the person wants as clients.' },
  'first-offer': { field: 'first-offer', means: 'Which offer to start with.' },
  channel: { field: 'channel', means: 'How clients will find the business.' },
  area: { field: 'other', means: 'Where the person will work, such as a town or area.' },
  hours: { field: 'other', means: 'When the person can work.' },
  experience: { field: 'other', means: 'How much experience the person has.' },
  'tools-you-use': { field: 'other', means: 'Which tools the person already uses.' },
});

/** Prompts to check, not advice. The AI only picks which apply. */
export const NOTE_BLOCKS: Readonly<Record<NoteBlockId, Readonly<NoteBlock>>> = frozen<NoteBlockId, NoteBlock>({
  'licence-may-apply': { words: 'Some places need a licence or permit for this work. Check your local rules before you start.' },
  insurance: { words: "Work in clients' homes or with their things usually needs insurance. Check before your first client." },
  'personal-data': { words: "You will hold clients' personal details. Keep only what you need, and only as long as you need it." },
  'children-or-care': { words: 'Work with children or people in care often needs a background check where you live.' },
  'regulated-advice': { words: 'Advice on money, law or health can be regulated. Say plainly what you do and do not advise on.' },
  safety: { words: 'This work has physical risks. Plan how you stay safe and what you do if something goes wrong.' },
});

/** The tools the composer may pick, with their catalogue names. A missing catalogue entry is a programming error. */
export const TOOL_BLOCKS: Readonly<Record<ToolBlockId, Readonly<ToolBlock>>> = frozen<ToolBlockId, ToolBlock>(Object.fromEntries(
  TOOL_BLOCK_IDS.map(id => {
    const entry = catalogueEntry(id);
    if (!entry) throw new Error(`The tool block ${id} is not in the connector catalogue.`);
    if (entry.category === 'payments') throw new Error(`The tool block ${id} is a payments connector; the rail comes from the country.`);
    return [id, { name: entry.name, category: entry.category }];
  }),
) as Record<ToolBlockId, ToolBlock>);

const has = (list: readonly string[], value: unknown): boolean => typeof value === 'string' && list.includes(value);
export const isOfferBlock = (value: unknown): value is OfferBlockId => has(OFFER_BLOCK_IDS, value);
export const isStepBlock = (value: unknown): value is StepBlockId => has(STEP_BLOCK_IDS, value);
export const isApprovalBlock = (value: unknown): value is ApprovalBlockId => has(APPROVAL_BLOCK_IDS, value);
export const isPageBlock = (value: unknown): value is PageBlockId => has(PAGE_BLOCK_IDS, value);
export const isToolBlock = (value: unknown): value is ToolBlockId => has(TOOL_BLOCK_IDS, value);
export const isQuestionBlock = (value: unknown): value is QuestionBlockId => has(QUESTION_BLOCK_IDS, value);
export const isNoteBlock = (value: unknown): value is NoteBlockId => has(NOTE_BLOCK_IDS, value);

/** Plain words for the pricing an offer may use: 'per month', 'per project or per hour'. */
export const PRICING_WORDS: Readonly<Record<PricingModel, string>> = Object.freeze({ monthly: 'per month', project: 'per project', hourly: 'per hour' });
export function allowedPricingWords(allowed: readonly PricingModel[]): string {
  return allowed.map(model => PRICING_WORDS[model]).join(' or ');
}

/** Every fixed string in the library, for the house-style and no-numbers tests. */
export function blockFixedWords(): string[] {
  return [
    ...Object.values(OFFER_BLOCKS).map(block => block.means),
    ...Object.values(STEP_BLOCKS).flatMap(block => [block.means, block.note]),
    ...Object.values(APPROVAL_BLOCKS).map(block => block.words),
    ...Object.values(PAGE_BLOCKS).map(block => block.means),
    ...Object.values(QUESTION_BLOCKS).map(block => block.means),
    ...Object.values(NOTE_BLOCKS).map(block => block.words),
  ];
}
