import type { Env } from '../shared/module.ts';
import { HostedError, check } from '../shared/errors.ts';
import { mailChannel, telegramChannel, whatsappChannel } from './channels.ts';
import type { MailChannel, TelegramChannel, WhatsAppChannel } from './channels.ts';
import { telegramMedia, whatsappMedia } from './documents.ts';
import type { RelayDocumentOptions } from './documents.ts';
import { hmacMailInbound, postmarkInbound } from './mail-inbound.ts';
import type { MailInboundAdapter } from './mail-inbound.ts';
import { checkApiOrigin } from './business-statuses.ts';

/** Per-message prices as checked on a date. A channel without a price makes the month's cost unknown, never zero. */
export type RelayPrices = { checkedOn: string; source: string; perMessagePaise: { whatsapp?: string; telegram?: string; mail?: string } };
export type RelayOptions = {
  whatsapp: WhatsAppChannel | null; telegram: TelegramChannel | null; mail: MailChannel | null; prices: RelayPrices | null;
  whatsappVerifyToken?: string; whatsappAppSecret?: string; telegramSecret?: string; telegramBotName?: string;
  /** Documents sent from the phone (experimental); absent means a document is acknowledged and nothing is stored. */
  documents?: RelayDocumentOptions;
  /** Public https origin of this API, for the business status hook URLs. */
  apiOrigin?: string;
  /** Inbound mail webhooks by provider name (POST /v1/webhooks/mail/:provider). */
  mailInbound?: Readonly<Record<string, MailInboundAdapter>>;
};

export function parseRelayPrices(value: unknown): RelayPrices {
  const bad = () => new HostedError('RELAY_PRICES_INVALID', 'The relay prices are not valid.', 500);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const { checkedOn, source, perMessagePaise, ...rest } = value as any;
  if (Object.keys(rest).length || typeof checkedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || Number.isNaN(Date.parse(`${checkedOn}T00:00:00Z`))
    || typeof source !== 'string' || !source.trim() || source.length > 500 || !perMessagePaise || typeof perMessagePaise !== 'object' || Array.isArray(perMessagePaise)) throw bad();
  const prices: RelayPrices['perMessagePaise'] = {};
  for (const [channel, paise] of Object.entries(perMessagePaise)) {
    if (!['whatsapp', 'telegram', 'mail'].includes(channel) || typeof paise !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(paise)) throw bad();
    prices[channel as keyof RelayPrices['perMessagePaise']] = paise;
  }
  return { checkedOn, source, perMessagePaise: prices };
}

const given = (value: string | undefined) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
/** Absent configuration leaves that channel not configured; sending on it refuses CHANNEL_NOT_CONFIGURED. */
export function relayConfig(env: Env): RelayOptions {
  const phoneNumberId = given(env.WHATSAPP_PHONE_NUMBER_ID), accessToken = given(env.WHATSAPP_ACCESS_TOKEN);
  const botToken = given(env.TELEGRAM_BOT_TOKEN), serverToken = given(env.POSTMARK_SERVER_TOKEN), from = given(env.MAIL_FROM);
  const botName = given(env.TELEGRAM_BOT_NAME), pricesJson = given(env.RELAY_PRICES_JSON), apiOrigin = given(env.HOSTED_API_ORIGIN);
  const inboundUser = given(env.POSTMARK_INBOUND_USER), inboundPassword = given(env.POSTMARK_INBOUND_PASSWORD), inboundHmac = given(env.MAIL_INBOUND_HMAC_SECRET);
  if (apiOrigin) checkApiOrigin(apiOrigin);
  const mailInbound: Record<string, MailInboundAdapter> = {};
  const authservId = given(env.POSTMARK_INBOUND_AUTHSERV_ID);
  if (inboundUser && inboundPassword) mailInbound.postmark = postmarkInbound({ user: inboundUser, password: inboundPassword, ...(authservId ? { authservId } : {}) });
  if (inboundHmac) mailInbound.hmac = hmacMailInbound({ secret: inboundHmac });
  check(!botName || /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botName), 'RELAY_CONFIG_INVALID', 'The Telegram bot name is not valid.', 500);
  let prices: RelayPrices | null = null;
  if (pricesJson) { let parsed: unknown; try { parsed = JSON.parse(pricesJson); } catch { throw new HostedError('RELAY_PRICES_INVALID', 'The relay prices are not valid.', 500); } prices = parseRelayPrices(parsed); }
  return {
    whatsapp: phoneNumberId && accessToken ? whatsappChannel({ phoneNumberId, accessToken }) : null,
    telegram: botToken ? telegramChannel({ botToken }) : null,
    mail: serverToken && from ? mailChannel({ serverToken, from }) : null,
    prices,
    whatsappVerifyToken: given(env.WHATSAPP_VERIFY_TOKEN), whatsappAppSecret: given(env.WHATSAPP_APP_SECRET),
    telegramSecret: given(env.TELEGRAM_WEBHOOK_SECRET), telegramBotName: botName, apiOrigin, mailInbound,
    documents: { whatsapp: phoneNumberId && accessToken ? whatsappMedia({ accessToken }) : null, telegram: botToken ? telegramMedia({ botToken }) : null },
  };
}
