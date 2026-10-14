import type { Fetch } from '../shared/module.ts';
import { HostedError, check } from '../shared/errors.ts';
import { BUTTONS, HEADLINES, MAIL_FOOTER, WHATSAPP_TEMPLATE, messageBody } from '../shared/templates.ts';
import type { MessageEvent } from '../shared/templates.ts';

/**
 * Channel adapters: real HTTP clients through the injected Fetch. Each renders only the fixed catalogue:
 * a headline and a link, the button labels, or one of the fixed replies. Nothing from the desktop or a sender is sent.
 */
export type OutboundTemplate = { event: MessageEvent; linkOrigin: string; openToken: string; offer: { approveToken: string; notNowToken: string } | null };
export const openLink = (origin: string, token: string) => `${origin}/l/${token}`;
export const decideLink = (origin: string, token: string) => `${origin}/b/${token}`;

export interface WhatsAppChannel {
  readonly channel: 'whatsapp';
  /** `to` is the wa_id: the phone number in international form without the plus. Returns the provider message id. */
  sendTemplate(fetch: Fetch, to: string, message: OutboundTemplate): Promise<string>;
  /** Free-form text: only inside the service window after an inbound message. */
  sendText(fetch: Fetch, to: string, text: string): Promise<string>;
}
export interface TelegramChannel {
  readonly channel: 'telegram';
  sendTemplate(fetch: Fetch, chatId: string, message: OutboundTemplate): Promise<string>;
  sendText(fetch: Fetch, chatId: string, text: string): Promise<string>;
  answerCallback(fetch: Fetch, callbackQueryId: string, text: string): Promise<void>;
}
export interface MailChannel {
  readonly channel: 'mail';
  sendTemplate(fetch: Fetch, to: string, message: OutboundTemplate): Promise<string>;
}

/** 408, 429 and 5xx are retried by the queue; any other refusal ends the job (PROVIDER_REFUSED). */
async function post(fetch: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let response: Awaited<ReturnType<Fetch>>;
  try { response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch { throw new HostedError('PROVIDER_UNREACHABLE', 'The message provider could not be reached.', 502); }
  if (!response.ok) {
    const retry = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new HostedError(retry ? 'PROVIDER_FAILED' : 'PROVIDER_REFUSED', 'The message provider refused the message.', 502);
  }
  try { return JSON.parse(await response.text()); } catch { throw new HostedError('PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502); }
}
const providerId = (value: unknown): string => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  check(typeof text === 'string' && /^[A-Za-z0-9._=:+/-]{1,256}$/.test(text), 'PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502);
  return text;
};
const recipient = (value: string, pattern: RegExp) => check(typeof value === 'string' && pattern.test(value), 'RECIPIENT_INVALID', 'The stored recipient is not valid.', 500);

export function whatsappChannel(config: { phoneNumberId: string; accessToken: string }): WhatsAppChannel {
  check(/^[0-9]{5,30}$/.test(config.phoneNumberId) && /^[A-Za-z0-9_.-]{20,1000}$/.test(config.accessToken), 'RELAY_CONFIG_INVALID', 'The WhatsApp configuration is not valid.', 500);
  const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, auth = { authorization: `Bearer ${config.accessToken}` };
  const sent = (reply: any) => providerId(Array.isArray(reply?.messages) ? reply.messages[0]?.id : undefined);
  return {
    channel: 'whatsapp',
    async sendTemplate(fetch, to, message) {
      recipient(to, /^[1-9][0-9]{7,14}$/);
      // Approve, Not now, then Open the app: the registered template's button order. The Open URL is registered as `<origin>/l/{{1}}`.
      const components: unknown[] = [];
      if (message.offer) components.push(
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: message.offer.approveToken }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: message.offer.notNowToken }] });
      components.push({ type: 'button', sub_type: 'url', index: message.offer ? '2' : '0', parameters: [{ type: 'text', text: message.openToken }] });
      return sent(await post(fetch, url, auth, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: WHATSAPP_TEMPLATE[message.event], language: { code: 'en' }, components } }));
    },
    async sendText(fetch, to, text) {
      recipient(to, /^[1-9][0-9]{7,14}$/);
      return sent(await post(fetch, url, auth, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: text } }));
    },
  };
}

export function telegramChannel(config: { botToken: string }): TelegramChannel {
  check(/^[0-9]{3,20}:[A-Za-z0-9_-]{20,100}$/.test(config.botToken), 'RELAY_CONFIG_INVALID', 'The Telegram configuration is not valid.', 500);
  const base = `https://api.telegram.org/bot${config.botToken}`;
  const result = (reply: any) => { check(reply?.ok === true, 'PROVIDER_REFUSED', 'The message provider refused the message.', 502); return reply.result; };
  return {
    channel: 'telegram',
    async sendTemplate(fetch, chatId, message) {
      recipient(chatId, /^-?[0-9]{1,20}$/);
      const link = openLink(message.linkOrigin, message.openToken);
      const rows: unknown[][] = [];
      if (message.offer) rows.push([{ text: BUTTONS.approve, callback_data: message.offer.approveToken }, { text: BUTTONS.notNow, callback_data: message.offer.notNowToken }]);
      rows.push([{ text: BUTTONS.open, url: link }]);
      return providerId(result(await post(fetch, `${base}/sendMessage`, {}, { chat_id: chatId, text: messageBody(message.event, link, 'telegram'), link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: rows } }))?.message_id);
    },
    async sendText(fetch, chatId, text) {
      recipient(chatId, /^-?[0-9]{1,20}$/);
      return providerId(result(await post(fetch, `${base}/sendMessage`, {}, { chat_id: chatId, text, link_preview_options: { is_disabled: true } }))?.message_id);
    },
    async answerCallback(fetch, callbackQueryId, text) {
      check(/^[A-Za-z0-9_-]{1,128}$/.test(callbackQueryId), 'RECIPIENT_INVALID', 'The stored recipient is not valid.', 500);
      result(await post(fetch, `${base}/answerCallbackQuery`, {}, { callback_query_id: callbackQueryId, text }));
    },
  };
}

/** The mail body: the headline, the link, for an offer the two one-time links, and the footer. Never "reply yes". */
export function mailBody(message: OutboundTemplate): string {
  const link = openLink(message.linkOrigin, message.openToken);
  if (!message.offer) return messageBody(message.event, link, 'mail');
  return [HEADLINES[message.event], link, `${BUTTONS.approve}: ${decideLink(message.linkOrigin, message.offer.approveToken)}`,
    `${BUTTONS.notNow}: ${decideLink(message.linkOrigin, message.offer.notNowToken)}`, '', MAIL_FOOTER].join('\n');
}
export const MAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

export function mailChannel(config: { serverToken: string; from: string }): MailChannel {
  check(/^[A-Za-z0-9-]{20,100}$/.test(config.serverToken) && MAIL_ADDRESS.test(config.from) && config.from.length <= 254, 'RELAY_CONFIG_INVALID', 'The mail configuration is not valid.', 500);
  return {
    channel: 'mail',
    async sendTemplate(fetch, to, message) {
      recipient(to, MAIL_ADDRESS);
      const reply = await post(fetch, 'https://api.postmarkapp.com/email', { 'x-postmark-server-token': config.serverToken },
        { From: config.from, To: to, Subject: HEADLINES[message.event], TextBody: mailBody(message), MessageStream: 'outbound' });
      check(reply?.ErrorCode === 0, 'PROVIDER_REFUSED', 'The message provider refused the message.', 502);
      return providerId(reply.MessageID);
    },
  };
}
