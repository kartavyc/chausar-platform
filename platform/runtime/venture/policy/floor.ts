// Chausar venture launcher, policy (P2-posture): the always-ask floor.
// Money going out, sending to a client or the public, deleting, changing prices, anything on a government portal,
// using a password, key or signed-in account, creating or changing a recurring job (an automation, a trigger, a
// workflow or a repeat rule), adding or loosening a rule, changing payment or payout details, and issuing for real
// (not drafting) need the owner's approval at every posture, auto with spot checks included. Deleting or stopping a
// scheduled job takes autonomy away, so it stays off the floor, unless the same action also makes one.
// Code decides what an action touches, from a table and then from the action itself, whatever the tool says it does,
// so a new effect is never quietly off the floor. Sending, money going out and deleting come from the one word list in
// effects.ts (classifyEffects, with the connector catalogue), the other kinds from the words here; argument values
// (notifying someone, archiving, issuing, a repeat rule, account details) and a DELETE web method add to it; a caller
// may add kinds, never remove them. A draft that carries a flag to issue it fails loudly.
// The floor that applies in every posture follows yc-software/qm command-policy (MIT); the recurring-job, rule and
// payment-detail rows follow omnigent policies/builtins/safety.py and the separate issue step Lexware-MCP-Server
// finalize-confirmation.ts (Ink v2 wave 1, H12). These are rewrites, not copies.
import { check } from '../../contracts.ts';
import type { ToolEffect } from '../contracts.ts';
import { argumentFlags, classifyEffects, DESTRUCTIVE_WORDS, mutatingHttp, nameWords, toolDeclaration } from './effects.ts';

export const FLOOR_KINDS = ['money-out', 'send', 'delete', 'price-change', 'government-portal', 'credential', 'recurring-job', 'rule-change', 'payment-details', 'issue'] as const;
export type FloorKind = typeof FLOOR_KINDS[number];

export const FLOOR_WORDS: Readonly<Record<FloorKind, string>> = Object.freeze({
  'money-out': 'Money going out always asks you first.',
  send: 'Sending to a client or the public always asks you first.',
  delete: 'Deleting anything always asks you first.',
  'price-change': 'Changing a price always asks you first.',
  'government-portal': 'Anything on a government portal always asks you first.',
  credential: 'Using a password, a key or a signed-in account always asks you first.',
  'recurring-job': 'Creating or changing a recurring job always asks you first.',
  'rule-change': 'Adding or loosening a rule always asks you first.',
  'payment-details': 'Changing payment or payout details always asks you first.',
  issue: 'Issuing for real, not as a draft, always asks you first.',
});

/** The words for every kind an action touches, in FLOOR_KINDS order: issuing an invoice says both lines. */
export function floorWords(floor: readonly FloorKind[]): string {
  return floor.map(kind => FLOOR_WORDS[kind]).join(' ');
}

/** Why a draft that carries a flag to issue it is refused. */
export const DRAFT_ISSUE_WORDS = 'This draft carries a flag to issue it for real. Drafting never issues; issuing is its own step and asks you first.';

/**
 * What a policy is asked about. tool-call: one harness tool call, before it runs. outside-effect: one effect that
 * leaves Chausar, before it is applied. digest: what an owner approval binds to. inputDigest: a tool call's exact input.
 * input: the call's checked input or the effect's arguments. connector: a catalogue id. http: the web method.
 */
export type PolicyAction = {
  phase: 'tool-call' | 'outside-effect';
  name: string;
  effect?: ToolEffect | null;
  touches?: readonly FloorKind[];
  inputDigest?: string;
  digest?: string;
  input?: Readonly<Record<string, unknown>> | null;
  connector?: string | null;
  http?: string | null;
};

/** Known names. The two harness tools that only record a request carry the floor of what they would do once applied. */
const TABLE: Readonly<Record<string, readonly FloorKind[]>> = Object.freeze({
  'payment.send': ['money-out'], 'payment.refund': ['money-out'], 'payout.send': ['money-out'], 'purchase.make': ['money-out'],
  'connector.post': ['send'], 'outbox.send': ['send'], 'message.send': ['send'], 'invoice.issue': ['send', 'issue'], 'deliverable.send': ['send'],
  'site.edit.apply': ['send'], 'site.publish': ['send'],
  'record.delete': ['delete'], 'file.delete': ['delete'],
  'price.change': ['price-change'],
  'portal.gst.file': ['government-portal'], 'portal.itr.file': ['government-portal'],
  'delegate.start': ['credential'], 'credential.use': ['credential'], 'browser.session': ['credential'],
  'outbox.propose': ['send'], 'agent.delegate': ['credential'],
  'schedule.create': ['recurring-job'], 'schedule.change': ['recurring-job'], 'job.schedule': ['recurring-job'],
  'schedule.delete': [], 'job.unschedule': [],
  'rule.add': ['rule-change'], 'rule.change': ['rule-change'], 'rule.loosen': ['rule-change'], 'policy.change': ['rule-change'],
  'payment.details.change': ['payment-details'], 'payout.details.change': ['payment-details'], 'bank.details.change': ['payment-details'],
  'invoice.draft': [],
});

/** Words for the kinds only the floor has. Whole words of the name (effects.ts nameWords). */
const WORDS: readonly [FloorKind, RegExp][] = [
  ['price-change', /^(price|prices|pricing|reprice)$/],
  ['government-portal', /^(portal|gst|gstn|itr|tds|mca|epfo|incometax|traces)$/],
  ['credential', /^(credential|credentials|password|token|secret|login|cookie|cookies|session|key|keys)$/],
  ['recurring-job', /^(schedule|schedules|scheduled|recurring|recurrence|rrule|cron|crontab|automation|automations|trigger|triggers|workflow|workflows)$/],
  ['rule-change', /^(rule|rules|policy|policies|filter|filters|allowlist|allowlists|whitelist|permission|permissions|forwarding)$/],
  ['issue', /^(issue|issued|finalize|finalise|finalized|finalised)$/],
];
const MONEY_OUT: ReadonlySet<string> = new Set(DESTRUCTIVE_WORDS.moneyOut);
const DELETE: ReadonlySet<string> = new Set(DESTRUCTIVE_WORDS.delete);
const SCHEDULED = /^(schedule|schedules|scheduled|recurring|recurrence|cron|crontab|automation|automations|trigger|triggers|workflow|workflows)$/;
const STOPS = /^(delete|remove|cancel|stop|pause|disable|erase|purge|drop|destroy|unschedule)$/;
const MAKES = /^(create|add|new|update|change|edit|set|replace|modify|enable|resume|start|restart|upsert|put|patch|insert|reschedule|schedule)$/;
/** Payment or payout details: a payee word, a payment word with a word for its details or a change, or an account number. */
const PAYEE = /^(beneficiary|beneficiaries|payee|payees|iban|ifsc|swift)$/;
const PAY_SIDE = /^(pay|payment|payments|payout|payouts|bank|billing|settlement|remittance|upi|vpa|fund)$/;
const DETAILS = /^(details|detail|account|accounts|method|methods|info|change|update|edit|set|add|replace)$/;

/** True for a name that only stops or deletes a scheduled job: deleting one is free, making one is not. */
function unscheduling(words: readonly string[]): boolean {
  const stops = words.includes('unschedule') || (words.some(word => SCHEDULED.test(word)) && words.some(word => STOPS.test(word)));
  // 'schedule' is both the job and a verb, so it counts as making one only beside another word for making.
  const makes = words.some(word => MAKES.test(word) && word !== 'schedule');
  return stops && !makes;
}

/** The floor kinds an action touches, in FLOOR_KINDS order. Empty means off the floor. */
export function floorOf(action: PolicyAction): FloorKind[] {
  const found = new Set<FloorKind>();
  for (const kind of action.touches ?? []) {
    check((FLOOR_KINDS as readonly string[]).includes(kind), 'INVALID_VENTURE_REQUEST', 'That is not a floor kind.');
    found.add(kind);
  }
  const listed = Object.hasOwn(TABLE, action.name) ? TABLE[action.name] : null;
  if (listed) for (const kind of listed) found.add(kind);
  else if (!toolDeclaration(action.name)) {
    // Chausar's own tools keep their declaration; anything else is judged from the action, whatever it says it does.
    const words = nameWords(action.name);
    const stopsOnly = unscheduling(words);
    // Sending and money going out: what effects.ts finds in the name, Chausar's coarse effect and the connector.
    const effects = classifyEffects({ name: action.name, effect: stopsOnly ? null : action.effect ?? null, connector: action.connector ?? null });
    if (!effects.unclassified) {
      if (effects.effects.includes('send')) found.add('send');
      if (effects.effects.includes('money') && (words.some(word => MONEY_OUT.has(word)) || action.connector)) found.add('money-out');
    }
    if (!stopsOnly && words.some(word => DELETE.has(word))) found.add('delete');
    for (const [kind, pattern] of WORDS) {
      if (stopsOnly && kind === 'recurring-job') continue;
      if (words.some(word => pattern.test(word))) found.add(kind);
    }
    const accountNumber = words.includes('account') && words.some(word => word === 'number' || word === 'no');
    if (accountNumber || words.some(word => PAYEE.test(word)) || (words.some(word => PAY_SIDE.test(word)) && words.some(word => DETAILS.test(word)))) found.add('payment-details');
    if (action.phase === 'tool-call' && action.effect === 'delegate') found.add('credential');
  }
  const flags = argumentFlags(action.input);
  if (flags.notify) found.add('send');
  if (flags.archive || (mutatingHttp(action.http) && action.http!.trim().toUpperCase() === 'DELETE')) found.add('delete');
  if (flags.issue) found.add('issue');
  if (flags.recurring) found.add('recurring-job');
  if (flags.paymentDetails) found.add('payment-details');
  return FLOOR_KINDS.filter(kind => found.has(kind));
}

/** Words for a draft that carries a flag to issue it for real, or null. Drafting never issues. */
export function draftIssueFlag(action: PolicyAction): string | null {
  const words = nameWords(action.name);
  if (!words.includes('draft') && !words.includes('drafts')) return null;
  return argumentFlags(action.input).issue ? DRAFT_ISSUE_WORDS : null;
}
