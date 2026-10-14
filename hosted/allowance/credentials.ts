/**
 * Allowance-scoped credentials. A signed-in device asks for one (`POST /v1/allowance/credentials`) and hands it to the
 * desktop's model gateway, which sends it as `Authorization: Bearer` to `POST /v1/allowance/responses` only.
 * - The token is opaque, starts `ca_` and is stored only as `secretHash(pepper, 'allowance-credential', token)`.
 * - It is bound to the account and device that asked; revoking it, or revoking the device, ends it at once.
 * - At most `MAX_LIVE_CREDENTIALS_PER_DEVICE` stay live per device: issuing one more revokes the oldest.
 * - Scope: no other route accepts it (the session authenticator hashes for 'session' and wants a bare 43-character
 *   token), and the responses route accepts nothing else (a session token neither has the prefix nor the hash).
 */
import type { HostedDeps } from '../shared/module.ts';
import type { HostedRequest, HostedResponse } from '../shared/http.ts';
import { bearer, fields, json, ok } from '../shared/http.ts';
import { check } from '../shared/errors.ts';
import { isId, newId, opaqueToken, secretHash } from '../shared/crypto.ts';

export const MAX_LIVE_CREDENTIALS_PER_DEVICE = 3;
export const RESPONSES_PATH = '/v1/allowance/responses';
const PURPOSE = 'allowance-credential';
export const isCredentialToken = (value: unknown): value is string => typeof value === 'string' && /^ca_[A-Za-z0-9_-]{43}$/.test(value);

export type CredentialPrincipal = { accountId: string; deviceId: string; credentialId: string };

/** Turns a Bearer allowance credential into its account and device. Unknown, revoked and revoked-device all refuse alike. */
export function credentialAuthenticator(deps: Pick<HostedDeps, 'sql' | 'pepper'>): (request: HostedRequest) => Promise<CredentialPrincipal> {
  return async request => {
    const token = bearer(request);
    check(isCredentialToken(token), 'UNAUTHENTICATED', 'Use an allowance credential.', 401);
    const { rows: [row] } = await deps.sql.query<{ id: string; account_id: string; device_id: string }>(
      `SELECT c.id, c.account_id, c.device_id FROM allowance_credentials c JOIN devices d ON d.id = c.device_id
       WHERE c.token_hash = $1 AND c.revoked_at IS NULL AND d.revoked_at IS NULL`, [secretHash(deps.pepper, PURPOSE, token)]);
    check(row, 'UNAUTHENTICATED', 'Use an allowance credential.', 401);
    return { accountId: row.account_id, deviceId: row.device_id, credentialId: row.id };
  };
}

export function credentialHandlers(deps: HostedDeps, apiOrigin: string | null) {
  const { sql, clock, pepper } = deps;
  secretHash(pepper, 'check', 'pepper');

  async function issue(request: HostedRequest): Promise<HostedResponse> {
    const { accountId, deviceId } = await deps.authenticate(request);
    fields(json(request), []);
    const plan = await deps.entitlements(accountId);
    check(plan.allowance, 'PLAN_REQUIRED', 'The model allowance needs the paid plan.', 402);
    check(apiOrigin, 'ALLOWANCE_ENDPOINT_NOT_SET', 'This server has no public address set for the allowance yet.', 503);
    const credentialId = newId('alc'), credential = `ca_${opaqueToken()}`, createdAt = clock().toISOString();
    await sql.transaction(async tx => {
      // One issue at a time per device, so the live count cannot be raced past the limit.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`allowance-credential:${deviceId}`]);
      await tx.query(`UPDATE allowance_credentials SET revoked_at = GREATEST(created_at, $2::timestamptz) WHERE id IN (
                        SELECT id FROM allowance_credentials WHERE device_id = $1 AND revoked_at IS NULL ORDER BY seq DESC OFFSET $3)`,
        [deviceId, createdAt, MAX_LIVE_CREDENTIALS_PER_DEVICE - 1]);
      await tx.query(`INSERT INTO allowance_credentials (id, token_hash, account_id, device_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [credentialId, secretHash(pepper, PURPOSE, credential), accountId, deviceId, createdAt]);
    });
    return ok({ credentialId, credential, endpoint: `${apiOrigin}${RESPONSES_PATH}`, createdAt }, 201);
  }

  /** Any device of the account may revoke; revoking twice answers with the first revocation time. */
  async function revoke(request: HostedRequest): Promise<HostedResponse> {
    const { accountId } = await deps.authenticate(request);
    const credentialId = request.params.credentialId;
    check(isId(credentialId, 'alc'), 'NOT_FOUND', 'The server has no such credential.', 404);
    const { rows: [row] } = await sql.query<{ revoked_at: Date | string }>(
      `UPDATE allowance_credentials SET revoked_at = COALESCE(revoked_at, GREATEST(created_at, $3::timestamptz))
       WHERE id = $1 AND account_id = $2 RETURNING revoked_at`, [credentialId, accountId, clock().toISOString()]);
    check(row, 'NOT_FOUND', 'The server has no such credential.', 404);
    return ok({ credentialId, revokedAt: new Date(row.revoked_at).toISOString() });
  }

  return { issue, revoke };
}
