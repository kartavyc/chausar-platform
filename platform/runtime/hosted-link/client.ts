/**
 * The desktop's client for the hosted API (hosted/API.md, v1). Every reply is size-bounded and checked for
 * its exact keys; an unexpected shape is HOSTED_REPLY_INVALID. A hosted refusal keeps its code when the code
 * is one the contract names, else it becomes HOSTED_REQUEST_FAILED. Messages are fixed desktop sentences:
 * nothing from the server reaches an error. The session token travels only in the Authorization header.
 */
import { createHash } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';
import { CHANNELS, MESSAGE_EVENTS } from './templates.ts';
import type { Channel, MessageEvent } from './templates.ts';

export type FetchReply = { status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> };
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<FetchReply>;

export const MAX_JSON_REPLY = 1024 * 1024;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const KNOWN_CODES: Readonly<Record<string, string>> = Object.freeze({
  UNAUTHENTICATED: 'The hosted session ended. Pair this computer again.',
  PLAN_REQUIRED: 'This needs the paid plan.',
  OTP_RATE_LIMITED: 'Too many codes were asked for. Try again later.',
  OTP_INVALID: 'That code is not right.',
  OTP_EXPIRED: 'That code has expired. Ask for a new one.',
  OTP_LOCKED: 'Too many wrong codes. Ask for a new one later.',
  PAYMENT_PARTNER_NOT_CONFIGURED: 'Payments are not set up yet.',
  OPT_IN_TEXT_CHANGED: 'The opt-in wording changed. Update the app and tick it again.',
  MONTHLY_BUDGET_REACHED: 'This month\'s messages are used up.',
  CHANNEL_OFF: 'That channel is not on.',
  BACKUP_DIGEST_MISMATCH: 'The backup changed on its way to the server.',
  BACKUP_FORMAT_INVALID: 'The server refused the backup format.',
  BACKUP_QUOTA_EXCEEDED: 'The backup storage is full.',
  BACKUP_EXISTS: 'A backup with that name already exists.',
  ALLOWANCE_EXHAUSTED: 'The model allowance for this month is used up.',
  MODEL_NOT_PRICED: 'That model has no price yet.',
  PROVIDER_NOT_CONFIGURED: 'That model provider is not set up on the server.',
  PROVIDER_FAILED: 'The model provider refused the request.',
  PROVIDER_OUTCOME_UNKNOWN: 'The model provider did not confirm the request. Its cost is held until it is settled.',
  REQUEST_EXISTS: 'That request was already made once.',
  NOT_FOUND: 'The server has no such item.',
});
export const HOSTED_CODES: readonly string[] = Object.freeze(Object.keys(KNOWN_CODES));

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const BACKUP_ID = /^bk_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PAISE = /^(?:0|[1-9]\d{0,17})$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Exact keys: every required key present, nothing else. */
export function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  const ok = !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)) && required.every(key => Object.hasOwn(value, key));
  check(ok, 'HOSTED_REPLY_INVALID', 'The hosted service sent a reply this app does not understand.');
  return value as Record<string, any>;
}
const valid = (condition: unknown): void => check(condition, 'HOSTED_REPLY_INVALID', 'The hosted service sent a reply this app does not understand.');
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isoOrNull = (value: unknown) => value === null || iso(value);

export const sha256Hex = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A base URL: https only, no credentials, query, fragment or path. */
export function hostedOrigin(value: unknown): string {
  let url: URL | undefined;
  try { url = typeof value === 'string' && value.length <= 2048 ? new URL(value) : undefined; } catch { url = undefined; }
  check(url && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && !/[?#@]/.test(value as string),
    'HOSTED_ORIGIN_INVALID', 'The hosted address must be a plain https origin.');
  return url.origin;
}

export type Entitlements = { plan: 'free' | 'paid'; relay: boolean; backup: boolean; backupQuotaBytes: number; backupKeep: number; allowance: boolean; allowanceMonthlyPaise: string; worker: boolean; monthlyMessages: number };
export type Me = { accountId: string; phone: string; plan: 'free' | 'paid'; entitlements: Entitlements; devices: { deviceId: string; deviceName: string; createdAt: string; lastSeenAt: string | null; current: boolean }[] };
export type ChannelRow = { channel: Channel; status: 'off' | 'awaiting-start' | 'on' | 'stopped' | 'not-configured'; optInAt: string | null; address: string | null; connectUrl?: string };
export type SealedBlob = { format: 'chausar-relay-sealed-v1'; nonce: string; ciphertext: string };
export type SealedEnvelope = { envelopeId: string; messageId: string; purpose: 'approval-intent'; decision: 'approve' | 'not-now'; channel: Channel; createdAt: string; expiresAt: string; nonce: string; ciphertext: string };
export type Counts = { month: string; sent: number; budget: number; costPaise: string | null; costState: 'known' | 'unknown'; byChannel: Record<Channel, number> };
export type BackupEntry = { backupId: string; sizeBytes: number; sha256: string; createdAt: string };
export type AllowanceRequest = { requestId: string; route: 'anthropic' | 'openai'; model: string; system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxOutputTokens: number };
export type AllowanceReply = { requestId: string; text: string; usage: { inputTokens: number; outputTokens: number }; costPaise: string; balancePaise: string; route: 'anthropic' | 'openai'; model: string; pricingCheckedOn: string };
export type WorkerJob = { type: string; title: string; enabled: boolean; consentAt: string | null; uses: string };

function entitlements(value: unknown): Entitlements {
  const e = shape(value, ['plan', 'relay', 'backup', 'backupQuotaBytes', 'backupKeep', 'allowance', 'allowanceMonthlyPaise', 'worker', 'monthlyMessages']);
  valid(['free', 'paid'].includes(e.plan) && [e.relay, e.backup, e.allowance, e.worker].every(v => typeof v === 'boolean')
    && count(e.backupQuotaBytes) && count(e.backupKeep) && count(e.monthlyMessages) && typeof e.allowanceMonthlyPaise === 'string' && PAISE.test(e.allowanceMonthlyPaise));
  return e as Entitlements;
}
export function channelRow(value: unknown): ChannelRow {
  const row = shape(value, ['channel', 'status', 'optInAt', 'address'], ['connectUrl']);
  valid(CHANNELS.includes(row.channel) && ['off', 'awaiting-start', 'on', 'stopped', 'not-configured'].includes(row.status) && isoOrNull(row.optInAt)
    && (row.address === null || text(row.address, 320)) && (row.connectUrl === undefined || (typeof row.connectUrl === 'string' && /^https:\/\/t\.me\/[A-Za-z0-9_]{1,64}\?start=[A-Za-z]{1,128}$/.test(row.connectUrl))));
  return row as ChannelRow;
}
function backupEntry(value: unknown): BackupEntry {
  const entry = shape(value, ['backupId', 'sizeBytes', 'sha256', 'createdAt']);
  valid(BACKUP_ID.test(entry.backupId) && count(entry.sizeBytes) && SHA256.test(entry.sha256) && iso(entry.createdAt));
  return entry as BackupEntry;
}
export function sealedEnvelope(value: unknown): SealedEnvelope {
  const e = shape(value, ['envelopeId', 'messageId', 'purpose', 'decision', 'channel', 'createdAt', 'expiresAt', 'nonce', 'ciphertext']);
  valid(text(e.envelopeId, 128) && ID.test(e.envelopeId) && text(e.messageId, 128) && ID.test(e.messageId) && e.purpose === 'approval-intent' && ['approve', 'not-now'].includes(e.decision)
    && CHANNELS.includes(e.channel) && iso(e.createdAt) && iso(e.expiresAt) && typeof e.nonce === 'string' && e.nonce.length <= 24 && BASE64.test(e.nonce)
    && typeof e.ciphertext === 'string' && e.ciphertext.length <= 8192 && BASE64.test(e.ciphertext));
  return e as SealedEnvelope;
}

/** One call's failure as a typed refusal. The server's own message is never used. */
async function refusal(reply: FetchReply): Promise<never> {
  let code = 'HOSTED_REQUEST_FAILED';
  try {
    const raw = await reply.text();
    if (raw.length <= 8192) {
      const body = JSON.parse(raw);
      const candidate = body?.error?.code;
      if (typeof candidate === 'string' && Object.hasOwn(KNOWN_CODES, candidate)) code = candidate;
    }
  } catch { /* An unreadable refusal stays HOSTED_REQUEST_FAILED. */ }
  throw new ChausarError(code, KNOWN_CODES[code] ?? 'The hosted service refused the request.');
}

export type HostedClientOptions = { origin: string; fetch: Fetch; timeoutMs?: number };

export class HostedClient {
  readonly origin: string;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;
  constructor(options: HostedClientOptions) {
    this.origin = hostedOrigin(options.origin);
    check(typeof options.fetch === 'function', 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up.');
    this.#fetch = options.fetch; this.#timeoutMs = options.timeoutMs ?? 20000;
  }
  async #send(method: string, path: string, options: { token?: string; json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> } = {}): Promise<FetchReply> {
    const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };
    if (options.token !== undefined) {
      check(typeof options.token === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(options.token), 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
      headers.authorization = `Bearer ${options.token}`;
    }
    let body: string | Uint8Array | undefined;
    if (options.json !== undefined) { body = JSON.stringify(options.json); headers['content-type'] = 'application/json'; }
    if (options.bytes !== undefined) { body = options.bytes; headers['content-type'] = 'application/octet-stream'; }
    try { return await this.#fetch(`${this.origin}${path}`, { method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(this.#timeoutMs) }); }
    catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
  }
  /** Sends one JSON call and returns the parsed reply with the exact text sent and received. */
  async #exchange(method: string, path: string, options: { token?: string; json?: unknown; expect?: number[] } = {}): Promise<{ value: any; sent: string | null; received: string }> {
    const reply = await this.#send(method, path, options);
    if (!reply.ok) await refusal(reply);
    valid((options.expect ?? [200]).includes(reply.status));
    const length = Number(reply.headers.get('content-length') ?? '0');
    valid(!(length > MAX_JSON_REPLY));
    let received: string;
    try { received = await reply.text(); } catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
    valid(received.length <= MAX_JSON_REPLY);
    let value: unknown;
    try { value = JSON.parse(received); } catch { valid(false); }
    return { value, sent: options.json === undefined ? null : JSON.stringify(options.json), received };
  }
  async #json(method: string, path: string, options: { token?: string; json?: unknown; expect?: number[] } = {}): Promise<any> {
    return (await this.#exchange(method, path, options)).value;
  }

  // Accounts
  async otpStart(phone: string): Promise<{ challengeId: string; expiresAt: string }> {
    const r = shape(await this.#json('POST', '/v1/accounts/otp/start', { json: { phone }, expect: [202] }), ['challengeId', 'expiresAt']);
    valid(text(r.challengeId, 128) && ID.test(r.challengeId) && iso(r.expiresAt)); return r as any;
  }
  async otpVerify(input: { challengeId: string; code: string; deviceName: string }): Promise<{ accountId: string; deviceId: string; sessionToken: string; expiresAt: string }> {
    const r = shape(await this.#json('POST', '/v1/accounts/otp/verify', { json: input }), ['accountId', 'deviceId', 'sessionToken', 'expiresAt']);
    valid(ID.test(r.accountId ?? '') && ID.test(r.deviceId ?? '') && typeof r.sessionToken === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(r.sessionToken) && iso(r.expiresAt)); return r as any;
  }
  async me(token: string): Promise<Me> {
    const r = shape(await this.#json('GET', '/v1/accounts/me', { token }), ['accountId', 'phone', 'plan', 'entitlements', 'devices']);
    valid(ID.test(r.accountId ?? '') && text(r.phone, 32) && ['free', 'paid'].includes(r.plan) && Array.isArray(r.devices) && r.devices.length <= 100);
    entitlements(r.entitlements);
    for (const device of r.devices) {
      const d = shape(device, ['deviceId', 'deviceName', 'createdAt', 'lastSeenAt', 'current']);
      valid(ID.test(d.deviceId ?? '') && text(d.deviceName, 120) && iso(d.createdAt) && isoOrNull(d.lastSeenAt) && typeof d.current === 'boolean');
    }
    return r as Me;
  }
  async revokeDevice(token: string, deviceId: string): Promise<{ deviceId: string; revokedAt: string }> {
    check(ID.test(deviceId), 'INVALID_REQUEST', 'Use a device from this account.');
    const r = shape(await this.#json('POST', `/v1/accounts/devices/${encodeURIComponent(deviceId)}/revoke`, { token, json: {} }), ['deviceId', 'revokedAt']);
    valid(r.deviceId === deviceId && iso(r.revokedAt)); return r as any;
  }

  // Billing
  async plans(token: string): Promise<{ plans: { plan: string; pricePaise: string; period: 'month'; includes: string[] }[] }> {
    const r = shape(await this.#json('GET', '/v1/billing/plans', { token }), ['plans']);
    valid(Array.isArray(r.plans) && r.plans.length <= 20);
    for (const plan of r.plans) { const p = shape(plan, ['plan', 'pricePaise', 'period', 'includes']); valid(text(p.plan, 40) && typeof p.pricePaise === 'string' && PAISE.test(p.pricePaise) && p.period === 'month' && Array.isArray(p.includes) && p.includes.length <= 50 && p.includes.every((i: unknown) => text(i, 200))); }
    return r as any;
  }
  async subscription(token: string): Promise<{ plan: string; status: string; currentPeriodEnd: string | null; partner: string | null }> {
    const r = shape(await this.#json('GET', '/v1/billing/subscription', { token }), ['plan', 'status', 'currentPeriodEnd', 'partner']);
    valid(text(r.plan, 40) && ['none', 'pending', 'active', 'past_due', 'cancelled'].includes(r.status) && isoOrNull(r.currentPeriodEnd) && (r.partner === null || text(r.partner, 40))); return r as any;
  }
  async checkout(token: string, idempotencyKey: string): Promise<{ checkoutId: string; checkoutUrl: string; status: 'pending' }> {
    const r = shape(await this.#json('POST', '/v1/billing/checkout', { token, json: { plan: 'paid', idempotencyKey } }), ['checkoutId', 'checkoutUrl', 'status']);
    valid(ID.test(r.checkoutId ?? '') && typeof r.checkoutUrl === 'string' && r.checkoutUrl.length <= 2048 && r.checkoutUrl.startsWith('https://') && r.status === 'pending'); return r as any;
  }
  async cancel(token: string): Promise<{ status: 'cancelled'; currentPeriodEnd: string | null }> {
    const r = shape(await this.#json('POST', '/v1/billing/cancel', { token, json: {} }), ['status', 'currentPeriodEnd']);
    valid(r.status === 'cancelled' && isoOrNull(r.currentPeriodEnd)); return r as any;
  }

  // Relay
  async channels(token: string): Promise<ChannelRow[]> {
    const r = shape(await this.#json('GET', '/v1/relay/channels', { token }), ['channels']);
    valid(Array.isArray(r.channels) && r.channels.length <= CHANNELS.length);
    const rows = r.channels.map(channelRow); valid(new Set(rows.map((row: ChannelRow) => row.channel)).size === rows.length); return rows;
  }
  async setChannel(token: string, channel: Channel, body: { enabled: boolean; optIn: { given: true; textSha256: string; recordedAt: string } | null; address?: string }): Promise<ChannelRow> {
    check(CHANNELS.includes(channel), 'INVALID_REQUEST', 'Choose WhatsApp, Telegram or mail.');
    const row = channelRow(await this.#json('PUT', `/v1/relay/channels/${channel}`, { token, json: body }));
    valid(row.channel === channel); return row;
  }
  async sendMessage(token: string, body: { event: MessageEvent; channel: Channel; idempotencyKey: string; offer?: { approve: SealedBlob; notNow: SealedBlob } }): Promise<{ messageId: string; status: 'queued'; month: string; sent: number; budget: number }> {
    const r = shape(await this.#json('POST', '/v1/relay/messages', { token, json: body, expect: [202] }), ['messageId', 'status', 'month', 'sent', 'budget']);
    valid(ID.test(r.messageId ?? '') && r.status === 'queued' && /^\d{4}-\d{2}$/.test(r.month ?? '') && count(r.sent) && count(r.budget)); return r as any;
  }
  async message(token: string, messageId: string): Promise<{ messageId: string; event: MessageEvent; channel: Channel; status: string; buttons: 'open-only' | 'approve-not-now-open'; decided: null | 'approve' | 'not-now'; expiresAt: string | null }> {
    check(ID.test(messageId), 'INVALID_REQUEST', 'Use a message from this account.');
    const r = shape(await this.#json('GET', `/v1/relay/messages/${encodeURIComponent(messageId)}`, { token }), ['messageId', 'event', 'channel', 'status', 'buttons', 'decided', 'expiresAt']);
    valid(r.messageId === messageId && MESSAGE_EVENTS.includes(r.event) && CHANNELS.includes(r.channel) && ['queued', 'sent', 'delivered', 'read', 'failed'].includes(r.status)
      && ['open-only', 'approve-not-now-open'].includes(r.buttons) && [null, 'approve', 'not-now'].includes(r.decided) && isoOrNull(r.expiresAt)); return r as any;
  }
  async counts(token: string, month: string): Promise<Counts> {
    check(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month), 'INVALID_REQUEST', 'Use a month as year and month.');
    const r = shape(await this.#json('GET', `/v1/relay/counts?month=${month}`, { token }), ['month', 'sent', 'budget', 'costPaise', 'costState', 'byChannel']);
    const by = shape(r.byChannel, [...CHANNELS]);
    valid(r.month === month && count(r.sent) && count(r.budget) && CHANNELS.every(c => count(by[c]))
      && ((r.costState === 'known' && typeof r.costPaise === 'string' && PAISE.test(r.costPaise)) || (r.costState === 'unknown' && r.costPaise === null))); return r as Counts;
  }
  async envelopes(token: string): Promise<SealedEnvelope[]> {
    const r = shape(await this.#json('GET', '/v1/relay/envelopes', { token }), ['envelopes']);
    valid(Array.isArray(r.envelopes) && r.envelopes.length <= 200); return r.envelopes.map(sealedEnvelope);
  }
  async ackEnvelope(token: string, envelopeId: string, disposition: 'collected' | 'expired' | 'invalid'): Promise<{ envelopeId: string; disposition: string }> {
    check(ID.test(envelopeId), 'INVALID_REQUEST', 'Use an envelope from this account.');
    const r = shape(await this.#json('POST', `/v1/relay/envelopes/${encodeURIComponent(envelopeId)}/ack`, { token, json: { disposition } }), ['envelopeId', 'disposition']);
    valid(r.envelopeId === envelopeId && r.disposition === disposition); return r as any;
  }

  // Backup
  async putBackup(token: string, backupId: string, bytes: Uint8Array): Promise<BackupEntry> {
    check(BACKUP_ID.test(backupId) && bytes.length <= MAX_BACKUP_BYTES, 'INVALID_REQUEST', 'Use a bounded backup with a valid name.');
    const digest = sha256Hex(bytes);
    const reply = await this.#send('PUT', `/v1/backups/${backupId}`, { token, bytes, headers: { 'x-chausar-sha256': digest } });
    if (!reply.ok) await refusal(reply);
    valid(reply.status === 201);
    let raw: string; try { raw = await reply.text(); } catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
    valid(raw.length <= MAX_JSON_REPLY);
    let value: unknown; try { value = JSON.parse(raw); } catch { valid(false); }
    const entry = backupEntry(value);
    valid(entry.backupId === backupId && entry.sha256 === digest && entry.sizeBytes === bytes.length); return entry;
  }
  async listBackups(token: string): Promise<{ backups: BackupEntry[]; quotaBytes: number; usedBytes: number; keep: number }> {
    const r = shape(await this.#json('GET', '/v1/backups', { token }), ['backups', 'quotaBytes', 'usedBytes', 'keep']);
    valid(Array.isArray(r.backups) && r.backups.length <= 1000 && count(r.quotaBytes) && count(r.usedBytes) && count(r.keep));
    return { ...r, backups: r.backups.map(backupEntry) } as any;
  }
  async getBackup(token: string, backupId: string): Promise<{ bytes: Buffer; sha256: string }> {
    check(BACKUP_ID.test(backupId), 'INVALID_REQUEST', 'Use a backup from this account.');
    const reply = await this.#send('GET', `/v1/backups/${backupId}`, { token, headers: { accept: 'application/octet-stream' } });
    if (!reply.ok) await refusal(reply);
    const digest = reply.headers.get('x-chausar-sha256') ?? '', length = Number(reply.headers.get('content-length') ?? '0');
    valid(reply.status === 200 && SHA256.test(digest) && !(length > MAX_BACKUP_BYTES));
    let bytes: Buffer; try { bytes = Buffer.from(await reply.arrayBuffer()); } catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
    valid(bytes.length <= MAX_BACKUP_BYTES);
    check(sha256Hex(bytes) === digest, 'HOSTED_BACKUP_INVALID', 'The downloaded backup does not match its digest.');
    return { bytes, sha256: digest };
  }
  async deleteBackup(token: string, backupId: string): Promise<{ backupId: string; deleted: true }> {
    check(BACKUP_ID.test(backupId), 'INVALID_REQUEST', 'Use a backup from this account.');
    const r = shape(await this.#json('DELETE', `/v1/backups/${backupId}`, { token }), ['backupId', 'deleted']);
    valid(r.backupId === backupId && r.deleted === true); return r as any;
  }

  // Model allowance
  async allowance(token: string): Promise<{ month: string; grantPaise: string; spentPaise: string; reservedPaise: string; balancePaise: string; pricing: { checkedOn: string; fxPaisePerUsd: string; source: string } | null; models: { route: string; model: string }[] }> {
    const r = shape(await this.#json('GET', '/v1/allowance', { token }), ['month', 'grantPaise', 'spentPaise', 'reservedPaise', 'balancePaise', 'pricing', 'models']);
    valid(/^\d{4}-\d{2}$/.test(r.month ?? '') && [r.grantPaise, r.spentPaise, r.reservedPaise].every(v => typeof v === 'string' && PAISE.test(v))
      && typeof r.balancePaise === 'string' && /^-?(?:0|[1-9]\d{0,17})$/.test(r.balancePaise) && Array.isArray(r.models) && r.models.length <= 100);
    if (r.pricing !== null) { const p = shape(r.pricing, ['checkedOn', 'fxPaisePerUsd', 'source']); valid(text(p.checkedOn, 40) && typeof p.fxPaisePerUsd === 'string' && PAISE.test(p.fxPaisePerUsd) && text(p.source, 300)); }
    for (const model of r.models) { const m = shape(model, ['route', 'model']); valid(['anthropic', 'openai'].includes(m.route) && text(m.model, 120)); }
    return r as any;
  }
  /** One allowance completion. Returns the exact request text sent and the exact reply text received. */
  async complete(token: string, request: AllowanceRequest): Promise<{ reply: AllowanceReply; sent: string; received: string }> {
    const exchange = await this.#exchange('POST', '/v1/allowance/complete', { token, json: request });
    const r = shape(exchange.value, ['requestId', 'text', 'usage', 'costPaise', 'balancePaise', 'route', 'model', 'pricingCheckedOn']);
    const usage = shape(r.usage, ['inputTokens', 'outputTokens']);
    valid(r.requestId === request.requestId && typeof r.text === 'string' && r.text.length <= 512 * 1024 && count(usage.inputTokens) && count(usage.outputTokens)
      && typeof r.costPaise === 'string' && PAISE.test(r.costPaise) && typeof r.balancePaise === 'string' && /^-?(?:0|[1-9]\d{0,17})$/.test(r.balancePaise)
      && r.route === request.route && r.model === request.model && text(r.pricingCheckedOn, 40));
    return { reply: r as AllowanceReply, sent: exchange.sent!, received: exchange.received };
  }

  // Always-on jobs worker
  async worker(token: string): Promise<{ endToEndEncrypted: false; label: string; jobs: WorkerJob[] }> {
    const r = shape(await this.#json('GET', '/v1/worker', { token }), ['endToEndEncrypted', 'label', 'jobs']);
    valid(r.endToEndEncrypted === false && text(r.label, 500) && Array.isArray(r.jobs) && r.jobs.length <= 50);
    r.jobs.forEach(workerJob); return r as any;
  }
  async setWorkerJob(token: string, type: string, body: { enabled: boolean; consent: { notEndToEndEncrypted: true; recordedAt: string } | null }): Promise<WorkerJob> {
    check(/^[a-z][a-z-]{1,60}$/.test(type), 'INVALID_REQUEST', 'Choose a job type the server offers.');
    const job = workerJob(unlabel(await this.#json('PUT', `/v1/worker/jobs/${type}`, { token, json: body })));
    valid(job.type === type); return job;
  }
  async setDueDates(token: string, dueDates: { id: string; date: string; remindDaysBefore: number }[]): Promise<{ stored: number }> {
    check(Array.isArray(dueDates) && dueDates.length <= 200, 'INVALID_REQUEST', 'Send at most two hundred due dates.');
    const r = shape(unlabel(await this.#json('PUT', '/v1/worker/due-dates', { token, json: { dueDates } })), ['stored']);
    valid(count(r.stored)); return r as any;
  }
  async deleteWorkerData(token: string): Promise<{ deleted: true }> {
    const r = shape(unlabel(await this.#json('DELETE', '/v1/worker/data', { token })), ['deleted']);
    valid(r.deleted === true); return r as any;
  }

  // Health
  async health(): Promise<{ ok: true }> {
    const r = shape(await this.#json('GET', '/healthz'), ['ok']); valid(r.ok === true); return r as any;
  }
}
/** The worker labels every reply as not end-to-end encrypted; the label is checked, then set aside. */
function unlabel(value: unknown): Record<string, unknown> {
  const { endToEndEncrypted, label, ...rest } = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  valid(endToEndEncrypted === false && text(label, 500)); return rest;
}
function workerJob(value: unknown): WorkerJob {
  const job = shape(value, ['type', 'title', 'enabled', 'consentAt', 'uses']);
  valid(/^[a-z][a-z-]{1,60}$/.test(job.type ?? '') && text(job.title, 200) && typeof job.enabled === 'boolean' && isoOrNull(job.consentAt)
    && text(job.uses, 300));
  return job as WorkerJob;
}
