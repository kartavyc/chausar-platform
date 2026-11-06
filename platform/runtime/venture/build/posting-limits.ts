// Owner-approved posting settings, per channel. An empty set restores the defaults.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { OwnerPostingLimitsView, PostingLimitsRecord, PostingLimitsView, VentureDeps } from '../contracts.ts';
import { exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { HOUSE_LIMITS, MIN_LINK_STREAK, OWNER_LIMIT_KEYS, gateUnits, ownerUnits, effectivePostingLimits } from '../playbooks/social/post-limits.ts';
import { ownerPostingLimits, postingName } from './posting.ts';

/** Text channels with owner limits: manual LinkedIn, browser X and the four supported official APIs. */
const LIMIT_CHANNELS: readonly string[] = Object.freeze(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram', 'discord']);
const LINE = 'You set the limits. WhatsApp, Gmail and X can ban accounts that send too fast. Every send still needs your approval. Posts across businesses on this computer count.';
const WORDS: Readonly<Record<keyof OwnerPostingLimitsView, string>> = Object.freeze({
  capPer24h: 'posts in 24 hours', minGapMinutes: 'minutes between posts', warmUpDays: 'warm-up days',
  duplicatePercent: 'near-duplicate percent', linkStreak: 'posts in a row linking one site',
});

function view(state: State): PostingLimitsView {
  const house = ownerUnits(HOUSE_LIMITS);
  return {
    channels: LIMIT_CHANNELS.map(connectorId => {
      const owner = ownerPostingLimits(state, connectorId);
      return { connectorId, name: postingName(connectorId), house: { ...house }, owner: { ...owner }, inUse: ownerUnits(effectivePostingLimits(gateUnits(owner))) };
    }),
    line: LINE,
  };
}

/** venture.posting.limits.get {} (read): per channel, Chausar's own limits, the owner's settings and those in use. */
export async function postingLimitsGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PostingLimitsView> {
  exactPayload(payload ?? {}, []);
  const { state } = readVenture(deps, ctx);
  return view(state);
}

/** Save owner-approved, whole-number settings. Percentages stay within their natural range. */
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
    const least = key === 'linkStreak' ? MIN_LINK_STREAK : key === 'minGapMinutes' || key === 'warmUpDays' ? 0 : 1;
    check(typeof value === 'number' && Number.isSafeInteger(value) && value >= least && (key !== 'duplicatePercent' || value <= 100), 'INVALID_VENTURE_REQUEST', `The ${WORDS[key]} must be a whole number from ${least}.`);
    limits[key] = value;
  }
  authorize(deps.store, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'posting.limits.set', tx => {
    tx.put<PostingLimitsRecord>({ ...tx.base('venture-posting-limits'), connectorId, limits });
    return view(tx.state);
  });
}
