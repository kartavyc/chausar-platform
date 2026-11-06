// Chausar flagship playbook, social media agency: Chausar's own posting limits (catalogue K5, Ink v2 wave 2 2B1).
// No platform publishes these numbers. They are house rules in the register's PlatformRule shape, so every number the
// risk gate (risk-gate.ts) uses has a rule id, a checked date and words the owner can read, and they say plainly that
// they are Chausar's choice, not a platform's. The founder accepted them on 23 October 2026 as labelled defaults the
// owner may change in either direction through venture.posting.limits.set.
//
// Idea taken, code written here: yominpost (MIT), whose platform_risk.py holds a daily cap, a minimum gap, a warm-up
// for a new channel, a near-duplicate check against recent posts and a same-domain link streak before it posts.
// No runtime import of register.ts: the register lists these rules too (one line there), so this file must load first.
import type { IsoDate } from '../../contracts.ts';
import type { PlatformRule } from './register.ts';

/** A house rule with the two fields every dated rule carries from wave 2: the steps that use it, and what it cannot see. */
export type HouseRule = PlatformRule & { usedBy: string[]; limitations: string[] };

const CHECKED: IsoDate = '2026-10-23';
const HOW = "Chausar's posting defaults, set on 23 October 2026. No platform publishes a number like this.";
const ONLY_CHAUSAR = 'Counts only the posts Chausar made from this computer, for any business here; posts made by hand or from another tool are not seen.';
const FINGERPRINTS = "Other businesses' posts are compared by short unsalted fingerprints of their word groups and linked sites, kept beside the browser profiles, not by the words.";

const house = (rule: Pick<HouseRule, 'id' | 'topic' | 'value' | 'rule'> & { limitations?: string[] }): HouseRule => ({
  ...rule, needs: null, scope: 'all', sources: [], checkedOn: CHECKED, read: 'house', how: HOW, note: null, usedBy: ['publish'],
  limitations: [ONLY_CHAUSAR, ...(rule.limitations ?? [])],
});

export const HOUSE_POSTING_RULES: readonly HouseRule[] = Object.freeze([
  house({
    id: 'house-post-cap-24h', topic: 'limit', value: 3,
    rule: "By default, Chausar posts up to 3 times on one channel in 24 hours. This is Chausar's default, not a platform rule.",
  }),
  house({
    id: 'house-post-min-gap', topic: 'limit', value: 60,
    rule: "By default, Chausar waits 60 minutes between posts on one channel. This is Chausar's default, not a platform rule.",
  }),
  house({
    id: 'house-warm-up', topic: 'limit', value: 7,
    rule: "By default, Chausar posts once a day for its first 7 days on a channel. This is Chausar's default, not a platform rule.",
    limitations: ['Chausar cannot tell how old the account is; it counts from its own first post on the channel.'],
  }),
  house({
    id: 'house-near-duplicate', topic: 'conduct', value: 850,
    rule: "By default, posts 85% like a recent post are held: three-word groups compared in whole thousandths. This is Chausar's default, not a platform rule.",
    limitations: ['Compares the words only, not pictures or video.', 'Short posts are compared poorly: a post under three words is one word group.', FINGERPRINTS],
  }),
  house({
    id: 'house-near-duplicate-warn', topic: 'conduct', value: 600,
    rule: "A post that is 60% or more the same as a recent post on its channel goes ahead with a warning. This is Chausar's default, not a platform rule.",
    limitations: ['Compares the words only, not pictures or video.', 'Short posts are compared poorly: a post under three words is one word group.', FINGERPRINTS],
  }),
  house({
    id: 'house-near-duplicate-window', topic: 'conduct', value: 5,
    rule: "Chausar compares a post with the last 5 posts on its channel. This is Chausar's default, not a platform rule.",
  }),
  house({
    id: 'house-link-streak', topic: 'conduct', value: 3,
    rule: "By default, a third post linking the same website gets a warning. This is Chausar's default, not a platform rule.",
    limitations: ['Reads web addresses written in the text only.', FINGERPRINTS],
  }),
] satisfies HouseRule[]);

/** The numbers the risk gate uses. Permille: thousandths, so 850 is 85%. */
export type PostingLimits = {
  capPer24h: number; minGapMinutes: number; warmUpDays: number;
  duplicateBlockPermille: number; duplicateWarnPermille: number; duplicateWindow: number; linkStreak: number;
};

/** One house rule's number, by id. A missing rule or number is a bug in this file, so it stops loading. */
function valueOf(id: string): number {
  const value = HOUSE_POSTING_RULES.find(item => item.id === id)?.value;
  if (typeof value !== 'number') throw new Error(`The house posting rule ${id} has no number.`);
  return value;
}

/** Chausar's own limits, each read from its house rule. */
export const HOUSE_LIMITS: Readonly<PostingLimits> = Object.freeze({
  capPer24h: valueOf('house-post-cap-24h'), minGapMinutes: valueOf('house-post-min-gap'), warmUpDays: valueOf('house-warm-up'),
  duplicateBlockPermille: valueOf('house-near-duplicate'), duplicateWarnPermille: valueOf('house-near-duplicate-warn'),
  duplicateWindow: valueOf('house-near-duplicate-window'), linkStreak: valueOf('house-link-streak'),
});

/** A streak of one would warn on every post that links anywhere, so the streak never goes below two. */
export const MIN_LINK_STREAK = 2;

/** Apply valid owner settings over the defaults. Zero disables the gap or warm-up. */
export function effectivePostingLimits(owner: Partial<PostingLimits>, base: Readonly<PostingLimits> = HOUSE_LIMITS): PostingLimits {
  const out: PostingLimits = { ...base };
  for (const key of Object.keys(base) as (keyof PostingLimits)[]) {
    const value = owner[key];
    const least = key === 'minGapMinutes' || key === 'warmUpDays' ? 0 : 1;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < least) continue;
    if (key === 'linkStreak' && value < MIN_LINK_STREAK) continue; // one link would warn on every post
    if ((key === 'duplicateBlockPermille' || key === 'duplicateWarnPermille') && value > 1000) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The five numbers the owner may change for a channel (venture.posting.limits.set), in the owner's own units: posts in
 * 24 hours, minutes between posts, warm-up days, the near-duplicate threshold in whole percent, and the link streak.
 */
export type OwnerPostingLimits = { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number };
export const OWNER_LIMIT_KEYS: readonly (keyof OwnerPostingLimits)[] = Object.freeze(['capPer24h', 'minGapMinutes', 'warmUpDays', 'duplicatePercent', 'linkStreak']);

/** The gate's limits in the owner's units. */
export function ownerUnits(limits: Readonly<PostingLimits>): OwnerPostingLimits {
  return {
    capPer24h: limits.capPer24h, minGapMinutes: limits.minGapMinutes, warmUpDays: limits.warmUpDays,
    duplicatePercent: Math.floor(limits.duplicateBlockPermille / 10), linkStreak: limits.linkStreak,
  };
}

/** The owner's numbers in the gate's units: a percent becomes thousandths. */
export function gateUnits(owner: Partial<OwnerPostingLimits>): Partial<PostingLimits> {
  const out: Partial<PostingLimits> = {};
  if (owner.capPer24h !== undefined) out.capPer24h = owner.capPer24h;
  if (owner.minGapMinutes !== undefined) out.minGapMinutes = owner.minGapMinutes;
  if (owner.warmUpDays !== undefined) out.warmUpDays = owner.warmUpDays;
  if (owner.duplicatePercent !== undefined) out.duplicateBlockPermille = owner.duplicatePercent * 10;
  if (owner.linkStreak !== undefined) out.linkStreak = owner.linkStreak;
  return out;
}
