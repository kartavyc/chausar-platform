import { randomUUID } from 'node:crypto';
import type { Sql } from './sql.ts';
import type { Clock } from '../shared/clock.ts';
import { check } from '../shared/errors.ts';
import { newId } from '../shared/crypto.ts';

export type Job = { id: string; type: string; accountId: string | null; payload: Record<string, unknown>; attempts: number; maxAttempts: number; leaseToken: string };
export type EnqueueInput = { type: string; accountId?: string | null; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; maxAttempts?: number };
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** A durable queue on PostgreSQL. A lease that lapses (a crashed worker) returns the job to the queue. */
export class JobQueue {
  readonly #sql: Sql; readonly #clock: Clock;
  constructor(sql: Sql, clock: Clock) { this.#sql = sql; this.#clock = clock; }
  /** Returns the job id, or the existing id when the dedupe key was already queued. */
  async enqueue(input: EnqueueInput, sql: Sql = this.#sql): Promise<string> {
    check(/^[a-z][a-zA-Z0-9.-]{1,63}$/.test(input.type), 'JOB_TYPE_INVALID', 'The job type is not valid.', 500);
    const id = newId('job');
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO jobs (id, type, account_id, payload, dedupe_key, max_attempts, run_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key RETURNING id`,
      [id, input.type, input.accountId ?? null, JSON.stringify(input.payload ?? {}), input.dedupeKey ?? null, input.maxAttempts ?? 5, (input.runAt ?? this.#clock()).toISOString()]);
    return rows[0].id;
  }
  async claim(types: readonly string[], options: { limit?: number; leaseMs?: number } = {}): Promise<Job[]> {
    const at = this.#clock(), lease = new Date(at.getTime() + (options.leaseMs ?? 60000)).toISOString();
    return this.#sql.transaction(async tx => {
      await tx.query(`UPDATE jobs SET status = 'queued', lease_token = NULL, lease_expires_at = NULL WHERE status = 'running' AND lease_expires_at < $1`, [at.toISOString()]);
      const { rows } = await tx.query(
        `SELECT id FROM jobs WHERE status = 'queued' AND run_at <= $1 AND type = ANY($2::text[]) ORDER BY run_at, created_at LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [at.toISOString(), [...types], options.limit ?? 10]);
      const claimed: Job[] = [];
      for (const row of rows) {
        const token = randomUUID();
        const { rows: [job] } = await tx.query(
          `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_token = $2, lease_expires_at = $3 WHERE id = $1
           RETURNING id, type, account_id, payload, attempts, max_attempts`, [row.id, token, lease]);
        claimed.push({ id: job.id, type: job.type, accountId: job.account_id, payload: job.payload, attempts: job.attempts, maxAttempts: job.max_attempts, leaseToken: token });
      }
      return claimed;
    });
  }
  async complete(job: Job): Promise<boolean> {
    const { rowCount } = await this.#sql.query(`UPDATE jobs SET status = 'done', lease_token = NULL, lease_expires_at = NULL, finished_at = $3 WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
      [job.id, job.leaseToken, this.#clock().toISOString()]);
    return rowCount === 1;
  }
  /** Retries with exponential backoff until max attempts, then marks the job dead. `retry: false` ends it now. */
  async fail(job: Job, code: string, options: { retry?: boolean } = {}): Promise<'queued' | 'dead' | 'lost'> {
    const error = CODE.test(code) ? code : 'JOB_FAILED';
    const dead = options.retry === false || job.attempts >= job.maxAttempts;
    const runAt = new Date(this.#clock().getTime() + Math.min(3600000, 2000 * 2 ** Math.max(0, job.attempts - 1))).toISOString();
    const { rowCount } = await this.#sql.query(
      `UPDATE jobs SET status = $3, last_error = $4, run_at = $5, lease_token = NULL, lease_expires_at = NULL, finished_at = CASE WHEN $3 = 'dead' THEN $6::timestamptz ELSE NULL END
       WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
      [job.id, job.leaseToken, dead ? 'dead' : 'queued', error, runAt, this.#clock().toISOString()]);
    return rowCount === 1 ? (dead ? 'dead' : 'queued') : 'lost';
  }
  async status(id: string): Promise<{ status: string; attempts: number; lastError: string | null } | undefined> {
    const { rows: [row] } = await this.#sql.query('SELECT status, attempts, last_error FROM jobs WHERE id = $1', [id]);
    return row ? { status: row.status, attempts: row.attempts, lastError: row.last_error } : undefined;
  }
}

export type JobHandler = (job: Job) => Promise<void>;
/** Thrown by a handler to end a job without retrying (for example a refused recipient). */
export class PermanentJobError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }

/** Runs registered handlers. `runOnce` is what tests and the worker loop call. */
export class Worker {
  readonly #queue: JobQueue; readonly #handlers = new Map<string, JobHandler>();
  constructor(queue: JobQueue) { this.#queue = queue; }
  register(type: string, handler: JobHandler) { check(!this.#handlers.has(type), 'JOB_TYPE_DUPLICATE', 'A job type has two handlers.', 500); this.#handlers.set(type, handler); return this; }
  get types(): string[] { return [...this.#handlers.keys()]; }
  async runOnce(limit = 10): Promise<{ done: number; retried: number; dead: number }> {
    const counts = { done: 0, retried: 0, dead: 0 };
    if (!this.#handlers.size) return counts;
    for (const job of await this.#queue.claim(this.types, { limit })) {
      try { await this.#handlers.get(job.type)!(job); if (await this.#queue.complete(job)) counts.done++; }
      catch (error: any) {
        const permanent = error instanceof PermanentJobError;
        const code = typeof error?.code === 'string' ? error.code : 'JOB_FAILED';
        const outcome = await this.#queue.fail(job, code, { retry: !permanent });
        if (outcome === 'dead') counts.dead++; else if (outcome === 'queued') counts.retried++;
      }
    }
    return counts;
  }
  /** The always-on loop. Stops when the signal aborts. */
  async loop(signal: AbortSignal, idleMs = 1000): Promise<void> {
    while (!signal.aborted) {
      const { done, retried, dead } = await this.runOnce();
      if (done + retried + dead === 0) await new Promise(resolve => { const timer = setTimeout(resolve, idleMs); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true }); });
    }
  }
}
