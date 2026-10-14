import type { HostedDeps } from '../shared/module.ts';
import type { Router } from '../shared/http.ts';
import { fields, json, ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, isLetterToken, letterToken, openServer, sameHex, sealServer, secretHash } from '../shared/crypto.ts';
import type { RelayKit } from './mail-verify.ts';

/**
 * Delivery statuses for messages a business sends through its OWN WhatsApp Business account (the writeback lane sends
 * templates with `biz_opaque_callback_data: <reference>`). Each account registers its own Meta app's webhook here; only
 * the status line of each callback is kept for thirty days. Customer messages and any other content are ignored.
 * Telegram has no delivery callbacks, so there is nothing like this for Telegram.
 */
export const BUSINESS_STATUS_KEEP_MS = 30 * 86400000;
export const BUSINESS_REFERENCE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MESSAGE_ID = /^[A-Za-z0-9._=:+/-]{1,256}$/;
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const list = (value: unknown, max = 100): any[] => Array.isArray(value) ? value.slice(0, max) : [];

/** A public https origin for the hook URL: no credentials, path, query or fragment. */
export function checkApiOrigin(origin: string): string {
  let url: URL | undefined;
  try { url = new URL(origin); } catch { url = undefined; }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || origin.replace(/\/$/, '') !== url.origin)
    throw new HostedError('RELAY_CONFIG_INVALID', 'The API origin must be a plain https origin.', 500);
  return url.origin;
}

export function createBusinessStatuses(deps: HostedDeps, kit: RelayKit, apiOrigin: string | undefined) {
  const origin = apiOrigin ? checkApiOrigin(apiOrigin) : undefined;
  const now = () => deps.clock();
  const hookHash = (hook: string) => secretHash(deps.pepper, 'relay-business-hook', hook);
  const verifyHash = (token: string) => secretHash(deps.pepper, 'relay-business-verify', token);
  const secretAad = (accountId: string) => `relay-business-secret:${accountId}`;

  async function hookOf(hook: string) {
    if (!isLetterToken(hook)) return null;
    const { rows: [row] } = await deps.sql.query('SELECT account_id, verify_hash, app_secret_sealed FROM relay_business_hooks WHERE hook_hash = $1', [hookHash(hook)]);
    return row ?? null;
  }
  async function store(accountId: string, status: any) {
    const id = typeof status?.id === 'string' && MESSAGE_ID.test(status.id) ? status.id : null;
    const reference = typeof status?.biz_opaque_callback_data === 'string' && BUSINESS_REFERENCE.test(status.biz_opaque_callback_data) ? status.biz_opaque_callback_data : null;
    if (!id || !reference || typeof status.status !== 'string' || !STATUSES.has(status.status)) return;
    const received = now(), seconds = typeof status.timestamp === 'string' && /^[0-9]{1,12}$/.test(status.timestamp) ? Number(status.timestamp) : NaN;
    const at = Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= received.getTime() + 300000 ? new Date(seconds * 1000) : received;
    await deps.sql.query(`INSERT INTO relay_business_statuses (account_id, message_id, status, at, reference, received_at) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (account_id, message_id, status) DO NOTHING`, [accountId, id, status.status, at.toISOString(), reference, received.toISOString()]);
  }

  return {
    routes(router: Router) {
      // Registers (or rotates) this account's hook. The old URL stops working at once.
      router.add('PUT', '/v1/relay/business-hook', async request => {
        const { accountId } = await deps.authenticate(request);
        const { appSecret } = fields<{ appSecret: unknown }>(json(request), ['appSecret']);
        check(typeof appSecret === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(appSecret), 'APP_SECRET_INVALID', 'The app secret is not valid.');
        check((await deps.entitlements(accountId)).relay, 'PLAN_REQUIRED', 'The relay is part of the paid plan.', 402);
        check(origin, 'API_ORIGIN_NOT_SET', 'The hosted service has no public address for hooks.', 503);
        const hook = letterToken(), verifyToken = letterToken(32), at = now().toISOString();
        await deps.sql.query(`INSERT INTO relay_business_hooks (account_id, hook_hash, verify_hash, app_secret_sealed, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
          ON CONFLICT (account_id) DO UPDATE SET hook_hash = EXCLUDED.hook_hash, verify_hash = EXCLUDED.verify_hash, app_secret_sealed = EXCLUDED.app_secret_sealed, updated_at = EXCLUDED.updated_at`,
          [accountId, hookHash(hook), verifyHash(verifyToken), sealServer(kit.sealKey, appSecret, secretAad(accountId)), at]);
        return ok({ hookUrl: `${origin}/v1/webhooks/whatsapp-business/${hook}`, verifyToken });
      });

      router.add('GET', '/v1/webhooks/whatsapp-business/:hook', async request => {
        const row = await hookOf(request.params.hook), challenge = request.query.get('hub.challenge') ?? '', given = request.query.get('hub.verify_token') ?? '';
        check(row && request.query.get('hub.mode') === 'subscribe' && /^[A-Za-z]{1,128}$/.test(given) && sameHex(verifyHash(given), row.verify_hash)
          && /^[A-Za-z0-9_-]{1,128}$/.test(challenge), 'WEBHOOK_VERIFY_FAILED', 'The webhook could not be verified.', 403);
        return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: challenge };
      });

      // Signed with THAT account's app secret; statuses are stored under that account only.
      router.add('POST', '/v1/webhooks/whatsapp-business/:hook', async request => {
        const row = await hookOf(request.params.hook);
        let secret: string | null = null;
        if (row) { try { secret = openServer(kit.sealKey, row.app_secret_sealed, secretAad(row.account_id)); } catch { secret = null; } }
        const signature = /^sha256=([0-9a-f]{64})$/.exec(request.headers['x-hub-signature-256'] ?? '');
        check(row && secret && signature && sameHex(signature[1], hmacHex(secret, request.body)), 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is not valid.', 401);
        let body: any;
        try { body = JSON.parse(request.body.toString('utf8')); } catch { throw new HostedError('INVALID_JSON', 'The request body is not valid JSON.'); }
        for (const entry of list(body?.entry)) for (const change of list(entry?.changes)) {
          if (change?.field !== 'messages' || !change.value || typeof change.value !== 'object') continue;
          // Only statuses[]: inbound customer messages (value.messages) are never read or stored.
          for (const status of list(change.value.statuses)) await store(row.account_id, status);
        }
        return ok({ received: true });
      });

      router.add('GET', '/v1/relay/business-statuses', async request => {
        const { accountId } = await deps.authenticate(request);
        for (const key of request.query.keys()) check(key === 'reference' || key === 'messageId', 'INVALID_REQUEST', 'The request has an unexpected field.');
        const reference = request.query.get('reference'), messageId = request.query.get('messageId');
        check(reference !== null && BUSINESS_REFERENCE.test(reference), 'REFERENCE_INVALID', 'The reference is not valid.');
        check(messageId === null || MESSAGE_ID.test(messageId), 'INVALID_REQUEST', 'The message id is not valid.');
        const { rows } = await deps.sql.query(`SELECT message_id, status, at, reference FROM relay_business_statuses
          WHERE account_id = $1 AND (reference = $2 OR ($3::text IS NOT NULL AND message_id = $3::text))
          ORDER BY at, message_id, CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 4 END LIMIT 200`, [accountId, reference, messageId]);
        return ok({ statuses: rows.map(row => ({ messageId: row.message_id, status: row.status, at: new Date(row.at).toISOString(), reference: row.reference })) });
      });
    },
    async sweep() {
      await deps.sql.query('DELETE FROM relay_business_statuses WHERE received_at <= $1', [new Date(now().getTime() - BUSINESS_STATUS_KEEP_MS).toISOString()]);
    },
  };
}
