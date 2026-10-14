import { Router, ok } from './shared/http.ts';
import { HostedError, check } from './shared/errors.ts';
import { systemClock, type Clock } from './shared/clock.ts';
import type { Env, Fetch, HostedDeps, HostedModule } from './shared/module.ts';
import type { Sql } from './db/sql.ts';
import { JobQueue, PermanentJobError, Worker } from './db/queue.ts';
import { accountsConfig } from './accounts/config.ts';
import { authenticator, createAccountsModule } from './accounts/module.ts';
import type { OtpProvider } from './accounts/otp.ts';
import { billingConfig } from './billing/config.ts';
import { billingEntitlements, createBillingModule } from './billing/module.ts';
import type { PaymentPartner } from './billing/partner.ts';
import { checkLinkOrigin, createRelayModule, relayConfig, type RelayOptions } from './relay/relay.ts';
import { createLinkPages } from './link/pages.ts';
import { backupConfig, backupStore, createBackupModule, type BlobStore } from './backup/index.ts';
import { allowanceConfig, allowanceProviders, createAllowanceModule } from './allowance/index.ts';
import { createWorkerJobsModule, indianDate } from './worker/index.ts';

export type HostedApp = { router: Router; worker: Worker; modules: HostedModule[]; queue: JobQueue };
/** Test and demo seams. Production leaves them empty and every provider comes from the environment. */
export type HostedOverrides = { clock?: Clock; otp?: OtpProvider; partner?: PaymentPartner; relay?: RelayOptions; blobStore?: BlobStore | null };

/** Builds every hosted module over one database. Reads configuration from `env`; refuses a server it cannot run safely. */
export function buildHosted(env: Env, sql: Sql, fetch: Fetch, overrides: HostedOverrides = {}): HostedApp {
  const pepper = env.HOSTED_PEPPER ?? '';
  check(pepper.length >= 32, 'SERVER_MISCONFIGURED', 'HOSTED_PEPPER must be at least thirty-two characters.', 500);
  const linkOrigin = checkLinkOrigin(env.LINK_ORIGIN ?? '');
  const clock = overrides.clock ?? systemClock, queue = new JobQueue(sql, clock);
  const billing = billingConfig(env, fetch);
  const entitlements = billingEntitlements(sql, clock, billing.config);
  const deps: HostedDeps = { sql, clock, queue, fetch, pepper, linkOrigin, authenticate: authenticator(sql, pepper, clock), entitlements };
  const relay = createRelayModule(deps, overrides.relay ?? relayConfig(env));
  const allowance = allowanceConfig(env), accounts = accountsConfig(env, fetch);
  const modules: HostedModule[] = [
    createAccountsModule(deps, { otp: overrides.otp ?? accounts.otp, entitlements, limits: accounts.limits }),
    createBillingModule(deps, { partner: overrides.partner ?? billing.partner, config: billing.config }),
    relay,
    createLinkPages(deps, relay.buttons, relay.mailConfirm),
    createBackupModule(deps, { store: overrides.blobStore !== undefined ? overrides.blobStore : backupStore(backupConfig(env)) }),
    createAllowanceModule(deps, { providers: allowanceProviders(allowance, fetch), pricing: allowance.pricing, apiOrigin: allowance.apiOrigin }),
    createWorkerJobsModule(deps, { async sendDueDateReminder(accountId) {
      // One reminder message per account per Indian day, whatever the number of due dates; it counts against the thirty.
      try { await relay.notify(accountId, 'due-date-near', `due-date-${indianDate(clock())}`); }
      catch (error) {
        if (error instanceof HostedError && ['CHANNEL_OFF', 'MONTHLY_BUDGET_REACHED', 'PLAN_REQUIRED', 'CHANNEL_NOT_CONFIGURED'].includes(error.code)) throw new PermanentJobError(error.code);
        throw error;
      }
    } }),
  ];
  const router = new Router()
    .add('GET', '/healthz', () => ok({ ok: true }))
    .add('GET', '/readyz', async () => {
      try { await sql.query('SELECT 1 FROM schema_migrations LIMIT 1'); return ok({ ok: true }); }
      catch { throw new HostedError('NOT_READY', 'The database is not ready.', 503); }
    });
  for (const module of modules) module.routes(router);
  const worker = new Worker(queue);
  for (const module of modules) module.jobs?.(worker);
  return { router, worker, modules, queue };
}
