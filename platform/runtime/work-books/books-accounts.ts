/**
 * Accounts (BK-11): the chart of accounts sorted into classes with the owner as judge.
 * Accounts come from retained Tally exports (ledger masters, voucher entries and the recipe's
 * ledger classes) and from facts that carry an account. A class is proposed only from the
 * parent group; with no group the account is 'unsure' and Chausar asks instead of guessing.
 * Customer and supplier accounts are therefore sorted by their group only, never by name.
 */
import { createHash } from 'node:crypto';
import { check, now, type Context, type State } from '../contracts.ts';
import { canSeeFact } from '../memory.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { sourceVisible } from './books-sources.ts';
import { input, member, peekBooks, writeBooks, type AccountClass, type AccountDecision } from './books-common.ts';

export const CLASSES: AccountClass[] = ['asset', 'liability', 'equity', 'income', 'expense', 'receivable', 'payable', 'bank', 'cash', 'tax'];
const GROUPS: Record<string, AccountClass> = {
  'sundry debtors': 'receivable', 'sundry creditors': 'payable', 'bank accounts': 'bank', 'bank od a/c': 'bank', 'cash-in-hand': 'cash', 'cash in hand': 'cash',
  'duties & taxes': 'tax', 'duties and taxes': 'tax', 'sales accounts': 'income', 'direct incomes': 'income', 'indirect incomes': 'income',
  'purchase accounts': 'expense', 'direct expenses': 'expense', 'indirect expenses': 'expense', 'capital account': 'equity', 'reserves & surplus': 'equity',
  'fixed assets': 'asset', 'current assets': 'asset', 'investments': 'asset', 'loans & advances (asset)': 'asset', 'stock-in-hand': 'asset', 'deposits (asset)': 'asset',
  'loans (liability)': 'liability', 'current liabilities': 'liability', 'secured loans': 'liability', 'unsecured loans': 'liability', 'provisions': 'liability',
};
type Found = { name: string; group: string | null; chain: string[]; sides: Set<'debit' | 'credit'>; recipeClass: string | null; sourceIds: Set<string> };
/** The reason as codes with their values, so a screen says it in the person's language (`reason` keeps the English sentences). */
export type Because = { code: 'group' | 'group-unsortable' | 'no-group' | 'side' | 'recipe' | 'learned' | 'said-no' | 'accountant'; group?: string; under?: string; side?: 'debit' | 'credit'; cls?: string };
export type AccountRow = { name: string; group: string | null; side: 'debit' | 'credit' | null; proposed: AccountClass | null; reason: string[]; because: Because[];
  decided: { class: AccountClass; by: string; role: string; at: string } | null; state: 'proposed' | 'unsure' | 'decided' };

/** A numeric character reference as text; an invalid code point (too large, a surrogate or NUL) reads as U+FFFD. */
const codePoint = (n: number) => Number.isInteger(n) && n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
export const decode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d{1,7});/g, (_m, n) => codePoint(Number(n))).replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) => codePoint(parseInt(n, 16))).replace(/&amp;/g, '&').trim();
const child = (body: string, tag: string) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(body); return m ? decode(m[1]) : ''; };
const named = (attributes: string, body: string) => { const m = /\bNAME="([^"]*)"/.exec(attributes); return m ? decode(m[1]) : child(body, 'NAME'); };

/** Ledger masters, group masters and entry sides from one retained Tally XML export. */
export function readTally(content: string) {
  const ledgers = new Map<string, string>(), groups = new Map<string, string>(), sides = new Map<string, Set<'debit' | 'credit'>>();
  for (const m of content.matchAll(/<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/g)) { const name = named(m[1], m[2]); if (name) ledgers.set(name, child(m[2], 'PARENT')); }
  for (const m of content.matchAll(/<GROUP\b([^>]*)>([\s\S]*?)<\/GROUP>/g)) { const name = named(m[1], m[2]); if (name) groups.set(name, child(m[2], 'PARENT')); }
  for (const m of content.matchAll(/<((?:ALL)?LEDGERENTRIES)\.LIST>([\s\S]*?)<\/\1\.LIST>/g)) {
    const ledger = child(m[2], 'LEDGERNAME'); if (!ledger) continue;
    const deemed = child(m[2], 'ISDEEMEDPOSITIVE'); const amount = child(m[2], 'AMOUNT');
    const side = deemed === 'Yes' ? 'debit' : deemed === 'No' ? 'credit' : amount ? (amount.startsWith('-') ? 'debit' : 'credit') : null;
    if (side) sides.set(ledger, (sides.get(ledger) ?? new Set()).add(side));
  }
  return { ledgers, groups, sides };
}
function chainOf(group: string, groups: Map<string, string>): string[] {
  const chain = [group]; let current = group;
  while (!GROUPS[current.toLowerCase()] && groups.get(current) && !chain.includes(groups.get(current)!) && chain.length < 16) { current = groups.get(current)!; chain.push(current); }
  return chain;
}
function collect(state: State, ctx: Context, host: ModuleHost): Map<string, Found> {
  const found = new Map<string, Found>();
  const entry = (name: string, sourceId: string) => { const item = found.get(name) ?? { name, group: null, chain: [], sides: new Set(), recipeClass: null, sourceIds: new Set<string>() }; item.sourceIds.add(sourceId); found.set(name, item); return item; };
  const visible = new Map<string, boolean>();
  const shown = (sourceId: unknown) => { if (typeof sourceId !== 'string') return false; if (!visible.has(sourceId)) visible.set(sourceId, sourceVisible(host.store, ctx, sourceId)); return visible.get(sourceId)!; };
  for (const record of state.imports) {
    // Retained content is parsed only for a source the caller can see whole.
    if (!shown(record.sourceId)) continue;
    const retained = record.retainedInput?.input; const classes = retained?.recipe?.tallyLedgerClasses;
    if (classes && typeof classes === 'object') for (const [name, cls] of Object.entries(classes)) entry(name, record.sourceId).recipeClass = String(cls);
    if (record.format === 'tally-xml' && typeof retained?.content === 'string') {
      const tally = readTally(retained.content);
      for (const name of new Set([...tally.ledgers.keys(), ...tally.sides.keys()])) {
        const item = entry(name, record.sourceId); const parent = tally.ledgers.get(name);
        if (parent) { item.group = parent; item.chain = chainOf(parent, tally.groups); }
        for (const side of tally.sides.get(name) ?? []) item.sides.add(side);
      }
    }
  }
  for (const fact of state.facts) {
    const name = [fact.fields.account, fact.fields.ledger].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    if (!name || fact.deletedAt || !canSeeFact(host.store, ctx, fact) || !shown(fact.sourceId)) continue;
    const item = entry(name, fact.sourceId); const group = [fact.fields.accountGroup, fact.fields.group, fact.fields.parentGroup].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    if (group && !item.group) { item.group = group; item.chain = [group]; }
  }
  return found;
}
function row(item: Found, decision: AccountDecision | undefined, learned: Map<string, { class: AccountClass; reason: string }>): AccountRow {
  const side = item.sides.size === 1 ? [...item.sides][0] : null;
  const primary = item.chain.find(g => GROUPS[g.toLowerCase()]);
  let proposed: AccountClass | null = primary ? GROUPS[primary.toLowerCase()] : null; const reason: string[] = []; const because: Because[] = [];
  if (item.group) {
    reason.push(primary ? `Its parent group is ${item.group}${primary !== item.group ? `, under ${primary}` : ''}.` : `Its parent group ${item.group} is not one Chausar can sort.`);
    because.push(primary ? { code: 'group', group: item.group, ...(primary !== item.group ? { under: primary } : {}) } : { code: 'group-unsortable', group: item.group });
  } else { reason.push('No parent group was read for this account, so Chausar asks instead of guessing.'); because.push({ code: 'no-group' }); }
  if (side) { reason.push(`It is a ${side} account in the vouchers read.`); because.push({ code: 'side', side }); }
  if (item.recipeClass) { reason.push(`The import recipe treats it as ${item.recipeClass}.`); because.push({ code: 'recipe', cls: item.recipeClass }); }
  const fromLearning = learned.get(item.name);
  if (!proposed && item.group && fromLearning) { proposed = fromLearning.class; reason.push(fromLearning.reason); because.push({ code: 'learned' }); }
  if (decision?.decision === 'no' && decision.proposed === proposed) { reason.push('You said no to the proposed class.'); because.push({ code: 'said-no' }); proposed = null; }
  const decided = decision && decision.class ? { class: decision.class, by: decision.by, role: decision.role, at: decision.at } : null;
  if (decided && decision!.role === 'accountant' && decision!.class !== decision!.proposed) { reason.push('Corrected by an accountant.'); because.push({ code: 'accountant' }); }
  return { name: item.name, group: item.group, side, proposed, reason, because, decided, state: decided ? 'decided' : proposed ? 'proposed' : 'unsure' };
}
/** learning-ext sorts into Tally-style classes; each maps onto one of ours. `suspense` stays unsure. */
const FROM_LEARNING: Readonly<Record<string, AccountClass>> = {
  sales: 'income', 'indirect-income': 'income', purchases: 'expense', 'direct-expenses': 'expense', 'indirect-expenses': 'expense', bank: 'bank', cash: 'cash',
  'duties-taxes': 'tax', loans: 'liability', 'current-liabilities': 'liability', capital: 'equity', 'fixed-assets': 'asset', 'current-assets': 'asset', stock: 'asset',
  'sundry-debtors': 'receivable', 'sundry-creditors': 'payable',
};
/** A stable plain account id for learning-ext; the name itself is books data and stays on this computer. */
export const accountId = (name: string) => `acct_${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
type LearningProposal = { accountId: string; name: string; accountClass: string | null; confidence: string; needsQuestion: boolean; evidence?: { detail?: unknown }[] };
type LearningSet = { id: string; at: string; sourceIds: string[]; proposals: LearningProposal[] };
/**
 * The proposal sets learning-ext holds for the caller (`learningx.accountsList`, read only), newest first: the newest
 * set for each exact source set. `accounts.propose` sends one set per source, so this is the latest sort of each source.
 */
async function latestSets(host: ModuleHost): Promise<{ available: boolean; sets: LearningSet[] }> {
  const result = await optionalCall<{ sets?: unknown }>(host, 'learningx.accountsList', {});
  if (!result.available) return { available: false, sets: [] };
  const sets = (Array.isArray(result.value?.sets) ? result.value.sets : []).filter((s: any) => s && typeof s.id === 'string' && typeof s.at === 'string' && Array.isArray(s.proposals))
    .map((s: any) => ({ ...s, sourceIds: Array.isArray(s.sourceIds) ? (s.sourceIds as unknown[]).filter((x): x is string => typeof x === 'string').sort() : [] })) as LearningSet[];
  const newest = new Map<string, LearningSet>();
  for (const set of sets.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) { const key = JSON.stringify(set.sourceIds); if (!newest.has(key)) newest.set(key, set); }
  return { available: true, sets: [...newest.values()] };
}
/** One proposal per account name: the newest set that names it wins. Each learned name keeps every latest set holding it (for the decision mirror). */
async function learnedProposals(host: ModuleHost) {
  const { available, sets } = await latestSets(host); const learned = new Map<string, { class: AccountClass; reason: string }>();
  const holders = new Map<string, { setId: string; accountId: string }[]>(); const seen = new Set<string>();
  for (const set of sets) for (const p of set.proposals) {
    if (!p || typeof p.name !== 'string' || typeof p.accountId !== 'string') continue;
    holders.set(p.name, [...(holders.get(p.name) ?? []), { setId: set.id, accountId: p.accountId }]);
    if (seen.has(p.name)) continue; seen.add(p.name);
    const mapped = typeof p.accountClass === 'string' ? FROM_LEARNING[p.accountClass] : undefined;
    if (mapped && p.needsQuestion !== true) learned.set(p.name, { class: mapped, reason: 'Proposed from earlier decisions in this workspace.' });
  }
  return { available, learned, holders, sortedAt: sets[0]?.at ?? null };
}
async function accountRows(ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const { available, learned, holders, sortedAt } = await learnedProposals(host); const decisions = peekBooks(state).accounts;
  const found = collect(state, ctx, host);
  const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => row(item, decisions.filter(d => d.name === item.name).at(-1), learned));
  return { rows, available, found, holders, sortedAt };
}
const PLAIN_TEXT = /^[^\u0000-\u001f\u007f]{1,200}$/, PLAIN_SOURCE = /^[A-Za-z0-9_.:-]{1,200}$/;
/**
 * The accounts to sort, grouped by source: one group per source, each account in it carrying that sourceId. An account
 * read from several sources is in each of their groups, so every name learning-ext keeps is bound to the sources it
 * came from. An account is never sent without its sources: a source whose id learning-ext cannot take is left out.
 */
export function accountsBySource(found: Map<string, { name: string; group: string | null; sourceIds: Set<string> }>) {
  const groups = new Map<string, { id: string; name: string; parentGroup?: string; sourceId: string }[]>();
  for (const a of [...found.values()].sort((x, y) => x.name.localeCompare(y.name))) {
    if (!PLAIN_TEXT.test(a.name) || !a.name.trim()) continue;
    for (const sourceId of [...a.sourceIds].sort()) {
      if (!PLAIN_SOURCE.test(sourceId)) continue;
      const list = groups.get(sourceId) ?? []; if (list.length >= 5000) continue;
      list.push({ id: accountId(a.name), name: a.name, ...(a.group && PLAIN_TEXT.test(a.group) && a.group.trim() ? { parentGroup: a.group } : {}), sourceId }); groups.set(sourceId, list);
    }
  }
  return groups;
}
type LearningMirror = { recorded: boolean; code?: string };
const codeOf = (error: unknown) => { const code = (error as { code?: unknown })?.code; return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'LEARNING_DECIDE_FAILED'; };

export const accountMethods: Record<string, MethodSpec> = {
  'accounts.list': { permission: 'read', async handler(ctx, payload, host) {
    input(payload, []); const { rows, available, sortedAt } = await accountRows(ctx, host);
    return { accounts: rows, proposals: { available, ...(sortedAt ? { sortedAt } : {}) } };
  } },
  /**
   * Ask learning-ext to sort the visible chart (`learningx.accountsPropose`), once per source: each call holds the
   * accounts read from that one source with its sourceId, so learning-ext shows a name only to members who may read
   * that source. Its proposals show on the next list. `setId` is the last set made; `setIds` lists them all.
   */
  'accounts.propose': { permission: 'prepare', async handler(ctx, payload, host) {
    input(payload, []); const { found } = await accountRows(ctx, host);
    const groups = accountsBySource(found);
    check(groups.size > 0, 'ACCOUNT_NOT_FOUND', 'No accounts were read from your books yet.');
    const setIds: string[] = []; const names = new Set<string>();
    for (const [, accounts] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const result = await optionalCall<{ id?: unknown; counts?: unknown }>(host, 'learningx.accountsPropose', { accounts });
      check(result.available, 'ACCOUNT_PROPOSALS_NOT_BUILT', 'Sorting by the learning lane is not installed here.');
      check(typeof result.value?.id === 'string', 'INVALID_LEARNING_REPLY', 'The learning lane gave an unreadable answer.');
      setIds.push(result.value.id); for (const a of accounts) names.add(a.name);
    }
    return { setId: setIds.at(-1)!, setIds, accounts: names.size };
  } },
  'accounts.classes': { permission: 'read', handler(_ctx, payload) { input(payload, []); return { classes: [...CLASSES] }; } },
  'accounts.decide': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['name', 'decision', 'class'], ['name', 'decision']);
    check(typeof request.name === 'string' && ['yes', 'no', 'change'].includes(request.decision), 'INVALID_BOOKS_REQUEST', 'Name the account and answer yes, no or change.');
    check(request.decision === 'change' ? CLASSES.includes(request.class) : request.class === undefined, 'INVALID_BOOKS_REQUEST', 'Choose one of the account classes only when changing the class.');
    const { rows, found, holders } = await accountRows(ctx, host); const current = rows.find(r => r.name === request.name); check(current, 'ACCOUNT_NOT_FOUND', 'This account was not found in your books.');
    check(request.decision !== 'yes' || current.proposed, 'CLASS_REQUIRED', 'There is no proposed class to accept. Choose a class.');
    const who = member(host.store.read(), ctx);
    const cls = request.decision === 'yes' ? current.proposed : request.decision === 'change' ? request.class : null;
    // The same decision sent again by the same person (a retry, a double tap) is kept once.
    const last = peekBooks(host.store.read()).accounts.filter(d => d.name === current.name).at(-1);
    const repeat = !!last && last.memberId === who.id && last.decision === request.decision && last.class === cls;
    if (!repeat) await writeBooks(host.store, ctx, 'prepare', books => {
      books.accounts.push({ name: current.name, decision: request.decision, class: cls, proposed: current.proposed,
        by: who.name, memberId: who.id, role: who.role, at: now(), sourceIds: [...found.get(current.name)!.sourceIds].sort() });
    });
    // Yes or No on a class learning-ext proposed goes back to its decision log (structure only), in every latest set that
    // holds the account. A change of class has no one-to-one class there, so it stays in this lane's record. The mirror is
    // best effort: the person's decision above is already kept, and a refusal there (ALREADY_DECIDED, say) is reported, never thrown.
    let learning: LearningMirror = { recorded: false };
    const held = holders.get(current.name) ?? [];
    if (!repeat && held.length > 0 && current.because.some(b => b.code === 'learned') && request.decision !== 'change') {
      learning = { recorded: true };
      for (const { setId, accountId: id } of held) {
        try {
          const result = await optionalCall(host, 'learningx.accountsDecide', { setId, decisions: [{ accountId: id, choice: request.decision === 'yes' ? 'accepted' : 'rejected' }] });
          if (!result.available) { learning = { recorded: false }; break; }
        } catch (error) { learning = { recorded: false, code: codeOf(error) }; break; }
      }
    }
    const after = (await accountRows(ctx, host)).rows.find(r => r.name === current.name)!;
    return { ...after, learning, repeated: repeat };
  } },
};
