/**
 * Accounts (BK-11): the chart of accounts sorted into classes with the owner as judge.
 * Accounts come from retained Tally exports (ledger masters, voucher entries and the recipe's
 * ledger classes) and from facts that carry an account. A class is proposed only from the
 * parent group; with no group the account is 'unsure' and Chausar asks instead of guessing.
 * Customer and supplier accounts are therefore sorted by their group only, never by name.
 */
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
export type AccountRow = { name: string; group: string | null; side: 'debit' | 'credit' | null; proposed: AccountClass | null; reason: string[];
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
  let proposed: AccountClass | null = primary ? GROUPS[primary.toLowerCase()] : null; const reason: string[] = [];
  if (item.group) reason.push(primary ? `Its parent group is ${item.group}${primary !== item.group ? `, under ${primary}` : ''}.` : `Its parent group ${item.group} is not one Chausar can sort.`);
  else reason.push('No parent group was read for this account, so Chausar asks instead of guessing.');
  if (side) reason.push(`It is a ${side} account in the vouchers read.`);
  if (item.recipeClass) reason.push(`The import recipe treats it as ${item.recipeClass}.`);
  const fromLearning = learned.get(item.name);
  if (!proposed && item.group && fromLearning) { proposed = fromLearning.class; reason.push(fromLearning.reason); }
  if (decision?.decision === 'no' && decision.proposed === proposed) { reason.push('You said no to the proposed class.'); proposed = null; }
  const decided = decision && decision.class ? { class: decision.class, by: decision.by, role: decision.role, at: decision.at } : null;
  if (decided && decision!.role === 'accountant' && decision!.class !== decision!.proposed) reason.push('Corrected by an accountant.');
  return { name: item.name, group: item.group, side, proposed, reason, decided, state: decided ? 'decided' : proposed ? 'proposed' : 'unsure' };
}
async function learnedProposals(host: ModuleHost) {
  const result = await optionalCall<{ proposals?: unknown }>(host, 'learningx.accountsProposals', {}); const learned = new Map<string, { class: AccountClass; reason: string }>();
  if (result.available && Array.isArray(result.value?.proposals)) for (const p of result.value.proposals as Record<string, unknown>[])
    if (p && typeof p.name === 'string' && CLASSES.includes(p.class as AccountClass)) learned.set(p.name, { class: p.class as AccountClass, reason: 'Proposed from earlier decisions in this workspace.' });
  return { available: result.available, learned };
}
async function accountRows(ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const { available, learned } = await learnedProposals(host); const decisions = peekBooks(state).accounts;
  const found = collect(state, ctx, host);
  const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => row(item, decisions.filter(d => d.name === item.name).at(-1), learned));
  return { rows, available, found };
}

export const accountMethods: Record<string, MethodSpec> = {
  'accounts.list': { permission: 'read', async handler(ctx, payload, host) { input(payload, []); const { rows, available } = await accountRows(ctx, host); return { accounts: rows, proposals: { available } }; } },
  'accounts.classes': { permission: 'read', handler(_ctx, payload) { input(payload, []); return { classes: [...CLASSES] }; } },
  'accounts.decide': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['name', 'decision', 'class'], ['name', 'decision']);
    check(typeof request.name === 'string' && ['yes', 'no', 'change'].includes(request.decision), 'INVALID_BOOKS_REQUEST', 'Name the account and answer yes, no or change.');
    check(request.decision === 'change' ? CLASSES.includes(request.class) : request.class === undefined, 'INVALID_BOOKS_REQUEST', 'Choose one of the account classes only when changing the class.');
    const { rows, found } = await accountRows(ctx, host); const current = rows.find(r => r.name === request.name); check(current, 'ACCOUNT_NOT_FOUND', 'This account was not found in your books.');
    check(request.decision !== 'yes' || current.proposed, 'CLASS_REQUIRED', 'There is no proposed class to accept. Choose a class.');
    const who = member(host.store.read(), ctx);
    await writeBooks(host.store, ctx, 'prepare', books => {
      books.accounts.push({ name: current.name, decision: request.decision, class: request.decision === 'yes' ? current.proposed : request.decision === 'change' ? request.class : null, proposed: current.proposed,
        by: who.name, memberId: who.id, role: who.role, at: now(), sourceIds: [...found.get(current.name)!.sourceIds].sort() });
    });
    return (await accountRows(ctx, host)).rows.find(r => r.name === current.name)!;
  } },
};
