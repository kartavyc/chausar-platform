// Synthetic composer answers for the P-engine unit tests (onboarding v2). Hand-written, never captured from a live
// account; no paid call was made. Every model string keeps within its word cap and holds no number in digits or words.
import type { Json, ModelReplayFixture, ModelTransport } from '../../../../runtime/venture/contracts.ts';
import type { ComposeModelOutput, DecideModelOutput } from '../../../../runtime/venture/onboarding-contracts.ts';
import { createReplayTransport } from '../../../../runtime/venture/models/index.ts';

export const DOG_TEXT = 'Dog walking for busy nurses in Leeds.';
export const EXCEL_TEXT = "I'm good at Excel and I want to teach it.";
export const CAFE_TEXT = 'Small cafes lose track of their bills.';
export const LANDLORD_TEXT = "My landlord won't fix the heating.";

export const DOG_DECIDE: DecideModelOutput = { kind: 'idea', family: 'other', reading: 'Walk dogs for nurses on long shifts in Leeds', views: ['offers-first', 'pages', 'notes'] };
export const DOG_COMPOSE: ComposeModelOutput = {
  name: 'Shift Paws Leeds',
  oneLiner: 'Dog walks for nurses who work long shifts in Leeds.',
  customer: 'Nurses in Leeds who work long or late shifts.',
  offers: [
    { block: 'subscription', name: 'Weekly walks', description: 'Regular walks on the days you work.', pricingModel: 'monthly' },
    { block: 'package', name: 'Holiday cover', description: 'Daily visits while you are away.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'book-time', title: 'Agree the walk times' },
    { block: 'in-person-work', title: 'Walk the dogs' },
    { block: 'draft-reply', title: 'Reply to owners' },
    { block: 'get-paid', title: 'Get paid' },
  ],
  approvals: ['each-draft', 'prices-invoices'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'Say what Shift Paws does, with one button to book.' },
    { block: 'offers-prices', title: 'Walks and prices', purpose: 'Each walk offer with its price.' },
    { block: 'booking', title: 'Book a walk', purpose: 'Pick a time for a meet and greet.' },
    { block: 'faq', title: 'Questions', purpose: 'Short answers about keys, leads and weather.' },
  ],
  tools: [
    { block: 'cal-com', reason: 'Owners pick walk times.' },
    { block: 'whatsapp', reason: 'Owners send updates and photos.' },
  ],
  questions: [],
  notes: ['insurance', 'safety'],
  views: { 'offers-first': { lead: ['offer_1', 'offer_2'] }, pages: { lead: ['page_1', 'page_3'] }, notes: { lead: ['insurance'] } },
};

export const EXCEL_DECIDE: DecideModelOutput = { kind: 'skill', family: 'consulting', reading: 'Teach Excel to people who want to use it at work', views: ['steps-first', 'questions', 'tools'] };
export const EXCEL_COMPOSE: ComposeModelOutput = {
  name: 'Clear Sheets',
  oneLiner: 'Friendly Excel lessons for people who use it at work.',
  customer: 'Office workers who want to feel at ease with Excel.',
  offers: [
    { block: 'session', name: 'Excel lesson', description: 'One lesson on what you need right now.', pricingModel: 'hourly' },
    { block: 'course', name: 'Excel basics course', description: 'A short set of lessons from the start.', pricingModel: 'project' },
    { block: 'audit', name: 'Workbook check', description: 'A look at your workbook with a list of fixes.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'collect-inputs', title: 'Gather their workbook' },
    { block: 'meet-client', title: 'Teach the lesson' },
    { block: 'draft-reply', title: 'Send lesson notes' },
    { block: 'follow-up', title: 'Check how it went' },
    { block: 'get-paid', title: 'Get paid' },
  ],
  approvals: ['each-draft', 'client-files'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'Say what the lessons cover, with one button to start.' },
    { block: 'offers-prices', title: 'Lessons and prices', purpose: 'Each lesson offer with its price.' },
    { block: 'about', title: 'About me', purpose: 'Who teaches the lessons.' },
    { block: 'start-request', title: 'Ask for a lesson', purpose: 'A short form to ask for a lesson.' },
  ],
  tools: [
    { block: 'google-calendar', reason: 'Learners pick lesson times.' },
    { block: 'google-drive', reason: 'Share workbooks before a lesson.' },
  ],
  questions: [
    { block: 'customer', kind: 'choice', text: 'Who do you want to teach?', choices: ['Office workers', 'Small business owners', 'Students'] },
    { block: 'area', kind: 'text', text: 'Where will you teach?', choices: [] },
  ],
  notes: [],
  views: { 'steps-first': { lead: ['step_2', 'step_3', 'step_4'] }, questions: { lead: ['q_1'] }, tools: { lead: ['google-calendar'] } },
};

export const CAFE_DECIDE: DecideModelOutput = { kind: 'problem', family: 'bookkeeping', reading: 'Help small cafes keep their bills in order', views: ['audience-first', 'tools', 'pages'] };
export const CAFE_COMPOSE: ComposeModelOutput = {
  name: 'Cafe Bills Desk',
  oneLiner: 'Bookkeeping for small cafes, with every bill matched to the bank.',
  customer: 'Owners of small cafes who lose track of bills.',
  offers: [
    { block: 'retainer', name: 'Monthly books', description: 'Your bills and bank matched each month.', pricingModel: 'monthly' },
    { block: 'setup', name: 'Books setup', description: 'Your books set up once, ready for each month.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'collect-inputs', title: 'Collect bills and statements' },
    { block: 'hands-on-work', title: 'Match bills to bank' },
    { block: 'draft-reply', title: 'Write the month summary' },
    { block: 'send', title: 'Send the summary' },
  ],
  approvals: ['each-draft', 'client-files'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'Say what the service does, with one button to start.' },
    { block: 'offers-prices', title: 'Plans and prices', purpose: 'Each plan with its price.' },
    { block: 'how-it-works', title: 'How it works', purpose: 'How bills move from the cafe to the books.' },
    { block: 'start-request', title: 'Get started', purpose: 'A short form to ask for help.' },
  ],
  tools: [
    { block: 'google-drive', reason: 'Cafes drop bills and statements in one folder.' },
    { block: 'zoho-books', reason: 'Where many cafes already keep books.' },
  ],
  questions: [],
  notes: [],
  views: { 'audience-first': { who: 'Owners of small busy cafes', pain: 'Bills go missing before the books close' }, tools: { lead: ['google-drive'] }, pages: { lead: ['page_1', 'page_2'] } },
};

/** The cafe plan with a client-area page in place of the request form, for the brief test that keeps the sign-in lines. */
export const CAFE_COMPOSE_CLIENT_AREA: ComposeModelOutput = {
  ...CAFE_COMPOSE,
  pages: [...CAFE_COMPOSE.pages.slice(0, 3), { block: 'client-area', title: 'Your bills', purpose: 'A signed-in page with your own bills and months.' }],
};

export const LANDLORD_DECIDE: DecideModelOutput = { kind: 'not-a-service', family: 'other', reading: 'Get the heating fixed', views: [] };

export const MODELS = Object.freeze({ fast: 'claude-haiku-5-5', main: 'claude-sonnet-5-5' });

/** An Anthropic Messages response holding one JSON text block, as a replay entry. */
export function anthropicEntry(purpose: 'decide' | 'compose', value: unknown, mustInclude: string[], model = purpose === 'decide' ? MODELS.fast : MODELS.main): ModelReplayFixture['responses'][number] {
  return {
    purpose, kind: 'anthropic-messages', model, status: 200, mustInclude,
    body: {
      id: `msg_synthetic_${purpose}`, type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
      stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1200, output_tokens: 300 },
    } as Json,
  };
}

/** A Claude Code JSON result (claude -p --output-format json) holding structured output, as a replay entry. */
export function claudeCliEntry(purpose: 'decide' | 'compose', value: unknown, mustInclude: string[]): ModelReplayFixture['responses'][number] {
  return {
    purpose, kind: 'claude-cli', model: 'claude-sonnet-5-5', status: 200, mustInclude,
    body: { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: value, usage: { input_tokens: 1200, output_tokens: 300 } } as Json,
  };
}

export function replay(responses: ModelReplayFixture['responses']): ModelTransport {
  return createReplayTransport({ label: 'synthetic recording', note: 'Hand-written composer answers for unit tests. No paid call was made.', responses });
}

/** The usual pair for a sentence: decide on Haiku, compose on Sonnet. */
export function planEntries(text: string, decide: DecideModelOutput, compose: ComposeModelOutput | null): ModelReplayFixture['responses'] {
  const phrase = text.slice(0, 16);
  const entries = [anthropicEntry('decide', decide, ['chausar-decide-v1', phrase])];
  if (compose) entries.push(anthropicEntry('compose', compose, ['chausar-compose-v1', phrase]));
  return entries;
}
