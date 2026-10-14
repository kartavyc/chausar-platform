import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsappChannel, telegramChannel, mailChannel, mailBody } from '../../hosted/relay/channels.ts';
import type { OutboundTemplate } from '../../hosted/relay/channels.ts';
import { createRelayModule, checkLinkOrigin, relayConfig, parseRelayPrices } from '../../hosted/relay/relay.ts';
import { letterToken } from '../../hosted/shared/crypto.ts';
import { BUTTONS, HEADLINES, MAIL_FOOTER, MAIL_TEXT, MESSAGE_EVENTS, REPLIES, WHATSAPP_TEMPLATE, confirmationBody, hasDigit, messageBody } from '../../hosted/shared/templates.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';

const ORIGIN = 'https://link.chausar.app';
const WA = { phoneNumberId: '106540352242922', accessToken: 'EAAGtestaccesstokenletterswhatsappcloud' };
const TG = { botToken: '7012345678:AAHtestBotTokenLettersAndDigitsOnly_x' };
const PM = { serverToken: 'postmark-server-token-test', from: 'messages@chausar.app' };
// Recorded provider replies (shapes as documented by each provider).
const RECORDED = {
  whatsapp: { messaging_product: 'whatsapp', contacts: [{ input: '919876543210', wa_id: '919876543210' }], messages: [{ id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSQjE3RDg3QTk1RkYxMEI5QTBGAA==' }] },
  telegram: { ok: true, result: { message_id: 4321, from: { id: 7012345678, is_bot: true, first_name: 'Chausar' }, chat: { id: 55501234, type: 'private' }, date: 1792000000, text: 'x' } },
  telegramCallback: { ok: true, result: true },
  postmark: { To: 'owner@example.com', SubmittedAt: '2026-10-14T10:00:00.0000000+00:00', MessageID: 'b7bc2f4a-e38e-4336-af7d-e6c392c2f817', ErrorCode: 0, Message: 'OK' },
};
type Call = { url: string; method?: string; headers: Record<string, string>; body: any; raw: string };
function fakeFetch(status = 200, override?: (url: string) => unknown) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init = {}) => {
    const raw = String(init.body ?? ''); calls.push({ url, method: init.method, headers: init.headers ?? {}, body: JSON.parse(raw), raw });
    const reply = override?.(url) ?? (url.includes('graph.facebook.com') ? RECORDED.whatsapp : url.endsWith('/answerCallbackQuery') ? RECORDED.telegramCallback : url.includes('api.telegram.org') ? RECORDED.telegram : RECORDED.postmark);
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  };
  return { fetch, calls };
}
const message = (event: OutboundTemplate['event'], offer: boolean): OutboundTemplate =>
  ({ event, linkOrigin: ORIGIN, openToken: letterToken(), offer: offer ? { approveToken: letterToken(), notNowToken: letterToken() } : null });

test('WhatsApp sends the registered template with the open token and, for an offer, two quick replies', async () => {
  const { fetch, calls } = fakeFetch(), channel = whatsappChannel(WA), sent = message('review-ready', true);
  assert.equal(await channel.sendTemplate(fetch, '919876543210', sent), RECORDED.whatsapp.messages[0].id);
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/106540352242922/messages');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.authorization, `Bearer ${WA.accessToken}`);
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(calls[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template', template: {
    name: 'chausar_review_ready', language: { code: 'en' }, components: [
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: sent.offer!.approveToken }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: sent.offer!.notNowToken }] },
      { type: 'button', sub_type: 'url', index: '2', parameters: [{ type: 'text', text: sent.openToken }] }] } });
  const plain = message('week-ahead-ready', false);
  await channel.sendTemplate(fetch, '919876543210', plain);
  assert.deepEqual(calls[1].body.template, { name: WHATSAPP_TEMPLATE['week-ahead-ready'], language: { code: 'en' }, components: [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: plain.openToken }] }] });
  await channel.sendText(fetch, '919876543210', REPLIES.help);
  assert.deepEqual(calls[2].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'text', text: { preview_url: false, body: REPLIES.help } });
  await assert.rejects(channel.sendText(fetch, '+919876543210', REPLIES.help), { code: 'RECIPIENT_INVALID' });
});

test('Telegram sends the headline and link with an inline keyboard, and answers presses', async () => {
  const { fetch, calls } = fakeFetch(), channel = telegramChannel(TG), sent = message('review-ready', true);
  assert.equal(await channel.sendTemplate(fetch, '55501234', sent), '4321');
  const link = `${ORIGIN}/l/${sent.openToken}`;
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TG.botToken}/sendMessage`);
  assert.deepEqual(calls[0].body, { chat_id: '55501234', text: messageBody('review-ready', link, 'telegram'), link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [
    [{ text: BUTTONS.approve, callback_data: sent.offer!.approveToken }, { text: BUTTONS.notNow, callback_data: sent.offer!.notNowToken }], [{ text: BUTTONS.open, url: link }]] } });
  assert.equal(calls[0].body.text, `${HEADLINES['review-ready']}\n${link}`);
  await channel.answerCallback(fetch, '4382bfdwdsb323b2d9', REPLIES.approved);
  assert.equal(calls[1].url, `https://api.telegram.org/bot${TG.botToken}/answerCallbackQuery`);
  assert.deepEqual(calls[1].body, { callback_query_id: '4382bfdwdsb323b2d9', text: REPLIES.approved });
  const refused = fakeFetch(200, () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
  await assert.rejects(channel.sendText(refused.fetch, '55501234', REPLIES.help), { code: 'PROVIDER_REFUSED' });
});

test('mail goes through Postmark with the headline as subject and the one-time links, never "reply yes"', async () => {
  const { fetch, calls } = fakeFetch(), channel = mailChannel(PM), sent = message('review-ready', true);
  assert.equal(await channel.sendTemplate(fetch, 'owner@example.com', sent), RECORDED.postmark.MessageID);
  assert.equal(calls[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(calls[0].headers['x-postmark-server-token'], PM.serverToken);
  assert.deepEqual(calls[0].body, { From: PM.from, To: 'owner@example.com', Subject: HEADLINES['review-ready'], MessageStream: 'outbound', TrackLinks: 'None', TrackOpens: false, TextBody: [
    HEADLINES['review-ready'], `${ORIGIN}/l/${sent.openToken}`, `Approve: ${ORIGIN}/b/${sent.offer!.approveToken}`, `Not now: ${ORIGIN}/b/${sent.offer!.notNowToken}`, '', MAIL_FOOTER].join('\n') });
  const plain = message('due-date-near', false);
  assert.equal(mailBody(plain), messageBody('due-date-near', `${ORIGIN}/l/${plain.openToken}`, 'mail'));
  assert.equal(/reply yes/i.test(mailBody(sent).replace(MAIL_FOOTER, '')), false);
  const failed = fakeFetch(200, () => ({ ErrorCode: 300, Message: 'Invalid email request' }));
  await assert.rejects(channel.sendTemplate(failed.fetch, 'owner@example.com', sent), { code: 'PROVIDER_REFUSED' });
});

test('provider failures are typed: retryable, refused, unreadable', async () => {
  const channel = whatsappChannel(WA);
  await assert.rejects(channel.sendText(fakeFetch(503).fetch, '919876543210', REPLIES.help), { code: 'PROVIDER_FAILED' });
  await assert.rejects(channel.sendText(fakeFetch(429).fetch, '919876543210', REPLIES.help), { code: 'PROVIDER_FAILED' });
  await assert.rejects(channel.sendText(fakeFetch(400).fetch, '919876543210', REPLIES.help), { code: 'PROVIDER_REFUSED' });
  await assert.rejects(channel.sendText(fakeFetch(200, () => 'not json').fetch, '919876543210', REPLIES.help), { code: 'PROVIDER_REPLY_INVALID' });
  await assert.rejects(channel.sendText(fakeFetch(200, () => ({ messages: [{ id: '<script>' }] })).fetch, '919876543210', REPLIES.help), { code: 'PROVIDER_REPLY_INVALID' });
  const down: Fetch = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(channel.sendText(down, '919876543210', REPLIES.help), { code: 'PROVIDER_UNREACHABLE' });
});

test('no digit in any outbound message: every event, channel, offer and reply, including button links and payloads', async () => {
  const { fetch, calls } = fakeFetch();
  const wa = whatsappChannel(WA), tg = telegramChannel(TG), mail = mailChannel(PM);
  for (const event of MESSAGE_EVENTS) for (const offer of [false, true]) {
    await wa.sendTemplate(fetch, '919876543210', message(event, offer));
    await tg.sendTemplate(fetch, '55501234', message(event, offer));
    await mail.sendTemplate(fetch, 'owner@example.com', message(event, offer));
  }
  for (const reply of Object.values(REPLIES)) { await wa.sendText(fetch, '919876543210', reply); await tg.sendText(fetch, '55501234', reply); await tg.answerCallback(fetch, 'callbackid', reply); await mail.sendText(fetch, 'owner@example.com', MAIL_TEXT.replySubject, reply); }
  await mail.sendText(fetch, 'owner@example.com', MAIL_TEXT.confirmHeadline, confirmationBody(`${ORIGIN}/v/${letterToken()}`));
  assert.equal(calls.length, MESSAGE_EVENTS.length * 2 * 3 + Object.keys(REPLIES).length * 4 + 1);
  let buttons = 0;
  for (const call of calls) {
    // The recipient (a phone number or chat id) and WhatsApp's positional button index are addressing, not message text.
    const body = structuredClone(call.body); delete body.to; delete body.chat_id;
    for (const component of body.template?.components ?? []) { delete component.index; for (const parameter of component.parameters) { buttons++; assert.equal(hasDigit(parameter.payload ?? parameter.text), false); } }
    for (const row of body.reply_markup?.inline_keyboard ?? []) for (const button of row) { buttons++; assert.equal(hasDigit(button.url ?? button.callback_data), false); }
    assert.equal(hasDigit(JSON.stringify(body)), false, JSON.stringify(body));
  }
  assert.equal(buttons, MESSAGE_EVENTS.length * (1 + 3) * 2, "every WhatsApp and Telegram button was checked");
});

test('the digit rule covers every script\'s decimal digits, in both copies of the catalogue', async () => {
  const desktop = await import('../runtime/hosted-link/templates.ts');
  // ASCII, Arabic-Indic, Extended Arabic-Indic, Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Thai, fullwidth, mathematical bold.
  const digits = ['7', '\u0663', '\u06F3', '\u0969', '\u09E9', '\u0A69', '\u0AE9', '\u0BE9', '\u0C69', '\u0CE9', '\u0D69', '\u0E53', '\uFF13', '\u{1D7D1}'];
  for (const check of [hasDigit, desktop.hasDigit]) {
    for (const digit of digits) assert.equal(check(`The week ahead ${digit} is ready.`), true, `U+${digit.codePointAt(0)!.toString(16)}`);
    for (const text of ['The week ahead is ready.', 'Roman numerals like XIV and the word seven are not digits.', 'ⅻ ½ ² ①']) assert.equal(check(text), false, text);
  }
});

test('the link origin must be https, bare and digit-free, or the relay refuses to start', () => {
  assert.equal(checkLinkOrigin('https://link.chausar.app/'), 'https://link.chausar.app');
  for (const bad of ['http://link.chausar.app', 'https://link2.chausar.app', 'https://link.chausar.app:8443', 'https://link.chausar.app/x', 'https://u:p@link.chausar.app', 'not a url', 'https://link.chausar.app?x=y'])
    assert.throws(() => checkLinkOrigin(bad), { code: 'LINK_ORIGIN_INVALID' }, bad);
  const deps = { linkOrigin: 'https://l1nk.chausar.app', pepper: 'p'.repeat(32) } as HostedDeps;
  assert.throws(() => createRelayModule(deps, { whatsapp: null, telegram: null, mail: null, prices: null }), { code: 'LINK_ORIGIN_INVALID' });
});

test('relay configuration comes from the environment; absent means not configured', () => {
  const none = relayConfig({});
  assert.deepEqual([none.whatsapp, none.telegram, none.mail, none.prices], [null, null, null, null]);
  const all = relayConfig({ WHATSAPP_PHONE_NUMBER_ID: WA.phoneNumberId, WHATSAPP_ACCESS_TOKEN: WA.accessToken, WHATSAPP_APP_SECRET: 'appsecret', WHATSAPP_VERIFY_TOKEN: 'verify',
    TELEGRAM_BOT_TOKEN: TG.botToken, TELEGRAM_BOT_NAME: 'ChausarBot', TELEGRAM_WEBHOOK_SECRET: 'tgsecret', POSTMARK_SERVER_TOKEN: PM.serverToken, MAIL_FROM: PM.from,
    RELAY_PRICES_JSON: JSON.stringify({ checkedOn: '2026-10-01', source: 'Meta rate card for India, utility', perMessagePaise: { whatsapp: '13', mail: '0' } }) });
  assert.equal(all.whatsapp?.channel, 'whatsapp'); assert.equal(all.telegram?.channel, 'telegram'); assert.equal(all.mail?.channel, 'mail');
  assert.deepEqual(all.prices, { checkedOn: '2026-10-01', source: 'Meta rate card for India, utility', perMessagePaise: { whatsapp: '13', mail: '0' } });
  assert.equal(all.telegramBotName, 'ChausarBot'); assert.equal(all.whatsappAppSecret, 'appsecret');
  assert.equal(relayConfig({ WHATSAPP_PHONE_NUMBER_ID: WA.phoneNumberId }).whatsapp, null, 'half a configuration is not a configuration');
  assert.throws(() => relayConfig({ RELAY_PRICES_JSON: '{' }), { code: 'RELAY_PRICES_INVALID' });
  for (const bad of [{ checkedOn: '2026-10-01', source: 's', perMessagePaise: { whatsapp: 0.13 } }, { checkedOn: '2026-10-01', source: 's', perMessagePaise: { sms: '1' } },
    { checkedOn: 'today', source: 's', perMessagePaise: {} }, { checkedOn: '2026-10-01', source: 's', perMessagePaise: {}, extra: 1 }, { checkedOn: '2026-10-01', source: 's', perMessagePaise: { mail: '-1' } }])
    assert.throws(() => parseRelayPrices(bad), { code: 'RELAY_PRICES_INVALID' });
  assert.throws(() => relayConfig({ WHATSAPP_PHONE_NUMBER_ID: 'abc', WHATSAPP_ACCESS_TOKEN: WA.accessToken }), { code: 'RELAY_CONFIG_INVALID' });
});
