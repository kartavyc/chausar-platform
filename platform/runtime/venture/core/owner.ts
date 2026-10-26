// Chausar venture launcher, core (Ink v2 wave 4, package 4J9): the owner profile. Two things only, kept in one
// venture-owner-profile record per business: the owner's first name, used for Today's greeting and nothing else, and
// the services the business does not sell (C21), which the outreach check (4E2) reads so a draft never offers them.
// Minimum data: no surname, no contact details, and the owner can take the name back (firstName null). Setting it is an
// owner approval inside the app; reading it is not.
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import type { OwnerProfileRecord, OwnerView, VentureDeps, VentureRecord } from '../contracts.ts';

/**
 * A first name of 1 to 40 characters, once the curly apostrophe is made straight: it starts with a letter in any script;
 * then letters, their marks, spaces, dots and hyphens; an apostrophe only between two letters (D'Souza); a zero-width
 * non-joiner or joiner only right after a letter or a mark (a Malayalam chillu, a Persian or Urdu ZWNJ).
 */
const FIRST_NAME = /^\p{L}(?:[\p{L}\p{M} .-]|(?<=[\p{L}\p{M}])'(?=\p{L})|(?<=[\p{L}\p{M}])[\u{200C}\u{200D}])*$/u;
const CURLY_APOSTROPHE = /\u{2019}/gu;
const NAME_MAX = 40;
const SERVICES_MAX = 20;
const SERVICE_MAX = 80;
const NAME_RULE = 'Your first name can have 1 to 40 letters, with spaces, dots, hyphens or apostrophes between letters, and nothing else.';
/**
 * Forget's backups line, word for word (BACKUPS_LINE in network/forget.ts; venture-owner.test.ts pins the two equal).
 * Core keeps its own copy rather than importing the network package, so a fault there never stops core loading.
 */
export const BACKUPS_LINE = 'Backups made before now still hold this person until those backups are deleted.';

/** The profile's two fields for a business, empty when the owner has set nothing. */
export function ownerProfileOf(state: State, ventureId: string): Pick<OwnerProfileRecord, 'firstName' | 'excludedServices'> {
  const record = listRecords(state, 'venture-owner-profile', ventureId).at(-1);
  return { firstName: record?.firstName ?? null, excludedServices: [...(record?.excludedServices ?? [])] };
}

/** The services the owner said the business does not sell, in the owner's order (read by 4E2's outreach check). */
export function excludedServicesOf(state: State, ventureId: string): string[] {
  return ownerProfileOf(state, ventureId).excludedServices;
}

function view(state: State, venture: VentureRecord): OwnerView {
  return { ...ownerProfileOf(state, venture.id), businessName: venture.workingName };
}

/** The owner's first name, trimmed, runs of spaces made one and curly apostrophes straight, or OWNER_NAME_INVALID. */
export function firstNameOf(value: unknown): string {
  check(typeof value === 'string', 'OWNER_NAME_INVALID', NAME_RULE);
  const name = value.trim().replace(CURLY_APOSTROPHE, "'").replace(/ {2,}/g, ' ');
  check([...name].length >= 1 && [...name].length <= NAME_MAX && FIRST_NAME.test(name), 'OWNER_NAME_INVALID', NAME_RULE);
  return name;
}

/** At most 20 one-line services of 1 to 80 characters each, trimmed; a repeat (any case) is kept once, first spelling. */
export function excludedServicesList(value: unknown): string[] {
  check(Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the services you do not sell as a list.');
  check(value.length <= SERVICES_MAX, 'INVALID_VENTURE_REQUEST', `List at most ${SERVICES_MAX} services you do not sell.`);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const service = singleLine(item, 'Each service you do not sell', { min: 1, max: SERVICE_MAX });
    const key = service.toLocaleLowerCase('en');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(service);
  }
  return kept;
}

/** venture.owner.get {} (level read): the first name, the services the business does not sell, and the business name. */
export async function ownerGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OwnerView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return view(state, venture);
}

/**
 * venture.owner.set { firstName?, excludedServices? } (level approve, app only): changes only the fields sent, at least
 * one. firstName null takes the name back. The profile is one record per business, replaced, so no old name is kept;
 * when a stored name goes, the answer carries Forget's backups line (kept), as earlier backups still hold it.
 */
export async function ownerSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OwnerView> {
  requireAppChannel(ctx, 'venture.owner.set');
  const body = exactPayload(payload, ['firstName', 'excludedServices']);
  check(Object.keys(body).length > 0, 'INVALID_VENTURE_REQUEST', 'Send your first name, the services you do not sell, or both.');
  const firstName = Object.hasOwn(body, 'firstName') ? (body.firstName === null ? null : firstNameOf(body.firstName)) : undefined;
  const excludedServices = Object.hasOwn(body, 'excludedServices') ? excludedServicesList(body.excludedServices) : undefined;
  return ventureAction(deps, ctx, 'approve', 'owner.set', tx => {
    const venture = tx.venture as VentureRecord;
    const current = tx.list('venture-owner-profile').at(-1);
    const next: OwnerProfileRecord = {
      ...(current ?? tx.base('venture-owner-profile')),
      memberId: tx.ctx.memberId, epoch: tx.ctx.epoch, at: tx.now,
      firstName: firstName === undefined ? current?.firstName ?? null : firstName,
      excludedServices: excludedServices ?? current?.excludedServices ?? [],
    };
    if (current) tx.replace(next); else tx.put(next);
    const removed = firstName === null && current?.firstName != null;
    return removed ? { ...view(tx.state, venture), kept: [BACKUPS_LINE] } : view(tx.state, venture);
  });
}
