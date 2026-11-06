// Chausar venture launcher, views (Ink v2 wave 4, package 4G2; catalogue O10): needs-you probes, each a Today 'notice'
// row with Open and Later. Package 4-0 put the row source here; other packages' notice rows ride along in noticeRows.
//
// A probe is code: it reads records only, never calls a model and never writes. Each has a severity and a deep link
// (an app address the notice opens), and runs inside its own try and catch, so one that throws is skipped and the
// rest still answer. The journal sweep's tick (build/journal-sweep.ts) runs them again: the first time one throws it
// writes Keeper's 'probes' run naming it, and from then on keeps that one record current (replaced only when its
// outcome or line changed or it is a day old).
// The probes:
// - posts that did not go out, or whose outcome is unknown, in the last 7 days (not one the owner turned down or
//   already checked and recorded);
// - a broken connection: a failed row in the latest connection check (4J7), with its fix;
// - drafted messages the owner has not sent after more than 3 days (4E2's drafts; reminders and timed follow-ups have
//   their own rows);
// - a gap in next week's social calendar: slots code planned that no draft of the order fills;
// - a figure that moved sharply: money received or billed in a week, by a z-score over 3 on at least 7 weeks, with
//   both figures receipted (probe-figures.ts);
// - a stalled client: a Talking card, or an open quote (a Proposal card), with no reply in 14 days.
// What another source already says is not said twice. Unread client replies are 4E3's reply rows (one per unread
// message, processed false), spend at the alert share is 4F2's notice (money/spend.ts spendRows), an unusable AI is
// the setup row ("Your AI needs attention"), an unreadable GitHub repo is the connector row, and a card with a
// follow-up row due is that row; so none of them is a probe row here. Every probe row's subject starts 'probe:', so no
// other source's row has its subject, and its version changes only when its facts do: Later (and any other decision
// on the row) is remembered by queue.ts until then, and 4G1 notifies about the subject once.
import { ChausarError, type Context, type State } from '../../contracts.ts';
import type {
  IsoDate, KeeperRunRecord, NoticeProbe, OutreachKind, QueueDecisionRecord, QueueNotice, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { currentVenture, digest, listRecords, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import type { W4Decision, W4Outcome, W4RowItem } from './queue-w4.ts';
import { sharpMove, WEEKLY_WHATS } from './probe-figures.ts';
import { aiState, rowId } from './queue.ts';
import { CHANNEL_CONNECTOR } from '../network/governor.ts';
import { cardsOf, CLOSED_STAGES, STAGE_LABEL, type Card } from '../network/pipeline.ts';
import { personById } from '../network/store.ts';
import { firstOf } from '../network/inbound.ts';
import { addDays, daysBetween, shortDay, weekStart } from '../network/followups.ts';
import { postingName } from '../build/posting.ts';
import { latestCheck } from '../build/connector-truth.ts';
import { assignSlots, calendarPosts, calendarSlotsOrNone } from '../playbooks/social/draft-posts.ts';
import { channelCapability } from '../playbooks/social/channels.ts';
import { taxRegistered } from '../money/goal-plans.ts';
import { savedSearchRows } from '../network/saved-searches.ts';
import { pauseNotices } from '../network/governor.ts';
import { reminderRows } from '../network/reminder-rows.ts';
import { contractNoticeRows } from '../money/order-contracts.ts';
import { relayNoticeRows } from '../agents/relay.ts';
import { mediaNoticeRows } from '../playbooks/kit/media-intake.ts';
import { monitorRows } from '../build/monitors.ts';
import { localAppRows } from '../build/local-apps.ts';
import { supportRows } from '../playbooks/support-desk/rows.ts';

/**
 * The open business's notice rows. 4D3's saved searches with new matches and 4E2's paused outreach channels ("Don't
 * reconnect for 3 days.") are here. 4E2's payment reminders ride along: their rows are follow-up rows (Open and I sent
 * it), and "I sent it" goes by its action to views/queue-w4.ts decideSent. Then 4G2's needs-you probes (probeRows),
 * which never take a subject another of these, or any row Today built before them (shown, from views/queue.ts),
 * already shows.
 */
export function noticeRows(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, shown?: ReadonlySet<string>): W4RowItem[] {
  const others = [...savedSearchRows(deps, ctx, state, venture), ...pauseNotices(deps, ctx, state, venture), ...reminderRows(deps, ctx, state, venture),
    // 4J12: order contracts waiting for the owner's signature, and agents' failed or needs_decision reports to the owner.
    ...contractNoticeRows(deps, ctx, state, venture), ...relayNoticeRows(deps, ctx, state, venture),
    // 5A4 (P9): clips still holding their location data because no ffmpeg was here to clean them.
    ...mediaNoticeRows(deps, ctx, state, venture),
    // 5A6 (K16, K13): a page the owner watches that changed, and an app of theirs that asked them to do something first.
    ...monitorRows(state, venture), ...localAppRows(state, venture), ...supportRows(state, venture)];
  return [...others, ...probeRows(deps, ctx, state, venture, new Set([...shown ?? [], ...others.map(row => row.subject)]))];
}

const DAY_MS = 86_400_000;
/** The probes' numbers: how far back a failed post counts, how long a draft or a client may wait. */
export const PROBE_LIMITS = Object.freeze({ postDays: 7, draftDays: 3, stalledDays: 14 });

/**
 * What a probe reads: the business as of one read, with its owner's day. cards: the pipeline, worked out once, and
 * card: one of them by its id or its lead's id (a Map built once). shown: the subjects Today already shows.
 */
export type ProbeInput = {
  deps: VentureDeps; ctx: Context; state: State; venture: VentureRecord; today: IsoDate; nowMs: number;
  cards: () => Card[]; card: (id: string) => Card | undefined; shown: ReadonlySet<string>;
};
/** One thing a probe found, before runProbes makes it a notice row. figures: each amount its line states, exactly as written, with its receipt, in order. */
export type ProbeItem = { subject: string; version: string; createdAt: string; title: string; line: string; navigate: string; figures?: QueueNotice['figures'] };
/** One needs-you probe: code, with its severity and the screen its notice opens. label: what it checks, in Keeper's words. */
export type Probe = { id: NoticeProbe; label: string; severity: QueueNotice['severity']; link: string; rows: (input: ProbeInput) => ProbeItem[] };

/** A subject part in the identifier alphabet. */
const idPart = (value: string) => value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const startOf = (day: IsoDate) => `${day}T00:00:00.000Z`;
const daysWords = (days: number) => (days === 1 ? '1 day' : `${days} days`);

/** "19 Oct, 21 Oct and 23 Oct": at most four, then how many more. */
function listWords(items: string[]): string {
  const shown = items.length > 4 ? [...items.slice(0, 3), `${items.length - 3} more`] : items;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

/** Posts that did not go out, or whose outcome is unknown, in the last 7 days. */
const posts: Probe = {
  id: 'post', label: 'failed posts', severity: 'high', link: '#/money/journal',
  rows: ({ state, venture, nowMs }) => listRecords(state, 'venture-connector-post', venture.id).flatMap((post): ProbeItem[] => {
    const last = post.journal.at(-1);
    if (!last || (post.state !== 'rejected' && post.state !== 'outcome_unknown')) return [];
    if (nowMs - Date.parse(last.at) > PROBE_LIMITS.postDays * DAY_MS) return [];
    // Turned down before it was approved, or settled by the owner's own check: the owner knows already.
    if (post.state === 'rejected' && (last.by === 'owner' || post.outcome?.by === 'owner' || !post.journal.some(step => step.state === 'approved'))) return [];
    const name = postingName(post.connectorId);
    const day = shortDay(localDayAt(last.at, venture.country), venture.country.dateOrder);
    const unknown = post.state === 'outcome_unknown';
    return [{
      subject: `probe:post:${idPart(post.id)}`, version: post.state, createdAt: last.at,
      title: unknown ? `A post to ${name} may have gone out` : `A post to ${name} did not go out`,
      line: unknown ? `Chausar stopped while posting on ${day}. Check ${name}, then record what you found in the journal.` : `It stopped on ${day}. Open the journal to see why, then propose it again.`,
      navigate: 'Open the journal in Money to see this post.',
    }];
  }),
};

/** The connections the setup row speaks for: an AI key, and the owner's command-line AI. */
const OWN_AI = /^(model|cli):/;

/**
 * A broken connection: each failed row of the latest connection check, its line then its fix. The version is the fix:
 * other words for the same failure (a status number, a time) do not bring back a row the owner set aside.
 */
const connections: Probe = {
  id: 'connection', label: 'broken connections', severity: 'high', link: '#/connections',
  rows: ({ deps, ctx, state, venture, shown }) => {
    const check = latestCheck(state, venture.id);
    if (!check) return [];
    // The setup row (views/queue.ts aiState) speaks for the owner's AI whenever it shows.
    const ai = shown.has('setup:ai') || aiState(deps, ctx, state, venture) !== null;
    const github = shown.has('connector:github') || listRecords(state, 'venture-build-follow', venture.id).at(-1)?.lastStatus?.word === 'repo-not-readable';
    return check.rows.flatMap((row): ProbeItem[] => {
      if (row.outcome !== 'failed') return [];
      if ((ai && OWN_AI.test(row.connectorId)) || (github && row.connectorId === 'github')) return []; // their own rows say it
      const name = row.name ?? row.connectorId;
      return [{
        subject: `probe:connection:${idPart(row.connectorId)}`, version: digest({ fix: row.fix ?? row.line }).slice(0, 16),
        createdAt: check.at, title: `${name} failed its check`, line: row.fix ? `${row.line} ${row.fix}` : row.line, navigate: `Fix ${name} under Connections.`,
      }];
    });
  },
};

/** Drafts that are handed off on their own rows: payment reminders (4E2's reminder rows) and timed follow-ups (4E1). */
const OWN_ROWS: ReadonlySet<OutreachKind> = new Set<OutreachKind>(['reminder', 'follow-up']);

/**
 * Drafted messages the owner has not sent after more than 3 days, on cards still open. A draft waits from when it could
 * be sent: its channel's pause (4E2, a block for 72 hours) holds it, so the 3 days count from the end of the last pause
 * that held it, and one still paused waits on nothing (the pause's own notice says so).
 */
const drafts: Probe = {
  id: 'drafts', label: 'drafts waiting', severity: 'low', link: '#/clients/pipeline',
  rows: ({ state, venture, nowMs, card: cardOf }) => {
    const holds = listRecords(state, 'venture-channel-hold', venture.id).filter(hold => hold.cause === 'blocked' && hold.until !== null && Date.parse(hold.at) <= nowMs);
    const sendableFrom = (draft: { channel: keyof typeof CHANNEL_CONNECTOR; at: string }) => holds
      .filter(hold => hold.connectorId === CHANNEL_CONNECTOR[draft.channel] && Date.parse(hold.until!) > Date.parse(draft.at))
      .reduce((latest, hold) => Math.max(latest, Date.parse(hold.until!)), Date.parse(draft.at));
    const waiting = listRecords(state, 'venture-outreach', venture.id).flatMap(draft => {
      if (draft.sent || OWN_ROWS.has(draft.outreachKind)) return [];
      const from = sendableFrom(draft);
      if (nowMs - from <= PROBE_LIMITS.draftDays * DAY_MS) return [];
      const card = draft.opportunityId ? cardOf(draft.opportunityId) : undefined;
      return !card || (!CLOSED_STAGES.has(card.stage) && !card.blocked) ? [{ draft, from }] : [];
    }).sort((a, b) => a.from - b.from || a.draft.id.localeCompare(b.draft.id)).map(item => item.draft);
    if (!waiting.length) return [];
    const oldest = waiting[0];
    const crossed = sendableFrom(oldest) + PROBE_LIMITS.draftDays * DAY_MS;
    const card = oldest.opportunityId ? cardOf(oldest.opportunityId) : undefined;
    const name = card?.name ?? (oldest.personId ? personById(state, oldest.personId)?.name : undefined) ?? 'a contact';
    const day = shortDay(localDayAt(oldest.at, venture.country), venture.country.dateOrder);
    const one = waiting.length === 1;
    return [{
      subject: 'probe:drafts', version: digest(waiting.map(draft => draft.id).sort()).slice(0, 16),
      createdAt: new Date(crossed).toISOString(),
      title: one ? '1 drafted message has waited more than 3 days' : `${waiting.length} drafted messages have waited more than 3 days`,
      line: one ? `It is for ${name}, drafted on ${day}. Send it yourself from Clients, Pipeline.` : `The oldest is for ${name}, drafted on ${day}. Send them yourself from Clients, Pipeline.`,
      navigate: 'Open the drafts from their cards in Clients, Pipeline, and send them yourself.',
    }];
  },
};

/** Runs whose draft does not count for the calendar: failed or turned down (practice runs never count). */
const DRAFTLESS: ReadonlySet<string> = new Set(['rejected', 'failed']);

/** A gap in next week's social calendar: for each open order with a calendar, next week's slots no draft fills. */
const calendar: Probe = {
  id: 'calendar', label: 'gaps in next week\'s calendar', severity: 'medium', link: '#/work',
  rows: ({ state, venture, today }) => {
    const from = addDays(weekStart(today), 7), to = addDays(from, 6);
    const dateOrder = venture.country.dateOrder;
    const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
    const runs = listRecords(state, 'venture-delivery-run', venture.id).filter(run => !run.practice && run.deliverable && !DRAFTLESS.has(run.status));
    return listRecords(state, 'venture-order', venture.id).flatMap((order): ProbeItem[] => {
      if (order.status !== 'open') return [];
      const slots = calendarSlotsOrNone(order.intake);
      const week = slots.filter(slot => slot.date >= from && slot.date <= to);
      if (!week.length) return [];
      const filled = new Set(runs.filter(run => run.orderId === order.id)
        .flatMap(run => assignSlots(calendarPosts(run.deliverable!), slots).filled.map(fill => fill.slot.id)));
      const gaps = week.filter(slot => !filled.has(slot.id));
      if (!gaps.length) return [];
      const byChannel = new Map<(typeof gaps)[number]['channel'], string[]>();
      for (const slot of gaps) byChannel.set(slot.channel, [...(byChannel.get(slot.channel) ?? []), shortDay(slot.date, dateOrder)]);
      const planned = [...byChannel].map(([channel, days]) => `${channelCapability(channel).name} on ${listWords(days)}`).join('; ');
      const one = gaps.length === 1;
      const client = clients.get(order.clientId) ?? 'a client';
      return [{
        subject: `probe:calendar:${idPart(order.id)}`, version: digest(gaps.map(slot => slot.id)).slice(0, 16), createdAt: startOf(weekStart(today)),
        title: one ? '1 post next week has no draft' : `${gaps.length} posts next week have no draft`,
        line: `The calendar for ${client} plans ${planned} with nothing drafted. Open the order in Work to draft ${one ? 'it' : 'them'}.`,
        navigate: `Open ${client}'s order in Work to draft next week's posts.`,
      }];
    });
  },
};

/** A figure that moved sharply: money received or billed in a week, by a z-score over 3 (probe-figures.ts). */
const sharp: Probe = {
  id: 'moved', label: 'figures that moved sharply', severity: 'medium', link: '#/money',
  rows: ({ state, venture, today }) => WEEKLY_WHATS.flatMap((what): ProbeItem[] => {
    const move = sharpMove(state, venture, what, today);
    if (!move) return [];
    const tax = what === 'billed' && taxRegistered(state, venture) ? ', before tax' : '';
    const when = move.current ? 'this week' : 'last week';
    return [{
      subject: `probe:moved:${what}`, version: `${move.week}.${move.direction}`,
      createdAt: startOf(move.current ? move.week : weekStart(today)),
      title: `Money ${what} moved sharply`,
      line: `Moved sharply ${when}: ${move.total} ${what}${move.current ? ' so far' : ''}${tax}, against ${move.average} a week on average over the ${plural(move.weeks, 'week', 'weeks')} before.`,
      navigate: 'Open Money to see the weeks behind it.',
      figures: [{ text: move.total, receiptId: move.weekReceiptId }, { text: move.average, receiptId: move.averageReceiptId }],
    }];
  }),
};

/** The stages a client can stall in: talking, and a quote sent (Proposal). */
const STALLS: ReadonlySet<string> = new Set(['talking', 'proposal']);

/** A stalled client: a Talking or Proposal card with no reply in 14 days, unless Today shows a follow-up row for it. */
const stalled: Probe = {
  id: 'stalled', label: 'stalled clients', severity: 'medium', link: '#/clients/pipeline',
  rows: ({ venture, today, cards, shown }) => {
    const candidates = cards().filter(card => STALLS.has(card.stage) && !card.blocked);
    return candidates.flatMap((card): ProbeItem[] => {
      if (shown.has(`followup:${card.key}`)) return [];
      const entered = card.history.filter(move => move.to === card.stage).at(-1);
      const enteredOn = localDayAt(entered?.at ?? card.createdAt, venture.country);
      const replied = card.touches.filter(touch => touch.what === 'reply').map(touch => touch.on).sort().at(-1) ?? null;
      const anchor = replied && replied > enteredOn ? replied : enteredOn;
      const waited = daysBetween(anchor, today);
      if (waited < PROBE_LIMITS.stalledDays) return [];
      const first = firstOf(card.name);
      const day = shortDay(anchor, venture.country.dateOrder);
      const said = anchor === replied ? `${card.name} last wrote on ${day}.` : `${card.name} moved to ${STAGE_LABEL[card.stage]} on ${day} and has not written since.`;
      return [{
        subject: `probe:stalled:${idPart(card.key)}`, version: `${card.stage}.${anchor}`, createdAt: startOf(addDays(anchor, PROBE_LIMITS.stalledDays)),
        title: card.stage === 'proposal' ? `No answer to your quote for ${first} in ${daysWords(waited)}` : `No reply from ${first} in ${daysWords(waited)}`,
        line: `${said} Follow up yourself, or move the card in Clients, Pipeline.`,
        navigate: `Open ${first}'s card in Clients, Pipeline.`,
      }];
    });
  },
};

/** Every probe, in the order Today and Keeper name them. */
export const PROBES: readonly Probe[] = Object.freeze([posts, connections, drafts, calendar, sharp, stalled]);

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

/** A probe that threw: its id, its words and why. */
export type ProbeFailure = { id: NoticeProbe; label: string; reason: string };

const reasonOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'an unknown error').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Runs each probe in its own try and catch and makes its items notice rows (Open, then Later), each subject once. A
 * probe that throws is skipped and named in failed. A subject in shown (rows Today already has) is left out. A business
 * still in its interview (no country yet) has none. Reads only.
 */
export function runProbes(
  deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, probes: readonly Probe[] = PROBES, shown: ReadonlySet<string> = new Set(),
): { rows: W4RowItem[]; failed: ProbeFailure[] } {
  if (!venture.country) return { rows: [], failed: [] };
  const now = deps.clock();
  const today = localDayAt(now, venture.country);
  let cards: Card[] | null = null;
  let byId: Map<string, Card> | null = null;
  const allCards = () => (cards ??= cardsOf(state, venture, today));
  // As findCard reads them: a card's own id wins over another card's lead id.
  const cardMap = () => (byId ??= new Map([...allCards().filter(card => card.leadId).map(card => [card.leadId!, card] as const), ...allCards().map(card => [card.id, card] as const)]));
  const input: ProbeInput = { deps, ctx, state, venture, today, nowMs: now.getTime(), cards: allCards, card: id => cardMap().get(id), shown };
  const rows: W4RowItem[] = [];
  const failed: ProbeFailure[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    let items: ProbeItem[];
    try {
      items = probe.rows(input);
    } catch (error) {
      failed.push({ id: probe.id, label: probe.label, reason: reasonOf(error) });
      continue;
    }
    for (const { figures, ...item } of items) {
      if (seen.has(item.subject) || shown.has(item.subject)) continue;
      seen.add(item.subject);
      rows.push({
        kind: 'notice', ...item,
        actions: [{ id: 'open', label: 'Open', primary: true }, { id: 'later', label: 'Later', primary: false }],
        notice: { probe: probe.id, severity: probe.severity, link: probe.link, ...(figures?.length ? { figures } : {}) },
      });
    }
  }
  return { rows, failed };
}

/** The probes' rows for Today, leaving out every subject Today already shows (shown). */
export function probeRows(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, shown: ReadonlySet<string> = new Set()): W4RowItem[] {
  return runProbes(deps, ctx, state, venture, PROBES, shown).rows;
}

/** A notice offers Open (navigation) and Later (queue.ts records it); anything else is refused in words. */
export async function decideNoticeRow(_deps: VentureDeps, _ctx: Context, _decision: W4Decision): Promise<W4Outcome> {
  throw new ChausarError('INVALID_VENTURE_REQUEST', 'A notice offers Open and Later.');
}

// ---------------------------------------------------------------------------
// Keeper's run (the journal sweep's tick)
// ---------------------------------------------------------------------------

/** A Keeper run's record older than this is renewed even when nothing changed (as views/keeper.ts does). */
const RENEW_AFTER_MS = DAY_MS;

/** What one run of the probes found, in Keeper's words: the probes that threw, else how many rows still need the owner. */
function probesRan(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, probes: readonly Probe[]): Pick<KeeperRunRecord, 'outcome' | 'line'> {
  const { rows, failed } = runProbes(deps, ctx, state, venture, probes);
  if (failed.length === 1) return { outcome: 'failed', line: `The check for ${failed[0].label} could not run: ${failed[0].reason}` };
  if (failed.length > 1) return { outcome: 'failed', line: `${failed.length} needs-you checks could not run: ${listWords(failed.map(item => item.label))}.` };
  const decided = new Set(listRecords(state, 'venture-queue-decision', venture.id).filter(record => !record.undoneAt).map((record: QueueDecisionRecord) => record.rowId)); // 4J2: undone ones no longer count
  const open = rows.filter(row => !decided.has(rowId(row.subject, row.version))).length;
  return { outcome: 'ok', line: open ? `Needs-you checks found ${plural(open, 'thing that needs you', 'things that need you')}.` : 'Needs-you checks found nothing that needs you.' };
}

/**
 * Keeper's 'probes' run, from the journal sweep's tick: runs every probe; the first run in which one throws is written,
 * with keeper.ran, and from then on the job's one record is replaced only when its outcome or line changed or it is a
 * day old. Never throws: a run that cannot be written leaves the last one in place, and the next tick tries again.
 */
export async function recordProbeRuns(deps: VentureDeps, ctx: Context, probes: readonly Probe[] = PROBES): Promise<void> {
  const fresh = (now: number, ran: Pick<KeeperRunRecord, 'outcome' | 'line'>, old: KeeperRunRecord | undefined) =>
    !!old && old.outcome === ran.outcome && old.line === ran.line && now - Date.parse(old.at) < RENEW_AFTER_MS;
  try {
    const state = deps.store.read();
    const venture = currentVenture(state);
    if (!venture?.country) return;
    const last = listRecords(state, 'venture-keeper-run', venture.id).find(record => record.job === 'probes');
    const first = probesRan(deps, ctx, state, venture, probes);
    // Until a probe has thrown once, Keeper's card needs no run of its own (views/keeper.ts lists the job once it has one).
    if ((!last && first.outcome !== 'failed') || fresh(deps.clock().getTime(), first, last)) return;
    await ventureAction(deps, ctx, 'prepare', 'keeper.probes', tx => {
      // Worked out again on the state the commit sees.
      const ran = probesRan(deps, ctx, tx.state, tx.venture!, probes);
      const old = tx.list('venture-keeper-run').filter(record => record.job === 'probes');
      if ((!old[0] && ran.outcome !== 'failed') || fresh(Date.parse(tx.now), ran, old[0])) return;
      const record: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'probes', ...ran };
      if (old[0]) tx.replace({ ...record, id: old[0].id });
      else tx.put(record);
      tx.emit('keeper.ran', { jobs: ['probes'] });
    });
  } catch {
    // Keeper's card keeps the run before; the next tick tries again.
  }
}
