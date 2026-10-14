/**
 * Ready-made jobs. Each is a typed card the owner reads before it starts: its steps, which of
 * them need an AI model, the calculations it depends on and the actions it may prepare.
 * The founder's first set: receivables (a week of chasing unpaid invoices), cash position,
 * stock and the weekly close, plus GST matching when the connectors lane serves it.
 * Custom jobs from one sentence run through an installed agent route and are labelled.
 */
import { check } from '../contracts.ts';
import type { StepKind, MissedRule } from './state.ts';

export const DAY_MS = 86_400_000;

export type JobTemplate = {
  id: string; title: string; goal: string; finishedWhen: string;
  intervalMs: number; stepsPerDelivery: number; maxRuns: number; durationDays: number;
  budgetMinor: string; reserveMinor: string; missedRule: MissedRule;
  steps: { kind: StepKind; title: string; needsModel: boolean }[];
  /** Published calculations the job reads, or another lane's method it needs. */
  requires: { operations: string[]; method?: string };
  allowedActions: string[]; keywords: string[];
  /** Cases the job works through, one child result each (one level deep). */
  caseSource: 'unpaid-invoices' | 'none' | 'goal';
  experimental?: boolean;
};

export const TEMPLATES: readonly JobTemplate[] = Object.freeze([
  { id: 'receivables-week', title: 'Chase unpaid invoices for a week',
    goal: 'Find unpaid invoices each day for a week, prepare a reminder for each customer who agreed to be contacted, and report what was paid.',
    finishedWhen: 'Seven daily rounds are done, or every invoice in the list is paid. You accept the week’s result.',
    intervalMs: DAY_MS, stepsPerDelivery: 7, maxRuns: 1, durationDays: 8, budgetMinor: '5000', reserveMinor: '700', missedRule: 'once',
    steps: [
      { kind: 'calculate', title: 'Work out what each customer owes (receivable aging)', needsModel: false },
      { kind: 'question', title: 'Decide for each invoice: remind, wait or ask you', needsModel: false },
      { kind: 'action', title: 'Prepare a reminder (it waits for your yes before anything is sent)', needsModel: false },
      { kind: 'lookup', title: 'Look up a missing detail with the agent, only when the rule is unsure', needsModel: true },
    ],
    requires: { operations: ['aging'] }, allowedActions: ['local.reminder-draft', 'writeback.payment-reminder'],
    keywords: ['unpaid', 'invoice', 'invoices', 'chase', 'reminder', 'reminders', 'receivable', 'receivables', 'collect', 'owed', 'overdue', 'paid'], caseSource: 'unpaid-invoices' },
  { id: 'cash-position', title: 'Cash position every morning',
    goal: 'Each morning, report money received and money still owed, each with its receipt.',
    finishedWhen: 'The morning report is delivered with a receipt for every figure. You accept it.',
    intervalMs: DAY_MS, stepsPerDelivery: 1, maxRuns: 30, durationDays: 31, budgetMinor: '1000', reserveMinor: '10', missedRule: 'once',
    steps: [
      { kind: 'calculate', title: 'Money received this month', needsModel: false },
      { kind: 'calculate', title: 'Money still owed (receivable aging)', needsModel: false },
    ],
    requires: { operations: ['received', 'aging'] }, allowedActions: [], keywords: ['cash', 'position', 'morning', 'bank', 'money', 'received'], caseSource: 'none' },
  { id: 'weekly-close', title: 'The weekly close',
    goal: 'Every week, total net sales, the contribution margin and what is still owed, then ask a person to review and lock the week in the books.',
    finishedWhen: 'The week’s figures are delivered with receipts and a person marked the review done. You accept it.',
    intervalMs: 7 * DAY_MS, stepsPerDelivery: 1, maxRuns: 12, durationDays: 85, budgetMinor: '2000', reserveMinor: '20', missedRule: 'once',
    steps: [
      { kind: 'calculate', title: 'Net sales for the week', needsModel: false },
      { kind: 'calculate', title: 'Contribution margin for the week', needsModel: false },
      { kind: 'calculate', title: 'Receivable aging at the week’s end', needsModel: false },
      { kind: 'person', title: 'Review the week and lock it in your books', needsModel: false },
    ],
    requires: { operations: ['net_sales', 'margin', 'aging'] }, allowedActions: [], keywords: ['week', 'weekly', 'close', 'books', 'lock', 'review', 'friday'], caseSource: 'none' },
  { id: 'stock-check', title: 'Stock check',
    goal: 'Every week, report stock on hand by item with its receipt.',
    finishedWhen: 'The stock figures are delivered with receipts. You accept them.',
    intervalMs: 7 * DAY_MS, stepsPerDelivery: 1, maxRuns: 12, durationDays: 85, budgetMinor: '1000', reserveMinor: '10', missedRule: 'once',
    steps: [{ kind: 'calculate', title: 'Stock on hand', needsModel: false }],
    requires: { operations: ['stock_on_hand'] }, allowedActions: [], keywords: ['stock', 'inventory', 'items', 'warehouse'], caseSource: 'none' },
  { id: 'gst-matching', title: 'GST matching',
    goal: 'Each month, match the purchase register against GSTR-2B and list what does not match.',
    finishedWhen: 'The match list is delivered. You accept it. Nothing is filed: tax filings are prepare only.',
    intervalMs: 30 * DAY_MS, stepsPerDelivery: 1, maxRuns: 12, durationDays: 365, budgetMinor: '1000', reserveMinor: '10', missedRule: 'once',
    steps: [{ kind: 'lookup', title: 'Match purchases against GSTR-2B (the connectors lane)', needsModel: false }, { kind: 'person', title: 'You or your CA files the return', needsModel: false }],
    requires: { operations: [], method: 'connectorsx.gstMatch' }, allowedActions: [], keywords: ['gst', 'gstr', '2b', 'purchase', 'register', 'match', 'tax'], caseSource: 'none' },
  { id: 'agent-task', title: 'A job in your own words',
    goal: '', finishedWhen: 'The agent hands back a result with its trace and you accept it.',
    intervalMs: DAY_MS, stepsPerDelivery: 1, maxRuns: 7, durationDays: 8, budgetMinor: '5000', reserveMinor: '500', missedRule: 'once',
    steps: [{ kind: 'lookup', title: 'The agent works on the goal (lookups only, no actions of its own)', needsModel: true }],
    requires: { operations: [] }, allowedActions: [], keywords: [], caseSource: 'goal', experimental: true },
] satisfies JobTemplate[]);

export function template(id: unknown): JobTemplate {
  const found = TEMPLATES.find(item => item.id === id);
  check(found, 'UNKNOWN_TEMPLATE', 'Choose a ready-made job.');
  return found;
}

const WORD = /[a-z0-9]+/g;
/**
 * Picks a ready-made job for one sentence by fixed keywords. No model reads the sentence.
 * A sentence that matches nothing, or two jobs equally, becomes an agent task.
 */
export function matchSentence(sentence: string): { template: JobTemplate; score: number; ambiguous: boolean } {
  check(typeof sentence === 'string' && sentence.trim().length >= 5 && sentence.length <= 500, 'INVALID_GOAL', 'Describe the job in one sentence.');
  const words = new Set(sentence.toLowerCase().match(WORD) ?? []);
  const scored = TEMPLATES.filter(item => item.keywords.length).map(item => ({ template: item, score: item.keywords.filter(word => words.has(word)).length }))
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
  const best = scored[0]; const second = scored[1];
  if (!best || best.score === 0) return { template: template('agent-task'), score: 0, ambiguous: false };
  if (second && second.score === best.score) return { template: template('agent-task'), score: best.score, ambiguous: true };
  return { template: best.template, score: best.score, ambiguous: false };
}

/** A ready-made job in the Agent Skills folder format (`<id>/SKILL.md`), so day-9 add-ons share one shape. */
export function skillFile(item: JobTemplate): { path: string; content: string } {
  const lines = [
    '---', `name: chausar-${item.id}`, `description: ${item.title}. ${item.goal || 'A job in your own words, run by an agent route.'}`.replace(/\n/g, ' '), '---', '',
    `# ${item.title}`, '', `**Finished when:** ${item.finishedWhen}`, '', '## Steps', '',
    ...item.steps.map((step, index) => `${index + 1}. ${step.title} (${step.kind}; ${step.needsModel ? 'needs an AI model' : 'runs without one'})`), '',
    '## Rules', '', '- Money, messages to outsiders, deleting and anything that cannot be undone always wait for a person.',
    '- A job cannot create another job without the owner’s yes.', '- The job is finished only when its owner accepts the result.',
    `- Calculations it reads: ${item.requires.operations.length ? item.requires.operations.join(', ') : 'none'}.`,
    `- Actions it may prepare: ${item.allowedActions.length ? item.allowedActions.join(', ') : 'none'}.`, '',
  ];
  return { path: `${item.id}/SKILL.md`, content: lines.join('\n') };
}
