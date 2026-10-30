// Chausar venture launcher: the owner's own posting limits per channel (Ink v2 wave 2, 2B1, catalogue K5).
// Chausar's house limits (playbooks/social/post-limits.ts) are the loosest it ever posts at; the founder decided on
// 23 October 2026 that the owner may only tighten them. venture.posting.limits.set (inside the app) stores the
// owner's stricter numbers for one channel as a record and refuses a looser one (POSTING_LIMIT_LOOSER); an empty set
// goes back to the house limits. The risk gate (build/posting.ts) reads the newest record per channel.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { OwnerPostingLimitsView, PostingLimitsRecord, PostingLimitsView, VentureDeps } from '../contracts.ts';
import { exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { HOUSE_LIMITS, MIN_LINK_STREAK, OWNER_LIMIT_KEYS, gateUnits, looserKeys, ownerUnits, tightenedLimits } from '../playbooks/social/post-limits.ts';
import { ownerPostingLimits, postingName } from './posting.ts';

/** Text channels with owner limits: manual LinkedIn, browser X and the four supported official APIs. */
const LIMIT_CHANNELS: readonly string[] = Object.freeze(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram', 'discord']);
const LINE = "Chausar's own posting limits are the loosest it posts at. You can only make them stricter, per channel, for this business; posts from every business on this computer count toward them.";
const WORDS: Readonly<Record<keyof OwnerPostingLimitsView, string>> = Object.freeze({
  capPer24h: 'posts in 24 hours', minGapMinutes: 'minutes between posts', warmUpDays: 'warm-up days',
  duplicatePercent: 'near-duplicate percent', linkStreak: 'posts in a row linking one site',
});

function view(state: State): PostingLimitsView {
  const house = ownerUnits(HOUSE_LIMITS);
  return {
    channels: LIMIT_CHANNELS.map(connectorId => {
      const owner = ownerPostingLimits(state, connectorId);
      return { connectorId, name: postingName(connectorId), house: { ...house }, owner: { ...owner }, inUse: ownerUnits(tightenedLimits(gateUnits(owner))) };
    }),
    line: LINE,
  };
}

/** venture.posting.limits.get {} (read): per channel, Chausar's own limits, the owner's stricter ones and those in use. */
export async function postingLimitsGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PostingLimitsView> {
  exactPayload(payload ?? {}, []);
  const { state } = readVenture(deps, ctx);
  return view(state);
}

/**
 * venture.posting.limits.set { connectorId, limits } (approve, inside the app): the owner's stricter numbers for one
 * channel, each a whole number of at least one (the percent at most 100). A number looser than Chausar's own is
 * refused with POSTING_LIMIT_LOOSER, naming it; a number left out is Chausar's own.
 */
export async function postingLimitsSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PostingLimitsView> {
  requireAppChannel(ctx, 'venture.posting.limits.set');
  const body = exactPayload(payload, ['connectorId', 'limits'], ['connectorId', 'limits']);
  const connectorId = typeof body.connectorId === 'string' && LIMIT_CHANNELS.includes(body.connectorId) ? body.connectorId : null;
  check(connectorId, 'INVALID_VENTURE_REQUEST', `Posting limits are set for ${LIMIT_CHANNELS.map(postingName).join(', ')}.`);
  check(body.limits !== null && typeof body.limits === 'object' && !Array.isArray(body.limits), 'INVALID_VENTURE_REQUEST', 'Send the limits as numbers.');
  const given = exactPayload(body.limits, OWNER_LIMIT_KEYS);
  const limits: Partial<OwnerPostingLimitsView> = {};
  for (const key of OWNER_LIMIT_KEYS) {
    const value = given[key];
    if (value === undefined) continue;
    const least = key === 'linkStreak' ? MIN_LINK_STREAK : 1;
    check(typeof value === 'number' && Number.isInteger(value) && value >= least && value <= (key === 'duplicatePercent' ? 100 : 10_000), 'INVALID_VENTURE_REQUEST', `The ${WORDS[key]} must be a whole number from ${least}.`);
    limits[key] = value;
  }
  const looser = looserKeys(limits);
  check(looser.length === 0, 'POSTING_LIMIT_LOOSER', `These are looser than Chausar's own limits: ${looser.map(key => WORDS[key]).join(', ')}. ${LINE}`);
  authorize(deps.store, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'posting.limits.set', tx => {
    tx.put<PostingLimitsRecord>({ ...tx.base('venture-posting-limits'), connectorId, limits });
    return view(tx.state);
  });
}
