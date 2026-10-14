/**
 * Blind backup storage. The desktop encrypts a backup with a key that never leaves the desktop and uploads
 * only ciphertext. The server checks the format marker, the size against the plan quota and the SHA-256 the
 * client states, then stores the bytes. It never receives a key, so it cannot open anything it stores.
 *
 * Retention: the `backup.prune` job keeps the newest `entitlements.backupKeep` stored versions per account.
 * When an account loses the backup entitlement (a cancelled plan), its backups stay readable and deletable
 * for 30 days from the first prune that sees the lapse, then every one is removed. Uploads need the plan;
 * listing, download and delete do not, so a person can always take their backups home.
 */
import { createHash } from 'node:crypto';
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { HostedRequest, Router } from '../shared/http.ts';
import type { Worker, Job } from '../db/queue.ts';
import type { Sql } from '../db/sql.ts';
import { ok } from '../shared/http.ts';
import { check } from '../shared/errors.ts';
import { sameHex } from '../shared/crypto.ts';
import { BACKUP_ID, blobKey, type BlobStore } from './store.ts';

export const BACKUP_MAGIC = Buffer.from('CHSBK1\0\0', 'latin1');
export const BACKUP_MAX_BODY = 512 * 1024 * 1024;
export const LAPSED_KEEP_DAYS = 30;
/** An upload that never finished (a crash between the row and the bytes) is cleared after this long. */
const PENDING_STALE_MS = 3600000;
const DAY_MS = 86400000;

type BackupRow = { backup_id: string; size_bytes: string; sha256: string; created_at: Date };
const view = (row: BackupRow) => ({ backupId: row.backup_id, sizeBytes: Number(row.size_bytes), sha256: row.sha256, createdAt: new Date(row.created_at).toISOString() });

export function createBackupModule(deps: HostedDeps, options: { store: BlobStore | null }): HostedModule {
  const { sql, clock } = deps;
  const store = (): BlobStore => { check(options.store, 'BLOB_STORE_NOT_CONFIGURED', 'Backup storage is not set up on this server.', 503); return options.store; };
  const idOf = (request: HostedRequest) => { const id = request.params.backupId; check(BACKUP_ID.test(id), 'BACKUP_ID_INVALID', 'The backup id is not valid.'); return id; };

  async function upload(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const plan = await deps.entitlements(accountId);
    check(plan.backup, 'PLAN_REQUIRED', 'Backup needs the paid plan.', 402);
    const blobs = store(), backupId = idOf(request); blobKey(accountId, backupId);
    check((request.headers['content-type'] ?? '').split(';')[0].trim() === 'application/octet-stream', 'UNSUPPORTED_MEDIA_TYPE', 'Send the backup as raw bytes.', 415);
    const stated = (request.headers['x-chausar-sha256'] ?? '').trim().toLowerCase();
    check(/^[0-9a-f]{64}$/.test(stated), 'INVALID_REQUEST', 'Send the SHA-256 of the backup.');
    const body = request.body;
    check(body.length > BACKUP_MAGIC.length && body.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC), 'BACKUP_FORMAT_INVALID', 'This is not a Chausar encrypted backup.');
    const sha256 = createHash('sha256').update(body).digest('hex');
    check(sameHex(sha256, stated), 'BACKUP_DIGEST_MISMATCH', 'The backup did not arrive intact. Send it again.');
    check(BigInt(body.length) <= BigInt(plan.backupQuotaBytes), 'BACKUP_QUOTA_EXCEEDED', 'This backup does not fit in the plan storage.', 413);
    const createdAt = clock().toISOString();
    // One upload at a time per account: the quota sum and the new row are decided together.
    await sql.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 40))', [`backup:${accountId}`]);
      const { rows: [existing] } = await tx.query('SELECT 1 FROM backups WHERE account_id = $1 AND backup_id = $2', [accountId, backupId]);
      check(!existing, 'BACKUP_EXISTS', 'A backup with this id already exists.', 409);
      const { rows: [{ used }] } = await tx.query<{ used: string }>('SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM backups WHERE account_id = $1', [accountId]);
      check(BigInt(used) + BigInt(body.length) <= BigInt(plan.backupQuotaBytes), 'BACKUP_QUOTA_EXCEEDED', 'This backup does not fit in the plan storage. Delete an older one first.', 413);
      await tx.query(`INSERT INTO backups (account_id, backup_id, size_bytes, sha256, state, created_at) VALUES ($1, $2, $3, $4, 'pending', $5)`, [accountId, backupId, body.length, sha256, createdAt]);
      await tx.query('DELETE FROM backup_lapses WHERE account_id = $1', [accountId]);
    });
    let stored: { sizeBytes: number; sha256: string } | undefined;
    try { stored = await blobs.put(blobKey(accountId, backupId), body); } catch { /* answered below */ }
    if (!stored || stored.sizeBytes !== body.length || stored.sha256 !== sha256) {
      await blobs.delete(blobKey(accountId, backupId)).catch(() => {});
      await sql.query('DELETE FROM backups WHERE account_id = $1 AND backup_id = $2', [accountId, backupId]);
      check(false, 'BACKUP_STORE_FAILED', 'The backup could not be stored. Send it again.', 500);
    }
    await sql.query(`UPDATE backups SET state = 'stored' WHERE account_id = $1 AND backup_id = $2`, [accountId, backupId]);
    await deps.queue.enqueue({ type: 'backup.prune', accountId, dedupeKey: `backup.prune:${accountId}:${backupId}` });
    return ok({ backupId, sizeBytes: body.length, sha256, createdAt }, 201);
  }

  async function list(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const plan = await deps.entitlements(accountId);
    const { rows } = await sql.query<BackupRow>(`SELECT backup_id, size_bytes, sha256, created_at FROM backups WHERE account_id = $1 AND state = 'stored' ORDER BY created_at DESC, backup_id DESC`, [accountId]);
    const { rows: [{ used }] } = await sql.query<{ used: string }>('SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM backups WHERE account_id = $1', [accountId]);
    return ok({ backups: rows.map(view), quotaBytes: plan.backupQuotaBytes, usedBytes: Number(used), keep: plan.backupKeep });
  }

  async function storedRow(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const backupId = idOf(request);
    const { rows: [row] } = await sql.query<BackupRow>(`SELECT backup_id, size_bytes, sha256, created_at FROM backups WHERE account_id = $1 AND backup_id = $2 AND state = 'stored'`, [accountId, backupId]);
    check(row, 'BACKUP_NOT_FOUND', 'There is no such backup.', 404);
    return { accountId, backupId, row };
  }

  async function download(request: HostedRequest) {
    const { accountId, backupId, row } = await storedRow(request);
    const bytes = await store().get(blobKey(accountId, backupId));
    check(bytes, 'BACKUP_NOT_FOUND', 'There is no such backup.', 404);
    return { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-chausar-sha256': row.sha256 }, body: bytes };
  }

  async function remove(request: HostedRequest) {
    const { accountId, backupId } = await storedRow(request);
    await drop(sql, accountId, backupId);
    return ok({ backupId, deleted: true });
  }

  /** The bytes go first: a row never outlives its blob by more than a failed call. */
  async function drop(db: Sql, accountId: string, backupId: string) {
    await store().delete(blobKey(accountId, backupId));
    await db.query('DELETE FROM backups WHERE account_id = $1 AND backup_id = $2', [accountId, backupId]);
  }

  async function pruneAccount(accountId: string): Promise<number> {
    const plan = await deps.entitlements(accountId), now = clock();
    const doomed = new Set<string>();
    if (plan.backup) {
      await sql.query('DELETE FROM backup_lapses WHERE account_id = $1', [accountId]);
      const { rows } = await sql.query<{ backup_id: string }>(`SELECT backup_id FROM backups WHERE account_id = $1 AND state = 'stored' ORDER BY created_at DESC, backup_id DESC OFFSET $2`,
        [accountId, Math.max(1, Math.floor(plan.backupKeep))]);
      for (const row of rows) doomed.add(row.backup_id);
    } else {
      await sql.query('INSERT INTO backup_lapses (account_id, lapsed_at) VALUES ($1, $2) ON CONFLICT (account_id) DO NOTHING', [accountId, now.toISOString()]);
      const { rows: [lapse] } = await sql.query<{ lapsed_at: Date }>('SELECT lapsed_at FROM backup_lapses WHERE account_id = $1', [accountId]);
      if (now.getTime() - new Date(lapse.lapsed_at).getTime() >= LAPSED_KEEP_DAYS * DAY_MS) {
        const { rows } = await sql.query<{ backup_id: string }>('SELECT backup_id FROM backups WHERE account_id = $1', [accountId]);
        for (const row of rows) doomed.add(row.backup_id);
      }
    }
    const { rows: stale } = await sql.query<{ backup_id: string }>(`SELECT backup_id FROM backups WHERE account_id = $1 AND state = 'pending' AND created_at < $2`,
      [accountId, new Date(now.getTime() - PENDING_STALE_MS).toISOString()]);
    for (const row of stale) doomed.add(row.backup_id);
    for (const backupId of doomed) await drop(sql, accountId, backupId);
    if (plan.backup || doomed.size) await sql.query('DELETE FROM backup_lapses WHERE account_id = $1 AND NOT EXISTS (SELECT 1 FROM backups WHERE account_id = $1)', [accountId]);
    return doomed.size;
  }

  async function prune(job: Job) {
    if (!options.store) return;
    const accounts = job.accountId ? [job.accountId]
      : (await sql.query<{ account_id: string }>('SELECT DISTINCT account_id FROM backups ORDER BY account_id')).rows.map(row => row.account_id);
    for (const accountId of accounts) await pruneAccount(accountId);
  }

  return {
    id: 'backup',
    routes(router: Router) {
      router.add('PUT', '/v1/backups/:backupId', upload, { maxBody: BACKUP_MAX_BODY })
        .add('GET', '/v1/backups', list)
        .add('GET', '/v1/backups/:backupId', download)
        .add('DELETE', '/v1/backups/:backupId', remove);
    },
    jobs(worker: Worker) { worker.register('backup.prune', prune); },
    /** One sweep of every account an hour, on top of the per-upload prune. */
    async sweep() {
      if (!options.store) return;
      await deps.queue.enqueue({ type: 'backup.prune', dedupeKey: `backup.prune:${clock().toISOString().slice(0, 13)}` });
    },
  };
}
