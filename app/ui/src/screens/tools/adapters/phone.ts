/**
 * Adapter for the hosted-link lane's `phone.*` channel methods, which may not exist yet.
 * The shapes are this screen's assumption; the coordinator adapts them here at merge.
 */
import { ShapeError, bool, digits, int, list, oneOf, optStr, rec, str } from '../../trust/kit/validate.ts';
import { id, optWhen } from '../validate.ts';

export const PHONE = { channels: 'phone.channels', preview: 'phone.preview', usage: 'phone.usage', optIn: 'phone.optIn', verify: 'phone.verify' } as const;
/** The monthly message budget the design fixes. */
export const MESSAGE_BUDGET = 30;

export type ChannelId = 'whatsapp' | 'mail';
export interface Channel { readonly id: ChannelId; readonly on: boolean; readonly address: string | null; readonly verified: boolean; readonly agreedOn: string | null; readonly costMinor: string | null }
export interface Channels { readonly relay: 'not-available' | 'available'; readonly testMode: boolean; readonly channels: readonly Channel[] }
export function channels(value: unknown): Channels {
  const r = rec(value);
  return {
    relay: oneOf(r['relay'], 'reply.relay', ['not-available', 'available'] as const), testMode: bool(r['testMode'], 'reply.testMode'),
    channels: list(r['channels'], 'reply.channels', (v, p) => {
      const c = rec(v, p);
      return {
        id: oneOf(c['id'], `${p}.id`, ['whatsapp', 'mail'] as const), on: bool(c['on'], `${p}.on`), address: optStr(c['address'], `${p}.address`, 320),
        verified: bool(c['verified'], `${p}.verified`), agreedOn: optWhen(c['agreedOn'], `${p}.agreedOn`), costMinor: c['costMinor'] === null ? null : digits(c['costMinor'], `${p}.costMinor`, false),
      };
    }, 2),
  };
}

export interface Message { readonly id: string; readonly text: string }
export function preview(value: unknown): readonly Message[] {
  return list(rec(value)['messages'], 'reply.messages', (v, p) => { const m = rec(v, p); return { id: id(m['id'], `${p}.id`), text: str(m['text'], `${p}.text`, 2000) }; }, 50);
}

export interface Usage { readonly month: string; readonly sent: number; readonly budget: number }
export function usage(value: unknown): Usage {
  const r = rec(value);
  const sent = int(r['sent'], 'reply.sent'), budget = int(r['budget'], 'reply.budget');
  if (sent < 0 || budget !== MESSAGE_BUDGET) throw new ShapeError('reply.budget');
  return { month: str(r['month'], 'reply.month', 40), sent, budget };
}
