// Chausar venture launcher, views: the plan as the owner reads it before accepting (venture.queue.view, kind plan).
// The plan to accept is the plan the owner kept (founder, 14 Nov 2026): their offers, the way to earn they kept with the
// business (core/way.ts: who pays, how they are reached, what the team does, what the owner does, the first week), the
// team they hired, how each order is done and approved, and the back office. Until then the sheet was the built-in
// service type's words alone, so a potter read "People and small businesses who need this service done well", a line
// about bookkeeping and "You do not charge GST" beside "Invoices are tax invoices".
//
// Nothing here is invented: the way's words are the ones the owner kept, a team line is an agent's own job and duties,
// and the two standing lines are the hire's own (agents/hire.ts HIRE_WORDS). The steps say who does what today.
//
// Seen in the real app on Windows (15 Nov 2026): a potter's plan said "Collect what the client sends and add the files to
// the order ... Send the work to the client", the built-in file-service steps, for someone who ships mugs; a technician's
// booking step said "add the files"; and a translator's plan named a Translator and a Checker the owner had never seen.
// Now a business no order flow fits (the plain service type) reads how an order is handled today, in four plain lines;
// a trade whose client sends a request, not files, reads that; and the agents that do each order are listed with the
// team, said to join when the plan is accepted (agents/order-agents.ts).
// Pure: no store, no clock and no engine import, so the app's fake engine builds the same sheet from the same parts.
import { KEEPER_JOINS } from '../agents/order-agents-core.ts';

export type PlanWords = { value: string; estimate?: boolean };
export type PlanSection = { heading?: string; lines: string[] };
/** The plan in plain parts. price: the offer's price as code formatted it ("₹500 per month"), or null when none is set. */
export type PlanParts = {
  serviceType: string | null;
  customer: PlanWords;
  offers: { name: PlanWords; description: PlanWords; price: string | null }[];
  steps: { title: PlanWords; doneBy: string; note: string }[];
  /** A flagship playbook's own steps, listed in place of the four template steps: each with who does it, in words. */
  flagshipSteps?: { title: PlanWords; doer: string }[];
  approvals: PlanWords[];
  tax: { label: string; registered: boolean; assumed: boolean; invoiceKind: 'tax-invoice' | 'invoice'; missing: string[] };
  /** The way to earn kept with the business, or null. */
  way: { customer: string; reach: string; teamDoes: string; youDo: string; firstWeek: string[] } | null;
  /** The agents the owner hired, retired ones left out. */
  team: { name: string; job: string; duties: string[] }[];
  /** The agents that do each order (a playbook's own, else the one delivery agent). joined: the plan is accepted, so they are on the team. */
  orderAgents?: { agents: { name: string; does: string }[]; joined: boolean };
};

const MODEL_ESTIMATE = ' (model estimate)';
const DONE_BY: Readonly<Record<string, string>> = { agent: 'an agent', you: 'you', 'agent-then-you': 'an agent, then you check it' };
/** The hire's standing lines for a team (agents/hire.ts HIRE_WORDS.teamNever and teamAsks; a test holds them equal). */
export const PLAN_TEAM_LINES = Object.freeze(['None of them sends, pays, posts, deletes or changes a price by itself.', 'They ask you before anything leaves.']);
/** The hands-on step's stored note (contracts.ts STEP_PLAN step_2, core/blocks.ts hands-on-work). */
const HANDS_ON_NOTE = 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.';
const HANDS_ON_OWN = 'You do the hands-on work.';
/** The first step's stored note (contracts.ts STEP_PLAN step_1), and how it reads where the client sends a request and no files. */
const COLLECT_NOTE = 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.';
const COLLECT_REQUEST = 'You add what the client asked for to the order, where the agent reads it. Reading inboxes for you is planned.';
/** Trades whose client sends a request (a booking, a class), not files to work from. */
const REQUEST_TYPES: readonly string[] = Object.freeze(['local-services', 'teaching']);
/**
 * How an order is handled today in a business no order flow fits (the plain service type: a maker of goods, work in no
 * listed kind). The built-in steps speak of a client's files and of sending the work, which is not how such an order
 * goes. These four lines are what Chausar really does there: the owner records the order (Work, New order), an agent
 * drafts the reply from it for the owner to check, and the owner does and delivers the rest.
 */
export const OWN_ORDER_LINES: readonly string[] = Object.freeze([
  'You record each order: who it is for and what they asked for.',
  'You do the work or make the goods yourself.',
  'An agent drafts the reply to the customer from the order, and you check it.',
  'You send the reply and deliver the order yourself.',
]);
/** Said of an agent that does orders while the plan is not accepted yet. */
export const ORDER_AGENT_JOINS = 'Joins when you accept this plan.';

const said = (line: PlanWords) => `${line.value}${line.estimate ? MODEL_ESTIMATE : ''}`;
const sentence = (text: string) => { const words = text.trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };

/**
 * A step's note as the owner reads it. The hands-on note speaks of bookkeeping, the one service where an agent does
 * that work today: only a bookkeeping business reads that sentence. The stored note is unchanged (it is part of the
 * plan's structure); every other note is shown as it is. The first step's note speaks of files: a trade whose client
 * sends a request reads of the request.
 */
export function shownStepNote(note: string, serviceType: string | null): string {
  if (note === COLLECT_NOTE && serviceType !== null && REQUEST_TYPES.includes(serviceType)) return COLLECT_REQUEST;
  return note === HANDS_ON_NOTE && serviceType !== 'bookkeeping' ? HANDS_ON_OWN : note;
}

/** The plan's sections, in reading order. With a kept way, who pays leads and the way and its first week follow the offers. */
export function planSections(plan: PlanParts): PlanSection[] {
  const { way, tax } = plan;
  const assumed = tax.assumed ? ' (Chausar assumed this; confirm it)' : '';
  // A business that does not charge the tax issues plain invoices, whatever its country's invoices are called.
  const taxInvoices = tax.registered && tax.invoiceKind === 'tax-invoice';
  return [
    way ? { heading: 'Who pays', lines: [way.customer] } : { heading: 'Who it is for', lines: [said(plan.customer)] },
    { heading: 'What you sell', lines: plan.offers.map(offer => `${said(offer.name)}: ${offer.price ?? 'no price yet'}. ${said(offer.description)}`) },
    ...(way ? [
      { heading: 'How you earn', lines: [`How you reach them: ${way.reach}`, `Your team does: ${way.teamDoes}`, `You do: ${way.youDo}`] },
      { heading: 'First week', lines: way.firstWeek.map((step, index) => `${index + 1}. ${step}`) },
    ] : []),
    // One team: the agents the owner hired, then the ones that do each order, which join when the plan is accepted.
    ...(plan.team.length || plan.orderAgents?.agents.length ? [{
      heading: 'Your team',
      lines: [
        ...plan.team.map(agent => `${agent.name}: ${[agent.job, ...agent.duties].map(sentence).join(' ')}`),
        // Keeper joins with them (it is code and does no order): every agent that will be on Team is listed here.
        ...(plan.orderAgents ? [...plan.orderAgents.agents, KEEPER_JOINS] : []).map(agent => `${agent.name}: ${sentence(agent.does)}${plan.orderAgents!.joined ? '' : ` ${ORDER_AGENT_JOINS}`}`),
        ...PLAN_TEAM_LINES,
      ],
    }] : []),
    {
      // The way says how the business earns; these steps say how one order is done and checked.
      heading: way ? 'How each order is done' : 'How the work is done',
      lines: plan.flagshipSteps
        ? plan.flagshipSteps.map(step => `${said(step.title)}: ${step.doer}.`)
        // No order flow fits the plain service type: how an order is handled today, in plain words.
        : plan.serviceType === 'other' ? [...OWN_ORDER_LINES]
          : plan.steps.map(step => `${said(step.title)}: ${DONE_BY[step.doneBy] ?? step.doneBy}. ${shownStepNote(step.note, plan.serviceType)}`),
    },
    { heading: 'What you approve', lines: plan.approvals.map(said) },
    {
      heading: 'Back office',
      lines: [
        `${tax.registered ? 'You charge' : 'You do not charge'} ${tax.label}${assumed}.`,
        taxInvoices ? 'Invoices are tax invoices.' : 'Invoices are plain invoices.',
        ...(taxInvoices ? tax.missing.map(item => `Missing for a tax invoice: ${item}.`) : []),
      ],
    },
  ];
}
