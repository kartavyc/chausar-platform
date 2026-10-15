/**
 * Desktop side of the hosted link: pairing, phone channels, fixed messages with sealed one-tap approvals,
 * encrypted backup upload and restore, the allowance route client and the always-on worker switches.
 * Private state lives in the module's vault namespace; the session token never leaves it except in the
 * Authorization header of a hosted call.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { audit, check, ChausarError, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ActionService, PreparedAction } from '../actions.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { HostedClient, hostedOrigin, MAX_BACKUP_BYTES, BACKUP_ID, sha256Hex } from './client.ts';
import type { AllowanceRequest, ChannelRow, Entitlements, Fetch, SealedBlob, SealedEnvelope } from './client.ts';
import { BUTTONS, CHANNELS, DESTINATION_OF, HEADLINES, LINK_PAGE, MAIL_FOOTER, MESSAGE_EVENTS, OPT_IN_TEXT, REPLIES, WHATSAPP_TEMPLATE, hasDigit, messageBody } from './templates.ts';
import type { Channel, MessageEvent } from './templates.ts';
import { newKey, openIntent, sealIntent, unwrapBackup, wrapBackup } from './seal.ts';
import { confirmationPreview, isMailAddress } from './relay-extras.ts';
import type { Decision } from './seal.ts';
import { registerAfterPairing } from './documents.ts';

export const MODULE_ID = 'hosted-link';
export const LABELS = Object.freeze({
  backup: 'Encrypted on this computer before upload. Chausar\'s server cannot open it.',
  worker: 'Always-on jobs are not end-to-end encrypted: the server does the work, so it can read what each job uses.',
  relay: 'Messages carry a headline and a link only.',
});
export const MESSAGE_BUDGET = 30;
export const OFFER_TTL_MS = 30 * 60 * 1000;
const LINK_PLACEHOLDER = 'x'.repeat(48);

type Pairing = { accountId: string; deviceId: string; sessionToken: string; sessionExpiresAt: string; pairedAt: string; phoneMasked: string };
type Offer = { offerId: string; actionId: string; digest: string; revision: number; memberId: string; epoch: number; channel: Channel; entryId: string;
  messageId: string | null; createdAt: string; expiresAt: string; used: boolean; usedAt?: string; envelopeId?: string; outcome?: string };
/**
 * One message this desktop asked the relay to send. `unknown`: no reply came back; `failed`: refused, or the relay
 * reports the send failed; `not-sent`: the relay confirmed it never received it (message-log.ts). The relay's own
 * statuses (`queued`, `sent`, `delivered`, `read`) are copied in by a check. `checkedAt`: the last relay lookup.
 * `accountId`: the hosted account of the pairing that sent it (the relay answers lookups per account, so an entry
 * from another pairing is never checked). `lastAttemptAt`: the last time this desktop posted it (a retry of an
 * `unknown` entry refreshes it; a check waits `RECHECK_AFTER_MS` after it before reading "not received" as `not-sent`).
 */
export type LogStatus = 'unknown' | 'queued' | 'failed' | 'not-sent' | 'sent' | 'delivered' | 'read';
export type LogEntry = { id: string; event: MessageEvent; channel: Channel; status: LogStatus; at: string; buttons: 'open-only' | 'approve-not-now-open';
  actionId: string | null; offerId: string | null; memberId: string; idempotencyKey: string; messageId: string | null; pendingOffer?: { approve: SealedBlob; notNow: SealedBlob }; errorCode?: string;
  checkedAt?: string; accountId?: string; lastAttemptAt?: string };
type ChannelRecord = { channel: Channel; enabled: boolean; optInAt: string | null; textSha256: string | null; relay: ChannelRow | null };
type Upload = { backupId: string; status: 'unknown' | 'stored' | 'failed'; sizeBytes: number; sha256: string; createdAt: string };
export type HostedLinkState = {
  version: 1;
  pairing: Pairing | null;
  challenge: { challengeId: string; phoneMasked: string; expiresAt: string } | null;
  /** The 32-byte relay sealing key (base64), created at pairing. */
  relayKey: string | null;
  account: { plan: 'free' | 'paid'; entitlements: Entitlements; deviceCount: number; refreshedAt: string } | null;
  offers: Offer[];
  messages: LogEntry[];
  channels: ChannelRecord[];
  channelsRefreshedAt: string | null;
  backup: { key: string | null; uploads: Upload[] };
  /** Picked Google Drive sync files (see drive-transport.ts), recorded by the host that created them. */
  drive: { folderId: string; headFileId: string; recordedAt: string } | null;
};
export const initialHostedLinkState = (): HostedLinkState => ({ version: 1, pairing: null, challenge: null, relayKey: null, account: null, offers: [], messages: [],
  channels: CHANNELS.map(channel => ({ channel, enabled: false, optInAt: null, textSha256: null, relay: null })), channelsRefreshedAt: null, backup: { key: null, uploads: [] }, drive: null });

const view = (host: ModuleHost): HostedLinkState => structuredClone(peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID) ?? initialHostedLinkState());
const change = <T>(host: ModuleHost, work: (s: HostedLinkState, state: State) => T): Promise<T> =>
  host.store.update(state => work(moduleState(state, MODULE_ID, initialHostedLinkState), state));

type Configured = { client: HostedClient | null; linkOrigin: string | null; clock: () => Date };
export function configuration(host: ModuleHost): Configured {
  const options = host.options as { origin?: unknown; fetch?: unknown; linkOrigin?: unknown; clock?: unknown };
  const clock = typeof options.clock === 'function' ? options.clock as () => Date : () => new Date();
  if (options.origin === undefined || options.origin === null) return { client: null, linkOrigin: null, clock };
  const fetcher: Fetch = typeof options.fetch === 'function' ? options.fetch as Fetch : (url, init) => fetch(url, init as RequestInit);
  const client = new HostedClient({ origin: options.origin as string, fetch: fetcher });
  return { client, linkOrigin: options.linkOrigin === undefined ? client.origin : hostedOrigin(options.linkOrigin), clock };
}
/**
 * Start-up options for the installed app (EngineModule.hostOptions): the hosted origin and the link origin come from
 * CHAUSAR_HOSTED_ORIGIN and CHAUSAR_LINK_ORIGIN, and requests use the platform fetch. Demo mode, an absent or an
 * invalid origin leave the module unconfigured, so every hosted call refuses HOSTED_NOT_CONFIGURED.
 */
export function hostOptions(input: { readonly demo: boolean; readonly env: Readonly<Record<string, string | undefined>> }): Record<string, unknown> {
  if (input.demo) return {};
  const origin = input.env.CHAUSAR_HOSTED_ORIGIN?.trim(), link = input.env.CHAUSAR_LINK_ORIGIN?.trim();
  if (!origin) return {};
  try { hostedOrigin(origin); if (link) hostedOrigin(link); } catch { return {}; }
  return { origin, ...(link ? { linkOrigin: link } : {}) };
}
const at = (c: Configured) => { const time = c.clock(); check(time instanceof Date && Number.isFinite(time.getTime()), 'HOSTED_CLOCK_INVALID', 'The host clock is unavailable.'); return time; };
export function connected(host: ModuleHost) {
  const c = configuration(host); check(c.client, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  const s = view(host); check(s.pairing && s.relayKey, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
  return { c, client: c.client, pairing: s.pairing, relayKey: s.relayKey, s };
}
/** Exact payload keys; anything else is refused before work starts. */
export function input(payload: Record<string, any>, required: readonly string[], optional: readonly string[] = []) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => required.includes(k) || optional.includes(k)) && required.every(k => Object.hasOwn(payload, k)),
    'INVALID_REQUEST', 'The request has missing or unexpected fields.');
  return payload;
}
export const desktopOnly = (ctx: Context) => check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Open the desktop app for this request.');
const indianMonth = (time: Date) => new Date(time.getTime() + 330 * 60000).toISOString().slice(0, 7);
const optInHash = (channel: Channel) => createHash('sha256').update(OPT_IN_TEXT[channel], 'utf8').digest('hex');

// Status and pairing

export function status(_ctx: Context, _payload: Record<string, any>, host: ModuleHost) {
  const c = configuration(host), s = view(host);
  return { configured: !!c.client, paired: !!s.pairing, demo: host.demo,
    pairing: s.pairing ? { accountId: s.pairing.accountId, deviceId: s.pairing.deviceId, pairedAt: s.pairing.pairedAt, phoneMasked: s.pairing.phoneMasked, sessionExpiresAt: s.pairing.sessionExpiresAt } : null,
    account: s.account ? structuredClone(s.account) : null, labels: { ...LABELS } };
}
export async function pairStart(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['phone']);
  const c = configuration(host); check(c.client, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  check(typeof payload.phone === 'string' && /^\+91[6-9]\d{9}$/.test(payload.phone), 'INVALID_PHONE', 'Use an Indian mobile number starting with +91.');
  check(!view(host).pairing, 'HOSTED_ALREADY_PAIRED', 'This computer is already paired. Unpair it first.');
  const challenge = await c.client.otpStart(payload.phone);
  const phoneMasked = `+91******${payload.phone.slice(-4)}`;
  await change(host, s => { s.challenge = { challengeId: challenge.challengeId, phoneMasked, expiresAt: challenge.expiresAt }; });
  return { challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, phoneMasked };
}
export async function pairFinish(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['challengeId', 'code', 'deviceName']);
  const c = configuration(host); check(c.client, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  const s = view(host); check(!s.pairing, 'HOSTED_ALREADY_PAIRED', 'This computer is already paired. Unpair it first.');
  check(s.challenge && payload.challengeId === s.challenge.challengeId, 'PAIRING_NOT_STARTED', 'Ask for a code first.');
  check(typeof payload.code === 'string' && /^[0-9]{4,8}$/.test(payload.code), 'OTP_INVALID', 'That code is not right.');
  check(typeof payload.deviceName === 'string' && payload.deviceName.trim().length > 0 && payload.deviceName.length <= 80 && !/[\x00-\x1f\x7f]/.test(payload.deviceName), 'INVALID_REQUEST', 'Name this computer in at most eighty characters.');
  const verified = await c.client.otpVerify({ challengeId: payload.challengeId, code: payload.code, deviceName: payload.deviceName.trim() });
  const pairedAt = at(c).toISOString();
  const paired = await change(host, (m, state) => {
    check(!m.pairing && m.challenge?.challengeId === payload.challengeId, 'PAIRING_NOT_STARTED', 'Ask for a code first.');
    m.pairing = { accountId: verified.accountId, deviceId: verified.deviceId, sessionToken: verified.sessionToken, sessionExpiresAt: verified.expiresAt, pairedAt, phoneMasked: m.challenge!.phoneMasked };
    m.relayKey = newKey(); m.challenge = null; m.offers = []; m.account = null;
    audit(state, 'hosted.paired', { deviceId: verified.deviceId });
    return { paired: true, accountId: verified.accountId, deviceId: verified.deviceId, pairedAt };
  });
  // Phone documents: a fresh X25519 key for this device; when the server cannot take it now, phone.documents.collect registers it later.
  await registerAfterPairing(ctx, host);
  return paired;
}
export async function unpair(ctx: Context, _payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(_payload, []);
  const s = view(host); let serverRevoked = false;
  if (s.pairing && !host.demo) {
    try { const c = configuration(host); if (c.client) { await c.client.revokeDevice(s.pairing.sessionToken, s.pairing.deviceId); serverRevoked = true; } }
    catch { serverRevoked = false; }
  }
  await change(host, (m, state) => {
    const was = !!m.pairing;
    m.pairing = null; m.relayKey = null; m.challenge = null; m.account = null;
    for (const offer of m.offers) if (!offer.used) { offer.used = true; offer.outcome = 'unpaired'; }
    for (const record of m.channels) record.relay = null;
    if (was) audit(state, 'hosted.unpaired', { serverRevoked });
  });
  return { paired: false, serverRevoked, credentialsForgotten: true };
}
export async function accountRefresh(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const { client, pairing, c } = connected(host);
  const me = await client.me(pairing.sessionToken);
  check(me.accountId === pairing.accountId, 'HOSTED_REPLY_INVALID', 'The hosted service sent a reply this app does not understand.');
  const account = { plan: me.plan, entitlements: me.entitlements, deviceCount: me.devices.length, refreshedAt: at(c).toISOString() };
  await change(host, m => { if (m.pairing?.accountId === me.accountId) m.account = structuredClone(account); });
  return account;
}

// Channels and templates

export async function channelsList(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const c = configuration(host), s = view(host); let stale = true;
  if (c.client && s.pairing && !host.demo) {
    try {
      const rows = await c.client.channels(s.pairing.sessionToken), refreshed = at(c).toISOString();
      await change(host, m => { for (const record of m.channels) record.relay = rows.find(row => row.channel === record.channel) ?? null; m.channelsRefreshedAt = refreshed; });
      stale = false;
    } catch (error) { if (!(error instanceof ChausarError)) throw error; }
  }
  const current = view(host);
  return { stale, refreshedAt: current.channelsRefreshedAt, channels: current.channels.map(record => ({ channel: record.channel,
    desktop: { enabled: record.enabled, optInAt: record.optInAt }, relay: record.relay ? structuredClone(record.relay) : null })) };
}
export async function channelsSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['channel', 'enabled', 'optIn'], ['address']);
  const channel = payload.channel as Channel;
  check(CHANNELS.includes(channel) && typeof payload.enabled === 'boolean' && typeof payload.optIn === 'boolean', 'INVALID_REQUEST', 'Choose a channel and whether it is on.');
  check(!payload.enabled || payload.optIn === true, 'OPT_IN_REQUIRED', 'Tick the opt-in wording to turn this channel on.');
  check(payload.address === undefined || (channel === 'mail' && isMailAddress(payload.address)),
    'INVALID_ADDRESS', 'Only mail takes an address, and it must be a mail address.');
  const { client, pairing, c } = connected(host);
  const recordedAt = at(c).toISOString(), textSha256 = optInHash(channel);
  const row = await client.setChannel(pairing.sessionToken, channel, { enabled: payload.enabled, optIn: payload.enabled ? { given: true, textSha256, recordedAt } : null, ...(payload.address === undefined ? {} : { address: payload.address }) });
  await change(host, (m, state) => {
    const record = m.channels.find(item => item.channel === channel)!;
    record.enabled = payload.enabled; record.relay = structuredClone(row);
    if (payload.enabled) { record.optInAt = recordedAt; record.textSha256 = textSha256; }
    audit(state, 'hosted.channel.set', { channel, enabled: payload.enabled, optInTextSha256: payload.enabled ? textSha256 : null });
  });
  return row;
}
export function templatesPreview(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const c = configuration(host); check(c.linkOrigin, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  check(!hasDigit(c.linkOrigin), 'HOSTED_ORIGIN_INVALID', 'The link address must not contain a digit.');
  const link = `${c.linkOrigin}/l/${LINK_PLACEHOLDER}`;
  const preview = { link, linkNote: 'Each message has its own link. The letters are different every time.', channels: CHANNELS.map(channel => ({
    channel, optInText: OPT_IN_TEXT[channel],
    messages: MESSAGE_EVENTS.map(event => ({ event, headline: HEADLINES[event], opens: DESTINATION_OF[event], body: messageBody(event, link, channel),
      ...(channel === 'whatsapp' ? { whatsappTemplate: WHATSAPP_TEMPLATE[event] } : {}),
      buttons: event === 'review-ready' ? [BUTTONS.approve, BUTTONS.notNow, BUTTONS.open] : [BUTTONS.open] })),
    ...(channel === 'mail' ? { footer: MAIL_FOOTER, confirmation: confirmationPreview(`${c.linkOrigin}/v/${LINK_PLACEHOLDER}`) } : {}) })),
  approvalButtonsNote: 'Approve and Not now appear only for a small change inside your workspace that can be undone. They work once and stop working after half an hour.',
  replies: { ...REPLIES }, linkPage: { ...LINK_PAGE } };
  check(!hasDigit(JSON.stringify(preview)), 'TEMPLATE_INVALID', 'A message template contains a digit.');
  return preview;
}

// Messages and sealed approvals

export async function messageCounts(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, [], ['month']);
  const { client, pairing, c } = connected(host);
  const month = payload.month ?? indianMonth(at(c));
  check(typeof month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month), 'INVALID_REQUEST', 'Use a month as year and month.');
  const counts = await client.counts(pairing.sessionToken, month);
  return { ...counts, remaining: Math.max(0, counts.budget - counts.sent), desktopBudget: MESSAGE_BUDGET };
}

const IMPACT_REASON: Record<string, string> = { money: 'money', message: 'message-to-outsiders', destructive: 'deleting-or-cannot-undo' };
/** Why an action cannot get one-tap buttons, or null when it can. Re-checked again before any relayed approval. */
export function offerIneligibility(actions: ActionService, state: State, ctx: Context, actionId: unknown): string | null {
  const action = typeof actionId === 'string' ? state.actions.find(item => item.id === actionId) as PreparedAction | undefined : undefined;
  if (!action) return 'not-a-single-action';
  try { actions.access(state, ctx, action); } catch { return 'not-a-single-action'; }
  if (action.status !== 'prepared' || action.attempts.length !== 0 || action.approval) return 'not-waiting';
  if (action.impact !== 'reversible') return IMPACT_REASON[action.impact] ?? 'cannot-undo';
  if (action.connector !== 'local') return 'outside-workspace';
  try { if (actions.operation(action.connector, action.operation).impact !== 'reversible') return 'catalogue-changed'; } catch { return 'catalogue-changed'; }
  if (action.digest !== actions.identity(action)) return 'preview-changed';
  return null;
}
export async function messageSend(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['event', 'channel'], ['actionId']);
  const event = payload.event as MessageEvent, channel = payload.channel as Channel, actionId: string | null = payload.actionId ?? null;
  check(MESSAGE_EVENTS.includes(event) && CHANNELS.includes(channel), 'INVALID_REQUEST', 'Choose a message and a channel.');
  check(actionId === null || (event === 'review-ready' && typeof actionId === 'string' && actionId.length > 0 && actionId.length <= 200), 'INVALID_REQUEST', 'Only a review message can name one action.');
  const { client, pairing, c } = connected(host);
  const actions = host.services.actions as ActionService;
  const time = at(c), sentAt = time.toISOString();
  const entry = await change(host, (m, state) => {
    check(m.pairing?.accountId === pairing.accountId && m.relayKey, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
    // Only an `unknown` entry is resent, with its own key and blobs (the relay deduplicates it). An entry a check
    // found `not-sent` is never resent: sending again makes a new entry with a new key and freshly sealed buttons.
    // Only this pairing's own entries: the relay knows a key only under the account that sent it.
    const retry = m.messages.find(item => item.status === 'unknown' && item.accountId === pairing.accountId && item.event === event && item.channel === channel
      && item.actionId === actionId && item.memberId === ctx.memberId);
    if (retry) {
      // Every attempt moves the check's waiting time on: a lookup racing this post must not read "not received" as never sent.
      retry.lastAttemptAt = sentAt;
      return { entry: structuredClone(retry), reason: null as string | null, offer: m.offers.find(o => o.offerId === retry.offerId) ?? null, retried: true };
    }
    // Mail has no owner binding (a forwarded mail would approve), so mail only ever carries Open the app.
    const reason = actionId !== null ? (channel === 'mail' ? 'mail-has-no-approve' : offerIneligibility(actions, state, ctx, actionId)) : event === 'review-ready' ? 'not-a-single-action' : null;
    const id = newId('message'), idempotencyKey = createHash('sha256').update(`chausar-relay-message|${event}|${channel}|${actionId ?? '-'}|${id}`).digest('hex');
    let offer: Offer | null = null, pendingOffer: LogEntry['pendingOffer'];
    if (actionId !== null && reason === null) {
      const action = state.actions.find(item => item.id === actionId) as PreparedAction;
      offer = { offerId: newId('offer'), actionId, digest: action.digest, revision: action.revision, memberId: ctx.memberId, epoch: ctx.epoch, channel, entryId: id,
        messageId: null, createdAt: sentAt, expiresAt: new Date(time.getTime() + OFFER_TTL_MS).toISOString(), used: false };
      const seal = (decision: Decision) => sealIntent(m.relayKey!, pairing.accountId, { v: 1, offerId: offer!.offerId, actionId, digest: offer!.digest, decision, expiresAt: offer!.expiresAt });
      pendingOffer = { approve: seal('approve'), notNow: seal('not-now') };
      m.offers.push(offer);
      // Used offers are history; keep the newest five hundred so the vault does not grow without bound.
      const used = m.offers.filter(o => o.used);
      if (used.length > 500) { const drop = new Set(used.slice(0, used.length - 500)); m.offers = m.offers.filter(o => !drop.has(o)); }
    }
    const created: LogEntry = { id, event, channel, status: 'unknown', at: sentAt, buttons: offer ? 'approve-not-now-open' : 'open-only', actionId, offerId: offer?.offerId ?? null,
      memberId: ctx.memberId, idempotencyKey, messageId: null, accountId: pairing.accountId, lastAttemptAt: sentAt, ...(pendingOffer ? { pendingOffer } : {}) };
    m.messages.push(created); if (m.messages.length > 500) m.messages.splice(0, m.messages.length - 500);
    return { entry: structuredClone(created), reason, offer: offer ? structuredClone(offer) : null, retried: false };
  });
  const { entry: record, offer } = entry;
  let reply;
  try { reply = await client.sendMessage(pairing.sessionToken, { event, channel, idempotencyKey: record.idempotencyKey, ...(record.pendingOffer ? { offer: record.pendingOffer } : {}) }); }
  catch (error) {
    const code = error instanceof ChausarError ? error.code : 'HOSTED_UNREACHABLE';
    // A lost connection or an unreadable reply leaves the outcome unknown; a retry reuses the same key.
    if (!['HOSTED_UNREACHABLE', 'HOSTED_REPLY_INVALID'].includes(code)) await change(host, m => {
      const item = m.messages.find(x => x.id === record.id); if (item) { item.status = 'failed'; item.errorCode = code; delete item.pendingOffer; }
      const voided = m.offers.find(o => o.offerId === record.offerId); if (voided && !voided.used) { voided.used = true; voided.outcome = 'not-sent'; }
    });
    throw error;
  }
  await change(host, (m, state) => {
    const item = m.messages.find(x => x.id === record.id); if (item) { item.status = 'queued'; item.messageId = reply.messageId; delete item.pendingOffer; }
    const sent = m.offers.find(o => o.offerId === record.offerId); if (sent) sent.messageId = reply.messageId;
    audit(state, 'hosted.relay.message', { event, channel, buttons: record.buttons });
  });
  return { messageId: reply.messageId, status: reply.status, event, channel, buttons: record.buttons, reason: record.buttons === 'open-only' ? entry.reason : null,
    offer: offer ? { offerId: offer.offerId, expiresAt: offer.expiresAt } : null, month: reply.month, sent: reply.sent, budget: reply.budget, retried: entry.retried };
}

type Collected = { envelopeId: string; decision: Decision; outcome: 'approved' | 'not-now' | 'refused' | 'expired' | 'invalid' | 'replayed' | 'already-applied' | 'other-member' | 'not-ours'; reason?: string; acked: boolean };
async function applyEnvelope(ctx: Context, host: ModuleHost, c: Configured, pairing: Pairing, relayKey: string, envelope: SealedEnvelope): Promise<Collected> {
  const client = c.client!, actions = host.services.actions as ActionService;
  const finish = async (outcome: Collected['outcome'], disposition: 'collected' | 'expired' | 'invalid' | null, reason?: string): Promise<Collected> => {
    let acked = false;
    if (disposition) { try { await client.ackEnvelope(pairing.sessionToken, envelope.envelopeId, disposition); acked = true; } catch { acked = false; } }
    return { envelopeId: envelope.envelopeId, decision: envelope.decision, outcome, ...(reason ? { reason } : {}), acked };
  };
  let intent;
  // An envelope this computer cannot open, or whose offer it never made, may belong to another computer on the
  // same account: it is left for that computer (or to expire), never acknowledged away.
  try { intent = openIntent(relayKey, pairing.accountId, envelope.decision, envelope); }
  catch { return finish('not-ours', null); }
  const time = at(c).getTime();
  const claim = await change(host, (m, state) => {
    const offer = m.offers.find(o => o.offerId === intent.offerId);
    if (!offer) return { outcome: 'not-ours' as const };
    if (offer.actionId !== intent.actionId || offer.digest !== intent.digest || offer.expiresAt !== intent.expiresAt
      || offer.channel !== envelope.channel || (offer.messageId !== null && offer.messageId !== envelope.messageId)) return { outcome: 'invalid' as const };
    if (offer.memberId !== ctx.memberId || offer.epoch !== ctx.epoch) return { outcome: 'other-member' as const };
    // An approval interrupted between the claim and actions.approve resumes on the next collect, through every check below.
    const resuming = offer.used && offer.envelopeId === envelope.envelopeId && offer.outcome === 'approving';
    if (offer.used && !resuming) return { outcome: offer.envelopeId === envelope.envelopeId ? 'already-applied' as const : 'replayed' as const };
    if (!resuming) { offer.used = true; offer.usedAt = new Date(time).toISOString(); offer.envelopeId = envelope.envelopeId; }
    if (!(time < Date.parse(offer.expiresAt) && time < Date.parse(envelope.expiresAt))) {
      offer.outcome = 'expired'; audit(state, 'hosted.relay.expired', { actionId: offer.actionId, channel: envelope.channel }); return { outcome: 'expired' as const };
    }
    const action = state.actions.find(item => item.id === offer.actionId) as PreparedAction | undefined;
    const reason = !action || action.digest !== offer.digest || action.revision !== offer.revision ? 'action-changed' : offerIneligibility(actions, state, ctx, offer.actionId);
    if (reason) { offer.outcome = 'refused'; audit(state, 'hosted.relay.refused', { actionId: offer.actionId, reason, channel: envelope.channel }); return { outcome: 'refused' as const, reason }; }
    if (intent.decision === 'not-now') { offer.outcome = 'not-now'; audit(state, 'hosted.relay.notNow', { actionId: offer.actionId, digest: offer.digest, channel: envelope.channel }); return { outcome: 'not-now' as const }; }
    offer.outcome = 'approving'; return { outcome: 'approve' as const, actionId: offer.actionId, digest: offer.digest };
  });
  if (claim.outcome === 'invalid' || claim.outcome === 'replayed') return finish(claim.outcome, 'invalid');
  if (claim.outcome === 'other-member' || claim.outcome === 'not-ours') return finish(claim.outcome, null);
  if (claim.outcome === 'expired') return finish('expired', 'expired');
  if (claim.outcome === 'already-applied' || claim.outcome === 'not-now') return finish(claim.outcome, 'collected');
  if (claim.outcome === 'refused') return finish('refused', 'collected', claim.reason);
  if (claim.outcome !== 'approve') return finish('invalid', 'invalid');
  // Approve only: execution stays a separate step inside the app.
  try { await actions.approve(ctx, claim.actionId, claim.digest); }
  catch (error) {
    const done = host.store.read().actions.find(item => item.id === claim.actionId) as PreparedAction | undefined;
    if (done?.status === 'approved' && done.approval?.digest === claim.digest && done.approval.memberId === ctx.memberId) {
      await change(host, (m, state) => { const offer = m.offers.find(o => o.offerId === intent.offerId); if (offer) offer.outcome = 'approved'; audit(state, 'hosted.relay.approved', { actionId: claim.actionId, digest: claim.digest, channel: envelope.channel }); });
      return finish('approved', 'collected');
    }
    const code = error instanceof ChausarError ? error.code : 'APPROVAL_FAILED';
    await change(host, (m, state) => { const offer = m.offers.find(o => o.offerId === intent.offerId); if (offer) offer.outcome = 'refused'; audit(state, 'hosted.relay.refused', { actionId: claim.actionId, reason: code, channel: envelope.channel }); });
    return finish('refused', 'collected', code);
  }
  await change(host, (m, state) => { const offer = m.offers.find(o => o.offerId === intent.offerId); if (offer) offer.outcome = 'approved'; audit(state, 'hosted.relay.approved', { actionId: claim.actionId, digest: claim.digest, channel: envelope.channel }); });
  return finish('approved', 'collected');
}
export async function relayCollect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot authorize an action.');
  const { client, pairing, relayKey, c } = connected(host);
  const envelopes = await client.envelopes(pairing.sessionToken);
  const collected: Collected[] = [];
  for (const envelope of envelopes) collected.push(await applyEnvelope(ctx, host, c, pairing, relayKey, envelope));
  return { collected };
}

// Encrypted backup

export async function backupUpload(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing, c } = connected(host);
  const backupKey = await change(host, m => (m.backup.key ??= newKey()));
  // The vault's own encrypted backup, made by the core method; this lane only wraps it.
  const local = await host.call('workspace.backup', {}) as { path: string };
  check(local && typeof local.path === 'string', 'BACKUP_FAILED', 'The local backup could not be made.');
  const size = (await stat(local.path)).size;
  check(size > 0 && size <= MAX_BACKUP_BYTES - 64, 'BACKUP_TOO_LARGE', 'The backup is too large to upload.');
  const inner = await readFile(local.path);
  const backupId = `bk_${randomBytes(16).toString('hex')}`;
  const wrapped = wrapBackup(backupKey, pairing.accountId, backupId, inner), digest = sha256Hex(wrapped), createdAt = at(c).toISOString();
  await change(host, m => { m.backup.uploads.push({ backupId, status: 'unknown', sizeBytes: wrapped.length, sha256: digest, createdAt }); if (m.backup.uploads.length > 200) m.backup.uploads.splice(0, m.backup.uploads.length - 200); });
  let stored;
  try { stored = await client.putBackup(pairing.sessionToken, backupId, wrapped); }
  catch (error) {
    const code = error instanceof ChausarError ? error.code : 'HOSTED_UNREACHABLE';
    if (!['HOSTED_UNREACHABLE', 'HOSTED_REPLY_INVALID'].includes(code)) await change(host, m => { const item = m.backup.uploads.find(u => u.backupId === backupId); if (item) item.status = 'failed'; });
    throw error;
  }
  await change(host, (m, state) => { const item = m.backup.uploads.find(u => u.backupId === backupId); if (item) { item.status = 'stored'; item.createdAt = stored.createdAt; } audit(state, 'hosted.backup.uploaded', { backupId, sha256: digest }); });
  return { ...stored, localBackupFile: basename(local.path), label: LABELS.backup };
}
export async function backupList(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const { client, pairing, s } = connected(host);
  const listed = await client.listBackups(pairing.sessionToken);
  return { ...listed, backups: listed.backups.map(entry => ({ ...entry, madeHere: s.backup.uploads.some(u => u.backupId === entry.backupId) })),
    keyHeldHere: !!s.backup.key, label: LABELS.backup };
}
export async function backupRestore(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['backupId'], ['backupKey']);
  check(typeof payload.backupId === 'string' && BACKUP_ID.test(payload.backupId), 'INVALID_REQUEST', 'Choose a backup from the list.');
  check(payload.backupKey === undefined || (typeof payload.backupKey === 'string' && payload.backupKey.length === 44), 'BACKUP_KEY_INVALID', 'The backup key is not in the right form.');
  const { client, pairing, s } = connected(host);
  const backupKey = payload.backupKey ?? s.backup.key;
  check(backupKey, 'BACKUP_KEY_MISSING', 'Restoring needs the backup key. It is in the vault that made the backup, or in your recovery kit if you exported it.');
  const { bytes, sha256 } = await client.getBackup(pairing.sessionToken, payload.backupId);
  const known = s.backup.uploads.find(u => u.backupId === payload.backupId && u.status === 'stored');
  check(!known || known.sha256 === sha256, 'HOSTED_BACKUP_INVALID', 'The downloaded backup is not the one uploaded from here.');
  const inner = unwrapBackup(backupKey, pairing.accountId, payload.backupId, bytes);
  let parsed: any; try { parsed = JSON.parse(inner.toString('utf8')); } catch { parsed = null; }
  check(parsed && typeof parsed === 'object' && Object.keys(parsed).sort().join(',') === 'backupFormat,envelope' && parsed.backupFormat === 'chausar.backup.v1',
    'HOSTED_BACKUP_INVALID', 'The downloaded file is not a Chausar vault backup.');
  const folder = join(host.directory, 'backups'), backupFile = `chausar-hosted-${payload.backupId}.backup`;
  await mkdir(folder, { recursive: true });
  try { await writeFile(join(folder, backupFile), inner, { flag: 'wx', mode: 0o600 }); }
  catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    check((await readFile(join(folder, backupFile))).equals(inner), 'HOSTED_BACKUP_INVALID', 'A different file already has this backup\'s name.');
  }
  await change(host, (_m, state) => audit(state, 'hosted.backup.downloaded', { backupId: payload.backupId }));
  return { backupFile, restoreWith: 'workspace.restore', needs: 'The vault passphrase of the workspace that made this backup.' };
}
export async function backupExportKey(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  const backupKey = await change(host, (m, state) => { m.backup.key ??= newKey(); audit(state, 'hosted.backup.keyExported', {}); return m.backup.key; });
  return { backupKey, secret: true, label: 'Secret. Keep this with your recovery kit. Restoring a hosted backup on a new computer needs it.' };
}

// Allowance and worker

export async function allowanceStatus(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const { client, pairing } = connected(host);
  return client.allowance(pairing.sessionToken);
}
export type AllowanceCompletion = { text: string; usage: { inputTokens: number; outputTokens: number }; costPaise: string;
  receipt: { route: 'chausar-allowance'; requestId: string; requestBody: string; replyBody: string; at: string } };
/**
 * The managed allowance route for the models-ext route catalogue. One attempt per request id; the receipt
 * holds the exact request body sent and the exact reply body received. A lost connection is an unknown
 * outcome (the server keeps the reservation until it settles); the caller must not retry with a new id.
 * Not wired into the gateway here: the models-ext lane owns routes and adds it to its catalogue.
 */
export class AllowanceRouteClient {
  readonly #client: HostedClient;
  readonly #token: () => string | Promise<string>;
  readonly #clock: () => Date;
  constructor(options: { client: HostedClient; sessionToken: () => string | Promise<string>; clock?: () => Date }) {
    this.#client = options.client; this.#token = options.sessionToken; this.#clock = options.clock ?? (() => new Date());
  }
  async complete(request: Omit<AllowanceRequest, 'requestId'> & { requestId?: string }): Promise<AllowanceCompletion> {
    const r = input(request as Record<string, any>, ['route', 'model', 'messages', 'maxOutputTokens'], ['requestId', 'system']);
    const requestId = r.requestId ?? newId('req');
    check(typeof requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(requestId) && ['anthropic', 'openai'].includes(r.route) && typeof r.model === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(r.model)
      && (r.system === undefined || (typeof r.system === 'string' && r.system.length <= 100000)) && Number.isSafeInteger(r.maxOutputTokens) && r.maxOutputTokens >= 1 && r.maxOutputTokens <= 64000
      && Array.isArray(r.messages) && r.messages.length >= 1 && r.messages.length <= 200
      && r.messages.every((m: any) => m && Object.keys(m).sort().join(',') === 'content,role' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 200000),
    'INVALID_REQUEST', 'The model request is not in the allowance form.');
    const body: AllowanceRequest = { requestId, route: r.route, model: r.model, ...(r.system === undefined ? {} : { system: r.system }),
      messages: r.messages.map((m: any) => ({ role: m.role, content: m.content })), maxOutputTokens: r.maxOutputTokens };
    const { reply, sent, received } = await this.#client.complete(await this.#token(), body);
    return { text: reply.text, usage: { ...reply.usage }, costPaise: reply.costPaise, receipt: { route: 'chausar-allowance', requestId, requestBody: sent, replyBody: received, at: this.#clock().toISOString() } };
  }
}
/** The allowance route for this workspace's pairing, for a host composition (models-ext) to register. */
export function allowanceRouteFor(host: ModuleHost): AllowanceRouteClient {
  const { client, c } = connected(host);
  return new AllowanceRouteClient({ client, clock: c.clock, sessionToken: () => {
    const pairing = view(host).pairing; check(pairing, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.'); return pairing.sessionToken;
  } });
}
export async function workerStatus(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const { client, pairing } = connected(host);
  const worker = await client.worker(pairing.sessionToken);
  return { endToEndEncrypted: false, label: worker.label, desktopLabel: LABELS.worker, jobs: worker.jobs };
}
export async function workerSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['type', 'enabled'], ['consent']);
  check(typeof payload.type === 'string' && /^[a-z][a-z-]{1,60}$/.test(payload.type) && typeof payload.enabled === 'boolean', 'INVALID_REQUEST', 'Choose a job and whether it is on.');
  check(!payload.enabled || payload.consent === true, 'CONSENT_REQUIRED', 'Turning on an always-on job needs your agreement that it is not end-to-end encrypted.');
  const { client, pairing, c } = connected(host);
  const recordedAt = at(c).toISOString();
  const job = await client.setWorkerJob(pairing.sessionToken, payload.type, { enabled: payload.enabled, consent: payload.enabled ? { notEndToEndEncrypted: true, recordedAt } : null });
  await change(host, (_m, state) => audit(state, 'hosted.worker.set', { type: payload.type, enabled: payload.enabled, consentAt: payload.enabled ? recordedAt : null }));
  return { ...job, label: LABELS.worker };
}
/**
 * Sends the due dates the reminder job uses: date only, never an amount or a name, each with a plain id the
 * caller chooses (for example from the compliance calendar). The server stores them only after consent.
 */
export async function workerDueDates(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['dueDates']);
  const list = payload.dueDates;
  check(Array.isArray(list) && list.length <= 200 && list.every((d: any) => d && typeof d === 'object' && !Array.isArray(d)
    && Object.keys(d).sort().join() === 'date,id,remindDaysBefore' && typeof d.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(d.id)
    && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isSafeInteger(d.remindDaysBefore) && d.remindDaysBefore >= 0 && d.remindDaysBefore <= 30),
  'INVALID_REQUEST', 'Send at most two hundred due dates, each a plain id, a date and how many days ahead to remind.');
  const { client, pairing } = connected(host);
  const result = await client.setDueDates(pairing.sessionToken, list.map((d: any) => ({ id: d.id, date: d.date, remindDaysBefore: d.remindDaysBefore })));
  await change(host, (_m, state) => audit(state, 'hosted.worker.dueDates', { stored: result.stored }));
  return { stored: result.stored, label: LABELS.worker };
}
export async function workerDeleteData(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing } = connected(host);
  await client.deleteWorkerData(pairing.sessionToken);
  await change(host, (_m, state) => audit(state, 'hosted.worker.deleted', {}));
  return { deleted: true };
}

// Engine lifecycle

/** Drops offers whose action no longer exists. Nothing else here is derived from a source. */
export function purgeOffers(state: State, reason: { removedIds: ReadonlySet<string> }): number {
  const s = peekModuleState<HostedLinkState>(state, MODULE_ID);
  if (!s) return 0;
  const before = s.offers.length;
  const gone = (actionId: string | null) => actionId !== null && (reason.removedIds.has(actionId) || !state.actions.some(action => action.id === actionId));
  s.offers = s.offers.filter(offer => !gone(offer.actionId));
  // The message log keeps no trace of a removed action: neither its id nor the sealed blobs that name it.
  for (const entry of s.messages) if (gone(entry.actionId)) { entry.actionId = null; delete entry.pendingOffer; }
  return before - s.offers.length;
}
/** Scheduled relay collection, only when configured, paired and not in demo. */
export async function tickCollect(ctx: Context, host: ModuleHost): Promise<unknown[]> {
  if (host.demo) return [];
  let c: Configured; try { c = configuration(host); } catch { return []; }
  const s = peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID);
  if (!c.client || !s?.pairing || !s.relayKey) return [];
  const { collected } = await relayCollect(ctx, {}, host);
  return collected.length ? [{ module: MODULE_ID, collected: collected.map(item => ({ outcome: item.outcome, acked: item.acked })) }] : [];
}
