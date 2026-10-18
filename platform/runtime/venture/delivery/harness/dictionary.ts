// Chausar delivery harness: the business dictionary, searched through two tools instead of pasted into prompts.
// Entries come from the business's own records: its terms, offers, delivery steps, approvals and back office
// settings, the owner's published money definitions, and a short glossary for the service type. No numbers: prices
// and rates stay in receipts. Ranking is plain word overlap with a phrase bonus (the EvoOntology browse rule).
import type { Context, State } from '../../../contracts.ts';
import { listRecords } from '../../records.ts';
import type { BlueprintRecord, ServiceType, VentureDeps, VentureRecord } from '../../contracts.ts';
import { acceptedBlueprintOrNull } from '../shared.ts';

export type DictionaryKind = 'term' | 'offer' | 'step' | 'approval' | 'setting' | 'definition' | 'concept';
export type DictionaryEntry = { id: string; kind: DictionaryKind; name: string; meaning: string; aliases: string[] };
export const DICTIONARY_KINDS: readonly DictionaryKind[] = ['term', 'offer', 'step', 'approval', 'setting', 'definition', 'concept'];

/** Words a service type's work uses, so the agent can check a client's word against what the business means. */
const GLOSSARY: Readonly<Partial<Record<ServiceType, readonly Omit<DictionaryEntry, 'kind'>[]>>> = Object.freeze({
  bookkeeping: [
    { id: 'concept.reconciliation', name: 'Reconciliation', meaning: "Checking a bank statement against the business's own records: every payment matched to a bill, and the closing balance worked out from the opening balance and the movements equal to the statement's.", aliases: ['reconcile', 'recon', 'matching', 'close the month', 'month end'] },
    { id: 'concept.bank-statement', name: 'Bank statement', meaning: 'The export from the bank for one account and one period: one row per payment or receipt, usually with a running balance.', aliases: ['statement', 'bank export', 'passbook', 'account statement'] },
    { id: 'concept.bill', name: 'Bill', meaning: 'A supplier asks the business to pay: supplier name, date, number and amount. Also called a purchase invoice.', aliases: ['purchase invoice', 'vendor invoice', 'expense', 'receipt'] },
    { id: 'concept.unmatched', name: 'Unmatched payment', meaning: 'Money that left the bank with no bill to explain it. The client is asked about each one; nothing is guessed.', aliases: ['missing bill', 'unexplained', 'unknown payment'] },
    { id: 'concept.category', name: 'Category', meaning: 'A label for what a payment was for, such as rent, supplies or travel. Labels come from rules the client can check.', aliases: ['head', 'ledger', 'account head', 'expense type'] },
    { id: 'concept.closing-balance', name: 'Closing balance', meaning: 'What the account holds at the end of the period, read from the statement and worked out by the calculator.', aliases: ['ending balance', 'balance at month end'] },
  ],
});

/** Every entry for the business now. Aliases from the playbook (the improvement loop's tool-level edits) are added. */
export function dictionaryEntries(state: State, venture: VentureRecord, aliases: Readonly<Record<string, readonly string[]>> = {}, definitions: readonly { name: string; label: string; meaning: string }[] = []): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  for (const term of listRecords(state, 'venture-term', venture.id)) {
    if (term.lifecycle === 'retired') continue;
    entries.push({ id: `term.${term.key}`, kind: 'term', name: term.name, meaning: term.meaning, aliases: [] });
  }
  const blueprint: BlueprintRecord | null = acceptedBlueprintOrNull(state, venture);
  if (blueprint) {
    for (const offer of blueprint.offers) {
      const unit = offer.pricing.quantityUnit === 'month' ? 'priced per month' : offer.pricing.quantityUnit === 'hour' ? 'priced per hour' : 'priced per project';
      entries.push({ id: `offer.${offer.id}`, kind: 'offer', name: offer.name.value, meaning: `${offer.description.value} It is ${unit}; the price comes from Chausar's calculator.`, aliases: [] });
    }
    for (const step of blueprint.deliverySteps) entries.push({ id: `step.${step.id}`, kind: 'step', name: step.title.value, meaning: step.note, aliases: [] });
    blueprint.approvals.forEach((approval, index) => entries.push({ id: `approval.${String.fromCharCode(97 + index)}`, kind: 'approval', name: 'Needs the owner', meaning: approval.value, aliases: ['approval', 'sign off'] }));
    const office = blueprint.backOffice;
    entries.push({ id: 'setting.tax', kind: 'setting', name: `${office.taxLabel} on invoices`, meaning: office.taxRegistered.value ? `The business charges ${office.taxLabel}. Rates and amounts come from the calculator.` : `The business does not charge ${office.taxLabel}.`, aliases: ['tax', 'gst', 'vat'] });
    entries.push({ id: 'setting.currency', kind: 'setting', name: 'Currency', meaning: `The business works in ${office.currency}.`, aliases: ['money', 'rupees', 'dollars'] });
  }
  for (const definition of definitions) {
    entries.push({ id: `definition.${definition.name}`, kind: 'definition', name: definition.label, meaning: definition.meaning, aliases: [definition.name] });
  }
  for (const concept of GLOSSARY[blueprint?.serviceType ?? venture.serviceType ?? 'other'] ?? []) entries.push({ ...concept, kind: 'concept', aliases: [...concept.aliases] });
  return entries.map(entry => ({ ...entry, aliases: [...entry.aliases, ...(aliases[entry.id] ?? [])] }));
}

/** The owner's published money definitions, when the engine has a dictionary. Never throws. */
export function ownerDefinitions(deps: VentureDeps, ctx: Context): { name: string; label: string; meaning: string }[] {
  try {
    const current = deps.services.ontology.current(ctx);
    const list = Array.isArray(current?.definitions) ? current.definitions : [];
    return list.filter((item: any) => typeof item?.name === 'string' && typeof item?.label === 'string' && typeof item?.meaning === 'string')
      .slice(0, 40).map((item: any) => ({ name: item.name, label: item.label, meaning: item.meaning }));
  } catch { return []; }
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{Nd}]+/u).filter(word => word.length >= 2);

function score(entry: DictionaryEntry, query: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const named = new Set(words([entry.name, ...entry.aliases].join(' ')));
  const meant = new Set(words(entry.meaning));
  let total = 0;
  for (const word of q) { if (named.has(word)) total += 3; else if (meant.has(word)) total += 1; }
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 3 && [entry.name, ...entry.aliases].some(name => name.toLowerCase() === phrase)) total += 6;
  else if (phrase.length >= 3 && (entry.name.toLowerCase().includes(phrase) || entry.meaning.toLowerCase().includes(phrase))) total += 2;
  return total;
}

/** dictionary.browse: up to six entries for a query, best first; ties keep the dictionary's order. */
export function browse(entries: readonly DictionaryEntry[], query: string, kind: DictionaryKind | null, limit = 6): DictionaryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, score: kind && entry.kind !== kind ? 0 : score(entry, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.min(Math.max(limit, 1), 6))
    .map(item => item.entry);
}

/** dictionary.resolve: the best entry for each mention, or null when nothing matches well enough. */
export function resolve(entries: readonly DictionaryEntry[], mentions: readonly string[]): { mention: string; entry: DictionaryEntry | null }[] {
  return mentions.map(mention => {
    const best = browse(entries, mention, null, 1)[0] ?? null;
    return { mention, entry: best && score(best, mention) >= 3 ? best : null };
  });
}

/** The short manifest that goes into prompts instead of the dictionary itself. */
export function manifest(entries: readonly DictionaryEntry[]): string {
  const counts = DICTIONARY_KINDS.map(kind => ({ kind, count: entries.filter(entry => entry.kind === kind).length })).filter(item => item.count > 0);
  const listed = counts.map(item => `${item.kind}s`).join(', ');
  return `The business dictionary holds the business's own ${listed || 'words'}. It is not pasted here. Use dictionary.browse with a few words when the client uses a word you are not sure of, and dictionary.resolve to check names before you use them.`;
}
