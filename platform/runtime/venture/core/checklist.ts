// Chausar venture launcher, core (P1): the twelve-item launch checklist.
// Reads, never writes, records other packages own. Onboarding connects an AI first (onboarding v2), so the AI item
// leads the list; it is done when any AI connection exists, made before the vault or after it.
// Ink v2 wave 4 (4J8): each item also has its link, the app address where it is done, so Business can list the setup
// item by item; the prices item is named as Today's setup row names it ("Set your prices").
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { ChecklistItem, ChecklistItemId, LaunchPlace, NextStep, VentureRecord } from '../contracts.ts';

const ITEMS: readonly { id: ChecklistItemId; label: string; place: LaunchPlace; link: string }[] = Object.freeze([
  { id: 'ai', label: 'Connect your AI', place: 'today', link: '#/connections/ai' },
  { id: 'idea', label: 'Say what you want to do', place: 'business', link: '#/business/plan' },
  { id: 'questions', label: 'Set your price and tax', place: 'business', link: '#/business/plan' },
  { id: 'plan', label: 'Accept your plan', place: 'business', link: '#/business/plan' },
  { id: 'prices', label: 'Set your prices', place: 'business', link: '#/business/prices' },
  { id: 'brief', label: 'Write the build brief', place: 'build', link: '#/business/build' },
  { id: 'builder', label: 'Open it in Lovable or Replit', place: 'build', link: '#/business/build' },
  { id: 'repo', label: 'Follow the build on GitHub', place: 'build', link: '#/business/build' },
  { id: 'rehearsal', label: 'Rehearse with practice clients', place: 'agents', link: '#/business/practice' },
  { id: 'first-client', label: 'Add your first client', place: 'clients', link: '#/clients' },
  { id: 'first-invoice', label: 'Send your first invoice', place: 'clients', link: '#/money/invoices' },
  { id: 'first-payment', label: 'Record your first payment', place: 'money', link: '#/money/invoices' },
] as const);

export const CHECKLIST_TOTAL = ITEMS.length;
/** The items in order, with their names and links (the UI's fake engine keeps a copy; a test pins the two equal). */
export const CHECKLIST_ITEMS = ITEMS;

function doneFlags(state: State, venture: VentureRecord): Record<ChecklistItemId, boolean> {
  const id = venture.id;
  const interviews = listRecords(state, 'venture-interview', id);
  const interview = interviews.length ? interviews[interviews.length - 1] : null;
  const questions = interview?.questions ?? [];
  const accepted = venture.acceptedBlueprintId
    ? listRecords(state, 'venture-blueprint', id).find(b => b.id === venture.acceptedBlueprintId) ?? null
    : null;
  const receipts = listRecords(state, 'venture-price-receipt', id);
  const priced = accepted ? accepted.offers.filter(o => o.pricing?.unitPriceMinor !== null && o.pricing?.unitPriceMinor !== undefined) : [];
  const prices = !!accepted && priced.length > 0 && priced.every(offer => receipts.some(r =>
    r?.subject?.type === 'offer' && r.subject.offerId === offer.id && r.inputs?.blueprintDigest === accepted.digest));
  const briefs = listRecords(state, 'venture-brief', id);
  const latestBrief = briefs.reduce<(typeof briefs)[number] | null>((latest, b) => (!latest || (b?.version ?? 0) >= (latest.version ?? 0) ? b : latest), null);
  return {
    idea: true,
    questions: questions.length > 0 && questions.every(q => q.answer !== null),
    plan: venture.acceptedBlueprintId !== null,
    prices,
    brief: latestBrief?.lint?.ok === true,
    builder: listRecords(state, 'venture-handoff', id).some(h => !!h?.openedAt),
    repo: listRecords(state, 'venture-build-follow', id).some(f => f?.lastStatus !== null && f?.lastStatus !== undefined),
    ai: listRecords(state, 'venture-model-connection', id).length > 0,
    rehearsal: listRecords(state, 'venture-simulation-run', id).some(r => r?.passed === true),
    'first-client': listRecords(state, 'venture-client', id).length > 0,
    'first-invoice': listRecords(state, 'venture-invoice', id).some(i => ['issued', 'part-paid', 'paid'].includes(i?.status)),
    'first-payment': listRecords(state, 'venture-payment', id).length > 0,
  };
}

export function checklistFor(state: State, venture: VentureRecord): { checklist: ChecklistItem[]; done: number; total: number; next: NextStep } {
  const flags = doneFlags(state, venture);
  const checklist = ITEMS.map(item => ({ id: item.id, label: item.label, done: flags[item.id], place: item.place, link: item.link }));
  const first = checklist.find(item => !item.done);
  return {
    checklist,
    done: checklist.filter(item => item.done).length,
    total: CHECKLIST_TOTAL,
    next: first ? { item: first.id, label: first.label, place: first.place } : null,
  };
}
