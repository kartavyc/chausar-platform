// Chausar venture launcher, network (Ink v2 wave 4, package 4D2): how many people sit in each relationship band, as a
// count receipt (money/sums.ts serves it; package 4-0 named the plan here). Each addend is one tie of a person the
// owner has not hidden, labelled with the tie's id and its band and never with a name, so the receipt lists every tie it
// counted and holds nothing about anyone Forget could leave behind. A tie gets a new id when its band changes, so a
// count made before reads stale; venture.network.sources keeps only the newest count. The from and to days name the
// day the newest tie was worked out.
import type { State } from '../../contracts.ts';
import type { NetworkBands, SumReceiptSubject, TieBand, TieRecord, VentureRecord } from '../contracts.ts';
import { TIE_BANDS } from '../contracts.ts';
import { listRecords, type VentureTx } from '../records.ts';
import type { Addend, SumPlan } from '../money/sums.ts';
import { localDayAt } from '../local-day.ts';
import { listPeople } from './store.ts';
import { BAND_WORDS } from './strength.ts';

type CountSubject = Extract<SumReceiptSubject, { type: 'count' }>;

/** The ties counted: of people the owner has not hidden, in one band or all, closest first, then by tie id. */
function counted(state: State, venture: VentureRecord, scope: string): TieRecord[] {
  const visible = new Set(listPeople(state, venture.id).filter(person => !person.hidden).map(person => person.id));
  return listRecords(state, 'venture-tie', venture.id)
    .filter(tie => visible.has(tie.personId) && (scope === 'all' || tie.band === scope))
    .sort((a, b) => TIE_BANDS.indexOf(a.band) - TIE_BANDS.indexOf(b.band) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The `count` receipt with what 'bands': each tie counted by its id, in its band; scope 'all' or one band. */
export function bandsCountPlan(state: State, venture: VentureRecord, subject: CountSubject): SumPlan {
  const addends: Addend[] = counted(state, venture, subject.scope).map(tie => ({
    recordId: tie.id, label: `${tie.id}: ${BAND_WORDS[tie.band]}`, amount: '1', display: '1', estimate: false,
  }));
  return {
    subject, currency: 'count', unit: 'count', addends,
    words: { label: 'People by how well you know them', one: 'person', many: 'people', none: 'No one in your network has a worked-out tie yet.' },
  };
}

/** The bands summary's plan as of now (null when no tie has been worked out), and its counts per band. */
export function bandsNow(state: State, venture: VentureRecord): { plan: SumPlan; counts: Omit<NetworkBands, 'receiptId'> } | null {
  const ties = counted(state, venture, 'all');
  if (!ties.length) return null;
  const newest = ties.reduce((latest, tie) => (tie.computedAt > latest ? tie.computedAt : latest), ties[0].computedAt);
  const day = localDayAt(newest, venture.country);
  const plan = bandsCountPlan(state, venture, { type: 'count', what: 'bands', scope: 'all', from: day, to: day });
  const of = (band: TieBand) => ties.filter(tie => tie.band === band).length;
  const counts = { close: of('close'), knowWell: of('know-well'), know: of('know'), metOnce: of('met-once'), cold: of('cold') };
  // 4D4: each band's share per mille, floored, in integers (the total is a count, never more than the people here).
  const share = (n: number) => (ties.length ? Math.floor((n * 1000) / ties.length) : 0);
  const permille = { close: share(counts.close), knowWell: share(counts.knowWell), know: share(counts.know), metOnce: share(counts.metOnce), cold: share(counts.cold) };
  return { plan, counts: { ...counts, permille } };
}

/** The bands counts of the open business other than keep, removed: only the newest count is kept. Answers how many went. */
export function dropOlderBandCounts(tx: VentureTx, keep: string): number {
  const ventureId = tx.venture!.id;
  const before = tx.state.conversations.length;
  tx.state.conversations = tx.state.conversations.filter(record => !(record?.kind === 'venture-sum-receipt' && record.ventureId === ventureId && record.id !== keep
    && record.subject?.type === 'count' && record.subject?.what === 'bands'));
  return before - tx.state.conversations.length;
}
