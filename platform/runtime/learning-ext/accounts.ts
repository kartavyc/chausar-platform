/**
 * Sorting the chart of accounts (plan day 2, block 4) and the ladder step 3 dataset export.
 * Rules and an optional model propose a class with evidence; a person accepts, corrects or
 * rejects each one, and every decision is a structure-only line in the decision log.
 */
import { check, newId, now, type Context, type State } from '../contracts.ts';
import { current } from '../actions.ts';
import { assertSourceAccess } from '../trust.ts';
import type { MethodSpec } from '../modules/types.ts';
import { recordDecision } from './log.ts';
import { area, canSee, ids, oneOf, peekArea } from './state.ts';
import { VALUE_PATTERNS } from './structure.ts';
import { ACCOUNT_CLASSES, CONFIDENCE, type AccountClass, type Reason, type StructuralEvent } from './vocabulary.ts';
import { datasetWords, propose, type ModelProposal, type Proposed } from './accounts-rules.ts';

type Decision = { choice: 'accepted' | 'corrected' | 'rejected'; accountClass: AccountClass | null; at: string; memberId: string; decisionId: string };
type Proposal = Proposed & { accountId: string; name: string; parentGroup?: string; sourceId?: string };
type ProposalSet = { id: string; at: string; memberId: string; sourceIds: string[]; proposals: Proposal[]; decisions: Record<string, Decision>;
  /** Set by a model run: the set it re-sorted and the gateway's model receipt. */
  basedOn?: string; modelReceiptId?: string };
type AccountsArea = { sets: ProposalSet[] };

const SET_LIMIT = 200, ACCOUNT_LIMIT = 5000, DATASET_THRESHOLD = 20_000;
const accountsOf = (state: State) => area<AccountsArea>(state, 'accounts', () => ({ sets: [] }));
const PLAIN_ID = /^[A-Za-z0-9_.:-]{1,200}$/, TEXT = /^[^\u0000-\u001f\u007f]{1,200}$/;
const IDENTIFIERS = VALUE_PATTERNS.filter(item => item.code !== 'DIGITS').map(item => item.pattern);

function record(value: unknown, required: string[], optional: string[] = [], message = 'Send the documented fields only.'): Record<string, any> {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_REQUEST', message);
  const keys = Object.keys(value);
  check(required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key)), 'INVALID_REQUEST', message);
  return value as Record<string, any>;
}
const list = (value: unknown, min: number, max: number, message: string) => { check(Array.isArray(value) && value.length >= min && value.length <= max, 'INVALID_REQUEST', message); return value as unknown[]; };
const plainId = (value: unknown, message = 'Use a plain identifier of at most 200 characters.') => { check(typeof value === 'string' && PLAIN_ID.test(value), 'INVALID_REQUEST', message); return value; };
const text = (value: unknown, message: string) => { check(typeof value === 'string' && TEXT.test(value) && value.trim().length > 0, 'INVALID_REQUEST', message); return value; };
const accountClass = (value: unknown) => oneOf(value, ACCOUNT_CLASSES, 'INVALID_CLASS', 'Choose a class from the chart-of-accounts list.');
const unique = (values: string[], message: string) => check(new Set(values).size === values.length, 'INVALID_REQUEST', message);

/** Account names are books data: the author, and members who prepare or decide (owner, co-founder, accountant), within source access. */
const setVisible = (state: State, ctx: Context, set: ProposalSet) => (set.memberId === ctx.memberId || ctx.role !== 'viewer') && canSee(state, ctx, set.sourceIds);
function visibleSet(state: State, ctx: Context, setId: unknown): ProposalSet {
  const id = plainId(setId, 'Name the proposal set.');
  const set = peekArea<AccountsArea>(state, 'accounts')?.sets.find(item => item.id === id);
  check(set && setVisible(state, ctx, set), 'NOT_FOUND', 'That proposal set is not available.');
  return set;
}
function view(set: ProposalSet) {
  const proposals = set.proposals.map(p => ({ ...structuredClone(p), decision: set.decisions[p.accountId] ? structuredClone(set.decisions[p.accountId]) : null }));
  return {
    id: set.id, at: set.at, sourceIds: [...set.sourceIds], proposals, ...(set.modelReceiptId ? { basedOn: set.basedOn, modelReceiptId: set.modelReceiptId } : {}),
    counts: { total: proposals.length, decided: proposals.filter(p => p.decision).length, needsQuestion: proposals.filter(p => p.needsQuestion).length },
  };
}

function proposeSet(state: State, ctx: Context, payload: Record<string, unknown>) {
  current(state, ctx, 'prepare');
  record(payload, ['accounts'], ['modelProposals']);
  const accounts = list(payload.accounts, 1, ACCOUNT_LIMIT, 'Send 1 to 5,000 accounts.').map(item => {
    const account = record(item, ['id', 'name'], ['parentGroup', 'sourceId'], 'Each account has an identifier, a name and optionally a parent group and source.');
    return {
      id: plainId(account.id), name: text(account.name, 'Each account name is plain text of at most 200 characters.'),
      parentGroup: account.parentGroup === undefined ? undefined : text(account.parentGroup, 'A parent group is plain text of at most 200 characters.'),
      sourceId: account.sourceId === undefined ? undefined : plainId(account.sourceId),
    };
  });
  unique(accounts.map(a => a.id), 'Each account identifier appears once.');
  unique(accounts.map(a => a.name), 'Each account name appears once in a chart of accounts.');
  const known = new Set(accounts.map(a => a.id)), models = new Map<string, ModelProposal>();
  for (const item of payload.modelProposals === undefined ? [] : list(payload.modelProposals, 0, ACCOUNT_LIMIT, 'Send at most 5,000 model proposals.')) {
    const model = record(item, ['id', 'accountClass', 'confidence', 'evidence'], [], 'Each model proposal has an account, a class, a confidence and evidence.');
    const id = plainId(model.id);
    check(known.has(id), 'NOT_FOUND', 'A model proposal names an account that is not in the list.');
    check(!models.has(id), 'INVALID_REQUEST', 'Each account has at most one model proposal.');
    models.set(id, { id, accountClass: accountClass(model.accountClass), confidence: oneOf(model.confidence, CONFIDENCE), evidence: text(model.evidence, 'Model evidence is plain text of at most 200 characters.') });
  }
  const sourceIds = ids(accounts.flatMap(a => a.sourceId ? [a.sourceId] : []), 'source identifiers', ACCOUNT_LIMIT);
  assertSourceAccess(state, ctx, sourceIds);
  const chart = accountsOf(state);
  check(chart.sets.length < SET_LIMIT, 'ACCOUNTS_FULL', 'Too many proposal sets are kept. Purge an older chart first.');
  const set: ProposalSet = {
    id: newId('accounts'), at: now(), memberId: ctx.memberId, sourceIds, decisions: {},
    proposals: accounts.map(a => ({
      accountId: a.id, name: a.name, ...(a.parentGroup !== undefined ? { parentGroup: a.parentGroup } : {}), ...(a.sourceId ? { sourceId: a.sourceId } : {}),
      ...propose(a.name, a.parentGroup, models.get(a.id)),
    })),
  };
  chart.sets.push(set);
  return view(set);
}

/** The accounts of a visible set, for a model request built elsewhere (`models.ts`). */
export function askableSet(state: State, ctx: Context, setId: unknown) {
  const set = visibleSet(state, ctx, setId);
  return { id: set.id, sourceIds: [...set.sourceIds], accounts: set.proposals.map(p => ({ id: p.accountId, name: p.name, parentGroup: p.parentGroup, sourceId: p.sourceId })) };
}
/** A new proposal set from the same accounts with validated model proposals merged through the rule proposer. */
export function proposeWithModel(state: State, ctx: Context, setId: string, modelProposals: ModelProposal[], modelReceiptId: string) {
  const base = askableSet(state, ctx, setId);
  const accounts = base.accounts.map(a => ({ id: a.id, name: a.name, ...(a.parentGroup !== undefined ? { parentGroup: a.parentGroup } : {}), ...(a.sourceId ? { sourceId: a.sourceId } : {}) }));
  const created = proposeSet(state, ctx, { accounts, modelProposals: structuredClone(modelProposals) });
  const set = accountsOf(state).sets.find(item => item.id === created.id)!;
  set.basedOn = base.id; set.modelReceiptId = modelReceiptId;
  return view(set);
}

function reasonOf(choice: Decision['choice'], proposal: Proposal): Reason {
  if (choice === 'corrected') return 'owner-override';
  if (proposal.needsQuestion) return 'low-confidence';
  return proposal.evidence.some(e => e.kind === 'parent-group') ? 'evidence-group' : 'evidence-keyword';
}

function decide(state: State, ctx: Context, payload: Record<string, unknown>) {
  current(state, ctx, 'prepare');
  record(payload, ['setId', 'decisions']);
  const set = visibleSet(state, ctx, payload.setId);
  const decisions = list(payload.decisions, 1, ACCOUNT_LIMIT, 'Send 1 to 5,000 decisions.').map(item => {
    const decision = record(item, ['accountId', 'choice'], ['accountClass'], 'Each decision names an account, a choice and, for a correction, a class.');
    const proposal = set.proposals.find(p => p.accountId === plainId(decision.accountId));
    check(proposal, 'NOT_FOUND', 'A decision names an account that is not in this proposal set.');
    const earlier = set.decisions[proposal.accountId];
    check(!earlier || earlier.memberId === ctx.memberId || ctx.role === 'owner', 'ALREADY_DECIDED', 'Another person decided this account. Only they or the owner can change it.');
    const choice = oneOf(decision.choice, ['accepted', 'corrected', 'rejected'] as const);
    let chosen: AccountClass | null = null;
    if (choice === 'accepted') {
      check(proposal.accountClass, 'INVALID_REQUEST', 'There is no proposed class to accept. Correct it instead.');
      check(decision.accountClass === undefined || decision.accountClass === proposal.accountClass, 'INVALID_REQUEST', 'Accepting takes the proposed class. Use a correction to choose another.');
      chosen = proposal.accountClass;
    } else if (choice === 'corrected') {
      chosen = accountClass(decision.accountClass);
      check(chosen !== proposal.accountClass, 'INVALID_CLASS', 'A correction chooses a different class from the proposal.');
    } else check(decision.accountClass === undefined, 'INVALID_REQUEST', 'A rejection does not choose a class.');
    return { proposal, choice, chosen };
  });
  unique(decisions.map(d => d.proposal.accountId), 'Decide each account once per request.');
  return {
    setId: set.id,
    decisions: decisions.map(({ proposal, choice, chosen }) => {
      // Structure only: the account name, group and identifier never enter the event.
      const event: StructuralEvent = {
        kind: 'accounts-label', choice, ...(chosen ? { accountClass: chosen } : {}), ...(proposal.accountClass ? { proposedClass: proposal.accountClass } : {}),
        confidence: proposal.confidence, evidence: [...proposal.evidence.map(e => e.kind), ...(choice === 'corrected' ? ['owner' as const] : [])], reason: reasonOf(choice, proposal),
      };
      const entry = recordDecision(state, ctx, { event, sourceIds: proposal.sourceId ? [proposal.sourceId] : [], refs: [set.id] });
      set.decisions[proposal.accountId] = { choice, accountClass: chosen, at: entry.at, memberId: ctx.memberId, decisionId: entry.id };
      return { accountId: proposal.accountId, choice, accountClass: chosen, decisionId: entry.id };
    }),
  };
}

function score(state: State, ctx: Context, payload: Record<string, unknown>) {
  current(state, ctx);
  record(payload, ['setId', 'key']);
  const set = visibleSet(state, ctx, payload.setId);
  const key = list(payload.key, 1, ACCOUNT_LIMIT, 'Send an answer key of 1 to 5,000 accounts.').map(item => {
    const row = record(item, ['accountId', 'accountClass'], [], 'Each answer key row names an account and its class.');
    return { accountId: plainId(row.accountId), accountClass: accountClass(row.accountClass) };
  });
  unique(key.map(k => k.accountId), 'Each account appears once in the answer key.');
  let right = 0, wrong = 0, notSure = 0, wrongAcceptedWithoutQuestion = 0;
  const rows = key.map(({ accountId, accountClass: expected }) => {
    const proposal = set.proposals.find(p => p.accountId === accountId);
    check(proposal, 'NOT_FOUND', 'The answer key names an account that is not in this proposal set.');
    const outcome = proposal.needsQuestion ? 'not-sure' : proposal.accountClass === expected ? 'right' : 'wrong';
    if (outcome === 'not-sure') notSure++; else if (outcome === 'right') right++; else wrong++;
    if (outcome === 'wrong' && proposal.confidence !== 'low') wrongAcceptedWithoutQuestion++;
    return { accountId, expected, proposed: proposal.accountClass, confidence: proposal.confidence, outcome };
  });
  return { setId: set.id, scored: rows.length, unscored: set.proposals.length - rows.length, right, wrong, notSure, wrongAcceptedWithoutQuestion, pass: wrongAcceptedWithoutQuestion === 0, rows };
}

/** Tally recipe classes: the four classes the importer totals, everything else as `other`. */
const RECIPE_CLASS: Partial<Record<AccountClass, 'sales' | 'purchase' | 'bank' | 'tax'>> = { sales: 'sales', purchases: 'purchase', bank: 'bank', cash: 'bank', 'duties-taxes': 'tax' };
function classes(state: State, ctx: Context, payload: Record<string, unknown>) {
  current(state, ctx);
  record(payload, ['setId']);
  const set = visibleSet(state, ctx, payload.setId);
  const decided: [string, 'sales' | 'purchase' | 'bank' | 'tax' | 'other'][] = [], undecided: { accountId: string; name: string; state: 'not decided' | 'rejected' }[] = [];
  for (const p of set.proposals) {
    const decision = set.decisions[p.accountId];
    if (decision?.accountClass) decided.push([p.name, RECIPE_CLASS[decision.accountClass] ?? 'other']);
    else undecided.push({ accountId: p.accountId, name: p.name, state: decision ? 'rejected' : 'not decided' });
  }
  return { setId: set.id, tallyLedgerClasses: Object.fromEntries(decided), undecided };
}

function labelDataset(state: State, ctx: Context, payload: Record<string, unknown>) {
  current(state, ctx, 'admin');
  record(payload, [], ['setId']);
  const sets = payload.setId === undefined ? (peekArea<AccountsArea>(state, 'accounts')?.sets ?? []).filter(set => setVisible(state, ctx, set)) : [visibleSet(state, ctx, payload.setId)];
  const lines: string[] = [];
  for (const set of sets) for (const p of set.proposals) {
    const decision = set.decisions[p.accountId];
    if (!decision?.accountClass || decision.choice === 'rejected') continue;
    lines.push(JSON.stringify({ words: datasetWords(p.name, IDENTIFIERS), group: p.parentGroup ? datasetWords(p.parentGroup, IDENTIFIERS) : [], label: decision.accountClass, grade: decision.choice }));
  }
  return {
    manifest: {
      schema: 'chausar.accounts-label-dataset.v1', rows: lines.length, threshold: DATASET_THRESHOLD, ready: lines.length >= DATASET_THRESHOLD, leavesMachine: false,
      note: 'Prepared on this computer for a future accounts-label classifier. Nothing is trained and nothing is sent.',
    },
    jsonl: lines.length ? `${lines.join('\n')}\n` : '',
  };
}

export const accountsMethods: Record<string, MethodSpec> = {
  'learningx.accountsPropose': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => proposeSet(state, ctx, payload)) },
  'learningx.accountsList': {
    permission: 'read', handler: (ctx, payload, host) => {
      const state = host.store.read(); current(state, ctx); record(payload, []);
      return { sets: (peekArea<AccountsArea>(state, 'accounts')?.sets ?? []).filter(set => setVisible(state, ctx, set)).map(view) };
    },
  },
  'learningx.accountsDecide': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => decide(state, ctx, payload)) },
  'learningx.accountsScore': { permission: 'read', handler: (ctx, payload, host) => score(host.store.read(), ctx, payload) },
  'learningx.accountsClasses': { permission: 'read', handler: (ctx, payload, host) => classes(host.store.read(), ctx, payload) },
  'learningx.labelDataset': { permission: 'admin', handler: (ctx, payload, host) => labelDataset(host.store.read(), ctx, payload) },
};

/** Remove proposal sets holding an account from a removed source, or removed by identifier. */
export function purgeAccounts(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; collect?: Set<string> }): number {
  const chart = peekArea<AccountsArea>(state, 'accounts');
  if (!chart) return 0;
  const before = chart.sets.length;
  const kept = chart.sets.filter(set => !reason.removedIds.has(set.id) && !set.sourceIds.some(id => reason.sourceIds.includes(id) || reason.removedIds.has(id)));
  for (const set of chart.sets) if (!kept.includes(set)) reason.collect?.add(set.id);
  chart.sets.splice(0, chart.sets.length, ...kept);
  return before - kept.length;
}

