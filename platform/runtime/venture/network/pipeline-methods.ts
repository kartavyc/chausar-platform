// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): the pipeline's engine methods. venture.pipeline.list
// (the board: seven columns with their sub lines, four tiles, "How people moved" and the forecast, every figure with
// its receipt), venture.pipeline.followups (the follow-up schedule), and the owner's add, setNext, move and settings,
// inside the app. The rules live in pipeline.ts, the dates in followups.ts, the score in score.ts, the counted
// figures in funnel.ts. A card shows its person's strength and best warm path from 4D2's ties and paths.
import { authorize, ChausarError, check, type Context, type State } from '../../contracts.ts';
import { PIPELINE_STAGES, TIE_BANDS } from '../contracts.ts';
import type {
  FollowupsView, FollowupView, IsoDate, LawfulBasis, LostReason, OutreachChannel, OutreachKind, PipelineCaps, PipelineCardResult, PipelineCardView, PipelineEvidenceInput, PipelineSettingsRecord, PipelineSettingsView,
  PersonRecord, PipelineQuoteView, PipelineStage, PipelineView, ScoreRule, StatTileView, TieRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import {
  exactPayload, formatVentureDate, identifier, isoDate, listRecords, readVenture, requireAppChannel, singleLine, smallInteger, ventureAction, type VentureTx,
} from '../records.ts';
import { localDayAt, ownerToday } from '../local-day.ts';
import { planDisplay, sumReceipt } from '../money/sums.ts';
import { businessOf } from '../views/shared.ts';
import { addDays, DEFAULT_PIPELINE_SETTINGS, lateWords, projectPlan, shortDay, threadAge, weekStart, type FollowupPlan } from './followups.ts';
import { closedIn, FORECAST_MIN_CLOSED, funnelCountPlan, HISTORY_DAYS, stageFunnel } from './funnel.ts';
import { followupSchedule, type FollowupEntry } from './followup-rows.ts';
import { bestPath, pathIndex, warmPaths, type PathIndex } from './paths.ts';
import { coldOutreach } from '../customers/leads.ts';
import { receiptFigure } from '../money/quote.ts';
import { latestBlueprint } from '../core/lookups.ts';
import { combinedSignals, initials } from './people.ts';
import {
  announce, BLOCKED_LINE, cardForWrite, cardsOf, channelPhrase, CHANNEL_WORDS, CLOSED_STAGES, DRAFT_WORDS, findCard, moveCard, nextStepOf, OWNER_LOST_REASONS,
  personBlocked, pipelineSettings, planInput, setNextStep, STAGE_LABEL, storeCard, triggerOf, unsentDrafts, type Card, type NextStep,
} from './pipeline.ts';
import { checkScoreRules, checkVotes, scoreCard, type ScoreFacts } from './score.ts';
import { plural } from './text.ts';
import { acceptedTimeline } from './accepted.ts';
import { channelCapsInput } from './governor.ts';

const STAGE_SUB: Readonly<Record<PipelineStage, string>> = Object.freeze({
  found: 'Not asked yet', asked: 'You sent the first note', talking: 'They wrote back', proposal: 'A price is with them', won: 'Now your clients',
  lost: 'It did not go ahead', 'not-now': 'Ask again later',
});
const FOLDED: ReadonlySet<PipelineStage> = new Set<PipelineStage>(['lost', 'not-now']);
/** The board's "Due soon": a next step due today, late, or in the next two days. */
export const DUE_SOON_DAYS = 2;
const TRIGGER_KINDS = ['import', 'search', 'saved-search', 'owner', 'lead'] as const;
const EVIDENCE_KINDS = ['reply', 'quote', 'note', 'client'] as const;

/** What a card view reads besides the card: the day, the business, the ties, the paths and the owner's score rules. */
type ViewContext = {
  state: State; venture: VentureRecord; today: IsoDate; business: string; ties: ReadonlyMap<string, TieRecord>; paths: PathIndex; rules: ScoreRule[];
  people: ReadonlyMap<string, PersonRecord>;
};

function viewContext(deps: VentureDeps, state: State, venture: VentureRecord, today: IsoDate): ViewContext {
  const ties = new Map<string, TieRecord>();
  for (const tie of listRecords(state, 'venture-tie', venture.id)) ties.set(tie.personId, tie);
  const people = new Map(listRecords(state, 'venture-person', venture.id).map(person => [person.id, person]));
  return { state, venture, today, business: businessOf(deps, state).name, ties, paths: pathIndex(state, venture.id), rules: pipelineSettings(state, venture.id).scoreRules, people };
}

/** How a next step reads on a card. */
function nextLine(next: NextStep, today: IsoDate, venture: VentureRecord): string {
  const day = shortDay(next.due, venture.country.dateOrder);
  const late = next.due < today ? `, ${lateWords(next.due, today)}` : '';
  if (next.kind === 'nudge') return next.due === today ? `${next.text} today` : `${next.text} ${day}${late}`;
  if (next.kind === 'owner') return next.due === today ? `${next.text}, due today` : `${next.text}, due ${day}${late}`;
  if (next.kind === 'other-path') return `${next.text}, from ${day}`;
  if (next.kind === 'park') return `Parks as Not now on ${day} if there is no reply`;
  return `Ask again from ${day}`;
}

const ORDINAL = ['Follow up', 'Second follow-up', 'Third follow-up'];

/** A card's timeline: what was sent and when they wrote, what is scheduled, and what is projected (estimated). */
function timelineOf(card: Card, view: ViewContext): PipelineCardView['timeline'] {
  const order = view.venture.country.dateOrder;
  const day = (on: IsoDate) => shortDay(on, order);
  const sent = card.touches.filter(touch => touch.what === 'sent');
  const newest = sent[sent.length - 1];
  const items: PipelineCardView['timeline'] = card.touches.map(touch => touch.what === 'sent'
    ? {
      what: 'sent' as const, at: touch.on, estimated: false,
      line: `${touch.kind === 'first' ? 'First note' : 'Follow-up'} sent${channelPhrase(touch.channel)}, ${day(touch.on)}.${touch === newest ? ' Chausar doesn\'t track opens.' : ''}`,
    }
    : { what: 'reply' as const, at: touch.on, line: `They wrote back, ${day(touch.on)}.`, estimated: false });
  const plans = projectPlan(planInput(card));
  plans.forEach((plan: FollowupPlan, index) => {
    const at = plan.kind === 'park' ? plan.on : plan.due;
    if (index === 0) {
      const line = plan.kind === 'nudge' ? `${plan.step === 0 ? 'Follow up' : 'Follow up again'} ${day(at)}${at < view.today ? `, ${lateWords(at, view.today)}` : ''}`
        : plan.kind === 'park' ? `Parks as Not now on ${day(at)} if there is no reply` : `Try another path, or Not now, from ${day(at)}`;
      items.push({ what: 'scheduled', at, line, estimated: false });
      return;
    }
    const line = plan.kind === 'nudge' ? `${ORDINAL[plan.step] ?? 'Another follow-up'} about ${day(at)}, estimated`
      : plan.kind === 'park' ? `Parks as Not now about ${day(at)} if there is no reply, estimated` : `Try another path, or Not now, about ${day(at)}, estimated`;
    items.push({ what: 'projected', at, line, estimated: true });
  });
  items.push(...acceptedTimeline(view.state, view.venture, card)); // 4E2: connection notes LinkedIn's export shows accepted
  return items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.at < b.item.at ? -1 : a.item.at > b.item.at ? 1 : a.index - b.index)).map(entry => entry.item);
}

/** What the owner's score rules read about a card. */
function scoreFacts(card: Card, tie: TieRecord | undefined): ScoreFacts {
  return {
    title: card.person?.role?.title ?? null, company: card.company, 'email-domain': card.emails[0]?.split('@')[1] ?? null, band: tie?.band ?? null,
    trigger: card.trigger.kind, stage: card.stage, meetings: card.person ? combinedSignals(card.person).meetings?.count ?? 0 : 0,
    client: Boolean(card.clientId ?? card.person?.clientId),
  };
}

/** The kinds and channels a draft may take (outreach.ts draftRequest: a connection note on LinkedIn, a cold email by mail). */
const DRAFT_CHOICES: readonly { kind: OutreachKind; channel: OutreachChannel }[] = (['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email'] as const)
  .flatMap(kind => (['email', 'linkedin', 'whatsapp'] as const).filter(channel => (kind !== 'connection-note' || channel === 'linkedin') && (kind !== 'cold-email' || channel === 'email'))
    .map(channel => ({ kind, channel })));

/**
 * 4E4: for each kind and channel, whether the draft is cold (coldOutreach, with the tie of whoever it goes to: an intro's
 * strongest confirmed connector, else the card's person) and whether it still needs its lawful basis: cold, and no
 * basis kept on the card for its own person (an intro's basis is the connector's, so it is always asked).
 */
function outreachChoices(card: Card, view: ViewContext): { outreach: NonNullable<PipelineCardView['outreach']>; basis: LawfulBasis | null } {
  const basis = card.stored?.basis ?? null;
  const own = card.person ? view.ties.get(card.person.id)?.band ?? null : null;
  // The connector an intro would go through, as planDraft picks it: the first confirmed one still in the network and not blocked.
  const connector = card.person ? warmPaths(view.paths, card.person.id, 50).find(path => {
    const via = path.confirmed && path.via ? view.people.get(path.via.id) : undefined;
    return via !== undefined && !personBlocked(view.state, view.venture.id, via);
  }) : undefined;
  const through = connector?.via ? view.ties.get(connector.via.id)?.band ?? null : null;
  const outreach = DRAFT_CHOICES.map(({ kind, channel }) => {
    const cold = coldOutreach({ kind, channel, band: kind === 'intro-request' ? through : own });
    return { kind, channel, cold, needsBasis: cold && (kind === 'intro-request' || !basis) };
  });
  return { outreach, basis };
}

/** 4E4: the quote a Proposal card rests on (its newest quote move), with its price receipt. */
function quoteOf(card: Card, view: ViewContext): PipelineCardView['quote'] {
  if (card.stage !== 'proposal') return null;
  const move = [...card.history].reverse().find(item => item.to === 'proposal' && item.evidence.kind === 'quote' && item.evidence.id);
  const receipt = move ? listRecords(view.state, 'venture-price-receipt', view.venture.id).find(item => item.id === move.evidence.id) : undefined;
  const amount = receipt ? receiptFigure(receipt, 'taxable') ?? receiptFigure(receipt, 'total') : undefined;
  return receipt && amount ? { value: amount.display, receiptId: receipt.id } : null;
}

/** 4E4: the client a Won card made, and since when, in words. */
function clientOf(card: Card, view: ViewContext): PipelineCardView['client'] {
  if (card.stage !== 'won' || !card.clientId) return null;
  const client = listRecords(view.state, 'venture-client', view.venture.id).find(item => item.id === card.clientId);
  const won = [...card.history].reverse().find(item => item.to === 'won');
  if (!client) return null;
  const since = won ? ` since ${shortDay(localDayAt(won.at, view.venture.country), view.venture.country.dateOrder)}` : '';
  return { name: client.name, line: `Now a client${since}.` };
}

/** One card as the board shows it. */
export function cardView(card: Card, view: ViewContext): PipelineCardView {
  const tie = card.person ? view.ties.get(card.person.id) : undefined;
  const band = tie?.band ?? null;
  const next = nextStepOf(card);
  const [draft] = unsentDrafts(view.state, view.venture, card);
  const score = scoreCard(scoreFacts(card, tie), view.rules, card.votes);
  const lastReply = card.touches.filter(touch => touch.what === 'reply').map(touch => touch.on).sort().at(-1);
  return {
    id: card.id, personId: card.personId, name: card.name, initials: initials(card.name), company: card.company, stage: card.stage,
    band, dots: band ? TIE_BANDS.length - TIE_BANDS.indexOf(band) : 0, path: card.person ? bestPath(view.paths, card.person.id) : null,
    next: next ? { text: next.text, due: next.due, line: nextLine(next, view.today, view.venture), late: (next.kind === 'nudge' || next.kind === 'owner') && next.due < view.today } : null,
    draft: draft ? `${DRAFT_WORDS[draft.kind]} drafted, for ${CHANNEL_WORDS[draft.channel]}` : null,
    draftId: draft?.id ?? null, draftChannel: draft?.channel ?? null, // 4E4: the screens open it again after a reload
    ...outreachChoices(card, view), quote: quoteOf(card, view), client: clientOf(card, view), // 4E4
    business: view.business, trigger: card.trigger.line,
    score: score ? { bucket: score.bucket, reasons: score.reasons } : null,
    timeline: timelineOf(card, view),
    ...(card.blocked ? { blocked: BLOCKED_LINE } : {}),
    ...(lastReply && !CLOSED_STAGES.has(card.stage) ? { thread: threadAge(lastReply, view.today) } : {}),
  };
}

/** The card of one person in the person sheet (4D1's venture.network.person): their newest card, or null. */
export function personCardView(deps: VentureDeps, state: State, venture: VentureRecord, personId: string): PipelineCardView | null {
  const today = ownerToday(deps.clock, venture.country);
  const mine = cardsOf(state, venture, today).filter(card => card.personId === personId);
  return mine.length ? cardView(mine[mine.length - 1], viewContext(deps, state, venture, today)) : null;
}

const byNext = (view: ViewContext) => (a: Card, b: Card) => {
  const da = nextStepOf(a)?.due ?? '9999-12-31', db = nextStepOf(b)?.due ?? '9999-12-31';
  return da < db ? -1 : da > db ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

/** One tile with its count receipt. */
async function tile(deps: VentureDeps, ctx: Context, venture: VentureRecord, id: string, label: string, scope: string, from: IsoDate, to: IsoDate, line: (count: number) => string, state: State): Promise<StatTileView> {
  const plan = funnelCountPlan(state, venture, { type: 'count', what: 'funnel', scope, from, to });
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  return { id, label, value: receipt.totalMinor, line: line(plan.addends.length), receiptId: receipt.id };
}

/** "1 for Mail, 1 for WhatsApp", in channel order, or the empty words. */
function tally(parts: [string, number][], empty: string): string {
  const shown = parts.filter(([, n]) => n > 0).map(([words, n]) => words.replace('{n}', String(n)));
  return shown.length ? shown.join(', ') : empty;
}

/**
 * venture.pipeline.list { filter? } (read): the board. Seven columns (Lost and Not now folded) with sub lines, counts and
 * cards; 'due' keeps cards with a next step due within two days (late ones too), 'draft' cards with a draft waiting.
 * Tiles: next steps this week, drafts to send, moved forward this week, won this month. "How people moved" over the
 * last 90 days, and the forecast. Every count and amount has its receipt.
 */
export async function pipelineList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PipelineView> {
  const body = exactPayload(payload ?? {}, ['filter']);
  check(body.filter === undefined || body.filter === 'due' || body.filter === 'draft', 'INVALID_VENTURE_REQUEST', 'Filter by due or by draft, or not at all.');
  const { state, venture } = readVenture(deps, ctx);
  const today = ownerToday(deps.clock, venture.country);
  const view = viewContext(deps, state, venture, today);
  const cards = cardsOf(state, venture, today);
  const soon = addDays(today, DUE_SOON_DAYS);
  const shown = cards.filter(card => {
    if (body.filter === 'due') { const next = nextStepOf(card); return !!next && next.kind !== 'ask-again' && next.due <= soon; }
    if (body.filter === 'draft') return !CLOSED_STAGES.has(card.stage) && unsentDrafts(state, venture, card).length > 0;
    return true;
  });
  const columns = PIPELINE_STAGES.map(stage => {
    const inStage = shown.filter(card => card.stage === stage).sort(byNext(view));
    return { stage, label: STAGE_LABEL[stage], sub: STAGE_SUB[stage], count: inStage.length, folded: FOLDED.has(stage), cards: inStage.map(card => cardView(card, view)) };
  });

  const week = weekStart(today), weekEnd = addDays(week, 6), month = `${today.slice(0, 8)}01`;
  const open = cards.filter(card => !CLOSED_STAGES.has(card.stage));
  const dueThisWeek = open.map(card => nextStepOf(card)).filter((next): next is NextStep => !!next && next.due <= weekEnd);
  const drafts = open.flatMap(card => unsentDrafts(state, venture, card));
  const moves = cards.flatMap(card => card.history.filter(move => move.from !== null && move.to !== 'lost' && move.to !== 'not-now'
    && localDayAt(move.at, venture.country) >= week && localDayAt(move.at, venture.country) <= today));
  const wonNames = cards.filter(card => card.history.some(move => move.to === 'won' && localDayAt(move.at, venture.country) >= month && localDayAt(move.at, venture.country) <= today))
    .map(card => card.name);
  const tiles = [
    await tile(deps, ctx, venture, 'next-steps', 'Next steps this week', 'due', today, weekEnd, () =>
      `${dueThisWeek.filter(next => next.due < today).length} late, ${dueThisWeek.filter(next => next.due === today).length} today, ${dueThisWeek.filter(next => next.due > today).length} later`, state),
    await tile(deps, ctx, venture, 'drafts', 'Drafts to send', 'drafts', today, today, () =>
      tally((['email', 'linkedin', 'whatsapp'] as const).map(channel => [`{n} for ${CHANNEL_WORDS[channel]}`, drafts.filter(draft => draft.channel === channel).length]), 'None waiting'), state),
    await tile(deps, ctx, venture, 'moved', 'Moved forward this week', 'moved', week, today, () =>
      tally((['asked', 'talking', 'proposal', 'won'] as const).map(stage => [`{n} to ${STAGE_LABEL[stage]}`, moves.filter(move => move.to === stage).length]), 'None yet'), state),
    await tile(deps, ctx, venture, 'won', 'Won this month', 'won', month, today, () =>
      wonNames.length ? `${wonNames.slice(0, 3).join(', ')}${wonNames.length > 3 ? `, and ${wonNames.length - 3} more` : ''}` : 'None yet', state),
  ];

  const from = addDays(today, 1 - HISTORY_DAYS);
  const funnel: PipelineView['funnel'] = [];
  for (const stage of PIPELINE_STAGES) {
    const counted = stageFunnel(cards, venture, stage, from, today);
    const receipt = await sumReceipt(deps, ctx, venture.id, funnelCountPlan(state, venture, { type: 'count', what: 'funnel', scope: stage, from, to: today }));
    const movedOnPermille = CLOSED_STAGES.has(stage) || counted.reached === 0 ? null : Math.floor((counted.movedOn * 1000) / counted.reached);
    funnel.push({ stage, reached: counted.reached, movedOnPermille, receiptId: receipt.id, reachedPermille: 0, share: null });
  }
  // 4E4: each stage's count against the largest, for the bars, and the share that moved on in words.
  const most = Math.max(0, ...funnel.map(item => item.reached));
  for (const item of funnel) {
    item.reachedPermille = most ? Math.floor((item.reached * 1000) / most) : 0;
    item.share = item.movedOnPermille === null ? null : `${Math.floor(item.movedOnPermille / 10)}%`;
  }

  const closed = closedIn(cards, venture, from, today).length;
  let forecast: PipelineView['forecast'];
  if (closed < FORECAST_MIN_CLOSED) {
    forecast = { line: `Not enough history yet: ${plural(closed, 'card', 'cards')} closed in the last 90 days, and a forecast needs ${FORECAST_MIN_CLOSED}.` };
  } else {
    const plan = funnelCountPlan(state, venture, { type: 'count', what: 'funnel', scope: 'forecast', from, to: today });
    forecast = plan.addends.length
      ? { value: planDisplay(plan), label: 'forecast from your last 90 days', receiptId: (await sumReceipt(deps, ctx, venture.id, plan)).id }
      : { line: 'No open card has a quote yet, so there is nothing to forecast.' };
  }
  return { columns, tiles, funnel, forecast, quotes: quotesOf(state, venture) };
}

/** 4E4: how many quotes the board offers as Proposal evidence, newest first. */
const QUOTE_PICKS = 20;

/** 4E4: the business's quotes (price receipts on an offer), newest first, for a Proposal move to rest on. */
function quotesOf(state: State, venture: VentureRecord): PipelineQuoteView[] {
  const offers = latestBlueprint(state, venture.id)?.offers ?? [];
  return listRecords(state, 'venture-price-receipt', venture.id)
    .filter(receipt => receipt.subject.type === 'offer')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, QUOTE_PICKS)
    .flatMap(receipt => {
      const amount = receiptFigure(receipt, 'taxable') ?? receiptFigure(receipt, 'total');
      if (!amount || receipt.subject.type !== 'offer') return [];
      const offerId = receipt.subject.offerId;
      const offer = offers.find(item => item.id === offerId)?.name.value ?? 'An offer no longer in your plan';
      return [{ receiptId: receipt.id, offer, quantity: receipt.inputs.quantity, value: amount.display, at: receipt.at }];
    });
}

function followupView(entry: FollowupEntry): FollowupView {
  return {
    cardId: entry.card.id, name: entry.card.name, company: entry.card.company, line: entry.line, due: entry.due, late: entry.late,
    channel: entry.channel, draftId: entry.draft?.id ?? null,
  };
}

/** venture.pipeline.followups {} (read): the follow-ups due now (as Today shows them) and the rest, each with its words. */
export async function pipelineFollowups(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FollowupsView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const schedule = followupSchedule(state, venture, deps.clock().toISOString());
  return { due: schedule.due.map(followupView), later: schedule.later.map(followupView) };
}

/** The card a write answers with, read again from the transaction's state. */
function resultCard(deps: VentureDeps, tx: VentureTx, id: string): PipelineCardView {
  const today = localDayAt(tx.now, tx.venture!.country);
  return cardView(findCard(cardsOf(tx.state, tx.venture!, today), id)!, viewContext(deps, tx.state, tx.venture!, today));
}

/**
 * venture.pipeline.add { personId, trigger: { kind, ref? }, votes? } (prepare, inside the app): a card in Found for one
 * person of the network, naming what made it (no source, no card), with per-factor votes for its score when given. A
 * person with an open card answers with it (new votes replace its old ones). A Not now or Lost card holds until its
 * "Ask again from" day; after it, and after Won, a new card links to the old one (whose park, when it parked on its
 * day, is stored first). A lead becomes this person's card, with its history; a lead whose card is closed starts a
 * fresh Found card linked to it.
 */
export async function pipelineAdd(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PipelineCardResult> {
  requireAppChannel(ctx, 'venture.pipeline.add');
  const body = exactPayload(payload, ['personId', 'trigger', 'votes'], ['personId']);
  const personId = identifier(body.personId, 'personId');
  check(body.trigger !== undefined && body.trigger !== null, 'PIPELINE_TRIGGER_REQUIRED', 'No source, no lead. Say where this person came from.');
  const trigger = exactPayload(body.trigger, ['kind', 'ref']);
  check(trigger.kind !== undefined, 'PIPELINE_TRIGGER_REQUIRED', 'No source, no lead. Say where this person came from.');
  check(typeof trigger.kind === 'string' && (TRIGGER_KINDS as readonly string[]).includes(trigger.kind), 'INVALID_VENTURE_REQUEST',
    'A card comes from a file, a search, a saved search, a lead or you.');
  const kind = trigger.kind as (typeof TRIGGER_KINDS)[number];
  const ref = trigger.ref === undefined ? null : identifier(trigger.ref, 'trigger.ref');
  const votes = body.votes === undefined ? null : checkVotes(body.votes);
  return ventureAction(deps, ctx, 'prepare', 'pipeline.add', tx => {
    const venture = tx.venture!;
    const person = tx.find('venture-person', personId);
    check(person, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
    const made = triggerOf(tx, person, { kind, ref });
    check(!personBlocked(tx.state, venture.id, person), 'PIPELINE_BLOCKED', BLOCKED_LINE);
    const today = localDayAt(tx.now, venture.country);
    const cards = cardsOf(tx.state, venture, today);
    const already = (card: Card) => {
      if (votes) { card.votes = votes; announce(tx, storeCard(tx, card).id); }
      return { card: resultCard(deps, tx, card.id), line: `Already in your pipeline, at ${STAGE_LABEL[card.stage]}.` };
    };
    const theirs = cards.filter(card => card.personId === person.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const newest = theirs[theirs.length - 1];
    if (newest && !CLOSED_STAGES.has(newest.stage)) return already(newest);
    if (newest && (newest.stage === 'not-now' || newest.stage === 'lost') && newest.askAgainFrom && newest.askAgainFrom > today) {
      throw new ChausarError('PIPELINE_STAGE_CLOSED',
        `${person.name} is ${STAGE_LABEL[newest.stage]} until ${formatVentureDate(newest.askAgainFrom, venture.country.dateOrder)}. Ask again from then.`);
    }
    // A card that parked on its day keeps that park in its record before a new card links to it.
    if (newest?.stored && newest.stored.stage !== newest.stage) storeCard(tx, newest);
    const leadCard = made.kind === 'lead' ? findCard(cards, made.ref!) : undefined;
    let card: Card;
    if (leadCard && !CLOSED_STAGES.has(leadCard.stage)) {
      if (leadCard.stored && leadCard.personId === person.id) return already(leadCard);
      check(!leadCard.stored || leadCard.personId === leadCard.leadId, 'PIPELINE_TRIGGER_REQUIRED', 'That lead\'s card is someone else\'s.');
      card = { ...leadCard, person, personId: person.id, trigger: made, name: person.name, company: person.role?.company ?? leadCard.company, linkedFrom: newest?.id ?? null };
    } else {
      card = {
        id: '', key: '', stored: null, lead: null, person, personId: person.id, createdAt: tx.now, stage: 'found', touches: [], sequence: null, next: null, trigger: made,
        history: [{ from: null, to: 'found', at: tx.now, by: ctx.memberId, evidence: { kind: made.kind === 'lead' ? 'lead' : 'owner', id: made.ref, line: made.line } }],
        blocked: false, clientId: null, lostReason: null, askAgainFrom: null, linkedFrom: leadCard?.id ?? newest?.id ?? null, leadId: null, votes: [],
        lastToPerson: null, name: person.name, company: person.role?.company ?? null, emails: person.handles.emails,
      };
    }
    if (votes) card.votes = votes;
    const record = storeCard(tx, card);
    announce(tx, record.id);
    const line = card.linkedFrom ? 'Added to Found again, linked to the earlier card.' : `Added to ${STAGE_LABEL[record.stage]}.`;
    return { card: resultCard(deps, tx, record.id), line };
  });
}

/** venture.pipeline.setNext { id, text, due } (prepare, inside the app): the owner's own next step on an open card. */
export async function pipelineSetNext(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PipelineCardResult> {
  requireAppChannel(ctx, 'venture.pipeline.setNext');
  const body = exactPayload(payload, ['id', 'text', 'due'], ['id', 'text', 'due']);
  const id = identifier(body.id, 'id');
  const text = singleLine(body.text, 'The next step', { min: 1, max: 200 });
  const due = isoDate(body.due, 'The day');
  return ventureAction(deps, ctx, 'prepare', 'pipeline.setNext', tx => {
    const record = setNextStep(tx, cardForWrite(tx, id), { text, due });
    return { card: resultCard(deps, tx, record.id), line: `Next step set for ${formatVentureDate(due, tx.venture!.country.dateOrder)}.` };
  });
}

/** The evidence of a move as the owner sends it, checked for shape (pipeline.ts checks it against the records). */
function evidenceOf(value: unknown): PipelineEvidenceInput | null {
  if (value === undefined || value === null) return null;
  const body = exactPayload(value, ['kind', 'id', 'on', 'text'], ['kind']);
  check(typeof body.kind === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(body.kind), 'INVALID_VENTURE_REQUEST', 'Evidence is a reply, a quote, a note or a client.');
  return {
    kind: body.kind as PipelineEvidenceInput['kind'],
    ...(body.id === undefined ? {} : { id: identifier(body.id, 'evidence.id') }),
    ...(body.on === undefined ? {} : { on: isoDate(body.on, 'The day') }),
    ...(body.text === undefined ? {} : { text: singleLine(body.text, 'The note', { min: 1, max: 300 }) }),
  };
}

/**
 * venture.pipeline.move { id, stage, reason?, evidence? } (approve, inside the app): forward only, with the evidence the
 * stage needs (pipeline.ts moveCard). id is the card's, or a lead's for a lead that has no card yet.
 */
export async function pipelineMove(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PipelineCardResult> {
  requireAppChannel(ctx, 'venture.pipeline.move');
  const body = exactPayload(payload, ['id', 'stage', 'reason', 'evidence'], ['id', 'stage']);
  const id = identifier(body.id, 'id');
  check(typeof body.stage === 'string' && (PIPELINE_STAGES as readonly string[]).includes(body.stage), 'INVALID_VENTURE_REQUEST', 'Choose one of the pipeline stages.');
  check(body.reason === undefined || (typeof body.reason === 'string' && (OWNER_LOST_REASONS as readonly string[]).includes(body.reason)), 'INVALID_VENTURE_REQUEST',
    'Choose one of the reasons: no budget, no reply, they chose someone else, not a fit, the timing, or another reason.');
  const stage = body.stage as PipelineStage;
  const reason = (body.reason as LostReason | undefined) ?? null;
  const evidence = evidenceOf(body.evidence);
  return ventureAction(deps, ctx, 'approve', 'pipeline.move', tx => {
    const { record, line } = moveCard(tx, cardForWrite(tx, id), stage, { reason, evidence, by: ctx.memberId });
    return { card: resultCard(deps, tx, record.id), line };
  });
}

function settingsView(settings: Pick<PipelineSettingsRecord, 'weekdays' | 'sendTime' | 'caps' | 'scoreRules'>, line: string): PipelineSettingsView {
  return { weekdays: [...settings.weekdays], sendTime: settings.sendTime, caps: { ...settings.caps }, scoreRules: settings.scoreRules.map(rule => ({ ...rule })), line };
}

/**
 * venture.pipeline.settings { weekdays?, sendTime?, caps?, scoreRules? } (approve, inside the app): the days and time the
 * owner sends follow-ups, the daily and weekly ceiling shared by first notes and follow-ups, and the score rules. Cards
 * already following up keep the sequence they copied. With no fields it only reads.
 */
export async function pipelineSettingsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PipelineSettingsView> {
  requireAppChannel(ctx, 'venture.pipeline.settings');
  const body = exactPayload(payload ?? {}, ['weekdays', 'sendTime', 'caps', 'scoreRules']);
  let weekdays: number[] | undefined, sendTime: string | undefined, caps: Partial<PipelineCaps> | undefined, scoreRules: ScoreRule[] | undefined;
  if (body.weekdays !== undefined) {
    check(Array.isArray(body.weekdays) && body.weekdays.length >= 1 && body.weekdays.length <= 7, 'INVALID_VENTURE_REQUEST', 'Choose the days you send, Monday 1 to Sunday 7.');
    weekdays = body.weekdays.map(day => smallInteger(day, 'A sending day', 1, 7)).sort((a, b) => a - b);
    check(new Set(weekdays).size === weekdays.length, 'INVALID_VENTURE_REQUEST', 'Name each sending day once.');
  }
  if (body.sendTime !== undefined) {
    check(typeof body.sendTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendTime), 'INVALID_VENTURE_REQUEST', 'Give the send time as 09:30.');
    sendTime = body.sendTime;
  }
  if (body.caps !== undefined) {
    const raw = exactPayload(body.caps, ['newPerDay', 'perWeek', 'channels']);
    caps = {
      ...(raw.newPerDay === undefined ? {} : { newPerDay: smallInteger(raw.newPerDay, 'People a day', 1, 100) }),
      ...(raw.perWeek === undefined ? {} : { perWeek: smallInteger(raw.perWeek, 'People a week', 1, 1000) }),
      // 4E2: the owner's lower daily caps per channel for the send governor, never above Chausar's own.
      ...(raw.channels === undefined ? {} : { channels: channelCapsInput(raw.channels) }),
    };
  }
  if (body.scoreRules !== undefined) scoreRules = checkScoreRules(body.scoreRules);
  if (!Object.keys(body).length) {
    authorize(deps.store, ctx, 'approve');
    const { state, venture } = readVenture(deps, ctx);
    return settingsView(pipelineSettings(state, venture.id), 'Your pipeline settings.');
  }
  return ventureAction(deps, ctx, 'approve', 'pipeline.settings', tx => {
    const stored = tx.list('venture-pipeline-settings')[0];
    const current = stored ?? DEFAULT_PIPELINE_SETTINGS;
    const next = {
      weekdays: weekdays ?? [...current.weekdays], sendTime: sendTime ?? current.sendTime, caps: { ...current.caps, ...(caps ?? {}) },
      scoreRules: scoreRules ?? current.scoreRules.map(rule => ({ ...rule })),
    };
    const record = stored
      ? tx.replace<PipelineSettingsRecord>({ ...stored, ...next })
      : tx.put<PipelineSettingsRecord>({ ...tx.base('venture-pipeline-settings'), ...next });
    announce(tx, record.id);
    return settingsView(record, 'Saved. Cards already following up keep the days they started with.');
  });
}
