/**
 * Always-on jobs. NOT END-TO-END ENCRYPTED: these jobs run on Chausar's server while the person's computer is
 * off, so the server reads what each job uses. Every reply says so (`endToEndEncrypted: false` and `WORKER_LABEL`),
 * a job turns on only with the person's recorded consent to exactly that, and a job's inputs are stored only while
 * it is on. Turning a job off, or `DELETE /v1/worker/data`, removes them.
 *
 * The one job today, `due-date-reminder`, keeps due dates (date only: no amount, no name) and, once per due date
 * per Indian day inside its reminder window, sends the fixed message "A due date is near." and nothing else.
 */
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { Handler, HostedRequest, HostedResponse, Router } from '../shared/http.ts';
import type { Job, Worker } from '../db/queue.ts';
import { json, fields, ok, problem } from '../shared/http.ts';
import { check } from '../shared/errors.ts';

export const WORKER_LABEL = "Always-on jobs run on Chausar's server while your computer is off. They are not end-to-end encrypted: the server does the work, so it can read what each job uses.";
export const WORKER_JOBS = Object.freeze({
  'due-date-reminder': { title: 'Due date reminders while your computer is off', uses: 'Your due dates (date only, no amounts or names)' },
});
export type WorkerJobType = keyof typeof WORKER_JOBS;
export const MAX_DUE_DATES = 200;
export const REMINDER_JOB = 'worker.dueDateReminder';

/** The calendar date in India Standard Time. */
export function indianDate(at: Date): string { return new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 10); }
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Every reply, refusals included, carries the label. */
export function labelled(handler: Handler): Handler {
  return async request => {
    let reply: HostedResponse;
    try { reply = await handler(request); } catch (error) { reply = problem(error); }
    return { ...reply, body: { endToEndEncrypted: false, label: WORKER_LABEL, ...(reply.body as Record<string, unknown>) } };
  };
}

export function createWorkerJobsModule(deps: HostedDeps, options: { sendDueDateReminder(accountId: string): Promise<void> }): HostedModule {
  const { sql, clock } = deps;
  type JobRow = { type: WorkerJobType; enabled: boolean; consent_at: Date | null };
  const view = (type: WorkerJobType, row?: JobRow) => ({ type, title: WORKER_JOBS[type].title, enabled: row?.enabled ?? false, consentAt: row?.consent_at ? new Date(row.consent_at).toISOString() : null, uses: WORKER_JOBS[type].uses });
  const rowOf = async (accountId: string, type: WorkerJobType) =>
    (await sql.query<JobRow>('SELECT type, enabled, consent_at FROM worker_jobs WHERE account_id = $1 AND type = $2', [accountId, type])).rows[0];

  async function list(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const { rows } = await sql.query<JobRow>('SELECT type, enabled, consent_at FROM worker_jobs WHERE account_id = $1', [accountId]);
    return ok({ jobs: (Object.keys(WORKER_JOBS) as WorkerJobType[]).map(type => view(type, rows.find(row => row.type === type))) });
  }

  async function setJob(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const type = request.params.type as WorkerJobType;
    check(Object.hasOwn(WORKER_JOBS, type), 'JOB_TYPE_UNKNOWN', 'There is no such always-on job.', 404);
    const body = fields<{ enabled: unknown; consent: any }>(json(request), ['enabled', 'consent']);
    check(typeof body.enabled === 'boolean', 'INVALID_REQUEST', 'Say whether the job is on.');
    const now = clock().toISOString();
    if (!body.enabled) {
      check(body.consent === null || typeof body.consent === 'object', 'INVALID_REQUEST', 'The consent is not valid.');
      await sql.transaction(async tx => {
        await tx.query(`INSERT INTO worker_jobs (account_id, type, enabled, consent_at, consent_recorded_at, updated_at) VALUES ($1, $2, false, NULL, NULL, $3)
                        ON CONFLICT (account_id, type) DO UPDATE SET enabled = false, consent_at = NULL, consent_recorded_at = NULL, updated_at = EXCLUDED.updated_at`, [accountId, type, now]);
        if (type === 'due-date-reminder') {
          await tx.query('DELETE FROM worker_due_dates WHERE account_id = $1', [accountId]);
          await tx.query(`DELETE FROM jobs WHERE type = $1 AND account_id = $2 AND status = 'queued'`, [REMINDER_JOB, accountId]);
        }
      });
      return ok(view(type, await rowOf(accountId, type)));
    }
    const plan = await deps.entitlements(accountId);
    check(plan.worker, 'PLAN_REQUIRED', 'Always-on jobs need the paid plan.', 402);
    check(body.consent && typeof body.consent === 'object' && !Array.isArray(body.consent), 'CONSENT_REQUIRED', 'Turning this on needs your consent that it is not end-to-end encrypted.');
    const consent = fields<{ notEndToEndEncrypted: unknown; recordedAt: unknown }>(body.consent, ['notEndToEndEncrypted', 'recordedAt']);
    check(consent.notEndToEndEncrypted === true, 'CONSENT_REQUIRED', 'Turning this on needs your consent that it is not end-to-end encrypted.');
    check(typeof consent.recordedAt === 'string' && consent.recordedAt.length <= 40 && !Number.isNaN(Date.parse(consent.recordedAt)), 'INVALID_REQUEST', 'The consent time is not valid.');
    await sql.query(`INSERT INTO worker_jobs (account_id, type, enabled, consent_at, consent_recorded_at, updated_at) VALUES ($1, $2, true, $3, $4, $3)
                     ON CONFLICT (account_id, type) DO UPDATE SET enabled = true, consent_at = EXCLUDED.consent_at, consent_recorded_at = EXCLUDED.consent_recorded_at, updated_at = EXCLUDED.updated_at`,
      [accountId, type, now, new Date(consent.recordedAt).toISOString()]);
    return ok(view(type, await rowOf(accountId, type)));
  }

  async function setDueDates(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const plan = await deps.entitlements(accountId);
    check(plan.worker, 'PLAN_REQUIRED', 'Always-on jobs need the paid plan.', 402);
    const { dueDates } = fields<{ dueDates: unknown }>(json(request), ['dueDates']);
    check(Array.isArray(dueDates) && dueDates.length <= MAX_DUE_DATES, 'INVALID_REQUEST', 'Send at most two hundred due dates.');
    const seen = new Set<string>();
    const rows = dueDates.map(value => {
      const item = fields<{ id: unknown; date: unknown; remindDaysBefore: unknown }>(value, ['id', 'date', 'remindDaysBefore']);
      check(typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) && !seen.has(item.id), 'INVALID_REQUEST', 'A due date id is not valid or is repeated.');
      check(isDate(item.date), 'INVALID_REQUEST', 'A due date is not a calendar date.');
      check(Number.isInteger(item.remindDaysBefore) && (item.remindDaysBefore as number) >= 0 && (item.remindDaysBefore as number) <= 30, 'INVALID_REQUEST', 'Reminders start between zero and thirty days before.');
      seen.add(item.id);
      return { id: item.id, date: item.date, days: item.remindDaysBefore as number };
    });
    const job = await rowOf(accountId, 'due-date-reminder');
    check(job?.enabled, 'JOB_NOT_ENABLED', 'Turn on due date reminders first.', 409);
    await sql.transaction(async tx => {
      await tx.query('DELETE FROM worker_due_dates WHERE account_id = $1', [accountId]);
      if (rows.length) await tx.query(`INSERT INTO worker_due_dates (account_id, id, due_on, remind_days_before, updated_at)
                                       SELECT $1, id, due_on, days, $5 FROM unnest($2::text[], $3::date[], $4::int[]) AS t(id, due_on, days)`,
        [accountId, rows.map(r => r.id), rows.map(r => r.date), rows.map(r => r.days), clock().toISOString()]);
    });
    return ok({ stored: rows.length });
  }

  async function deleteData(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    await sql.transaction(async tx => {
      await tx.query('DELETE FROM worker_due_dates WHERE account_id = $1', [accountId]);
      await tx.query('DELETE FROM worker_jobs WHERE account_id = $1', [accountId]);
      await tx.query(`DELETE FROM jobs WHERE type = $1 AND account_id = $2 AND status = 'queued'`, [REMINDER_JOB, accountId]);
    });
    return ok({ deleted: true });
  }

  /** A due date reminds when today in India lies in [due date - remindDaysBefore, due date] and its job is on. */
  const DUE_TODAY = `SELECT d.account_id, d.id FROM worker_due_dates d
    JOIN worker_jobs j ON j.account_id = d.account_id AND j.type = 'due-date-reminder' AND j.enabled
    WHERE $1::date BETWEEN d.due_on - d.remind_days_before AND d.due_on`;

  async function remind(job: Job) {
    const accountId = job.accountId, dueDateId = job.payload.dueDateId;
    if (!accountId || typeof dueDateId !== 'string') return;
    // Checked again at send time: the job may have been turned off or the date removed since the sweep.
    const { rows: [still] } = await sql.query(`${DUE_TODAY} AND d.account_id = $2 AND d.id = $3`, [indianDate(clock()), accountId, dueDateId]);
    if (!still || !(await deps.entitlements(accountId)).worker) return;
    await options.sendDueDateReminder(accountId);
  }

  return {
    id: 'worker',
    routes(router: Router) {
      router.add('GET', '/v1/worker', labelled(list))
        .add('PUT', '/v1/worker/jobs/:type', labelled(setJob))
        .add('PUT', '/v1/worker/due-dates', labelled(setDueDates))
        .add('DELETE', '/v1/worker/data', labelled(deleteData));
    },
    jobs(worker: Worker) { worker.register(REMINDER_JOB, remind); },
    async sweep() {
      const today = indianDate(clock());
      const { rows } = await sql.query<{ account_id: string; id: string }>(DUE_TODAY, [today]);
      for (const row of rows) await deps.queue.enqueue({ type: REMINDER_JOB, accountId: row.account_id, payload: { dueDateId: row.id }, dedupeKey: `${REMINDER_JOB}:${row.account_id}:${row.id}:${today}` });
    },
  };
}
