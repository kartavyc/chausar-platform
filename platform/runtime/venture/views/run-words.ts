// Chausar venture launcher: more of the words Chausar itself writes, for the app to say in the owner's language (fix
// round 7, re-check 6 item 5). With Hindi on these stayed English: every Earlier line, the run sheet's steps, the run's
// model receipt, the evidence line, and Team's "Idle" and "On your own AI plan". The app says each from its pack
// (app/ui/src/places/today/plan-words.ts), the way round 6 did for a draft's card (views/card-words.ts):
// - RUN_FIXED_WORDS are the same every time;
// - RUN_TEMPLATE_WORDS hold a count, a name or another of these lines in {braces}. The app finds the template a line
//   was filled from and says it with the same values; a value stays as written unless it is itself one of these lines.
// - SERVICE_STEPS are the steps each kind of service starts with (core/service-types.ts); a step the owner or the AI
//   wrote is not one of them and stays as written.
// A test holds the engine to exactly these words and the English pack to them.
//
// Pure: no store, no network and no Node imports, so the app's fake engine and the app read this file.

export const RUN_FIXED_WORDS = Object.freeze({
  /** A price step's evidence (views/runs.ts). */
  priceReceipt: 'Price receipt',
  /** An agent with nothing on now, and one while the business is paused (views/team.ts). */
  idle: 'Idle',
  paused: 'Paused',
  /** A month's AI spend that came to nothing on the owner's own plan (owner-format.ts formatCost, models/own-plan.ts). */
  ownPlan: 'On your own AI plan',
  /** The Delivery agent's job (agents/order-agents-core.ts DELIVERY_JOB, views/team.ts): Chausar's words, not an AI's. */
  deliveryJob: 'Reads each order, works on it with tools, and drafts the reply for you to check.',
});

/**
 * The words of a run's model receipt (money/model-receipt.ts, which exports them). The suffixes (" (estimate)") are
 * parts of a line, not lines, so the app does not say them alone.
 */
export const RECEIPT_WORDS = Object.freeze({
  templates: 'Built-in templates', ownCopy: 'Your own copy', noAi: 'No AI', noCost: 'No cost',
  plan: 'On your plan', unknown: 'Not known yet', notReported: 'not reported', tokensNotReported: 'Tokens not reported',
  someNotReported: ' (some not reported)', yourTool: 'Your AI tool', yourKey: 'Your AI key', estimate: ' (estimate)',
  // Fix round 6 (17 Nov 2026): one role word, one model. A call names its tier as Connections does; an agent job names
  // the main model AI settings chooses (on Codex gpt-6.1-terra, where calls run on gpt-6-luna).
  tier: Object.freeze({ main: 'Plans and drafts', fast: 'Quick work' }) as Readonly<Record<'main' | 'fast', string>>,
  job: 'Main model',
});

export const RUN_TEMPLATE_WORDS = Object.freeze({
  /** The tokens a provider reported (money/model-receipt.ts usageWords), each count grouped as the country groups it. */
  usage: '{input} tokens in, {output} out',
  /** A check's line on the evidence (delivery/verdicts.ts checkLine), one per outcome word. */
  checkPass: 'Passed: {detail}',
  checkFail: 'Failed: {detail}',
  checkNotRun: 'Not run: {detail}',
  checkNotChecked: 'Not checked: {detail}',
  /** A decision on Today's Earlier, by the owner (journal/decision-words.ts DECISION_WORDS with "You"). */
  decidedOwner: 'You decided: {reason}',
  chosePlan: 'You chose {action}: {reason}',
  choseToday: 'You chose {action} on Today: {reason}',
  /** The owner's own price and tax answers as their decision says them (core/owner-price.ts, core/owner-tax.ts). */
  priceSet: 'Price of {item} set to {price}.',
  noTax: 'You do not charge {tax}.',
});

/** The steps each kind of service starts with (core/service-types.ts serviceTemplate), each written once. */
export const SERVICE_STEPS: readonly string[] = Object.freeze([
  "Collect the client's goals and brand files", "Set up ads and posts in the client's accounts", 'Draft the campaign plan and posts for review',
  'Send the approved plan to the client', 'Collect the raw files and the brief', 'Edit and design the work', 'Draft notes and questions on the brief for review',
  'Send the final files to the client', "Gather the client's questions and papers", 'Hold the call and work through the problem', 'Draft the written advice for review',
  'Send the advice to the client', 'Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client',
  "Collect the client's question and sources", 'Search and read the sources', 'Draft the research notes for review', 'Send the notes to the client',
  'Collect the topic, notes and examples', 'Research the topic and gather sources', 'Draft the piece for review', 'Send the piece to the client',
  'Collect the customer messages', "Look up orders and accounts in the client's tools", 'Draft replies for review', 'Send the approved replies',
  "Collect each learner's level and goals", 'Teach the class or the session', 'Draft worksheets, quizzes and progress notes for review',
  'Send the approved notes to learners or parents', 'Collect the booking request and the address', 'Do the visit or the work in person',
  'Draft the quote, the reminder and the follow up for review', 'Send the approved reminder to the customer', "Collect the client's papers and questions",
  'Hold the consultation yourself', 'Draft notes, letters and reminders for your sign off', 'Send what you signed to the client', 'Collect what the client sends',
  'Do the hands-on work', 'Draft the reply for review', 'Send the work to the client',
]);

/** A step's pack name: its words in lower case, joined by hyphens ("do-the-hands-on-work"). */
export const stepKey = (step: string): string => step.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
