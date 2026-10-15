import { createHash, hkdfSync } from 'node:crypto';
import type { HostedDeps } from '../shared/module.ts';
import type { HostedRequest, Router } from '../shared/http.ts';
import { fields, json, ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { isLetterToken, letterToken, newId, openServer, sameHex, sealServer, secretHash } from '../shared/crypto.ts';
import { RECOVERY_TEXT, WHATSAPP_RECOVERY_TEMPLATE, recoveryContactBody } from '../shared/templates.ts';
import type { Channel } from '../shared/templates.ts';
import type { Sql, Row } from '../db/sql.ts';
import { PermanentJobError } from '../db/queue.ts';
import type { Job, Worker } from '../db/queue.ts';
import { MAIL_ADDRESS } from './channels.ts';
import type { MailChannel, TelegramChannel, WhatsAppChannel } from './channels.ts';

/**
 * Recovery through a contact (FR-13, SH-02). A two-part escrow: the desktop encrypts its recovery code under a random
 * key K and keeps the ciphertext on its own disk; the relay keeps K (sealed) and the contact's address (sealed). A
 * recovery request is authenticated by a local request credential the desktop keeps beside the ciphertext (the relay
 * keeps only a keyed hash of its SHA-256). The relay sends the contact one fixed message with a /r/ link, and the owner's
 * own channels one fixed notice; once the contact confirms, K is released exactly once and deleted. The relay never
 * receives the recovery code, and the desktop file never holds K.
 */
export const RECOVERY_CONFIRM_MS = 24 * 3600000, RECOVERY_RELEASE_MS = 24 * 3600000, RECOVERY_JOB = 'relay.recovery';
/**
 * Limits in twenty-four hours: requests per enrolment, and messages one contact may get from one account. Another
 * account naming the same contact counts only against its own allowance, so it cannot use up this account's.
 * `RECOVERY_CONTACT_PER_DAY` is a ceiling across all accounts against spam; it never refuses an account's first
 * request of the day to its contact, so no other account can block a recovery outright.
 */
export const RECOVERY_REQUESTS_PER_DAY = 3, RECOVERY_ACCOUNT_CONTACT_PER_DAY = 3, RECOVERY_CONTACT_PER_DAY = 20;
export const INDIAN_MOBILE = /^\+91[6-9][0-9]{9}$/;
export type RecoveryStatus = 'waiting' | 'confirmed' | 'declined' | 'expired' | 'failed' | 'released';
export type RecoveryPages = { peek(token: string): Promise<boolean>; decide(token: string, choice: 'confirm' | 'decline'): Promise<'confirmed' | 'declined' | null> };
export type RecoveryKit = {
  linkOrigin: string; sealKey: Buffer; mail: MailChannel | null; whatsapp: WhatsAppChannel | null; telegram: TelegramChannel | null;
  recipientHash(channel: Channel, id: string): string;
  addressAad(accountId: string, channel: Channel): string;
};

const RETRYABLE = new Set(['PROVIDER_FAILED', 'PROVIDER_UNREACHABLE']);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const isoOf = (value: unknown) => value == null ? null : new Date(value as string).toISOString();
export const recoveryLink = (origin: string, token: string) => `${origin}/r/${token}`;
const maskReach = (reach: string) => reach.startsWith('+') ? `${reach.slice(0, 3)}${'•'.repeat(Math.max(0, reach.length - 7))}${reach.slice(-4)}`
  : `${reach[0]}•••${reach.slice(reach.lastIndexOf('@'))}`;

export function createRecovery(deps: HostedDeps, kit: RecoveryKit) {
  const now = () => deps.clock();
  const sealKey = Buffer.from(hkdfSync('sha256', deps.pepper, 'chausar-relay', 'recovery-seal', 32));
  const credentialHash = (verifier: string) => secretHash(deps.pepper, 'recovery-credential', verifier);
  const contactHash = (reach: string) => secretHash(deps.pepper, 'recovery-contact', reach);
  const tokenHash = (token: string) => secretHash(deps.pepper, 'recovery-confirm', token);
  const keyAad = (id: string) => `recovery-key:${id}`, contactAad = (id: string) => `recovery-contact:${id}`;
  const canReach = (channel: 'whatsapp' | 'mail') => channel === 'mail' ? !!kit.mail : !!kit.whatsapp?.sendFixedTemplate;

  /** The enrolment a request credential belongs to (any status), on a device that is not revoked. */
  async function byCredential(sql: Sql, request: HostedRequest, lock = false): Promise<Row> {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
    check(match, 'RECOVERY_CREDENTIAL_INVALID', 'The recovery credential is not valid.', 401);
    const { rows: [row] } = await sql.query(`SELECT e.* FROM recovery_enrolments e JOIN devices d ON d.id = e.device_id AND d.revoked_at IS NULL
      WHERE e.credential_hash = $1${lock ? ' FOR UPDATE OF e' : ''}`, [credentialHash(sha256(match[1]))]);
    check(row, 'RECOVERY_CREDENTIAL_INVALID', 'The recovery credential is not valid.', 401);
    check(row.status !== 'revoked', 'RECOVERY_NOT_ENROLLED', 'There is no recovery contact for this computer.', 404);
    return row;
  }
  /** What a request reads as to the desktop at this moment. */
  function statusOf(row: Row, at: Date): RecoveryStatus {
    if (row.status === 'queued' || row.status === 'sent') return new Date(row.expires_at) > at ? 'waiting' : 'expired';
    if (row.status === 'confirmed') return new Date(row.decided_at).getTime() + RECOVERY_RELEASE_MS > at.getTime() ? 'confirmed' : 'expired';
    if (row.status === 'replaced') return 'expired';
    return row.status as RecoveryStatus;
  }
  const view = (row: Row, at: Date) => ({ requestId: row.id, status: statusOf(row, at), expiresAt: isoOf(row.expires_at) });
  async function requestOf(sql: Sql, enrolmentId: string, requestId: string, lock = false): Promise<Row> {
    check(/^rcr_[0-9a-f-]{36}$/.test(requestId), 'RECOVERY_REQUEST_NOT_FOUND', 'There is no such recovery request.', 404);
    const { rows: [row] } = await sql.query(`SELECT * FROM recovery_requests WHERE id = $1 AND enrolment_id = $2${lock ? ' FOR UPDATE' : ''}`, [requestId, enrolmentId]);
    check(row, 'RECOVERY_REQUEST_NOT_FOUND', 'There is no such recovery request.', 404);
    return row;
  }
  /** Voids the open requests of an enrolment: their links no longer work. */
  const voidRequests = (sql: Sql, enrolmentId: string, at: string) => sql.query(`UPDATE recovery_requests SET status = 'replaced', token_hash = NULL, updated_at = $2
    WHERE enrolment_id = $1 AND status IN ('queued', 'sent', 'confirmed')`, [enrolmentId, at]);

  // ---- sending: the contact's one message, and the owner's notice on each channel that is on
  async function ownerRecipient(accountId: string, channel: Channel): Promise<string | null> {
    const { rows: [row] } = await deps.sql.query('SELECT status, recipient_hash, address_sealed FROM relay_channels WHERE account_id = $1 AND channel = $2', [accountId, channel]);
    if (row?.status !== 'on' || !row.recipient_hash) return null;
    if (channel === 'whatsapp') {
      const { rows: [account] } = await deps.sql.query('SELECT phone FROM accounts WHERE id = $1', [accountId]);
      const to = typeof account?.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(account.phone) ? account.phone.slice(1) : null;
      return to && sameHex(row.recipient_hash, kit.recipientHash('whatsapp', to)) ? to : null;
    }
    if (!row.address_sealed) return null;
    try { return openServer(kit.sealKey, row.address_sealed, kit.addressAad(accountId, channel)); } catch { throw new HostedError('RECIPIENT_INVALID', 'The stored recipient is not valid.', 500); }
  }
  async function sendOwner(job: Job, requestId: string, channel: Channel) {
    const { rows: [row] } = await deps.sql.query('SELECT account_id FROM recovery_requests WHERE id = $1', [requestId]);
    if (!row) return;
    try {
      const to = await ownerRecipient(row.account_id, channel);
      if (!to) return;
      if (channel === 'mail') { check(kit.mail, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503); await kit.mail.sendText(deps.fetch, to, RECOVERY_TEXT.ownerSubject, RECOVERY_TEXT.ownerLine); }
      else if (channel === 'telegram') { check(kit.telegram, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503); await kit.telegram.sendText(deps.fetch, to, RECOVERY_TEXT.ownerLine); }
      else { check(kit.whatsapp?.sendFixedTemplate, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503); await kit.whatsapp.sendFixedTemplate(deps.fetch, to, WHATSAPP_RECOVERY_TEMPLATE.owner, null); }
    } catch (error: any) {
      const code = error instanceof HostedError ? error.code : 'DISPATCH_FAILED';
      if (error instanceof HostedError && !RETRYABLE.has(code)) throw new PermanentJobError(code);
      if (job.attempts >= job.maxAttempts) throw new PermanentJobError(code);
      throw error;
    }
  }
  async function sendContact(job: Job, requestId: string) {
    const { rows: [row] } = await deps.sql.query(`SELECT r.*, e.status AS enrolment_status, e.contact_sealed, e.contact_channel FROM recovery_requests r
      JOIN recovery_enrolments e ON e.id = r.enrolment_id WHERE r.id = $1`, [requestId]);
    if (!row || row.status !== 'queued') return;
    const at = () => now().toISOString();
    if (row.enrolment_status !== 'active' || new Date(row.expires_at) <= now()) {
      await deps.sql.query(`UPDATE recovery_requests SET status = 'replaced', token_hash = NULL, updated_at = $2 WHERE id = $1 AND status = 'queued'`, [requestId, at()]);
      return;
    }
    try {
      let to: string;
      try { to = openServer(sealKey, row.contact_sealed, contactAad(row.enrolment_id)); } catch { throw new HostedError('RECIPIENT_INVALID', 'The stored recipient is not valid.', 500); }
      const token = letterToken();
      const { rowCount } = await deps.sql.query(`UPDATE recovery_requests SET token_hash = $2, updated_at = $3 WHERE id = $1 AND status = 'queued'`, [requestId, tokenHash(token), at()]);
      if (rowCount !== 1) return;
      let providerId: string;
      if (row.contact_channel === 'mail') {
        check(kit.mail, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
        providerId = await kit.mail.sendText(deps.fetch, to, RECOVERY_TEXT.contactSubject, recoveryContactBody(recoveryLink(kit.linkOrigin, token)));
      } else {
        check(kit.whatsapp?.sendFixedTemplate, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
        providerId = await kit.whatsapp.sendFixedTemplate(deps.fetch, to.slice(1), WHATSAPP_RECOVERY_TEMPLATE.contact, token);
      }
      await deps.sql.query(`UPDATE recovery_requests SET status = 'sent', provider_message_id = $2, last_error = NULL, updated_at = $3 WHERE id = $1 AND status = 'queued'`, [requestId, providerId, at()]);
    } catch (error: any) {
      const code = error instanceof HostedError ? error.code : 'DISPATCH_FAILED';
      const retry = !(error instanceof HostedError) || RETRYABLE.has(code);
      if (!retry || job.attempts >= job.maxAttempts) await deps.sql.query(`UPDATE recovery_requests SET status = 'failed', token_hash = NULL, last_error = $2, updated_at = $3 WHERE id = $1 AND status = 'queued'`, [requestId, code, at()]);
      else await deps.sql.query('UPDATE recovery_requests SET token_hash = NULL, last_error = $2, updated_at = $3 WHERE id = $1', [requestId, code, at()]);
      throw retry ? error : new PermanentJobError(code);
    }
  }
  async function dispatch(job: Job) {
    const { requestId, target, channel } = job.payload as { requestId?: unknown; target?: unknown; channel?: unknown };
    if (typeof requestId !== 'string') throw new PermanentJobError('JOB_PAYLOAD_INVALID');
    if (target === 'contact') return sendContact(job, requestId);
    if (target === 'owner' && (channel === 'whatsapp' || channel === 'telegram' || channel === 'mail')) return sendOwner(job, requestId, channel);
    throw new PermanentJobError('JOB_PAYLOAD_INVALID');
  }

  // ---- the /r/ link page: GET peeks (mail scanners prefetch links), POST decides once
  const usable = `SELECT r.id FROM recovery_requests r JOIN recovery_enrolments e ON e.id = r.enrolment_id AND e.status = 'active'
    WHERE r.token_hash = $1 AND r.status = 'sent' AND r.expires_at > $2`;
  const pages: RecoveryPages = {
    async peek(token) {
      if (!isLetterToken(token)) return false;
      return (await deps.sql.query(usable, [tokenHash(token), now().toISOString()])).rows.length === 1;
    },
    async decide(token, choice) {
      if (!isLetterToken(token)) return null;
      return deps.sql.transaction(async tx => {
        const at = now().toISOString();
        const { rows: [found] } = await tx.query(`${usable} FOR UPDATE OF r`, [tokenHash(token), at]);
        if (!found) return null;
        const status = choice === 'confirm' ? 'confirmed' : 'declined';
        await tx.query('UPDATE recovery_requests SET status = $2, decided_at = $3, token_hash = NULL, updated_at = $3 WHERE id = $1', [found.id, status, at]);
        return status;
      });
    },
  };

  function routes(router: Router) {
    // Enrolment, by the paired desktop (session auth). K arrives once and is sealed at rest; the name never arrives.
    router.add('PUT', '/v1/recovery/enrolment', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const body = fields<{ key: unknown; contact: any; credentialSha256: unknown }>(json(request), ['key', 'contact', 'credentialSha256']);
      const { reach } = fields<{ reach: unknown }>(body.contact, ['reach']);
      check(typeof body.key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(body.key) && Buffer.from(body.key, 'base64').length === 32, 'RECOVERY_KEY_INVALID', 'The recovery key is not valid.');
      check(typeof body.credentialSha256 === 'string' && /^[0-9a-f]{64}$/.test(body.credentialSha256), 'INVALID_REQUEST', 'The request credential is not valid.');
      check(typeof reach === 'string' && reach.length <= 254 && (INDIAN_MOBILE.test(reach) || MAIL_ADDRESS.test(reach)), 'RECOVERY_REACH_INVALID', 'Give an Indian mobile number or a mail address.');
      const channel = INDIAN_MOBILE.test(reach) ? 'whatsapp' : 'mail', normal = channel === 'mail' ? reach.toLowerCase() : reach;
      check(canReach(channel), 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      check((await deps.entitlements(accountId)).relay, 'PLAN_REQUIRED', 'The recovery contact is part of the paid plan.', 402);
      return deps.sql.transaction(async tx => {
        const at = now().toISOString(), id = newId('rce');
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`recovery-enrol:${accountId}:${deviceId}`]);
        const { rows: earlier } = await tx.query(`UPDATE recovery_enrolments SET status = 'revoked', key_sealed = NULL, contact_sealed = NULL, updated_at = $3
          WHERE account_id = $1 AND device_id = $2 AND status = 'active' RETURNING id`, [accountId, deviceId, at]);
        for (const row of earlier) await voidRequests(tx, row.id, at);
        const verifier = credentialHash(body.credentialSha256 as string);
        const { rows: [taken] } = await tx.query('SELECT 1 FROM recovery_enrolments WHERE credential_hash = $1', [verifier]);
        check(!taken, 'INVALID_REQUEST', 'The request credential is not valid.');
        await tx.query(`INSERT INTO recovery_enrolments (id, account_id, device_id, status, key_sealed, contact_channel, contact_sealed, contact_hash, contact_mask, credential_hash, created_at, updated_at)
          VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $10)`,
          [id, accountId, deviceId, sealServer(sealKey, body.key as string, keyAad(id)), channel, sealServer(sealKey, reach, contactAad(id)), contactHash(normal), maskReach(reach), verifier, at]);
        return ok({ enrolmentId: id, contactChannel: channel, contactMasked: maskReach(reach), enrolledAt: at });
      });
    });
    router.add('GET', '/v1/recovery/enrolment', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { rows: [row] } = await deps.sql.query(`SELECT * FROM recovery_enrolments WHERE account_id = $1 AND device_id = $2 AND status = 'active'`, [accountId, deviceId]);
      return ok({ enrolment: row ? { enrolmentId: row.id, contactChannel: row.contact_channel, contactMasked: row.contact_mask, enrolledAt: isoOf(row.created_at) } : null });
    });
    router.add('DELETE', '/v1/recovery/enrolment', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      return deps.sql.transaction(async tx => {
        const at = now().toISOString();
        const { rows } = await tx.query(`UPDATE recovery_enrolments SET status = 'revoked', key_sealed = NULL, contact_sealed = NULL, updated_at = $3
          WHERE account_id = $1 AND device_id = $2 AND status = 'active' RETURNING id`, [accountId, deviceId, at]);
        for (const row of rows) await voidRequests(tx, row.id, at);
        return ok({ removed: rows.length > 0 });
      });
    });

    // Removal by the request credential, for a desktop that has no session (unpaired, or the session ended): deletes
    // K and the contact's address of exactly the enrolment that credential belongs to.
    router.add('POST', '/v1/recovery/enrolment/withdraw', async request => {
      fields(json(request), []);
      return deps.sql.transaction(async tx => {
        const enrolment = await byCredential(tx, request, true);
        if (enrolment.status !== 'active') return ok({ removed: false });
        const at = now().toISOString();
        await tx.query(`UPDATE recovery_enrolments SET status = 'revoked', key_sealed = NULL, contact_sealed = NULL, updated_at = $2 WHERE id = $1`, [enrolment.id, at]);
        await voidRequests(tx, enrolment.id, at);
        return ok({ removed: true });
      });
    });

    // Requests, by the locked desktop (request credential auth: the session lives in the locked vault).
    router.add('POST', '/v1/recovery/requests', async request => {
      fields(json(request), []);
      return deps.sql.transaction(async tx => {
        const enrolment = await byCredential(tx, request, true);
        check(enrolment.status === 'active', 'RECOVERY_KEY_RELEASED', 'This recovery contact was used. Name them again after you are back in.', 410);
        const at = now(), since = new Date(at.getTime() - 24 * 3600000).toISOString();
        const { rows: [mine] } = await tx.query('SELECT count(*)::int AS n FROM recovery_requests WHERE enrolment_id = $1 AND created_at > $2', [enrolment.id, since]);
        check(mine.n < RECOVERY_REQUESTS_PER_DAY, 'RECOVERY_REQUEST_LIMITED', 'Three recovery requests were made today. Try again tomorrow.', 429);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`recovery-contact:${enrolment.contact_hash}`]);
        const { rows: [counts] } = await tx.query(`SELECT count(*) FILTER (WHERE account_id = $3)::int AS own, count(*)::int AS every
          FROM recovery_requests WHERE contact_hash = $1 AND created_at > $2`, [enrolment.contact_hash, since, enrolment.account_id]);
        check(counts.own < RECOVERY_ACCOUNT_CONTACT_PER_DAY, 'RECOVERY_REQUEST_LIMITED', 'This contact was asked too often today. Try again tomorrow.', 429);
        check(counts.own === 0 || counts.every < RECOVERY_CONTACT_PER_DAY, 'RECOVERY_REQUEST_LIMITED', 'This contact was asked too often today. Try again tomorrow.', 429);
        // A new request voids every earlier link of this enrolment.
        await voidRequests(tx, enrolment.id, at.toISOString());
        const id = newId('rcr'), expires = new Date(at.getTime() + RECOVERY_CONFIRM_MS).toISOString();
        await tx.query(`INSERT INTO recovery_requests (id, enrolment_id, account_id, contact_hash, status, expires_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'queued', $5, $6, $6)`, [id, enrolment.id, enrolment.account_id, enrolment.contact_hash, expires, at.toISOString()]);
        await deps.queue.enqueue({ type: RECOVERY_JOB, accountId: enrolment.account_id, payload: { requestId: id, target: 'contact' }, dedupeKey: `recovery:${id}` }, tx);
        // The owner hears of it on every channel that is on, so a request nobody expected is noticed.
        const { rows: on } = await tx.query(`SELECT channel FROM relay_channels WHERE account_id = $1 AND status = 'on'`, [enrolment.account_id]);
        for (const { channel } of on) if (kit[channel as Channel]) await deps.queue.enqueue({ type: RECOVERY_JOB, accountId: enrolment.account_id, payload: { requestId: id, target: 'owner', channel }, dedupeKey: `recovery:${id}:${channel}` }, tx);
        return ok({ requestId: id, status: 'waiting', expiresAt: expires, contactChannel: enrolment.contact_channel }, 202);
      });
    });
    router.add('GET', '/v1/recovery/requests/:requestId', async request => {
      const enrolment = await byCredential(deps.sql, request);
      return ok(view(await requestOf(deps.sql, enrolment.id, request.params.requestId), now()));
    });
    // K leaves once, only for a confirmed request, and is deleted with the contact's address in the same transaction.
    router.add('POST', '/v1/recovery/requests/:requestId/release', async request => {
      fields(json(request), []);
      return deps.sql.transaction(async tx => {
        const enrolment = await byCredential(tx, request, true);
        const row = await requestOf(tx, enrolment.id, request.params.requestId, true), at = now();
        const status = statusOf(row, at);
        check(status !== 'released' && enrolment.status === 'active', 'RECOVERY_KEY_RELEASED', 'The recovery key was already released.', 410);
        check(status !== 'declined', 'RECOVERY_DECLINED', 'Your recovery contact said they did not ask.', 409);
        check(status !== 'expired', 'RECOVERY_EXPIRED', 'This recovery request has expired.', 410);
        check(status === 'confirmed', 'RECOVERY_NOT_CONFIRMED', 'Your recovery contact has not confirmed yet.', 409);
        let key: string;
        try { key = openServer(sealKey, enrolment.key_sealed, keyAad(enrolment.id)); } catch { throw new HostedError('SEALED_INVALID', 'A sealed server value is damaged.', 500); }
        await tx.query(`UPDATE recovery_enrolments SET status = 'released', key_sealed = NULL, contact_sealed = NULL, updated_at = $2 WHERE id = $1`, [enrolment.id, at.toISOString()]);
        await tx.query(`UPDATE recovery_requests SET status = 'released', released_at = $2, updated_at = $2 WHERE id = $1`, [row.id, at.toISOString()]);
        return ok({ requestId: row.id, key });
      });
    });
  }

  return {
    routes, pages,
    jobs(worker: Worker) { worker.register(RECOVERY_JOB, dispatch); },
    async sweep() {
      const at = now(), old = new Date(at.getTime() - 2 * 86400000).toISOString();
      // An active enrolment whose device was revoked (the revoke itself does this too; this catches any revoke made
      // another way) loses K and the contact's address, and its open links stop working.
      await deps.sql.transaction(async tx => {
        const { rows } = await tx.query(`UPDATE recovery_enrolments e SET status = 'revoked', key_sealed = NULL, contact_sealed = NULL, updated_at = $1
          FROM devices d WHERE d.id = e.device_id AND d.revoked_at IS NOT NULL AND e.status = 'active' RETURNING e.id`, [at.toISOString()]);
        for (const row of rows) await voidRequests(tx, row.id, at.toISOString());
      });
      await deps.sql.query(`UPDATE recovery_requests SET token_hash = NULL WHERE token_hash IS NOT NULL AND expires_at <= $1`, [at.toISOString()]);
      await deps.sql.query('DELETE FROM recovery_requests WHERE created_at <= $1', [old]);
      await deps.sql.query(`DELETE FROM recovery_enrolments WHERE status <> 'active' AND updated_at <= $1`, [old]);
    },
  };
}
