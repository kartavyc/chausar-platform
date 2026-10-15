/**
 * Adapter for the hosted-link lane's desktop methods behind TL-09 Phone, as written in
 * `platform/runtime/hosted-link/service.ts` and docs/lanes/hosted-link.md: `hosted.status`,
 * `hosted.pair.start` and `hosted.pair.finish` (your phone number, verified by a code),
 * `phone.channels.list` and `phone.channels.set` (each channel's switch, with the ticked
 * opt-in), `phone.templates.preview` (the exact text of every message) and
 * `phone.messages.counts` (this month against thirty, and the cost). Every reply is checked
 * into this screen's view types; every engine-written text is data shown as text.
 */
import { ShapeError, bool, digits, int, list, oneOf, optStr, rec, str, strings } from '../../trust/kit/validate.ts';
import { id, optWhen, when } from '../validate.ts';

export const PHONE = {
  status: 'hosted.status', pairStart: 'hosted.pair.start', pairFinish: 'hosted.pair.finish',
  channels: 'phone.channels.list', set: 'phone.channels.set', preview: 'phone.templates.preview', counts: 'phone.messages.counts',
  verify: 'phone.verify',
} as const;
/** The monthly message budget the design fixes. */
export const MESSAGE_BUDGET = 30;
/** The phone number hosted-link pairs: an Indian mobile number starting with +91. */
export const PHONE_NUMBER = /^\+91[6-9]\d{9}$/;
export const PAIR_CODE = /^[0-9]{4,8}$/;

export const CHANNEL_IDS = ['whatsapp', 'telegram', 'mail'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface Status {
  readonly configured: boolean; readonly paired: boolean; readonly demo: boolean;
  readonly phoneMasked: string | null; readonly pairedAt: string | null;
}
export function status(value: unknown): Status {
  const r = rec(value);
  const pairing = r['pairing'] === null || r['pairing'] === undefined ? null : rec(r['pairing'], 'reply.pairing');
  const paired = bool(r['paired'], 'reply.paired');
  if (paired !== (pairing !== null)) throw new ShapeError('reply.pairing');
  return {
    configured: bool(r['configured'], 'reply.configured'), paired, demo: bool(r['demo'], 'reply.demo'),
    phoneMasked: pairing === null ? null : str(pairing['phoneMasked'], 'reply.pairing.phoneMasked', 40),
    pairedAt: pairing === null ? null : when(pairing['pairedAt'], 'reply.pairing.pairedAt'),
  };
}

export type RelayStatus = 'off' | 'awaiting-start' | 'on' | 'stopped' | 'not-configured';
export interface Channel {
  readonly id: ChannelId; readonly on: boolean; readonly agreedAt: string | null;
  readonly relay: { readonly status: RelayStatus; readonly agreedAt: string | null; readonly address: string | null; readonly connectUrl: string | null } | null;
}
export interface Channels { readonly stale: boolean; readonly refreshedAt: string | null; readonly channels: readonly Channel[] }
export function channels(value: unknown): Channels {
  const r = rec(value);
  return {
    stale: bool(r['stale'], 'reply.stale'), refreshedAt: optWhen(r['refreshedAt'], 'reply.refreshedAt'),
    channels: list(r['channels'], 'reply.channels', (v, p) => {
      const c = rec(v, p), desktop = rec(c['desktop'], `${p}.desktop`);
      const relay = c['relay'] === null || c['relay'] === undefined ? null : rec(c['relay'], `${p}.relay`);
      return {
        id: oneOf(c['channel'], `${p}.channel`, CHANNEL_IDS), on: bool(desktop['enabled'], `${p}.desktop.enabled`), agreedAt: optWhen(desktop['optInAt'], `${p}.desktop.optInAt`),
        relay: relay === null ? null : {
          status: oneOf(relay['status'], `${p}.relay.status`, ['off', 'awaiting-start', 'on', 'stopped', 'not-configured'] as const),
          agreedAt: optWhen(relay['optInAt'], `${p}.relay.optInAt`), address: optStr(relay['address'], `${p}.relay.address`, 320),
          connectUrl: optStr(relay['connectUrl'], `${p}.relay.connectUrl`, 500),
        },
      };
    }, 3),
  };
}

export interface Message { readonly event: string; readonly headline: string; readonly body: string; readonly buttons: readonly string[] }
export interface Preview {
  readonly channels: readonly { readonly id: ChannelId; readonly optInText: string; readonly messages: readonly Message[]; readonly footer: string | null }[];
  readonly approvalNote: string; readonly replies: readonly { readonly id: string; readonly text: string }[];
}
export function preview(value: unknown): Preview {
  const r = rec(value), replies = rec(r['replies'], 'reply.replies');
  return {
    channels: list(r['channels'], 'reply.channels', (v, p) => {
      const c = rec(v, p);
      return {
        id: oneOf(c['channel'], `${p}.channel`, CHANNEL_IDS), optInText: str(c['optInText'], `${p}.optInText`, 1000),
        messages: list(c['messages'], `${p}.messages`, (m, q) => {
          const x = rec(m, q);
          return { event: id(x['event'], `${q}.event`), headline: str(x['headline'], `${q}.headline`, 300), body: str(x['body'], `${q}.body`, 2000), buttons: strings(x['buttons'], `${q}.buttons`, 5) };
        }, 20),
        footer: optStr(c['footer'], `${p}.footer`, 1000),
      };
    }, 3),
    approvalNote: str(r['approvalButtonsNote'], 'reply.approvalButtonsNote', 1000),
    replies: Object.keys(replies).slice(0, 20).map((k) => ({ id: k, text: str(replies[k], `reply.replies.${k}`, 1000) })),
  };
}

export interface Counts {
  readonly month: string; readonly sent: number; readonly budget: number; readonly costPaise: string | null;
  /** Per channel: messages this month, and, when the engine gives them, that channel's cost and its
   *  price per message in whole paise (`undefined`: the engine does not give it; `null`: unknown). */
  readonly byChannel: readonly { readonly id: ChannelId; readonly sent: number; readonly costPaise?: string | null; readonly perMessagePaise?: string | null }[];
}
/** An optional per-channel paise map: absent, or each named channel a digit string or null. */
function paiseByChannel(value: unknown, path: string): Partial<Record<ChannelId, string | null>> | undefined {
  if (value === undefined) return undefined;
  const r = rec(value, path), out: Partial<Record<ChannelId, string | null>> = {};
  for (const k of Object.keys(r)) {
    const c = oneOf(k, `${path}.${k}`, CHANNEL_IDS);
    out[c] = r[k] === null ? null : digits(r[k], `${path}.${k}`, false);
  }
  return out;
}
export function counts(value: unknown): Counts {
  const r = rec(value), by = rec(r['byChannel'], 'reply.byChannel');
  const sent = int(r['sent'], 'reply.sent'), budget = int(r['budget'], 'reply.budget');
  if (sent < 0 || budget !== MESSAGE_BUDGET) throw new ShapeError('reply.budget');
  const known = oneOf(r['costState'], 'reply.costState', ['known', 'unknown'] as const);
  const costPaise = known === 'known' ? digits(r['costPaise'], 'reply.costPaise', false) : null;
  if (known === 'unknown' && r['costPaise'] !== null) throw new ShapeError('reply.costPaise');
  const month = str(r['month'], 'reply.month', 7);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new ShapeError('reply.month');
  const cost = paiseByChannel(r['costByChannel'], 'reply.costByChannel'), price = paiseByChannel(r['perMessagePaise'], 'reply.perMessagePaise');
  return {
    month, sent, budget, costPaise,
    byChannel: CHANNEL_IDS.filter((c) => by[c] !== undefined).map((c) => {
      const n = int(by[c], `reply.byChannel.${c}`);
      if (n < 0) throw new ShapeError(`reply.byChannel.${c}`);
      return { id: c, sent: n, ...(cost === undefined ? {} : { costPaise: cost[c] ?? null }), ...(price === undefined ? {} : { perMessagePaise: price[c] ?? null }) };
    }),
  };
}

export interface PairStarted { readonly challengeId: string; readonly expiresAt: string; readonly phoneMasked: string }
export function pairStarted(value: unknown): PairStarted {
  const r = rec(value);
  return { challengeId: id(r['challengeId'], 'reply.challengeId'), expiresAt: when(r['expiresAt'], 'reply.expiresAt'), phoneMasked: str(r['phoneMasked'], 'reply.phoneMasked', 40) };
}
export function paired(value: unknown): { readonly paired: true } {
  if (rec(value)['paired'] !== true) throw new ShapeError('reply.paired');
  return { paired: true };
}

// ---- TL tools: is a channel's address verified (`phone.verify`) ----

/** Refusals that mean the hosted relay is absent, unconfigured or unpaired: shown as the relay sentence. */
export const RELAY_ABSENT: ReadonlySet<string> = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE', 'DEMO_EXTERNAL_DISABLED', 'HOSTED_NOT_CONFIGURED', 'HOSTED_NOT_PAIRED']);
export function relayCode(code: string): string { return RELAY_ABSENT.has(code) ? 'RELAY_NOT_AVAILABLE' : code; }
export const VERIFIABLE = ['mail', 'whatsapp'] as const;
export function verified(value: unknown): { readonly verified: boolean } {
  const r = rec(value);
  if (Object.keys(r).some((k) => k !== 'verified')) throw new ShapeError('reply');
  return { verified: bool(r['verified'], 'reply.verified') };
}
