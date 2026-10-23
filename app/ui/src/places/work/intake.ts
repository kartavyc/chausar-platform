/**
 * What a new order says at intake, for an offer from a flagship playbook (BlueprintViewLite.intake, worked out by the
 * engine in platform/runtime/venture/playbooks/intake.ts). An offer that cuts footage is refused with RIGHTS_REQUIRED
 * unless the order says whose footage it is, on a basis the offer accepts; a licence or a clip programme also needs
 * its reference. The other fields are what the playbook's checks read. A social content calendar also asks for its
 * calendar (the month, channels, posts per channel and weekdays the engine plans dated slots from) and every social
 * offer for the client's own word lists. Pure helpers; the sheet keeps the state.
 */
import type { EngineMethods, OfferIntakeLite, RightsBasisLite } from '../../engine/types';

/** The channels a content calendar can post on, in the order the sheet lists them (the engine's SOCIAL_CHANNELS). */
export const CALENDAR_CHANNELS = ['linkedin', 'instagram', 'x', 'facebook', 'threads', 'tiktok', 'youtube-shorts'] as const;
/** ISO weekdays, Monday (1) to Sunday (7). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** The client's word lists, each typed as one line with commas between the entries. */
export const RULE_LISTS = ['bannedWords', 'bannedTopics', 'competitors', 'protectedPhrases'] as const;
export type RuleList = (typeof RULE_LISTS)[number];

export interface IntakeDraft {
  basis: RightsBasisLite | ''; holder: string; reference: string;
  format: 'long' | 'short'; aiVoice: boolean; aiPresenter: boolean; paidPromotion: boolean; cutFile: string;
  /** The calendar: no calendar is sent while the month is empty. */
  month: string; channels: string[]; postsPerChannel: string; weekdays: number[];
  /** The client's word lists as typed, commas between entries. */
  rules: Record<RuleList, string>;
}
export const EMPTY_INTAKE: IntakeDraft = {
  basis: '', holder: '', reference: '', format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: '',
  month: '', channels: [], postsPerChannel: '', weekdays: [], rules: { bannedWords: '', bannedTopics: '', competitors: '', protectedPhrases: '' },
};

/** One typed list as entries: split on commas and new lines, trimmed, empty ones dropped. */
export function ruleEntries(typed: string): string[] {
  return typed.split(/[,\n]/).map((entry) => entry.trim()).filter((entry) => entry !== '');
}

type IntakeParams = NonNullable<EngineMethods['venture.order.create']['params']['intake']>;

/** The basis in use: the one chosen when this offer accepts it, else the only one the offer accepts, else none yet. */
export function basisFor(ask: OfferIntakeLite, draft: IntakeDraft): RightsBasisLite | '' {
  if (draft.basis !== '' && ask.rights.includes(draft.basis)) return draft.basis;
  return ask.rights.length === 1 ? ask.rights[0]! : '';
}

/** Whether the rights are complete enough to send: a basis the offer accepts, who owns the footage, and any reference. */
export function intakeReady(ask: OfferIntakeLite | null, draft: IntakeDraft): boolean {
  if (!ask || ask.rights.length === 0) return true;
  const basis = basisFor(ask, draft);
  return basis !== '' && draft.holder.trim() !== '' && (basis === 'own-footage' || draft.reference.trim() !== '');
}

/** The intake to send with the order: only the fields this offer asks for; nothing for an offer that asks nothing. */
export function intakeParams(ask: OfferIntakeLite | null, draft: IntakeDraft): IntakeParams | undefined {
  if (!ask) return undefined;
  const out: IntakeParams = {};
  const basis = basisFor(ask, draft);
  if (ask.rights.length > 0 && basis !== '') {
    out.rights = { basis, holder: draft.holder.trim(), ...(basis === 'own-footage' ? {} : { reference: draft.reference.trim() }) };
  }
  if (ask.fields.includes('format')) out.format = draft.format;
  if (ask.fields.includes('aiVoice')) out.aiVoice = draft.aiVoice;
  if (ask.fields.includes('aiPresenter')) out.aiPresenter = draft.aiPresenter;
  if (ask.fields.includes('paidPromotion')) out.paidPromotion = draft.paidPromotion;
  if (ask.fields.includes('cutFile') && draft.cutFile.trim() !== '') out.cutFile = draft.cutFile.trim();
  // The engine plans the slots and refuses a calendar it can't fill, in its own words; a whole number is sent as typed.
  if (ask.fields.includes('calendar') && draft.month.trim() !== '') {
    const posts = draft.postsPerChannel.trim();
    out.calendar = {
      month: draft.month.trim(),
      channels: CALENDAR_CHANNELS.filter((channel) => draft.channels.includes(channel)),
      postsPerChannel: /^\d{1,3}$/.test(posts) ? Number(posts) : 0,
      weekdays: [...draft.weekdays].sort((a, b) => a - b),
    };
  }
  if (ask.fields.includes('clientRules')) {
    const lists = Object.fromEntries(RULE_LISTS.map((list) => [list, ruleEntries(draft.rules[list])])) as Record<RuleList, string[]>;
    if (RULE_LISTS.some((list) => lists[list].length > 0)) out.clientRules = lists;
  }
  return out;
}
