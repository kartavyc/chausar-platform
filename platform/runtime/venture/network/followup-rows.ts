// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): Today's 'followup' rows, one per card and due date
// when a follow-up is due or late, with the handoff as the primary and "I sent it". The schedule is code: each card's
// next follow-up from its copied sequence, shown from the owner's send time on its day, then one ceiling a day and a
// week shared by first notes and follow-ups (each side uses whatever the other leaves), oldest due first; what does not
// fit, and anything due on a day the owner does not send, waits and says why. The handoff itself (mailto, LinkedIn,
// wa.me) is 4E2's venture.outreach.open; here "Open" is navigation and Chausar sends nothing. A row carries its parts
// (who, the due day, days late, channel, the drafted nudge) so the screen can say it in its own words and in Hindi.
// Decisions on the rows come through views/queue-w4.ts (decideSent, decideFollowup). Reads only, except the decision,
// which records the owner's own send.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type {
  IsoDate, IsoTime, OpportunityRecord, OutreachChannel, OutreachRecord, OutreachSentChannel, QueueAction, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { ventureAction } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../views/queue-w4.ts';
import { addDays, daysBetween, isoWeekday, lateWords, nextAllowedDay, shortDay, weekStart } from './followups.ts';
import { CHANNEL_WORDS, cardForWrite, cardsOf, pipelineSettings, planOf, recordCardSend, unsentDrafts, type Card, type CardDraft } from './pipeline.ts';

/** One follow-up in the schedule: its card, due day and channel, the nudge drafted for it, and the line to show. */
export type FollowupEntry = {
  card: Card; due: IsoDate; late: boolean; step: number; channel: OutreachChannel | null; draft: CardDraft | null; line: string;
};

const OPEN_LABEL: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'Open in Mail', linkedin: 'Open in LinkedIn', whatsapp: 'Open WhatsApp' });
const SENT_CHANNEL: Readonly<Record<OutreachChannel, OutreachSentChannel>> = Object.freeze({ email: 'own-mailbox', linkedin: 'linkedin', whatsapp: 'whatsapp' });
const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });

/** How a follow-up's day reads: 'Follow up today', 'Follow up 19 Oct, 2 days late'. */
export function followupWords(text: string, due: IsoDate, today: IsoDate, venture: VentureRecord): string {
  if (due === today) return `${text} today`;
  const late = lateWords(due, today);
  return `${text} ${shortDay(due, venture.country.dateOrder)}${late ? `, ${late}` : ''}`;
}

/** The id of a follow-up row: one per card (its lead's id for a card that began as a lead) and due day. */
export const followupRowId = (card: Pick<Card, 'key'>, due: IsoDate) => `followup:${card.key}:${due}`;

/**
 * The follow-up schedule at a moment: due (today from the owner's send time, or late; on a sending day; within the
 * ceiling) and later (not yet due, or waiting: before the send time, not a sending day, or the day's or the week's
 * ceiling is used). Oldest due first.
 */
export function followupSchedule(state: State, venture: VentureRecord, now: IsoTime): { due: FollowupEntry[]; later: FollowupEntry[] } {
  // Sending days and times are the owner's local ones, so a business still in its interview (no country yet) has none.
  if (!venture.country) return { due: [], later: [] };
  const today = localDayAt(now, venture.country);
  const clock = localTimeAt(now, venture.country).slice(11, 16);
  const cards = cardsOf(state, venture, today);
  const settings = pipelineSettings(state, venture.id);
  const week = weekStart(today), weekEnd = addDays(week, 6);
  const sends = cards.flatMap(card => card.touches.filter(touch => touch.what === 'sent'));
  const usedToday = sends.filter(touch => touch.on === today).length;
  const usedWeek = sends.filter(touch => touch.on >= week && touch.on <= weekEnd).length;
  let dayRoom = Math.max(0, settings.caps.newPerDay - usedToday), weekRoom = Math.max(0, settings.caps.perWeek - usedWeek);
  const entries: FollowupEntry[] = [];
  for (const card of cards) {
    const plan = planOf(card);
    if (plan?.kind !== 'nudge') continue;
    const draft = unsentDrafts(state, venture, card).find(item => item.kind === 'follow-up') ?? null;
    const text = plan.step === 0 ? 'Follow up' : 'Follow up again';
    entries.push({ card, due: plan.due, late: plan.due < today, step: plan.step, channel: draft?.channel ?? plan.channel, draft, line: followupWords(text, plan.due, today, venture) });
  }
  entries.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.card.createdAt < b.card.createdAt ? -1 : a.card.createdAt > b.card.createdAt ? 1 : 0));
  const due: FollowupEntry[] = [], later: FollowupEntry[] = [];
  const order = venture.country.dateOrder;
  for (const entry of entries) {
    const drafted = entry.draft ? ` Nudge drafted for ${CHANNEL_WORDS[entry.draft.channel]}.` : '';
    const { weekdays, sendTime } = entry.card.sequence!;
    if (entry.due > today) { later.push({ ...entry, line: `${entry.line}.${drafted}` }); continue; }
    if (entry.due === today && clock < sendTime) { later.push({ ...entry, line: `${entry.line}. It shows on Today from ${sendTime}.` }); continue; }
    if (!weekdays.includes(isoWeekday(today))) { later.push({ ...entry, line: `${entry.line}. Today is not one of your sending days.` }); continue; }
    if (dayRoom > 0 && weekRoom > 0) {
      dayRoom -= 1; weekRoom -= 1;
      due.push({ ...entry, line: `${entry.line}.${drafted}` });
      continue;
    }
    const waits = weekRoom <= 0
      ? `This week's limit of ${settings.caps.perWeek} is used, so this waits for ${shortDay(nextAllowedDay(addDays(week, 7), weekdays), order)}.`
      : `Today's limit of ${settings.caps.newPerDay} is used, so this waits for ${shortDay(nextAllowedDay(addDays(today, 1), weekdays), order)}.`;
    later.push({ ...entry, line: `${entry.line}. ${waits}` });
  }
  return { due, later };
}

/** The open business's follow-up rows: one per due follow-up, as the schedule allows now. */
export function followupRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const now = deps.clock().toISOString();
  if (!venture.country) return [];
  const today = localDayAt(now, venture.country);
  return followupSchedule(state, venture, now).due.map(entry => {
    const { card } = entry;
    const daysLate = Math.max(0, daysBetween(entry.due, today));
    const lateness = daysLate === 0 ? 'due today' : lateWords(entry.due, today)!;
    const drafted = entry.draft ? `Nudge drafted for ${CHANNEL_WORDS[entry.draft.channel]}.` : 'No nudge drafted yet.';
    return {
      kind: 'followup', subject: `followup:${card.key}`, version: entry.due, createdAt: `${entry.due}T00:00:00.000Z`,
      title: `Follow up with ${card.name}`, line: `${card.name}${card.company ? `, ${card.company}` : ''}: follow-up is ${lateness}. ${drafted}`,
      actions: [action('sent', 'I sent it', false), action('open', entry.draft ? OPEN_LABEL[entry.draft.channel] : 'Open the card', true)],
      navigate: entry.draft ? `Open the nudge from ${card.name}'s card in Clients, Pipeline.` : `Draft the nudge from ${card.name}'s card in Clients, Pipeline.`,
      followup: { cardId: card.key, name: card.name, company: card.company, due: entry.due, daysLate, channel: entry.channel, draftId: entry.draft?.id ?? null },
    };
  });
}

/** What a card says will happen next, after a send was recorded. */
function afterSend(record: OpportunityRecord, card: Card, venture: VentureRecord): string {
  const plan = planOf(card);
  const order = venture.country.dateOrder;
  if (!plan || record.stage !== 'asked') return 'Recorded.';
  if (plan.kind === 'nudge') return `Recorded. Next follow-up ${shortDay(plan.due, order)}.`;
  if (plan.kind === 'other-path') return `Recorded. If there is no reply by ${shortDay(plan.due, order)}, try another path, or Not now.`;
  return `Recorded. If there is no reply by ${shortDay(plan.on, order)}, the card parks as Not now.`;
}

/**
 * "I sent it" on a follow-up row: the owner sent the nudge themselves, today. Inside the transaction the row must still
 * be this card's follow-up for this due day, due by today, so a second tap (or a second screen) records nothing more.
 * The nudge drafted for the card (if any) is marked sent on its channel; the send is recorded on the card, which works
 * out the next follow-up. Nothing is sent.
 */
export async function decideFollowupSent(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const key = decision.subject.slice('followup:'.length);
  return ventureAction(deps, ctx, 'approve', 'pipeline.followupSent', tx => {
    const venture = tx.venture!;
    const today = localDayAt(tx.now, venture.country);
    const card = cardForWrite(tx, key);
    const plan = planOf(card);
    check(plan?.kind === 'nudge' && plan.due <= today && decision.row.id === followupRowId(card, plan.due), 'APPROVAL_STALE', 'This follow-up is no longer due.');
    const waiting = unsentDrafts(tx.state, venture, card).find(item => item.kind === 'follow-up');
    const draft = waiting ? tx.find('venture-outreach', waiting.id) : undefined;
    const channel = draft ? SENT_CHANNEL[draft.channel] : plan.channel ? SENT_CHANNEL[plan.channel] : null;
    if (draft) tx.replace<OutreachRecord>({ ...draft, sent: { at: tx.now, channel: channel!, recordedAt: tx.now, recordedBy: ctx.memberId } });
    const record = recordCardSend(tx, card.id, { on: today, channel, outreachKind: 'follow-up', ref: draft?.id ?? null, by: ctx.memberId });
    return { line: afterSend(record, cardForWrite(tx, record.id), venture) };
  });
}

/** Any other action on a follow-up row: a follow-up row offers Open (navigation) and I sent it only. */
export async function decideFollowupOther(_deps: VentureDeps, _ctx: Context, _decision: W4Decision): Promise<W4Outcome> {
  throw new ChausarError('INVALID_VENTURE_REQUEST', 'A follow-up offers Open and I sent it.');
}
