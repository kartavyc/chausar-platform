// Chausar venture launcher, core (P1): service types, the keyword classifier and the template words.
// Template words describe what the owner and an agent will do, never what was done: no digits, no banned
// words, no done claims. A test runs every string here through assertNoNumbers, houseStyleFindings and
// doneClaimFindings.
import { SERVICE_TYPES, SERVICE_TYPE_LABELS } from '../contracts.ts';
import type { InterviewModelOutput, ServiceType } from '../contracts.ts';

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
 * a tie goes to the type listed first in SERVICE_TYPES, and no hit at all gives 'other'.
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
  return best;
}

export type ServiceTemplate = {
  type: ServiceType;
  label: string;
  /** q_1 (field customer, a choice of three) and q_2 (field channel, free text). */
  questions: InterviewModelOutput['questions'];
  /** offer_1 then offer_2. */
  offers: { name: string; description: string }[];
  /** step_1 to step_4; step_3 is always the drafting step. */
  steps: string[];
  approvals: string[];
  customer: string;
  oneLiner: string;
};

type Words = Omit<ServiceTemplate, 'type' | 'label' | 'questions'> & { firstQuestion: string; choices: string[]; secondQuestion: string };

const WORDS: Readonly<Record<ServiceType, Words>> = Object.freeze({
  agency: {
    firstQuestion: 'Who will your first clients be?',
    choices: ['Local shops and gyms', 'Online brands', 'Clinics and studios'],
    secondQuestion: 'Where do you plan to find your first clients?',
    offers: [
      { name: 'Monthly marketing', description: 'Planned posts, ad drafts and a short monthly update for review.' },
      { name: 'Campaign launch', description: 'A single campaign planned and drafted from start to launch.' },
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
      { name: 'Monthly studio plan', description: 'Regular editing and design work each month, planned with you.' },
      { name: 'Studio hours', description: 'Editing or design time booked by the hour.' },
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
      { name: 'Monthly advice', description: 'Regular calls and written advice for one business each month.' },
      { name: 'Strategy review', description: 'A focused look at one problem with clear next steps.' },
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
      { name: 'Monthly books', description: 'Bank matching, bill sorting and a short monthly report.' },
      { name: 'Catch up', description: 'Past months put in order before the monthly service starts.' },
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
      { name: 'Monthly research', description: 'A regular stream of research notes on the topics a client picks.' },
      { name: 'Research hours', description: 'Focused research time booked by the hour.' },
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
      { name: 'Monthly content', description: "Regular posts or newsletters written in the client's voice." },
      { name: 'Single piece', description: 'One article, script or newsletter written to a brief.' },
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
      { name: 'Monthly support', description: 'Customer replies drafted every day for you to check and send.' },
      { name: 'Support hours', description: 'Help with a busy week or a launch, booked by the hour.' },
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
      { name: 'Monthly service', description: 'Regular work for one client each month, planned with you.' },
      { name: 'Single project', description: 'One piece of work with a clear start and finish.' },
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
    offers: words.offers.map(offer => ({ ...offer })),
    steps: [...words.steps],
    approvals: [...words.approvals],
    customer: words.customer,
    oneLiner: words.oneLiner,
  };
}

/** Every string in a template, for the word checks in tests. */
export function templateStrings(template: ServiceTemplate): string[] {
  return [
    template.label, template.customer, template.oneLiner,
    ...template.questions.flatMap(q => [q.text, ...q.choices]),
    ...template.offers.flatMap(o => [o.name, o.description]),
    ...template.steps, ...template.approvals,
  ];
}
