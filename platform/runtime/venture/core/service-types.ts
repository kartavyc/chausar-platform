// Chausar venture launcher, core (P1): service types, the keyword classifier and the template words.
// Template words describe what the owner and an agent will do, never what was done: no digits, no banned
// words, no done claims. A test runs every string here through assertNoNumbers, houseStyleFindings and
// doneClaimFindings.
import { OFFER_IDS, SECOND_OFFER_MODEL, SERVICE_TYPES, SERVICE_TYPE_LABELS } from '../contracts.ts';
import type { InterviewModelOutput, PricingModel, ServiceType } from '../contracts.ts';
import { pickPlaybook } from '../playbooks/registry.ts';

/** Substring keywords per type, matched against the lower-cased idea. */
export const SERVICE_KEYWORDS: Readonly<Record<Exclude<ServiceType, 'other'>, readonly string[]>> = Object.freeze({
  agency: ['marketing', 'ads', 'advert', 'social media', 'agency', 'leads', 'outreach', 'growth', 'campaign'],
  studio: ['podcast', 'video', 'design', 'edit', 'photo', 'logo', 'brand', 'studio', 'animation'],
  consulting: ['consult', 'advis', 'coach', 'strategy', 'audit', 'mentor'],
  bookkeeping: ['bookkeep', 'accounts', 'accounting', 'gst', 'tax', 'ledger', 'payroll', 'invoice', 'books'],
  research: ['research', 'lead list', 'market', 'report', 'analysis', 'data', 'survey'],
  content: ['blog', 'newsletter', 'copy', 'writing', 'seo', 'article', 'content', 'script'],
  support: ['support', 'customer service', 'inbox', 'helpdesk', 'help desk', 'chat', 'tickets'],
});

/**
 * Picks a service type from the idea: each keyword found counts one hit for its type, the highest count wins,
 * a tie goes to the type listed first in SERVICE_TYPES. With no hit at all, a flagship playbook the idea picks
 * (playbooks/registry.ts) gives the type it extends, so "a faceless YouTube channel" plans as a studio; else 'other'.
 */
export function classifyIdea(idea: string): ServiceType {
  const text = idea.toLowerCase();
  let best: ServiceType = 'other';
  let bestHits = 0;
  for (const type of SERVICE_TYPES) {
    if (type === 'other') continue;
    const hits = SERVICE_KEYWORDS[type].filter(keyword => text.includes(keyword)).length;
    if (hits > bestHits) { best = type; bestHits = hits; }
  }
  return bestHits === 0 ? pickPlaybook(idea)?.serviceType ?? 'other' : best;
}

export type OfferWords = { name: string; description: string };

export type ServiceTemplate = {
  type: ServiceType;
  label: string;
  /** q_1 (field customer, a choice of three) and q_2 (field channel, free text). */
  questions: InterviewModelOutput['questions'];
  /** offer_1 then offer_2, worded for their starting pricing: offer_1 per month, offer_2 by SECOND_OFFER_MODEL. */
  offers: OfferWords[];
  /** offer_1 then offer_2, each worded for every way it can be charged, so the words follow the owner's choice. */
  offerChoices: Record<PricingModel, OfferWords>[];
  /** step_1 to step_4; step_3 is always the drafting step. */
  steps: string[];
  approvals: string[];
  customer: string;
  oneLiner: string;
};

type Words = Omit<ServiceTemplate, 'type' | 'label' | 'questions' | 'offers' | 'offerChoices'> & {
  firstQuestion: string; choices: string[]; secondQuestion: string;
  /** offer_1 then offer_2, one wording per pricing model. */
  offers: [Record<PricingModel, OfferWords>, Record<PricingModel, OfferWords>];
};

const WORDS: Readonly<Record<ServiceType, Words>> = Object.freeze({
  agency: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Local shops and gyms', 'Online brands', 'Clinics and studios'],
    secondQuestion: 'Where do you plan to find your first clients?',
    offers: [
      {
        monthly: { name: 'Monthly marketing', description: 'Planned posts, ad drafts and a short monthly update for review.' },
        project: { name: 'Marketing project', description: 'Posts, ad drafts and a plan for one piece of marketing work, start to finish.' },
        hourly: { name: 'Marketing hours', description: 'Planning, posts and ad drafts, booked by the hour.' },
      },
      {
        project: { name: 'Campaign launch', description: 'A single campaign planned and drafted from start to launch.' },
        monthly: { name: 'Monthly campaigns', description: 'A new campaign planned and drafted each month.' },
        hourly: { name: 'Campaign hours', description: 'Campaign planning and drafting, booked by the hour.' },
      },
    ],
    steps: ["Collect the client's goals and brand files", "Set up ads and posts in the client's accounts", 'Draft the campaign plan and posts for review', 'Send the approved plan to the client'],
    approvals: ['Every post and ad before it goes live', 'Any message that asks a client for money'],
    customer: 'Small businesses that want steady marketing without hiring a team.',
    oneLiner: 'A small marketing agency where an agent drafts posts and plans, and you approve each one.',
  },
  studio: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Podcasters and creators', 'Small brands', 'Event and wedding hosts'],
    secondQuestion: 'How will clients send you their files?',
    offers: [
      {
        monthly: { name: 'Monthly studio plan', description: 'Regular editing and design work each month, planned with you.' },
        project: { name: 'Studio project', description: 'One editing or design job with a clear brief, start to finish.' },
        hourly: { name: 'Editing and design hours', description: 'Regular editing and design work, booked by the hour.' },
      },
      {
        hourly: { name: 'Studio hours', description: 'Editing or design time booked by the hour.' },
        monthly: { name: 'Monthly edits', description: 'A set amount of editing and design time each month.' },
        project: { name: 'Single edit', description: 'One file edited or one design made to a brief.' },
      },
    ],
    steps: ['Collect the raw files and the brief', 'Edit and design the work', 'Draft notes and questions on the brief for review', 'Send the final files to the client'],
    approvals: ['Every file before it reaches a client', 'Any change to the price or scope'],
    customer: 'Creators and small brands who need clean edits and designs on time.',
    oneLiner: 'A creative studio where an agent drafts briefs and notes, and you do the craft.',
  },
  consulting: {
    firstQuestion: 'Who will you advise first?',
    choices: ['Founders of small companies', 'Shop and cafe owners', 'Freelancers and solo workers'],
    secondQuestion: 'What problem do clients usually bring to you?',
    offers: [
      {
        monthly: { name: 'Monthly advice', description: 'Regular calls and written advice for one business each month.' },
        project: { name: 'Advice project', description: 'Calls and written advice on one business problem, start to finish.' },
        hourly: { name: 'Advice by the hour', description: 'Calls and written advice, booked by the hour.' },
      },
      {
        project: { name: 'Strategy review', description: 'A focused look at one problem with clear next steps.' },
        monthly: { name: 'Monthly strategy check', description: 'A short look at the strategy each month, with clear next steps.' },
        hourly: { name: 'Strategy hours', description: 'Time on one problem with clear next steps, booked by the hour.' },
      },
    ],
    steps: ["Gather the client's questions and papers", 'Hold the call and work through the problem', 'Draft the written advice for review', 'Send the advice to the client'],
    approvals: ['Every piece of advice before a client sees it', 'Any message that asks a client for money'],
    customer: 'Owners of small businesses who want a clear outside view.',
    oneLiner: 'A consulting practice where an agent drafts written advice and you check every word.',
  },
  bookkeeping: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Cafes and restaurants', 'Small shops', 'Freelancers and consultants'],
    secondQuestion: 'How will clients send you their bills and statements?',
    offers: [
      {
        monthly: { name: 'Monthly books', description: 'Bank matching, bill sorting and a short monthly report.' },
        project: { name: 'Bookkeeping project', description: 'Bank matching, bill sorting and a short report for one stretch of time you choose.' },
        hourly: { name: 'Bookkeeping hours', description: 'Bank matching, bill sorting and short reports, booked by the hour.' },
      },
      {
        project: { name: 'Catch up', description: 'Past months put in order before the regular service starts.' },
        monthly: { name: 'Monthly catch up', description: 'A few past months put in order each month until the books are current.' },
        hourly: { name: 'Catch up hours', description: 'Past months put in order, booked by the hour.' },
      },
    ],
    steps: ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'],
    approvals: ['Every monthly report before it reaches a client', 'Any message that asks a client for money'],
    customer: 'Small business owners who want tidy books without chasing receipts.',
    oneLiner: 'A bookkeeping studio where an agent drafts the monthly report and you check it.',
  },
  research: {
    firstQuestion: 'Who will order research from you first?',
    choices: ['Startup founders', 'Sales teams', 'Small agencies'],
    secondQuestion: 'What kind of research will clients ask for most?',
    offers: [
      {
        monthly: { name: 'Monthly research', description: 'A regular stream of research notes on the topics a client picks.' },
        project: { name: 'Research project', description: 'Research notes on one question a client picks, start to finish.' },
        hourly: { name: 'Research by the hour', description: 'Research notes on the topics a client picks, booked by the hour.' },
      },
      {
        hourly: { name: 'Research hours', description: 'Focused research time booked by the hour.' },
        monthly: { name: 'Monthly research time', description: 'A set amount of focused research time each month.' },
        project: { name: 'Single research note', description: 'One focused note on a single question.' },
      },
    ],
    steps: ["Collect the client's question and sources", 'Search and read the sources', 'Draft the research notes for review', 'Send the notes to the client'],
    approvals: ['Every research note before it reaches a client', 'Any claim that names a person or a company'],
    customer: 'Founders and small teams who need answers they can act on.',
    oneLiner: "A research desk where an agent drafts notes from the client's question and you check the facts.",
  },
  content: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Local businesses', 'Coaches and experts', 'Online shops'],
    secondQuestion: 'What will clients send you to start a piece?',
    offers: [
      {
        monthly: { name: 'Monthly content', description: "Regular posts or newsletters written in the client's voice." },
        project: { name: 'Content project', description: "A set of posts or newsletters in the client's voice for one campaign." },
        hourly: { name: 'Writing hours', description: "Posts or newsletters in the client's voice, booked by the hour." },
      },
      {
        project: { name: 'Single piece', description: 'One article, script or newsletter written to a brief.' },
        monthly: { name: 'Monthly feature piece', description: 'One longer article, script or newsletter each month.' },
        hourly: { name: 'Editing hours', description: 'Edits to pieces the client wrote, booked by the hour.' },
      },
    ],
    steps: ['Collect the topic, notes and examples', 'Research the topic and gather sources', 'Draft the piece for review', 'Send the piece to the client'],
    approvals: ['Every piece before it reaches a client', 'Any change to the price or scope'],
    customer: 'Busy owners who want to publish often in their own voice.',
    oneLiner: 'A content shop where an agent drafts each piece and you edit it before it goes out.',
  },
  support: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Online shops', 'Software startups', 'Local service businesses'],
    secondQuestion: 'Where do customers write in today, for example email or chat?',
    offers: [
      {
        monthly: { name: 'Monthly support', description: 'Customer replies drafted every day for you to check and send.' },
        project: { name: 'Support project', description: 'Customer replies drafted for a set stretch, such as a launch or a sale.' },
        hourly: { name: 'Support by the hour', description: 'Customer replies drafted for you to check and send, booked by the hour.' },
      },
      {
        hourly: { name: 'Support hours', description: 'Help with a busy week or a launch, booked by the hour.' },
        monthly: { name: 'Monthly backup', description: 'Extra reply drafting each month for the busiest days.' },
        project: { name: 'Launch support', description: 'Help with the replies for one launch or sale.' },
      },
    ],
    steps: ['Collect the customer messages', "Look up orders and accounts in the client's tools", 'Draft replies for review', 'Send the approved replies'],
    approvals: ['Every reply before it reaches a customer', 'Any refund or promise of money'],
    customer: 'Small online businesses that want fast, kind replies to their customers.',
    oneLiner: 'A support team for hire where an agent drafts replies and you approve each one.',
  },
  other: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Individuals', 'Small businesses', 'Larger companies'],
    secondQuestion: 'How will clients first get in touch with you?',
    offers: [
      {
        monthly: { name: 'Monthly service', description: 'Regular work for one client each month, planned with you.' },
        project: { name: 'Service project', description: 'One piece of work for one client, planned with you from start to finish.' },
        hourly: { name: 'Service by the hour', description: 'Work for one client, planned with you and booked by the hour.' },
      },
      {
        project: { name: 'Single project', description: 'One piece of work with a clear start and finish.' },
        monthly: { name: 'Monthly follow up', description: 'A short piece of follow up work each month.' },
        hourly: { name: 'Extra hours', description: 'Extra work on request, booked by the hour.' },
      },
    ],
    steps: ['Collect what the client sends', 'Do the hands-on work', 'Draft the reply for review', 'Send the work to the client'],
    approvals: ['Every reply before it reaches a client', 'Any message that asks a client for money'],
    customer: 'People and small businesses who need this service done well.',
    oneLiner: 'A service business where an agent drafts replies and you check each one.',
  },
});

/** Template words for a service type. Every call returns a fresh copy. */
export function serviceTemplate(type: ServiceType): ServiceTemplate {
  const words = WORDS[type] ?? WORDS.other;
  return {
    type,
    label: SERVICE_TYPE_LABELS[type],
    questions: [
      { field: 'customer', kind: 'choice', text: words.firstQuestion, choices: [...words.choices] },
      { field: 'channel', kind: 'text', text: words.secondQuestion, choices: [] },
    ],
    offers: OFFER_IDS.map((_, index) => ({ ...words.offers[index === 0 ? 0 : 1][index === 0 ? 'monthly' : SECOND_OFFER_MODEL[type]] })),
    offerChoices: words.offers.map(choices => ({ monthly: { ...choices.monthly }, project: { ...choices.project }, hourly: { ...choices.hourly } })),
    steps: [...words.steps],
    approvals: [...words.approvals],
    customer: words.customer,
    oneLiner: words.oneLiner,
  };
}

/**
 * Template words for one offer, worded for how it is charged: 'Marketing hours' when the owner charges by the hour,
 * never 'Monthly marketing'. index 0 is offer_1, index 1 is offer_2. The words stay an assumption on the plan.
 */
export function offerWords(type: ServiceType, index: number, model: PricingModel): OfferWords {
  const words = WORDS[type] ?? WORDS.other;
  return { ...words.offers[index === 1 ? 1 : 0][model] };
}

/** Every string in a template, for the word checks in tests. */
export function templateStrings(template: ServiceTemplate): string[] {
  return [
    template.label, template.customer, template.oneLiner,
    ...template.questions.flatMap(q => [q.text, ...q.choices]),
    ...template.offers.flatMap(o => [o.name, o.description]),
    ...template.offerChoices.flatMap(choices => Object.values(choices).flatMap(o => [o.name, o.description])),
    ...template.steps, ...template.approvals,
  ];
}
