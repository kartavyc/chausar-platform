// Chausar venture launcher, core (P1): the twelve-item launch checklist.
// Reads, never writes, records other packages own. The AI item sits after the build steps on purpose:
// planning, briefs and the back office work with templates, so a new owner is never pushed to find a key first.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { ChecklistItem, ChecklistItemId, LaunchPlace, NextStep, VentureRecord } from '../contracts.ts';

const ITEMS: readonly { id: ChecklistItemId; label: string; place: LaunchPlace }[] = Object.freeze([
  { id: 'idea', label: 'Describe your idea', place: 'business' },
  { id: 'questions', label: 'Set your price and tax', place: 'business' },
  { id: 'plan', label: 'Accept your plan', place: 'business' },
  { id: 'prices', label: 'Price your offers', place: 'business' },
  { id: 'brief', label: 'Write the build brief', place: 'build' },
  { id: 'builder', label: 'Open it in Lovable or Replit', place: 'build' },
  { id: 'repo', label: 'Follow the build on GitHub', place: 'build' },
  { id: 'ai', label: 'Add your AI (optional)', place: 'today' },
  { id: 'rehearsal', label: 'Rehearse with practice clients', place: 'agents' },
  { id: 'first-client', label: 'Add your first client', place: 'clients' },
  { id: 'first-invoice', label: 'Send your first invoice', place: 'clients' },
  { id: 'first-payment', label: 'Record your first payment', place: 'money' },
] as const);

export const CHECKLIST_TOTAL = ITEMS.length;

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
  const checklist = ITEMS.map(item => ({ id: item.id, label: item.label, done: flags[item.id], place: item.place }));
  const first = checklist.find(item => !item.done);
  return {
    checklist,
    done: checklist.filter(item => item.done).length,
    total: CHECKLIST_TOTAL,
    next: first ? { item: first.id, label: first.label, place: first.place } : null,
  };
}
