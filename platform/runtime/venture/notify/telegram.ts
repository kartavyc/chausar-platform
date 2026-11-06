// Wave 6 package 6F6 (D35): phone alerts through the owner's own Telegram bot, from the desktop app. The owner makes a
// bot with BotFather and gives Chausar its token and their chat id inside the app; both go to the computer's protected
// key storage (the host's credential port, name alerts:telegram) and never into the business file, which keeps only
// whether a bot is set and whether the owner chose details. Each alert outside the app then sends the bot one message
// with the count alone ("Chausar: 3 things wait for you. Open the app to decide."); details are opt-in and add the
// titles of what waits. Approvals stay in the app: the message carries no link, no button and nothing to approve with.
// Each send is its own action journal entry under the owner's standing setting (action notify.relay, target
// api.telegram.org), holding the count and the outcome, never the token or chat id; a send that may not have arrived
// or met a server error is tried once more as a new entry, a refusal is not. The hosted app does not talk to Telegram.
import { createHash, randomBytes } from 'node:crypto';
import { ChausarError, authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { ALERT_MAY_NOT_HAVE_ARRIVED, journalled, type ApplyResult } from '../journal/journal.ts';
import type { IsoTime, NotifySettingsRecord, TelegramView, VentureDeps } from '../contracts.ts';
import { currentNotifySettings } from './settings.ts';

/** The credential name the bot token and chat id are saved under, together, in the host's protected storage. */
export const TELEGRAM_CREDENTIAL = 'alerts:telegram';
export const TELEGRAM_HOST = 'api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 8_000;
const BOT_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID = /^-?\d{1,20}$/;
const MAX_TITLES = 10;
const WORDS = Object.freeze({
  token: 'Paste the bot token BotFather gave you. It looks like 123456789:AA, then about 35 letters and digits.',
  chat: 'Give your chat id as a number. The phone access guide says how to find it.',
  hosted: 'The hosted app does not talk to Telegram. Telegram alerts come from the desktop app.',
  notSet: 'Set up your Telegram bot first.',
  none: 'No Telegram bot is set. Alerts can go to your own bot as a count only.',
  counts: 'Alerts go to your Telegram bot as a count only, like "3 things wait for you".',
  details: 'Alerts go to your Telegram bot with the titles of what waits. Titles can name clients.',
  standing: 'Telegram alerts are set in Notifications: the count, and titles only if you chose them.',
});

type Saved = { token: string; chatId: string };
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const TIMED_OUT = Symbol('timed-out');

/** The alert text: the count alone, then one line per title when the owner chose details. Never a link. */
export function telegramText(count: number, titles: readonly string[] = []): string {
  const head = `Chausar: ${count} ${count === 1 ? 'thing waits' : 'things wait'} for you. Open the app to decide.`;
  const lines = titles.slice(0, MAX_TITLES).map(title => `- ${title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/https?:\/\/\S+/gi, '').trim().slice(0, 80)}`);
  return [head, ...lines].join('\n');
}

function viewOf(setting: NotifySettingsRecord['telegram'] | undefined, said?: string): TelegramView {
  const view: TelegramView = setting
    ? { connected: true, details: setting.details, line: setting.details ? WORDS.details : WORDS.counts }
    : { connected: false, details: false, line: WORDS.none };
  return said === undefined ? view : { ...view, said };
}

/** The saved token and chat id, or null when none are saved, storage is unavailable or what is saved is not valid. */
export async function telegramSaved(deps: VentureDeps, workspaceId: string): Promise<Saved | null> {
  if (!deps.credentials) return null;
  let saved: string | null = null;
  try { saved = await deps.credentials.get(workspaceId, TELEGRAM_CREDENTIAL); } catch { return null; }
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<Saved>;
    return typeof parsed.token === 'string' && BOT_TOKEN.test(parsed.token) && typeof parsed.chatId === 'string' && CHAT_ID.test(parsed.chatId)
      ? { token: parsed.token, chatId: parsed.chatId } : null;
  } catch { return null; }
}

/** Telegram's own words from an error answer, cleaned and short, or null. */
function telegramWords(body: Buffer | undefined): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(body ?? '').toString('utf8')) as { description?: unknown };
    return typeof parsed.description === 'string' ? parsed.description.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200) : null;
  } catch { return null; }
}

/** How one send ended. wentOut: it may have reached Telegram. halted: the journal refused it. */
type Post = { took: boolean; status: number | null; wentOut: boolean; halted: boolean; line: string };
const BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED']);

/** One send to the bot, as its own journal entry under the owner's standing setting. The digest never holds the token. */
async function sendOnce(deps: VentureDeps, owner: Context, saved: Saved, count: number, text: string, alert: string, attempt: number, detailed: boolean): Promise<Post> {
  const body = JSON.stringify({ chat_id: saved.chatId, text, disable_web_page_preview: true });
  const post: Post = { took: false, status: null, wentOut: false, halted: true, line: '' };
  try {
    await journalled<null>(deps, owner, {
      action: 'notify.relay', subject: `notify-relay:telegram-${alert}:${attempt}`, target: TELEGRAM_HOST,
      actionDigest: sha256([TELEGRAM_HOST, alert, String(attempt), text].join('\n')),
      line: detailed ? `Send the alert count (${count}) and the titles of what waits to your Telegram bot.` : `Send the alert count (${count}) to your Telegram bot. Only the number goes out.`,
      descriptionComplete: true,
    }, async (): Promise<ApplyResult<null>> => {
      post.halted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (line: string, outcome: 'applied' | 'not-sent', by: 'platform' | 'engine'): ApplyResult<null> => { post.line = line; return { outcome, line, value: null, by }; };
      try {
        const sending = guardedFetch({
          url: `https://${TELEGRAM_HOST}/bot${saved.token}/sendMessage`, method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body,
          maxRedirects: 0, timeoutMs: TELEGRAM_TIMEOUT_MS, maxBytes: 64 * 1024,
        }, deps.net ?? {});
        const answer = await Promise.race([sending, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), TELEGRAM_TIMEOUT_MS); })]);
        post.wentOut = true;
        if (answer === TIMED_OUT) { sending.catch(() => {}); return finish(`Telegram did not answer in time. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, 'not-sent', 'engine'); }
        post.status = answer.status;
        if (answer.status >= 200 && answer.status < 300) { post.took = true; return finish(`Telegram took the alert count (${count}).`, 'applied', 'platform'); }
        if (answer.status === 401 || answer.status === 404) return finish('Telegram refused the bot token. Check it in BotFather and save it again.', 'not-sent', 'platform');
        const words = telegramWords(answer.body);
        return finish(`Telegram answered ${answer.status}${words ? `: ${words}` : ''}. It did not take the alert.`, 'not-sent', 'platform');
      } catch (error) {
        const code = error instanceof ChausarError ? error.code : '';
        post.wentOut = !BEFORE_SENDING.has(code) && code !== 'NET_REDIRECT_REFUSED';
        if (!post.wentOut) return finish(error instanceof ChausarError ? error.message : 'Chausar could not reach Telegram.', 'not-sent', 'engine');
        return finish(`The alert to Telegram stopped part way. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, 'not-sent', 'engine');
      } finally {
        if (timer) clearTimeout(timer);
      }
    }, { standing: { line: WORDS.standing } });
  } catch {
    post.halted = true;
  }
  return post;
}

/** C5 task 11: what Find me answers: the chat to save and its first name, or none with the words why. */
export type TelegramFound = { found: { chatId: string; name: string } | null; line: string };
const START_FIRST = 'Send /start to your bot in Telegram, then press Find me again.';

/** The newest private chat in a getUpdates answer whose message starts with /start; groups and channels are skipped. */
export function startedChat(body: unknown): { chatId: string; name: string } | null {
  const result = (body as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) return null;
  for (const item of [...result].reverse()) {
    const message = (item as { message?: { chat?: { id?: unknown; type?: unknown; first_name?: unknown }; text?: unknown } } | null)?.message;
    const chat = message?.chat;
    if (!chat || chat.type !== 'private' || typeof message!.text !== 'string' || !/^\/start\b/.test(message!.text.trim())) continue;
    const id = typeof chat.id === 'number' && Number.isSafeInteger(chat.id) ? String(chat.id) : null;
    if (!id || !CHAT_ID.test(id)) continue;
    const name = typeof chat.first_name === 'string' ? chat.first_name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 64) : '';
    return { chatId: id, name: name || 'this chat' };
  }
  return null;
}

/**
 * venture.notify.telegram.findChat { token } (prepare, app only): one getUpdates call to the owner's own bot, through
 * the network guard, to find the chat that sent /start. Answers its id and first name for the owner to confirm; stores
 * nothing (the save is venture.notify.telegram with that chat id). A webhook (409), a refused token and no /start yet
 * each answer plain words. The token is never written anywhere and never said back.
 */
export async function telegramFindChatHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TelegramFound> {
  requireAppChannel(ctx, 'venture.notify.telegram.findChat');
  const body = exactPayload(payload, ['token'], ['token']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', WORDS.hosted);
  check(typeof body.token === 'string' && BOT_TOKEN.test(body.token.trim()), 'INVALID_VENTURE_REQUEST', WORDS.token);
  authorize(deps.store, ctx, 'prepare');
  readVenture(deps, ctx);
  const token = (body.token as string).trim();
  let answer;
  try {
    answer = await guardedFetch({
      url: `https://${TELEGRAM_HOST}/bot${token}/getUpdates?allowed_updates=%5B%22message%22%5D`, method: 'GET',
      maxRedirects: 0, timeoutMs: TELEGRAM_TIMEOUT_MS, maxBytes: 256 * 1024,
    }, deps.net ?? {});
  } catch {
    return { found: null, line: 'Chausar could not reach Telegram. Check this computer is online, then press Find me again.' };
  }
  if (answer.status === 409) return { found: null, line: 'Your bot sends its messages to a web address (a webhook), so Chausar cannot read them. Type your chat id under "Type the chat id yourself" instead.' };
  if (answer.status === 401 || answer.status === 404) return { found: null, line: 'Telegram refused the bot token. Check it in BotFather and paste it again.' };
  if (answer.status < 200 || answer.status >= 300) return { found: null, line: `Telegram answered ${answer.status}. Press Find me again in a minute.` };
  let parsed: unknown = null;
  try { parsed = JSON.parse(answer.body.toString('utf8')); } catch { /* no chat found */ }
  const found = startedChat(parsed);
  return found ? { found, line: `Is this you: ${found.name}?` } : { found: null, line: START_FIRST };
}

const worthRetry = (post: Post) => !post.halted && (post.status !== null ? post.status >= 500 || post.status === 429 : post.wentOut);

/** Sends one text, tried once more at most after no answer or a server error. */
async function sendText(deps: VentureDeps, owner: Context, saved: Saved, count: number, text: string, detailed: boolean): Promise<TelegramDelivery & { line: string }> {
  const alert = randomBytes(6).toString('hex');
  let reached = false, line = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const post = await sendOnce(deps, owner, saved, count, text, alert, attempt, detailed);
    reached ||= post.wentOut;
    line = post.line;
    if (post.took) return { took: true, reached: true, line };
    if (!worthRetry(post)) break;
  }
  return { took: false, reached, line };
}

/** The titles an alert counted: the items marked sent at that moment that are still on Today. */
function titlesAt(state: State, ventureId: string, at: IsoTime | null): string[] {
  if (!at) return [];
  return listRecords(state, 'venture-notification', ventureId).filter(record => record.alert === 'sent' && record.alertedAt === at && !record.endedAt).map(record => record.title);
}

/** What a Telegram delivery did. reached: a send may have reached Telegram, so the alert counts as given. */
export type TelegramDelivery = { took: boolean; reached: boolean };

/**
 * One alert outside the app to the owner's bot, as the owner inside the app (VentureDeps.ownerContext) whoever's request
 * started the look. at: the moment the alert's items were marked, for the titles when the owner chose details. Never on
 * the hosted app. Never throws.
 */
export async function deliverTelegram(deps: VentureDeps, ctx: Context, count: number, at: IsoTime | null): Promise<TelegramDelivery> {
  const none: TelegramDelivery = { took: false, reached: false };
  try {
    if (deps.host === 'hosted-web') return none;
    const state = deps.store.read();
    const venture = currentVenture(state);
    const setting = venture ? currentNotifySettings(state, venture.id).telegram : null;
    if (!venture || !setting) return none;
    const saved = await telegramSaved(deps, state.workspace.id);
    if (!saved) return none;
    const titles = setting.details ? titlesAt(state, venture.id, at) : [];
    const { took, reached } = await sendText(deps, deps.ownerContext?.() ?? ctx, saved, count, telegramText(count, titles), setting.details);
    return { took, reached };
  } catch {
    return none;
  }
}

/**
 * venture.notify.telegram (approve, app only). { bot: { token, chatId } } saves the bot in protected storage and turns
 * Telegram alerts on (count only); { bot: null } removes it; { details } chooses whether alerts add titles; { test: true }
 * sends one test alert with the current count only. An empty request reads it and writes nothing. Not on the hosted app.
 */
export async function telegramHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TelegramView> {
  requireAppChannel(ctx, 'venture.notify.telegram');
  const body = exactPayload(payload, ['bot', 'details', 'test']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', WORDS.hosted);
  authorize(deps.store, ctx, 'approve');
  const { state, venture } = readVenture(deps, ctx);
  const current = currentNotifySettings(state, venture.id).telegram;
  if (!Object.keys(body).length) return viewOf(current);
  let bot: Saved | null | undefined;
  if (Object.hasOwn(body, 'bot') && body.bot !== null) {
    const given = exactPayload(body.bot, ['token', 'chatId'], ['token', 'chatId']);
    check(typeof given.token === 'string' && BOT_TOKEN.test(given.token.trim()), 'INVALID_VENTURE_REQUEST', WORDS.token);
    check(typeof given.chatId === 'string' && CHAT_ID.test(given.chatId.trim()), 'INVALID_VENTURE_REQUEST', WORDS.chat);
    bot = { token: given.token.trim(), chatId: given.chatId.trim() };
  } else if (Object.hasOwn(body, 'bot')) bot = null;
  check(!Object.hasOwn(body, 'details') || typeof body.details === 'boolean', 'INVALID_VENTURE_REQUEST', 'Details must be on or off.');
  check(!Object.hasOwn(body, 'test') || body.test === true, 'INVALID_VENTURE_REQUEST', 'Send test as true.');
  check(bot !== undefined || current, 'TELEGRAM_NOT_SET', WORDS.notSet);
  if (bot !== undefined) {
    check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
    const workspaceId = state.workspace.id;
    if (bot === null) await deps.credentials.delete(workspaceId, TELEGRAM_CREDENTIAL);
    else await deps.credentials.set(workspaceId, TELEGRAM_CREDENTIAL, JSON.stringify(bot));
  }
  const next = await ventureAction(deps, ctx, 'approve', 'notify.telegram', tx => {
    const settings = currentNotifySettings(tx.state, tx.venture!.id);
    const setting: NotifySettingsRecord['telegram'] = bot === null ? null
      : { details: typeof body.details === 'boolean' ? body.details : bot ? false : settings.telegram!.details, savedAt: bot ? tx.now : settings.telegram!.savedAt };
    if (JSON.stringify(setting) !== JSON.stringify(settings.telegram)) tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...settings, telegram: setting });
    return setting;
  });
  if (body.test !== true || !next) return viewOf(next);
  const saved = await telegramSaved(deps, state.workspace.id);
  check(saved, 'TELEGRAM_NOT_SET', WORDS.notSet);
  const fresh = deps.store.read();
  const count = listRecords(fresh, 'venture-notification', venture.id).filter(record => !record.endedAt).length;
  const sent = await sendText(deps, ctx, saved, count, telegramText(count), false);
  return viewOf(next, sent.took ? 'Telegram took the test alert.' : sent.line || 'The test alert could not be sent.');
}
