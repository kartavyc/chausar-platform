// Chausar connectors: the webhook handoff to n8n or Make (Ink v2 wave 5, package 5A6, catalogue K24), for owners who
// already run one. venture.webhook.set { kind, url | null, test? } is standing configuration: approve, inside the app.
// The address passes the network guard (never one inside this computer or its network) and, being a key in itself, is
// held on the secret shelf only while the app is open, never in a record, an event or the journal (the journal names
// its host). With test, Chausar first sends one fixed test item (TEST_ITEM, shown before the owner presses) and keeps
// the address only if it was not refused. sendToWebhook sends one approved item: an always-ask journalled write
// ('connector.write', operation 'webhook-send') whose line shows the exact payload, inside the app only. A 2xx answer is
// applied; a 4xx is known not to have arrived; a timeout, a lost connection or a server error is outcome unknown (1B)
// and is never sent again on its own. Chausar never makes the webhook or a workflow: the owner's n8n or Make does.
// The publish-to-webhook idea follows marketing-skill's scripts/publish_webhook.py (reusable by licence); written here
// for Chausar, not copied.
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { Json, SecretName, VentureDeps } from '../contracts.ts';
import { digest, exactPayload, requireAppChannel, readVenture } from '../records.ts';
import { checkUrl, guardedFetch, resolvePublic } from '../core/net-guard.ts';
import { journalled, type ApplyDone, type ApplyResult } from '../journal/journal.ts';
import { CHAUSAR_USER_AGENT } from './fetch-policy.ts';
import type { WebhookKind, WebhookView } from './records-connect.ts';

export const WEBHOOK_NAMES: Readonly<Record<WebhookKind, string>> = Object.freeze({ n8n: 'n8n', make: 'Make' });
/** The one item the test sends, exactly, shown to the owner before they press. */
export const TEST_ITEM: Readonly<Record<string, Json>> = Object.freeze({ from: 'Chausar', test: true, line: 'A test item from Chausar. You can ignore it.' });
export const WEBHOOK_TIMEOUT_MS = 15_000;

export const WEBHOOK_WORDS = Object.freeze({
  kept: (kind: WebhookKind, host: string) => `Your ${WEBHOOK_NAMES[kind]} webhook at ${host} is set. Chausar sends an item there only after you approve that exact item. It keeps the address only while the app is open.`,
  answered: (kind: WebhookKind) => `The test item reached your ${WEBHOOK_NAMES[kind]} webhook.`,
  unknown: (kind: WebhookKind) => `The test item may or may not have reached your ${WEBHOOK_NAMES[kind]} webhook. Check it there; Chausar will not send it again.`,
  cleared: (kind: WebhookKind) => `No ${WEBHOOK_NAMES[kind]} webhook is set. Chausar sends nothing there.`,
  notSet: (kind: WebhookKind) => `No ${WEBHOOK_NAMES[kind]} webhook is set. Set its address under Connections first.`,
});

const secretOf = (kind: WebhookKind): SecretName => `webhook:${kind}`;
/** The network guard's refusals that come before any byte is sent; every other failure may have reached the webhook. */
const BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED']);

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

function kindOf(value: unknown): WebhookKind {
  check(value === 'n8n' || value === 'make', 'INVALID_VENTURE_REQUEST', 'Choose n8n or Make.');
  return value;
}

/** The address as the guard checks it: https, public, no name or password in it. */
async function checkedAddress(deps: VentureDeps, raw: unknown): Promise<URL> {
  check(typeof raw === 'string' && raw.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Paste the webhook address from n8n or Make.');
  const url = checkUrl(raw);
  check(url.protocol === 'https:', 'INVALID_VENTURE_REQUEST', 'Use the https address n8n or Make gives the webhook.');
  await resolvePublic(url.hostname.replace(/\.$/, ''), deps.net?.resolve);
  return url;
}

/**
 * Sends one item to the owner's webhook, inside the app: proposed, approved and applied at once by the owner who pressed
 * Send on the exact payload (journal/journal.ts journalled). Answers the journal entry; an unknown outcome is an entry
 * in outcome_unknown, which refuses the same subject from then on (JOURNAL_OUTCOME_UNKNOWN).
 */
export async function sendToWebhook(deps: VentureDeps, ctx: Context, input: { kind: WebhookKind; subject: string; payload: unknown }): Promise<ApplyDone<number | null>> {
  requireAppChannel(ctx, 'venture.webhook.set');
  const kind = kindOf(input.kind);
  const address = deps.secrets.get(secretOf(kind));
  check(address, 'WEBHOOK_NOT_SET', WEBHOOK_WORDS.notSet(kind));
  const url = new URL(address);
  const body = webhookPayloadText(input.payload);
  const name = WEBHOOK_NAMES[kind];
  const line = `Send to your ${name} webhook at ${url.hostname}: ${body}`;
  return journalled<number | null>(deps, ctx, {
    action: 'connector.write', operation: 'webhook-send', subject: `webhook:${kind}:${input.subject}`, target: `${name} webhook at ${url.hostname}`,
    actionDigest: digest(`${kind}\n${body}`), line: line.slice(0, 300), descriptionComplete: line.length <= 300,
  }, async (): Promise<ApplyResult<number | null>> => {
    try {
      const answer = await guardedFetch({
        url: url.href, method: 'POST', body, maxRedirects: 0, timeoutMs: WEBHOOK_TIMEOUT_MS, maxBytes: 64 * 1024,
        headers: { 'content-type': 'application/json', 'user-agent': CHAUSAR_USER_AGENT },
      }, deps.net ?? {});
      if (answer.status >= 200 && answer.status <= 299) return { outcome: 'applied', line: `Your ${name} webhook took it (${answer.status}).`, value: answer.status, by: 'platform' };
      if (answer.status >= 400 && answer.status <= 499) return { outcome: 'not-sent', line: `Your ${name} webhook refused it (${answer.status}). Nothing ran there.`, value: answer.status, by: 'platform' };
      return { outcome: 'unknown', line: `Your ${name} webhook answered ${answer.status}: part of its workflow may have run.`, value: answer.status };
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // Refused before anything left (the guard, the lookup): not sent. Anything else may have reached the workflow:
      // unknown, never sent again on its own.
      if (error instanceof ChausarError && BEFORE_SENDING.has(code)) return { outcome: 'not-sent', line: `${error.message} Nothing was sent.`, value: null };
      return { outcome: 'unknown', line: `Your ${name} webhook did not answer as expected.`, value: null };
    }
  });
}

/**
 * venture.webhook.set { kind, url | null, test? } (approve, inside the app): keeps the address on the shelf, or clears
 * it. With test, the fixed test item goes first; a webhook that refuses it (4xx) is not kept (WEBHOOK_REFUSED).
 */
export async function webhookSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WebhookView> {
  requireAppChannel(ctx, 'venture.webhook.set');
  const body = exactPayload(payload, ['kind', 'url', 'test'], ['kind', 'url']);
  const kind = kindOf(body.kind);
  check(body.test === undefined || typeof body.test === 'boolean', 'INVALID_VENTURE_REQUEST', 'test is true or false.');
  authorize(deps.store, ctx, 'approve');
  readVenture(deps, ctx);
  if (body.url === null) {
    deps.secrets.delete(secretOf(kind));
    return { kind, set: false, host: null, line: WEBHOOK_WORDS.cleared(kind), test: null };
  }
  const url = await checkedAddress(deps, body.url);
  const before = deps.secrets.get(secretOf(kind));
  deps.secrets.set(secretOf(kind), url.href);
  if (body.test !== true) return { kind, set: true, host: url.hostname, line: WEBHOOK_WORDS.kept(kind, url.hostname), test: null };
  let done: ApplyDone<number | null>;
  try {
    done = await sendToWebhook(deps, ctx, { kind, subject: `test:${digest(url.href).slice(0, 12)}:${Date.parse(deps.clock().toISOString())}`, payload: TEST_ITEM });
  } catch (error) {
    if (before !== null) deps.secrets.set(secretOf(kind), before); else deps.secrets.delete(secretOf(kind));
    throw error;
  }
  if (done.entry.state === 'rejected') {
    if (before !== null) deps.secrets.set(secretOf(kind), before); else deps.secrets.delete(secretOf(kind));
    throw new ChausarError('WEBHOOK_REFUSED', `${done.entry.journal.at(-1)?.line ?? 'The webhook refused the test item.'} The address was not kept.`);
  }
  const answered = done.entry.state === 'applied';
  return {
    kind, set: true, host: url.hostname, test: answered ? 'answered' : 'unknown',
    line: `${answered ? WEBHOOK_WORDS.answered(kind) : WEBHOOK_WORDS.unknown(kind)} ${WEBHOOK_WORDS.kept(kind, url.hostname)}`,
  };
}
