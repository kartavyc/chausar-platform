// Chausar flagship playbooks: what an order for a flagship offer asks at intake (playbook wiring). An offer that cuts
// footage (every YouTube channel offer) refuses the order with RIGHTS_REQUIRED until the rights to the footage are
// recorded, and only the bases that offer accepts count: clips of another show need a licence or the creator's clip
// programme, with its reference (delivery/rights.ts). The other fields say what the checks need to know: long video
// or Shorts, any AI voice, AI presenter or paid promotion, and the finished cut on this computer for the finishing
// check. A social agency order also takes the client's own word lists (banned words and topics, competitors, phrases
// never flagged), and a content calendar order its calendar (month, channels, posts per channel, weekdays), which code
// plans into dated slots at once, so a month with too few posting days is refused here (social/calendar.ts). An
// offer from any other plan takes no intake at all.
import { check, type State } from '../../contracts.ts';
import { localPathProblem } from '../../local-paths.ts';
import type { IsoDate, IsoTime, OfferIntakeAsk, OrderIntake, VentureHostKind, VentureRecord } from '../contracts.ts';
import { RIGHTS_LABELS, recordRights, requireRights } from '../delivery/rights.ts';
import type { FlagshipOffer } from './plan.ts';
import { planCalendar, type CalendarInput } from './social/calendar.ts';
import { SOCIAL_OFFERS } from './social/playbook.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { kitIntakeAsk, kitOrderIntake } from './kit/intake.ts';

const KEYS = ['rights', 'format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile', 'calendar', 'clientRules'] as const;
/** The social offers whose orders post on a calendar code plans. */
const CALENDAR_OFFERS: readonly string[] = Object.freeze(['content-calendar']);
/** The social offers whose drafts hold no posts (the monthly report), so they ask no post disclosures. */
const NO_POST_OFFERS: readonly string[] = Object.freeze(['monthly-report']);
const POST_DISCLOSURES: readonly OfferIntakeAsk['fields'][number][] = Object.freeze(['aiVoice', 'aiPresenter', 'paidPromotion']);
const RULE_LISTS = ['bannedWords', 'bannedTopics', 'competitors', 'protectedPhrases'] as const;
const MAX_RULE_ITEMS = 50;
const MAX_RULE_CHARS = 80;

/**
 * The intake fields besides the rights that each flagship playbook's checks read (playbooks/draft-checks.ts): the
 * YouTube checks read the format, the AI and paid promotion disclosures and the cut; the social checks read the
 * disclosures, the client's word lists and, for a content calendar, its calendar. The CA firm's checks read none, so
 * its orders ask nothing.
 */
const FIELDS_READ: Readonly<Record<string, readonly OfferIntakeAsk['fields'][number][]>> = Object.freeze({
  [YOUTUBE_ID]: ['format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'],
  [SOCIAL_AGENCY_ID]: ['aiVoice', 'aiPresenter', 'paidPromotion', 'calendar', 'clientRules'],
});

/**
 * What an order for a flagship offer asks at intake, for the order form: the rights the offer accepts and the other
 * fields its playbook's checks read. The hosted server reads no file on the owner's computer, so it never asks for the
 * cut; only a content calendar asks for its calendar, and the monthly report, which holds no posts, asks no post
 * disclosures. Null when the order asks nothing.
 */
export function offerIntakeAsk(playbookId: string, offer: Pick<FlagshipOffer, 'rights' | 'intake'> & { key?: string }, host: VentureHostKind): OfferIntakeAsk | null {
  // Ink v2 wave 5 (5A1): a kit offer asks its own fields (playbooks/kit/intake.ts).
  if (offer.intake) return kitIntakeAsk({ rights: offer.rights, intake: offer.intake });
  const key = offer.key ?? '';
  const fields = (FIELDS_READ[playbookId] ?? []).filter(field => (field !== 'cutFile' || host !== 'hosted-web') && (field !== 'calendar' || CALENDAR_OFFERS.includes(key))
    && !(playbookId === SOCIAL_AGENCY_ID && NO_POST_OFFERS.includes(key) && POST_DISCLOSURES.includes(field)));
  return offer.rights.length || fields.length ? { rights: [...offer.rights], fields: [...fields] } : null;
}

/** A social agency offer, by its playbook offer id (the plan offer's key). */
const isSocialOffer = (key: string | undefined) => !!key && SOCIAL_OFFERS.some(offer => offer.id === key);

/**
 * A content calendar's month, channels, posts per channel and weekdays, planned at once so a calendar code can't fill
 * is refused now, in planCalendar's words, and so is one with a slot before today (the owner's local day): a post is
 * never planned for a day that has gone. Kept as sent; the slots are planned again from it wherever they are read.
 */
function calendarField(value: unknown, key: string | undefined, today: IsoDate): NonNullable<OrderIntake['calendar']> {
  check(CALENDAR_OFFERS.includes(key ?? ''), 'INVALID_VENTURE_REQUEST', 'This offer posts on no calendar, so it takes none.');
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the calendar as its month, channels, posts per channel and weekdays.');
  const body = value as Record<string, unknown>;
  const extra = Object.keys(body).filter(name => !['month', 'channels', 'postsPerChannel', 'weekdays'].includes(name));
  check(extra.length === 0, 'INVALID_VENTURE_REQUEST', `The calendar has no field called ${extra[0]}.`);
  const calendar = { month: body.month, channels: body.channels, postsPerChannel: body.postsPerChannel, weekdays: body.weekdays } as CalendarInput;
  check(typeof calendar.month === 'string', 'INVALID_VENTURE_REQUEST', 'Give the month like 2026-11.');
  const past = planCalendar(calendar).filter(slot => slot.date < today).sort((a, b) => (a.date < b.date ? -1 : 1));
  check(past.length === 0, 'INVALID_VENTURE_REQUEST',
    `The calendar for ${calendar.month} has posts on days before today, from ${past[0]?.date}. Pick a later month.`);
  return { month: calendar.month, channels: [...calendar.channels], postsPerChannel: calendar.postsPerChannel, weekdays: [...calendar.weekdays] };
}

/**
 * The client's own word lists for the social checks: each list optional (missing is empty), each entry plain words of
 * at most eighty characters, trimmed, kept once.
 */
function clientRulesField(value: unknown, key: string | undefined): NonNullable<OrderIntake['clientRules']> {
  check(isSocialOffer(key), 'INVALID_VENTURE_REQUEST', 'This offer reads no word lists from the client.');
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', "Send the client's word lists as named lists.");
  const body = value as Record<string, unknown>;
  const extra = Object.keys(body).filter(name => !(RULE_LISTS as readonly string[]).includes(name));
  check(extra.length === 0, 'INVALID_VENTURE_REQUEST', `The client's word lists have no list called ${extra[0]}.`);
  const list = (name: typeof RULE_LISTS[number]): string[] => {
    const raw = body[name] ?? [];
    check(Array.isArray(raw) && raw.length <= MAX_RULE_ITEMS, 'INVALID_VENTURE_REQUEST', `Send ${name} as a list of at most ${MAX_RULE_ITEMS} entries.`);
    const items = (raw as unknown[]).map(item => {
      const words = typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : '';
      check(words.length > 0 && words.length <= MAX_RULE_CHARS && !/[\u0000-\u001F\u007F]/.test(words), 'INVALID_VENTURE_REQUEST',
        `Each entry in ${name} is plain words of at most ${MAX_RULE_CHARS} characters.`);
      return words;
    });
    return [...new Set(items)];
  };
  return { bannedWords: list('bannedWords'), bannedTopics: list('bannedTopics'), competitors: list('competitors'), protectedPhrases: list('protectedPhrases') };
}
const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;

function flag(value: unknown, field: string): boolean {
  check(value === undefined || typeof value === 'boolean', 'INVALID_VENTURE_REQUEST', `Say yes or no to ${field}.`);
  return value === true;
}

/**
 * The finished cut, as a full path to a video file on this computer: never a network share (\\server or //server), and
 * on Windows a drive letter path (platform/runtime/speech.ts localPathProblem). The hosted server reads no file of yours.
 */
function cutFile(value: unknown, host: VentureHostKind): string | null {
  if (value === undefined || value === null) return null;
  check(host !== 'hosted-web', 'INVALID_VENTURE_REQUEST', "The hosted server can't read a file on your computer. Name the cut in the desktop app.");
  const problem = localPathProblem(value);
  check(!problem, 'INVALID_VENTURE_REQUEST', `The cut: ${problem}`);
  check(typeof value === 'string' && VIDEO.test(value), 'INVALID_VENTURE_REQUEST', 'Name the cut as a full path to an MP4, MOV, M4V, MKV or WEBM file on this computer.');
  return value as string;
}

/**
 * Checks an order's intake against its plan offer. offer: the flagship offer the order is (playbooks/plan.ts), or null
 * for an offer from any other plan, which takes no intake. Returns what to keep on the order, or null when nothing is
 * asked. Refuses with RIGHTS_REQUIRED when the offer cuts footage and the rights are missing, unreadable, of a kind the
 * offer does not accept, or ended.
 */
export function orderIntake(raw: unknown, offer: { key?: string; name: string; rights: FlagshipOffer['rights']; intake?: FlagshipOffer['intake'] } | null, meta: { by: string; at: IsoTime; today: IsoDate; host: VentureHostKind; state?: State; venture?: VentureRecord }): OrderIntake | null {
  if (!offer) {
    check(raw === undefined, 'INVALID_VENTURE_REQUEST', 'This offer takes no intake.');
    return null;
  }
  // Ink v2 wave 5 (5A1): a kit offer keeps its own fields under intake.fields (playbooks/kit/intake.ts).
  if (offer.intake) return kitOrderIntake(raw, { ...offer, intake: offer.intake }, meta);
  check(raw === undefined || (raw !== null && typeof raw === 'object' && !Array.isArray(raw)), 'INVALID_VENTURE_REQUEST', 'Send the intake as named fields.');
  const body = (raw ?? {}) as Record<string, unknown>;
  const extra = Object.keys(body).filter(key => !(KEYS as readonly string[]).includes(key));
  check(extra.length === 0, 'INVALID_VENTURE_REQUEST', `The intake has no field called ${extra[0]}.`);
  const cuts = offer.rights.length > 0;
  if (!cuts) check(body.rights === undefined || body.rights === null, 'INVALID_VENTURE_REQUEST', 'This offer cuts no footage, so it records no rights.');
  let rights = null;
  if (cuts) {
    rights = recordRights(body.rights, { by: meta.by, at: meta.at });
    const wanted = offer.rights.map(basis => RIGHTS_LABELS[basis].toLowerCase()).join(' or ');
    check(offer.rights.includes(rights.basis), 'RIGHTS_REQUIRED', `${offer.name} needs ${wanted}, recorded at intake.`);
    requireRights({ id: 'intake', clipping: true }, { rights }, meta.today);
  }
  check(body.format === undefined || body.format === 'long' || body.format === 'short', 'INVALID_VENTURE_REQUEST', 'Choose a long video or Shorts.');
  const intake: OrderIntake = {
    rights,
    format: body.format === 'short' ? 'short' : 'long',
    aiVoice: flag(body.aiVoice, 'an AI voice'),
    aiPresenter: flag(body.aiPresenter, 'an AI presenter'),
    paidPromotion: flag(body.paidPromotion, 'paid promotion'),
    cutFile: cutFile(body.cutFile, meta.host),
    ...(body.calendar === undefined || body.calendar === null ? {} : { calendar: calendarField(body.calendar, offer.key, meta.today) }),
    ...(body.clientRules === undefined || body.clientRules === null ? {} : { clientRules: clientRulesField(body.clientRules, offer.key) }),
  };
  // An offer that cuts no footage and was sent nothing keeps no intake.
  return !cuts && raw === undefined ? null : intake;
}
