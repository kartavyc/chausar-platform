/**
 * Relay additions on the desktop: delivery statuses of the business's own WhatsApp Business messages (read by the
 * writeback lane through host.call('hosted.messageStatuses', { reference, messageId })), the registration of that
 * status hook, and whether a phone channel's address is verified. The app secret is sent once and never kept here.
 */
import { audit, check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { BUSINESS_MESSAGE_ID, BUSINESS_REFERENCE } from './client.ts';
import type { BusinessStatus } from './client.ts';
import { MAIL_TEXT, confirmationBody } from './templates.ts';
import { connected, desktopOnly, input } from './service.ts';

/** The relay's own rule for a mail address (hosted/relay/channels.ts), so the desktop refuses what the relay would. */
export const MAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
export const isMailAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && MAIL_ADDRESS.test(value);

/** The exact confirmation mail, for the message preview. */
export function confirmationPreview(link: string) {
  return { subject: MAIL_TEXT.confirmHeadline, body: confirmationBody(link), note: 'Mail turns on after the link in this mail is opened and Confirm is pressed.' };
}

/**
 * `hosted.messageStatuses`: payload exactly `{ reference, messageId: string | null }`; the reply is the array of statuses
 * the business's own WhatsApp Business hook recorded for that reference (or message id), oldest first. Telegram has no
 * delivery callbacks, so nothing like this exists for it.
 */
export async function messageStatuses(_ctx: Context, payload: Record<string, any>, host: ModuleHost): Promise<BusinessStatus[]> {
  input(payload, ['reference', 'messageId']);
  check(typeof payload.reference === 'string' && BUSINESS_REFERENCE.test(payload.reference), 'REFERENCE_INVALID', 'The reference is not valid.');
  check(payload.messageId === null || (typeof payload.messageId === 'string' && BUSINESS_MESSAGE_ID.test(payload.messageId)), 'INVALID_REQUEST', 'The message id is not valid.');
  const { client, pairing } = connected(host);
  return client.businessStatuses(pairing.sessionToken, payload.reference, payload.messageId);
}

/** `hosted.businessHook.set`: registers (or rotates) the hook for the business's own Meta app. Shown once; nothing is stored here. */
export async function businessHookSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['appSecret']);
  check(typeof payload.appSecret === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(payload.appSecret), 'APP_SECRET_INVALID', 'Paste the app secret of your own WhatsApp Business app.');
  const { client, pairing } = connected(host);
  const hook = await client.setBusinessHook(pairing.sessionToken, payload.appSecret);
  await host.store.update(state => { audit(state, 'hosted.businessHook.set', {}); });
  return { hookUrl: hook.hookUrl, verifyToken: hook.verifyToken };
}

/**
 * `phone.verify`: payload exactly `{ channel: 'mail' | 'whatsapp' }`. True only once the relay confirmed that channel's
 * address: mail after its confirmation link was used, WhatsApp while it is on for the account's OTP-verified phone.
 */
export async function phoneVerify(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, ['channel']);
  check(payload.channel === 'mail' || payload.channel === 'whatsapp', 'INVALID_REQUEST', 'Choose mail or WhatsApp.');
  const { client, pairing } = connected(host);
  const row = (await client.channels(pairing.sessionToken)).find(item => item.channel === payload.channel);
  return { verified: row?.verified === true };
}
