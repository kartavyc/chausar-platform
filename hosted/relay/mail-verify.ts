import type { HostedDeps } from '../shared/module.ts';
import { HostedError, check } from '../shared/errors.ts';
import { isLetterToken, letterToken, newId, openServer, sameHex, secretHash } from '../shared/crypto.ts';
import { MAIL_TEXT, confirmationBody } from '../shared/templates.ts';
import type { Channel, REPLIES } from '../shared/templates.ts';
import type { Sql } from '../db/sql.ts';
import { PermanentJobError } from '../db/queue.ts';
import type { Job, Worker } from '../db/queue.ts';
import { confirmLink } from './channels.ts';
import type { MailChannel } from './channels.ts';

/** What the relay shares with its mail and status helpers: its keys and its single paths for replies and arrivals. */
export type RelayKit = {
  sealKey: Buffer; linkOrigin: string; mail: MailChannel | null;
  recipientHash(channel: Channel, id: string): string;
  addressAad(accountId: string, channel: Channel): string;
  queueReply(sql: Sql, input: { channel: Channel; accountId: string | null; key: keyof typeof REPLIES; to: string; inboundAt: Date }): Promise<void>;
  arrived(sql: Sql, channel: Channel, providerEventId: string, accountId: string | null, kind: string): Promise<boolean>;
  command(sql: Sql, channel: Channel, sender: string, accountId: string | null, kind: 'help' | 'stop' | 'start'): Promise<keyof typeof REPLIES>;
};
/** The address confirmation link page: GET peeks (mail scanners prefetch links), POST confirms once. */
export type MailConfirmPages = { peek(token: string): Promise<boolean>; confirm(token: string): Promise<boolean> };

export const CONFIRM_MS = 24 * 3600000, CONFIRM_JOB = 'relay.mailConfirm', CONFIRMATIONS_PER_DAY = 3;
const RETRYABLE = new Set(['PROVIDER_FAILED', 'PROVIDER_UNREACHABLE']);

/**
 * Mail turns on only after its address is confirmed: one fixed mail with a /v/<letters> link, single use, a day long.
 * It does not count against the monthly thirty; at most three are sent per account in a day.
 */
export function createMailVerify(deps: HostedDeps, kit: RelayKit) {
  const now = () => deps.clock();
  const tokenHash = (token: string) => secretHash(deps.pepper, 'relay-mail-confirm', token);

  /** Inside the channel save's transaction, when mail would turn on: the status to store, queueing a confirmation when one is needed. */
  async function require(tx: Sql, accountId: string, recipient: string, confirmedHash: string | null): Promise<'on' | 'awaiting-confirmation'> {
    if (confirmedHash && sameHex(confirmedHash, recipient)) return 'on';
    const at = now();
    const { rows: [pending] } = await tx.query(`SELECT id FROM relay_mail_confirmations WHERE account_id = $1 AND recipient_hash = $2
      AND (status = 'queued' OR (status = 'sent' AND expires_at > $3)) LIMIT 1`, [accountId, recipient, at.toISOString()]);
    if (pending) return 'awaiting-confirmation';
    const { rows: [counted] } = await tx.query('SELECT count(*)::int AS n FROM relay_mail_confirmations WHERE account_id = $1 AND created_at > $2',
      [accountId, new Date(at.getTime() - 24 * 3600000).toISOString()]);
    check(counted.n < CONFIRMATIONS_PER_DAY, 'MAIL_CONFIRM_LIMITED', 'Three confirmation mails were sent today. Try again tomorrow.', 429);
    // A new address (or a new attempt) voids every earlier link.
    await tx.query(`UPDATE relay_mail_confirmations SET status = 'replaced', token_hash = NULL, updated_at = $2 WHERE account_id = $1 AND status IN ('queued', 'sent')`, [accountId, at.toISOString()]);
    const id = newId('rmc');
    await tx.query('INSERT INTO relay_mail_confirmations (id, account_id, recipient_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)', [id, accountId, recipient, at.toISOString()]);
    await deps.queue.enqueue({ type: CONFIRM_JOB, accountId, payload: { confirmationId: id }, dedupeKey: `relay-confirm:${id}` }, tx);
    return 'awaiting-confirmation';
  }

  async function dispatch(job: Job) {
    const id = job.payload.confirmationId;
    if (typeof id !== 'string') throw new PermanentJobError('JOB_PAYLOAD_INVALID');
    const { rows: [row] } = await deps.sql.query('SELECT * FROM relay_mail_confirmations WHERE id = $1', [id]);
    if (!row || row.status !== 'queued') return;
    const at = () => now().toISOString();
    const { rows: [channel] } = await deps.sql.query(`SELECT status, recipient_hash, address_sealed FROM relay_channels WHERE account_id = $1 AND channel = 'mail'`, [row.account_id]);
    if (channel?.status !== 'awaiting-confirmation' || !channel.recipient_hash || !channel.address_sealed || !sameHex(channel.recipient_hash, row.recipient_hash)) {
      await deps.sql.query(`UPDATE relay_mail_confirmations SET status = 'replaced', token_hash = NULL, updated_at = $2 WHERE id = $1 AND status = 'queued'`, [id, at()]);
      return;
    }
    try {
      check(kit.mail, 'CHANNEL_NOT_CONFIGURED', 'This channel is not configured.', 503);
      let to: string;
      try { to = openServer(kit.sealKey, channel.address_sealed, kit.addressAad(row.account_id, 'mail')); } catch { throw new HostedError('RECIPIENT_INVALID', 'The stored recipient is not valid.', 500); }
      const token = letterToken();
      const { rowCount } = await deps.sql.query(`UPDATE relay_mail_confirmations SET token_hash = $2, expires_at = $3, updated_at = $4 WHERE id = $1 AND status = 'queued'`,
        [id, tokenHash(token), new Date(now().getTime() + CONFIRM_MS).toISOString(), at()]);
      if (rowCount !== 1) return;
      const providerId = await kit.mail.sendText(deps.fetch, to, MAIL_TEXT.confirmHeadline, confirmationBody(confirmLink(kit.linkOrigin, token)));
      await deps.sql.query(`UPDATE relay_mail_confirmations SET status = 'sent', provider_message_id = $2, last_error = NULL, updated_at = $3 WHERE id = $1 AND status = 'queued'`, [id, providerId, at()]);
    } catch (error: any) {
      const code = error instanceof HostedError ? error.code : 'DISPATCH_FAILED';
      const retry = !(error instanceof HostedError) || RETRYABLE.has(code);
      if (!retry || job.attempts >= job.maxAttempts) await deps.sql.query(`UPDATE relay_mail_confirmations SET status = 'failed', token_hash = NULL, last_error = $2, updated_at = $3 WHERE id = $1 AND status = 'queued'`, [id, code, at()]);
      else await deps.sql.query('UPDATE relay_mail_confirmations SET token_hash = NULL, last_error = $2, updated_at = $3 WHERE id = $1', [id, code, at()]);
      throw retry ? error : new PermanentJobError(code);
    }
  }

  /** A usable link: sent, unused, unexpired, and the channel still waits for this same address. */
  const usable = `SELECT c.id, c.account_id, c.recipient_hash FROM relay_mail_confirmations c
    JOIN relay_channels r ON r.account_id = c.account_id AND r.channel = 'mail' AND r.status = 'awaiting-confirmation' AND r.recipient_hash = c.recipient_hash
    WHERE c.token_hash = $1 AND c.status = 'sent' AND c.used_at IS NULL AND c.expires_at > $2`;
  const pages: MailConfirmPages = {
    async peek(token) {
      if (!isLetterToken(token)) return false;
      const { rows } = await deps.sql.query(usable, [tokenHash(token), now().toISOString()]);
      return rows.length === 1;
    },
    async confirm(token) {
      if (!isLetterToken(token)) return false;
      return deps.sql.transaction(async tx => {
        const at = now().toISOString();
        const { rows: [found] } = await tx.query(`${usable} FOR UPDATE OF c, r`, [tokenHash(token), at]);
        if (!found) return false;
        await tx.query(`UPDATE relay_channels SET status = 'on', confirmed_hash = recipient_hash, updated_at = $2 WHERE account_id = $1 AND channel = 'mail'`, [found.account_id, at]);
        await tx.query(`UPDATE relay_mail_confirmations SET status = 'confirmed', used_at = $2, token_hash = NULL, updated_at = $2 WHERE id = $1`, [found.id, at]);
        return true;
      });
    },
  };

  return {
    require, pages,
    jobs(worker: Worker) { worker.register(CONFIRM_JOB, dispatch); },
    async sweep() {
      const at = now();
      await deps.sql.query(`UPDATE relay_mail_confirmations SET token_hash = NULL WHERE token_hash IS NOT NULL AND expires_at <= $1`, [at.toISOString()]);
      await deps.sql.query('DELETE FROM relay_mail_confirmations WHERE created_at <= $1', [new Date(at.getTime() - 2 * 86400000).toISOString()]);
    },
  };
}
