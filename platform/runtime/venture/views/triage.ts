// Chausar venture launcher, views (Ink v2 wave 4, package 4J2; catalogue O18): the owner's triage rule orders Today
// (venture.triage.preview and venture.triage.set). The owner writes how they want Today ordered ("clients with a
// deadline first"); their own AI maps the words to a typed rule over fixed fields only (due, client, kind, money,
// business, each ascending or descending), and with no AI the fixed choices are offered. The preview is a dry run of
// today's rows in that order; set saves the rule and Today's order uses it. A rule only orders: it never hides, drops
// or adds a row, and never changes an id or a digest. The plan and setup rows still lead and locked businesses still
// come last; the rule orders the rows between. Every key's value comes from the row's own fields and receipts, by code.
// A rule can also name kinds of item that lead everything, setup cards included ("proposals that find customers
// first"): the owner asked for exactly that first. Found on Windows, 16 Nov 2026: with only the five sort fields a
// rule had no way to say it, the setup cards led whatever it said, and the box still showed the owner's words as
// the rule. The box now shows what the rule does, in code's words (ruleDoes).
import { authorize, ChausarError, check, type Context, type State, internalCheck } from '../../contracts.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type { Json, ModelTask, QueueKind, QueueRow, TriageField, TriageGroup, TriagePreview, TriageRule, TriageRuleRecord, TriageRuleView, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, digest, exactPayload, findRecord, listRecords, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import { screenReadback } from '../core/secrets.ts';
import { stakeOf } from '../money/next-step.ts';

export const TRIAGE_FIELDS: readonly TriageField[] = Object.freeze(['due', 'client', 'kind', 'money', 'business'] as const);
/** The most keys one rule has. */
export const TRIAGE_KEYS_MAX = 3;
/** The kinds of item a rule can put first, each with the words code says for it. The most exact kind stands first. */
const GROUP_WORDS: Readonly<Record<TriageGroup, string>> = Object.freeze({
  'find-customers': 'proposals that find customers', proposal: 'proposals', draft: 'drafts', question: 'questions for you', invoice: 'invoices', quote: 'quotes',
  signoff: 'sign-offs', reply: 'replies', followup: 'follow-ups', bank: 'bank items', connector: 'connections', notice: 'notices', setup: 'setup cards',
  price: 'prices', plan: 'your plan',
});
export const TRIAGE_GROUPS = Object.freeze(Object.keys(GROUP_WORDS)) as readonly TriageGroup[];
/** The wider kind each exact kind belongs to: a proposal that finds customers is a proposal. */
const WIDER: Readonly<Partial<Record<TriageGroup, TriageGroup>>> = Object.freeze({ 'find-customers': 'proposal' });
/** The most kinds one rule puts first. */
export const TRIAGE_FIRST_MAX = 3;
export const TRIAGE_MARKER = 'chausar-triage-rule-v1';

/** The fixed choices, offered with or without the owner's AI. The last one is Chausar's own order. */
export const TRIAGE_CHOICES: readonly TriageRule[] = Object.freeze([
  { keys: [{ field: 'due', order: 'asc' }], words: 'Nearest deadline first' },
  { keys: [{ field: 'money', order: 'desc' }], words: 'Most money first' },
  { keys: [{ field: 'client', order: 'asc' }], words: 'By client, A to Z' },
  { keys: [{ field: 'kind', order: 'asc' }], words: 'By kind of work' },
  { keys: [{ field: 'business', order: 'asc' }], words: 'By business, A to Z' },
  { keys: [], words: "Chausar's own order" },
] as TriageRule[]);

const KEY_WORDS: Readonly<Record<TriageField, Readonly<Record<'asc' | 'desc', string>>>> = Object.freeze({
  due: { asc: 'nearest deadline first', desc: 'latest deadline first' },
  client: { asc: 'client A to Z', desc: 'client Z to A' },
  kind: { asc: 'kind of work', desc: 'kind of work, reversed' },
  money: { asc: 'least money first', desc: 'most money first' },
  business: { asc: 'business A to Z', desc: 'business Z to A' },
});
/** The order the kinds of row take for the kind key. */
const KIND_ORDER: readonly QueueKind[] = ['plan', 'price', 'setup', 'invoice', 'quote', 'draft', 'question', 'signoff', 'connector', 'bank', 'proposal', 'followup', 'reply', 'notice', 'locked'];
const LEAD: readonly QueueKind[] = ['plan', 'price', 'setup'];

const INSTRUCTIONS = `${TRIAGE_MARKER}. The owner wrote under words how to order their list of tasks. `
  + 'first: the kinds of item they ask to lead, in order, at most three, each the most exact kind and only those the words '
  + 'name (find-customers: a proposal to find customers), else empty. keys: how the rest is sorted, by due (the deadline), '
  + 'client (the name), kind (a fixed order), money (at stake) or business, each asc or desc, at most three, the most '
  + 'important first. If the words ask to hide or drop items, or for what neither can do, give an empty first and no keys: '
  + 'a rule only orders.';

/**
 * What a rule does, from code alone: the kinds that lead, then what the keys do. Empty for Chausar's own order. A wider
 * kind after its exact kind leads only the rest of its kind: "proposals that find customers first, then other proposals".
 */
export function ruleDoes(rule: TriageRule): string {
  const first = rule.first ?? [];
  const words = (group: TriageGroup, at: number) => first.slice(0, at).some(earlier => WIDER[earlier] === group) ? `other ${GROUP_WORDS[group]}` : GROUP_WORDS[group];
  return [...first.map((group, at) => (at === 0 ? `${words(group, at)} first` : words(group, at))), ...rule.keys.map(key => KEY_WORDS[key.field][key.order])].join(', then ');
}
/** Whether a rule orders anything: it names a kind to lead, or a key. */
const orders = (rule: TriageRule | null | undefined): rule is TriageRule => !!rule && (rule.keys.length > 0 || (rule.first?.length ?? 0) > 0);

/** The rule in plain words, from code: never the owner's words, which a rule may not be able to hold. */
export function ruleLine(rule: TriageRule): string {
  if (!orders(rule)) return "Today is in Chausar's own order.";
  return `Today is ordered: ${ruleDoes(rule)}. Nothing is hidden.`;
}

/** A rule's keys and words, checked: fixed fields only, each once, asc or desc, at most three. code: the refusal's code. */
export function validateRule(raw: unknown, words: string | null, code = 'INVALID_VENTURE_REQUEST'): TriageRule {
  const body = exactPayload(raw, words === null ? ['keys', 'first', 'words'] : ['keys', 'first'], words === null ? ['keys', 'words'] : ['keys'], code);
  check(Array.isArray(body.keys) && body.keys.length <= TRIAGE_KEYS_MAX, code, `A rule has at most ${TRIAGE_KEYS_MAX} keys.`);
  const keys = (body.keys as unknown[]).map(item => {
    const key = exactPayload(item, ['field', 'order'], ['field', 'order'], code);
    check(typeof key.field === 'string' && (TRIAGE_FIELDS as readonly string[]).includes(key.field), code, 'A rule orders by due, client, kind, money or business only.');
    check(key.order === 'asc' || key.order === 'desc', code, 'Each key is ascending or descending.');
    return { field: key.field as TriageField, order: key.order as 'asc' | 'desc' };
  });
  check(new Set(keys.map(key => key.field)).size === keys.length, code, 'Use each field once.');
  const named = body.first ?? [];
  check(Array.isArray(named) && named.length <= TRIAGE_FIRST_MAX && named.every(group => typeof group === 'string' && (TRIAGE_GROUPS as readonly string[]).includes(group))
    && new Set(named).size === named.length, code, `A rule puts at most ${TRIAGE_FIRST_MAX} kinds of item first, each once, from the kinds Today shows.`);
  // An exact kind named after its wider kind would lead nothing: the wider one already took its rows (orderRows).
  const first = (named as TriageGroup[]).filter((group, at, all) => !all.slice(0, at).includes(WIDER[group]!));
  return { keys, ...(first.length ? { first } : {}), words: words ?? singleLine(body.words, 'The rule\'s words', { min: 1, max: 200 }) };
}

/** The newest rule the owner saved for the business, or null. */
export function savedRule(state: State, venture: VentureRecord): TriageRuleRecord | null {
  return listRecords(state, 'venture-triage-rule', venture.id).at(-1) ?? null;
}

/** What a preview and a save are bound to: the rule in force when the dry run was made. */
export function ruleInForceDigest(state: State, venture: VentureRecord): string {
  return savedRule(state, venture)?.digest ?? digest({ rule: null });
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

type Value = string | number | bigint | null;

/**
 * A row's value for one field, from its own fields and receipts; null when it has none (it then goes last). A row of
 * another business is never read with the open business's records or currency: it ranks by business only.
 */
function valueOf(state: State, venture: VentureRecord, row: QueueRow, field: TriageField, openBusinessId: string | null): Value {
  if (field === 'business') return row.businessName;
  if (row.kind === 'locked' || (openBusinessId !== null && row.businessId !== openBusinessId)) return null;
  if (field === 'kind') { const at = KIND_ORDER.indexOf(row.kind); return at < 0 ? KIND_ORDER.length : at; }
  if (field === 'client') return row.meta?.client ?? row.followup?.name ?? row.reply?.name ?? null;
  if (field === 'due') {
    const at = row.meta?.expiresAt ? Date.parse(row.meta.expiresAt) : row.followup?.due ? Date.parse(`${row.followup.due}T00:00:00.000Z`) : NaN;
    return Number.isFinite(at) ? at : null;
  }
  // money: only a stored receipt in the business's own currency (money/next-step.ts); a business still in its
  // interview has no country, so nothing it shows has money at stake.
  try { return venture.country ? stakeOf(state, venture, row)?.amount ?? null : null; } catch { return null; }
}

function compare(a: Value, b: Value, order: 'asc' | 'desc'): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  const sign = order === 'asc' ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') return sign * a.localeCompare(b, 'en', { sensitivity: 'base' });
  return a < b ? -sign : a > b ? sign : 0;
}

/** Whether a row is of a kind a rule names. A proposal that finds customers is told by its own record, never its title. */
function inGroup(state: State, row: QueueRow, group: TriageGroup): boolean {
  if (group !== 'find-customers') return row.kind === group;
  if (row.kind !== 'proposal') return false;
  const [subject, id] = row.id.split(':');
  return subject === 'proposal' && !!id && findRecord(state, 'venture-proposal', id)?.proposalKind === 'find-customers';
}

/** The open business's id on Today: other businesses only ever show as locked rows (views/queue.ts). */
function openBusinessOf(rows: readonly QueueRow[]): string | null {
  return rows.find(row => row.kind !== 'locked')?.businessId ?? null;
}

/**
 * Today's rows in a rule's order: the kinds of item the rule names first, in the order named and each in Today's own
 * order; then the plan and setup rows as they are; then the rest ordered by the rule's keys (rows with no value for a
 * key after those with one, ties in Today's own order); then locked businesses. A row of another business is never
 * read, so it never leads. The same rows, each once.
 */
export function orderRows(state: State, venture: VentureRecord | null, all: QueueRow[], rule: TriageRule | null, openBusinessId: string | null = openBusinessOf(all)): QueueRow[] {
  if (!venture || !orders(rule)) return all;
  const led: QueueRow[] = [];
  for (const group of rule.first ?? []) {
    for (const row of all) if (!led.includes(row) && row.kind !== 'locked' && (openBusinessId === null || row.businessId === openBusinessId) && inGroup(state, row, group)) led.push(row);
  }
  const rows = led.length ? all.filter(row => !led.includes(row)) : all;
  if (!rule.keys.length) return led.length ? [...led, ...rows.filter(row => row.kind !== 'locked'), ...rows.filter(row => row.kind === 'locked')] : all;
  const lead = rows.filter(row => LEAD.includes(row.kind));
  const locked = rows.filter(row => row.kind === 'locked');
  const middle = rows.map((row, index) => ({ row, index })).filter(item => !LEAD.includes(item.row.kind) && item.row.kind !== 'locked');
  const values = new Map(middle.map(item => [item.row.id, rule.keys.map(key => valueOf(state, venture, item.row, key.field, openBusinessId))]));
  middle.sort((a, b) => {
    const left = values.get(a.row.id)!, right = values.get(b.row.id)!;
    for (let at = 0; at < rule.keys.length; at += 1) {
      const result = compare(left[at], right[at], rule.keys[at].order);
      if (result) return result;
    }
    return a.index - b.index;
  });
  return [...led, ...lead, ...middle.map(item => item.row), ...locked];
}

/**
 * Orders Today's rows by the owner's saved triage rule. A rule never hides a row: it returns the same rows, each once,
 * with the same ids and digests. With no rule saved it keeps the engine's own order.
 */
export function withTriage(state: State, rows: QueueRow[]): QueueRow[] {
  const venture = currentVenture(state);
  if (!venture) return rows;
  return orderRows(state, venture, rows, savedRule(state, venture)?.rule ?? null);
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/** The model task that maps the owner's screened words to keys. The owner's words only: no row, client or figure. */
export function triageTask(words: string): ModelTask<TriageRule> {
  const key: Json = { type: 'object', additionalProperties: false, required: ['field', 'order'], properties: { field: { type: 'string', enum: [...TRIAGE_FIELDS] }, order: { type: 'string', enum: ['asc', 'desc'] } } };
  return {
    purpose: 'triage-rule', instructions: INSTRUCTIONS, input: { words, fields: [...TRIAGE_FIELDS] },
    schemaName: 'venture-triage-rule', schema: {
      type: 'object', additionalProperties: false, required: ['first', 'keys'],
      properties: { first: { type: 'array', items: { type: 'string', enum: [...TRIAGE_GROUPS] } }, keys: { type: 'array', items: key } },
    },
    validate: raw => validateRule(raw, words, 'MODEL_OUTPUT_REJECTED'), containsClientData: false, maxOutputTokens: 256,
  };
}

/** The owner's AI's rule for the words, or null when no AI serves it or it gave none Chausar could use. */
async function modelRule(deps: VentureDeps, ctx: Context, words: string): Promise<TriageRule | null> {
  let tier;
  try { tier = deps.models.status(ctx).tiers[PURPOSE_TIER['triage-rule']]; } catch { return null; }
  if (!tier || tier.presetId === 'built-in-templates' || tier.usable === false) return null;
  try {
    const outcome = await deps.models.generate(ctx, triageTask(words));
    return outcome.by === 'model' && orders(outcome.value) ? outcome.value : null;
  } catch (error) {
    if (error instanceof ChausarError || (error as { code?: unknown })?.code) return null;
    throw error;
  }
}

/**
 * venture.triage.preview { text } (prepare): the owner's words mapped to a rule by their own AI, or the fixed choices
 * with none, and today's rows in the rule's order as a dry run (in the order Today has now when there is no rule).
 * digest: the rule in force now, which venture.triage.set sends back.
 */
export async function triagePreviewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TriagePreview> {
  const body = exactPayload(payload, ['text'], ['text']);
  // Keys, card, Aadhaar, bank account, OTP and PAN never leave the computer in the owner's words.
  const words = screenReadback(singleLine(body.text, 'How you want Today ordered', { min: 1, max: 200 })).text;
  authorize(deps.store, ctx, 'prepare');
  const state = deps.store.read();
  const venture = currentVenture(state);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const rule = await modelRule(deps, ctx, words);
  const { queueListHandler } = await import('./queue.ts');
  const { rows } = await queueListHandler(deps, ctx, {});
  const fresh = deps.store.read();
  return {
    rule, does: rule ? ruleDoes(rule) : null, choices: TRIAGE_CHOICES.map(choice => structuredClone(choice)), rows: rule ? orderRows(fresh, venture, rows, rule) : rows,
    digest: ruleInForceDigest(fresh, venture), by: rule ? 'model' : 'choices',
  };
}

/**
 * venture.triage.set { rule, digest } (approve, app only): saves the rule and Today's order uses it. digest: the rule in
 * force when the dry run was made; another rule saved since is APPROVAL_STALE. A rule with no keys is Chausar's own order.
 */
export async function triageSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TriageRuleView> {
  requireAppChannel(ctx, 'venture.triage.set');
  const body = exactPayload(payload, ['rule', 'digest'], ['rule', 'digest']);
  const rule = validateRule(body.rule, null);
  internalCheck(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the dry run you saw.');
  return ventureAction(deps, ctx, 'approve', 'triage.set', tx => {
    check(ruleInForceDigest(tx.state, tx.venture!) === body.digest, 'APPROVAL_STALE', 'Your order changed on another screen. Look at the dry run again.');
    tx.put<TriageRuleRecord>({ ...tx.base('venture-triage-rule'), rule, digest: digest({ rule }), by: ctx.memberId });
    tx.emit('queue.changed', {});
    return { rule, line: ruleLine(rule) };
  });
}
