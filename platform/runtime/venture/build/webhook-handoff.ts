// Chausar connectors: the webhook handoff to n8n or Make (Ink v2 wave 5, package 5A6, catalogue K24), for owners who
// already run one. venture.webhook.set { kind, url | null, secret, test? } is standing configuration: approve, inside
// the app. The address passes the network guard (never one inside this computer or its network) and, being a key in
// itself, is held on the secret shelf only while the app is open, never in a record, an event or the journal (the journal
// names its host). With test, Chausar first sends one fixed test item (TEST_ITEM, shown before the owner presses) and
// keeps the address only if it was not refused. sendToWebhook sends one approved item: an always-ask journalled write
// ('connector.write', operation 'webhook-send') whose line shows the exact payload, inside the app only. A 2xx answer is
// applied; a 4xx is known not to have arrived; a timeout, a lost connection or a server error is outcome unknown (1B)
// and is never sent again on its own. Chausar never makes the webhook or a workflow: the owner's n8n or Make does.
// The publish-to-webhook idea follows marketing-skill's scripts/publish_webhook.py (reusable by licence); written here
// for Chausar, not copied.
//
// W6 6F4 (D33): every send is signed and carries one idempotency key. The owner gives a signing secret with the
// address (the same secret their n8n or Make check uses; the shelf holds it like the address). The headers follow the
// Standard Webhooks layout (standardwebhooks.com, MIT; written here, not copied): webhook-id is the journal's claim key,
// also sent as idempotency-key; webhook-timestamp is whole seconds; webhook-signature is "v1," and the base64 HMAC-SHA256
// of "id.timestamp.body". Retries are limited to what is known never to have run: a failed name lookup (nothing left this
// computer) or a 429 (the receiver said it did not take it), at most WEBHOOK_ATTEMPTS tries with the same id. Anything
// that may have arrived stays outcome unknown and is never retried. venture.webhook.send { kind, subject, payload,
// digest? } first answers the exact text and its digest; the send needs that digest back, so the bytes that leave are
// the bytes the owner saw, to the address they registered. The journal entry is the receipt.
import { createHmac } from 'node:crypto';
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { Json, SecretName, VentureDeps } from '../contracts.ts';
import { digest, exactPayload, identifier, requireAppChannel, readVenture } from '../records.ts';
import { checkUrl, guardedFetch, resolvePublic } from '../core/net-guard.ts';
import { journalled, type ApplyDone, type ApplyResult } from '../journal/journal.ts';
import { CHAUSAR_USER_AGENT } from './fetch-policy.ts';
import type { WebhookKind, WebhookSendView, WebhookView } from './records-connect.ts';

export const WEBHOOK_NAMES: Readonly<Record<WebhookKind, string>> = Object.freeze({ n8n: 'n8n', make: 'Make' });
/** The one item the test sends, exactly, shown to the owner before they press. */
export const TEST_ITEM: Readonly<Record<string, Json>> = Object.freeze({ from: 'Chausar', test: true, line: 'A test item from Chausar. You can ignore it.' });
export const WEBHOOK_TIMEOUT_MS = 15_000;
/** At most this many tries of one approved item, and only while each earlier try is known not to have run. */
export const WEBHOOK_ATTEMPTS = 3;
/** The wait before the second and third try. A 429's Retry-After is honoured up to WEBHOOK_LONGEST_WAIT_MS. */
export const WEBHOOK_WAITS_MS: readonly number[] = Object.freeze([1_000, 3_000]);
export const WEBHOOK_LONGEST_WAIT_MS = 10_000;
/** The largest item Chausar sends, as its exact text. */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

export const WEBHOOK_WORDS = Object.freeze({
  kept: (kind: WebhookKind, host: string) => `Your ${WEBHOOK_NAMES[kind]} connection at ${host} is set. Chausar sends an item there only after you approve that exact item. It keeps the address only while the app is open.`,
  answered: (kind: WebhookKind) => `The test item reached your ${WEBHOOK_NAMES[kind]} connection.`,
  unknown: (kind: WebhookKind) => `The test item may or may not have reached your ${WEBHOOK_NAMES[kind]} connection. Check it there; Chausar will not send it again.`,
  cleared: (kind: WebhookKind) => `No ${WEBHOOK_NAMES[kind]} connection is set. Chausar sends nothing there.`,
  notSet: (kind: WebhookKind) => `No ${WEBHOOK_NAMES[kind]} connection is set. Set its address under Connections first.`,
  secret: 'Add a signing secret of 16 to 256 characters with no spaces, the same one your check in n8n or Make uses.',
  preview: (kind: WebhookKind, host: string) => `This exact item goes to your ${WEBHOOK_NAMES[kind]} connection at ${host}, signed, once you approve it.`,
  stale: 'This item or its address changed since you saw it. Look at it again before sending.',
  tooLarge: 'This item is too large to send. Keep it under 64 KB.',
});

export type WebhookDelivery = { status: number | null; deliveryId: string; attempts: number };
export type WebhookSendOptions = { sleep?: (ms: number) => Promise<void> };

const secretOf = (kind: WebhookKind): SecretName => `webhook:${kind}`;
const signingOf = (kind: WebhookKind): SecretName => `webhook-signing:${kind}`;
/** The network guard's refusals that come before any byte is sent; every other failure may have reached the webhook. */
const BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED']);
/** Of those, the one worth another try: a name lookup can fail for a moment. */
const TRY_AGAIN_BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_LOOKUP_FAILED']);
const realSleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** A value as JSON with its keys in order, so the same item is always the same bytes and the same digest. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
/** The exact text an item is sent as. */
export function webhookPayloadText(payload: unknown): string {
  return JSON.stringify(canonical(payload));
}
/** The signature a receiver checks: "v1," and base64 HMAC-SHA256 of "id.timestamp.body" with the owner's secret. */
export function webhookSignature(secret: string, id: string, timestamp: string, body: string): string {
  return `v1,${createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function kindOf(value: unknown): WebhookKind {
  check(value === 'n8n' || value === 'make', 'INVALID_VENTURE_REQUEST', 'Choose n8n or Make.');
  return value;
}
function signingSecret(value: unknown): string {
  check(typeof value === 'string' && /^[\x21-\x7e]{16,256}$/.test(value), 'INVALID_VENTURE_REQUEST', WEBHOOK_WORDS.secret);
  return value;
}

/** The address as the guard checks it: https, public, no name or password in it. */
async function checkedAddress(deps: VentureDeps, raw: unknown): Promise<URL> {
  check(typeof raw === 'string' && raw.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Paste the receiving address from n8n or Make.');
  const url = checkUrl(raw);
  check(url.protocol === 'https:', 'INVALID_VENTURE_REQUEST', 'Use the https receiving address n8n or Make gives you.');
  await resolvePublic(url.hostname.replace(/\.$/, ''), deps.net?.resolve);
  return url;
}

/** The registered address and its secret, or WEBHOOK_NOT_SET. */
function registered(deps: VentureDeps, kind: WebhookKind): { url: URL; secret: string } {
  const address = deps.secrets.get(secretOf(kind));
  const secret = deps.secrets.get(signingOf(kind));
  check(address && secret, 'WEBHOOK_NOT_SET', WEBHOOK_WORDS.notSet(kind));
  return { url: new URL(address), secret };
}
/** What the owner approves: the kind, the address (as a digest, never itself) and the exact text. */
const approvalDigest = (kind: WebhookKind, url: URL, text: string) => digest({ kind, address: digest(url.href), text });

function retryAfterMs(headers: Record<string, string>, fallback: number): number {
  const seconds = Number.parseInt(headers['retry-after'] ?? '', 10);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, WEBHOOK_LONGEST_WAIT_MS) : fallback;
}

/**
 * Sends one item to the owner's webhook, inside the app: proposed, approved and applied at once by the owner who pressed
 * Send on the exact payload (journal/journal.ts journalled). Answers the journal entry; an unknown outcome is an entry
 * in outcome_unknown, which refuses the same subject from then on (JOURNAL_OUTCOME_UNKNOWN).
 */
export async function sendToWebhook(
  deps: VentureDeps, ctx: Context, input: { kind: WebhookKind; subject: string; payload: unknown }, options: WebhookSendOptions = {},
): Promise<ApplyDone<WebhookDelivery>> {
  requireAppChannel(ctx, 'venture.webhook.set');
  const kind = kindOf(input.kind);
  const { url, secret } = registered(deps, kind);
  const body = webhookPayloadText(input.payload);
  const name = WEBHOOK_NAMES[kind];
  const sleep = options.sleep ?? realSleep;
  const line = `Send to your ${name} connection at ${url.hostname}: ${body}`;
  return journalled<WebhookDelivery>(deps, ctx, {
    action: 'connector.write', operation: 'webhook-send', subject: `webhook:${kind}:${input.subject}`, target: `${name} connection at ${url.hostname}`,
    actionDigest: approvalDigest(kind, url, body), line: line.slice(0, 300), descriptionComplete: line.length <= 300,
  }, async (handle): Promise<ApplyResult<WebhookDelivery>> => {
    // The claim key is the delivery id: the same on every try, so a receiver that keeps ids can drop a repeat.
    const deliveryId = handle.idempotencyKey;
    for (let attempt = 1; ; attempt += 1) {
      const delivery = (status: number | null): WebhookDelivery => ({ status, deliveryId, attempts: attempt });
      const more = attempt < WEBHOOK_ATTEMPTS;
      const wait = WEBHOOK_WAITS_MS[attempt - 1] ?? WEBHOOK_WAITS_MS[WEBHOOK_WAITS_MS.length - 1]!;
      const timestamp = String(Math.floor(Date.parse(deps.clock().toISOString()) / 1000));
      try {
        const answer = await guardedFetch({
          url: url.href, method: 'POST', body, maxRedirects: 0, timeoutMs: WEBHOOK_TIMEOUT_MS, maxBytes: 64 * 1024,
          headers: {
            'content-type': 'application/json', 'user-agent': CHAUSAR_USER_AGENT, 'webhook-id': deliveryId, 'idempotency-key': deliveryId,
            'webhook-timestamp': timestamp, 'webhook-signature': webhookSignature(secret, deliveryId, timestamp, body),
          },
        }, deps.net ?? {});
        if (answer.status >= 200 && answer.status <= 299) {
          return { outcome: 'applied', line: `Your ${name} connection took it (${answer.status}). Delivery ${deliveryId}, try ${attempt}.`, value: delivery(answer.status), by: 'platform' };
        }
        // 429: the receiver says it did not take it, so another try cannot run anything twice.
        if (answer.status === 429 && more) { await sleep(retryAfterMs(answer.headers, wait)); continue; }
        if (answer.status >= 400 && answer.status <= 499) {
          return { outcome: 'not-sent', line: `Your ${name} connection refused it (${answer.status}) after ${attempt} ${attempt === 1 ? 'try' : 'tries'}. Nothing ran there.`, value: delivery(answer.status), by: 'platform' };
        }
        return { outcome: 'unknown', line: `Your ${name} connection answered ${answer.status}: part of its workflow may have run. Delivery ${deliveryId}.`, value: delivery(answer.status) };
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        // Refused before anything left (the guard, the lookup): not sent, and a lookup may be tried again. Anything else
        // may have reached the workflow: unknown, never sent again on its own.
        if (error instanceof ChausarError && BEFORE_SENDING.has(code)) {
          if (TRY_AGAIN_BEFORE_SENDING.has(code) && more) { await sleep(wait); continue; }
          return { outcome: 'not-sent', line: `${error.message} Nothing was sent.`, value: delivery(null) };
        }
        return { outcome: 'unknown', line: `Your ${name} connection did not answer as expected. Delivery ${deliveryId}.`, value: delivery(null) };
      }
    }
  });
}

/**
 * venture.webhook.set { kind, url | null, secret, test? } (approve, inside the app): keeps the address and its signing
 * secret on the shelf, or clears both. With test, the fixed test item goes first; a webhook that refuses it (4xx) is
 * not kept (WEBHOOK_REFUSED).
 */
export async function webhookSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WebhookView> {
  requireAppChannel(ctx, 'venture.webhook.set');
  const body = exactPayload(payload, ['kind', 'url', 'secret', 'test'], ['kind', 'url']);
  const kind = kindOf(body.kind);
  check(body.test === undefined || typeof body.test === 'boolean', 'INVALID_VENTURE_REQUEST', 'test is true or false.');
  authorize(deps.store, ctx, 'approve');
  readVenture(deps, ctx);
  if (body.url === null) {
    check(body.secret === undefined, 'INVALID_VENTURE_REQUEST', 'Clearing the address needs no secret.');
    deps.secrets.delete(secretOf(kind));
    deps.secrets.delete(signingOf(kind));
    return { kind, set: false, host: null, line: WEBHOOK_WORDS.cleared(kind), test: null };
  }
  const secret = signingSecret(body.secret);
  const url = await checkedAddress(deps, body.url);
  const before = { address: deps.secrets.get(secretOf(kind)), secret: deps.secrets.get(signingOf(kind)) };
  const restore = () => {
    if (before.address !== null) deps.secrets.set(secretOf(kind), before.address); else deps.secrets.delete(secretOf(kind));
    if (before.secret !== null) deps.secrets.set(signingOf(kind), before.secret); else deps.secrets.delete(signingOf(kind));
  };
  deps.secrets.set(secretOf(kind), url.href);
  deps.secrets.set(signingOf(kind), secret);
  if (body.test !== true) return { kind, set: true, host: url.hostname, line: WEBHOOK_WORDS.kept(kind, url.hostname), test: null };
  let done: ApplyDone<WebhookDelivery>;
  try {
    done = await sendToWebhook(deps, ctx, { kind, subject: `test:${digest(url.href).slice(0, 12)}:${Date.parse(deps.clock().toISOString())}`, payload: TEST_ITEM });
  } catch (error) {
    restore();
    throw error;
  }
  if (done.entry.state === 'rejected') {
    restore();
    throw new ChausarError('WEBHOOK_REFUSED', `${done.entry.journal.at(-1)?.line ?? 'n8n or Make refused the test item.'} The address was not kept.`);
  }
  const answered = done.entry.state === 'applied';
  return {
    kind, set: true, host: url.hostname, test: answered ? 'answered' : 'unknown',
    line: `${answered ? WEBHOOK_WORDS.answered(kind) : WEBHOOK_WORDS.unknown(kind)} ${WEBHOOK_WORDS.kept(kind, url.hostname)}`,
  };
}

/**
 * venture.webhook.send { kind, subject, payload, digest? } (approve, inside the app). Without digest: the preview, the
 * exact text and the digest of what would go where; nothing is proposed or sent. With digest: the send, refused
 * APPROVAL_STALE when the text or the registered address changed since that preview. The answer is the receipt.
 */
export async function webhookSend(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WebhookSendView> {
  requireAppChannel(ctx, 'venture.webhook.send');
  const body = exactPayload(payload, ['kind', 'subject', 'payload', 'digest'], ['kind', 'subject', 'payload']);
  const kind = kindOf(body.kind);
  const subject = identifier(body.subject, 'The subject');
  check(body.digest === undefined || typeof body.digest === 'string', 'INVALID_VENTURE_REQUEST', 'Send back the digest you were shown.');
  authorize(deps.store, ctx, 'approve');
  readVenture(deps, ctx);
  const { url } = registered(deps, kind);
  const text = webhookPayloadText(body.payload);
  check(typeof text === 'string', 'INVALID_VENTURE_REQUEST', 'Send an item to deliver.');
  check(Buffer.byteLength(text) <= WEBHOOK_MAX_BYTES, 'INVALID_VENTURE_REQUEST', WEBHOOK_WORDS.tooLarge);
  const shown = approvalDigest(kind, url, text);
  const view = { kind, host: url.hostname, text, digest: shown };
  if (body.digest === undefined) {
    return { ...view, state: 'preview', status: null, deliveryId: null, attempts: 0, entryId: null, line: WEBHOOK_WORDS.preview(kind, url.hostname) };
  }
  check(body.digest === shown, 'APPROVAL_STALE', WEBHOOK_WORDS.stale);
  const done = await sendToWebhook(deps, ctx, { kind, subject, payload: body.payload });
  const state = done.entry.state === 'applied' ? 'applied' : done.entry.state === 'rejected' ? 'refused' : 'unknown';
  return {
    ...view, state, status: done.value?.status ?? null, deliveryId: done.value?.deliveryId ?? null, attempts: done.value?.attempts ?? 0,
    entryId: done.entry.id, line: done.entry.journal.at(-1)?.line ?? '',
  };
}
