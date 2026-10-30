// Chausar venture launcher, views (Ink v2 wave 4, package 4A1; spec 5.1): Keeper, the engine's own jobs, shown
// honestly as code, never as an AI. venture.team.keeper lists each job with its last run, read from records only:
// backups from the workspace port (the custody view, automatic backups only); every other job from its
// venture-keeper-run record, one per job. The journal sweep's tick (build/journal-sweep.ts) runs the jobs that live in
// this engine (the sweep itself, the platform rule dates, the tax rate tables, the posting steps) and replaces a job's
// record, with keeper.ran, only when its outcome or line changed or the record is a day old, so an idle business is
// not rewritten (nor backed up again) every few minutes. A tick whose runs could not be written is recorded as a
// failed journal-sweep run when that can be written. Connection checks (4J7), network strength (4D2), the needs-you
// probes (4G2) and the calendar feed (4E3) write their own runs; until one does, the job says "Not run yet". Nothing
// here claims a run that has no record. Keeper's runs are shown only on its card, never as department jobs.
import { type Context, type State } from '../../contracts.ts';
import type {
  AgentView, KeeperJobId, KeeperJobView, KeeperOutcome, KeeperRunRecord, KeeperView, Posture, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { currentVenture, exactPayload, formatMicros, formatVentureDate, listRecords, readVenture, ventureAction, type VentureTx } from '../records.ts';
import { acceptedBlueprintOrNull, todayIso } from '../delivery/shared.ts';
import { currentPlaybook, deliveryFlagship } from '../delivery/playbook.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { playbookRules, rulesSummary } from '../playbooks/rules-current.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { unconfirmedRateTables } from '../playbooks/ca-firm/signoff.ts';
import { BROWSER_SCRIPTS } from '../build/browser.ts';
import { stepsCheckedOnOf, stepsRecordOf } from '../build/posting-steps.ts';
import { localDayAt } from '../local-day.ts';
import { plain } from './shared.ts';

/** Keeper's id on the team. It is code: it has no chat, no steps and no posture to set. */
export const KEEPER_ID = 'keeper';
export const KEEPER_NAME = 'Keeper';
const KEEPER_ROLE = 'Runs the engine\'s own jobs as code, not AI: backups, the journal sweep, connection checks, rule and rate dates, posting steps and network strength.';

/** The jobs Keeper always lists, in order; the probes and the calendar feed are listed once they have run. */
const LISTED: readonly KeeperJobId[] = ['backups', 'journal-sweep', 'connection-checks', 'rule-freshness', 'rate-tables', 'posting-steps', 'network-strength'];
const WHEN_RUN: readonly KeeperJobId[] = ['probes', 'calendar-feed', 'monitors']; // 5A6: page monitors once one has run
const JOB_NAMES: Readonly<Record<KeeperJobId, string>> = Object.freeze({
  backups: 'Backups', 'journal-sweep': 'Journal sweep', 'connection-checks': 'Connection checks', 'rule-freshness': 'Platform rule dates',
  'rate-tables': 'Tax rate tables', 'posting-steps': 'Posting steps', 'network-strength': 'Network strength', probes: 'Needs-you checks',
  'calendar-feed': 'Calendar feed', monitors: 'Page monitors',
});
export const KEEPER_WORDS = Object.freeze({
  notRun: 'Not run yet.',
  hosted: 'Not on the hosted app.',
  notNeeded: 'Not needed for this business.',
  noBackups: 'This computer keeps no automatic backups of this business.',
  autoOff: 'Automatic backups are off.',
  nothingMoved: 'Nothing was left half done.',
  idle: 'Idle',
});

/** The flagship playbook the business runs (as venture.rules.list reads it): the playbook in use's, the plan's, else the idea's. */
function businessFlagship(state: State, venture: VentureRecord): string | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.flagship ?? null;
  const plan = acceptedBlueprintOrNull(state, venture);
  return plan ? deliveryFlagship(venture, plan) : pickPlaybook(venture.idea)?.id ?? null;
}

/** Whether a job this engine runs on its tick applies to this business. Jobs other packages run always apply. */
function needed(state: State, venture: VentureRecord, job: KeeperJobId, today: string): boolean {
  const flagship = businessFlagship(state, venture);
  if (job === 'rule-freshness') return playbookRules(flagship, today).length > 0;
  if (job === 'rate-tables') return flagship === CA_FIRM_ID;
  if (job === 'posting-steps') return flagship === SOCIAL_AGENCY_ID || Object.keys(BROWSER_SCRIPTS).some(id => !!stepsRecordOf(state, id));
  return true;
}

/** The last run of one job, from its record. */
export function keeperRunOf(state: State, ventureId: string, job: KeeperJobId): KeeperRunRecord | undefined {
  return listRecords(state, 'venture-keeper-run', ventureId).filter(record => record.job === job).sort((a, b) => b.at.localeCompare(a.at))[0];
}

const fromRecord = (record: KeeperRunRecord) => ({ at: record.at, outcome: record.outcome, line: record.line });

/**
 * Backups, from the workspace port's custody view, automatic ones only: Keeper's run is the newest automatic backup;
 * a copy the owner made by hand is not Keeper's. With automatic backups off no run is claimed; a failed try is said in words.
 */
async function backupsJob(deps: VentureDeps, venture: VentureRecord): Promise<KeeperJobView> {
  const base = { id: 'backups' as const, name: JOB_NAMES.backups };
  if (deps.host === 'hosted-web') return { ...base, lastRun: null, note: KEEPER_WORDS.hosted };
  if (!deps.workspace?.backups) return { ...base, lastRun: null, note: KEEPER_WORDS.notRun };
  let backups: Awaited<ReturnType<NonNullable<NonNullable<VentureDeps['workspace']>['backups']>>>;
  try { backups = await deps.workspace.backups(); } catch { backups = null; }
  if (!backups) return { ...base, lastRun: null, note: KEEPER_WORDS.noBackups };
  if (!backups.auto) return { ...base, lastRun: null, note: KEEPER_WORDS.autoOff };
  const failed = backups.lastError ? ` The last try did not work: ${backups.lastError}` : '';
  if (!backups.newestAt) return { ...base, lastRun: null, note: backups.lastError ? `No automatic backup yet.${failed}` : KEEPER_WORDS.notRun };
  const kept = `${backups.count} automatic ${backups.count === 1 ? 'backup' : 'backups'} kept on this computer.`;
  const newest = ` The newest is from ${formatVentureDate(localDayAt(backups.newestAt, venture.country), venture.country.dateOrder)}.`;
  return { ...base, lastRun: { at: backups.newestAt, outcome: backups.lastError ? 'warn' : 'ok', line: `${kept}${newest}${failed}` }, note: null };
}

/** Keeper's jobs as they stand: each with its last run from records, or a note saying why there is none. */
export async function keeperJobs(deps: VentureDeps, state: State, venture: VentureRecord): Promise<KeeperJobView[]> {
  const today = todayIso(deps, venture);
  const jobs: KeeperJobView[] = [];
  for (const id of LISTED) {
    if (id === 'backups') { jobs.push(await backupsJob(deps, venture)); continue; }
    const record = keeperRunOf(state, venture.id, id);
    jobs.push(record ? { id, name: JOB_NAMES[id], lastRun: fromRecord(record), note: null }
      : { id, name: JOB_NAMES[id], lastRun: null, note: needed(state, venture, id, today) ? KEEPER_WORDS.notRun : KEEPER_WORDS.notNeeded });
  }
  for (const id of WHEN_RUN) {
    const record = keeperRunOf(state, venture.id, id);
    if (record) jobs.push({ id, name: JOB_NAMES[id], lastRun: fromRecord(record), note: null });
  }
  return jobs;
}

/** venture.team.keeper {} (read): Keeper's jobs and their last runs. Reading writes nothing. */
export async function teamKeeperHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<KeeperView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  return { jobs: await keeperJobs(deps, state, venture) };
}

/**
 * Keeper on the team: code in Operations, no steps, no chat, no posture to set (the posture field shows the business's,
 * which Keeper never acts under: it sends nothing). failed when one of its jobs' last runs failed, else idle.
 */
export function keeperAgent(state: State, venture: VentureRecord, posture: Posture): AgentView {
  const failed = listRecords(state, 'venture-keeper-run', venture.id).some(record => record.outcome === 'failed');
  return plain({
    id: KEEPER_ID, name: KEEPER_NAME, role: KEEPER_ROLE, now: KEEPER_WORDS.idle, posture, spend: formatMicros('0'), steps: [],
    department: 'operations' as const, kind: 'code' as const, state: failed ? 'failed' as const : 'idle' as const, chat: false,
  });
}

// ---------------------------------------------------------------------------
// The tick: the jobs this engine runs, written as Keeper runs
// ---------------------------------------------------------------------------

type Ran = { job: KeeperJobId; outcome: KeeperOutcome; line: string };

/** The journal sweep's run: how many claims it closed, and whether any may have gone out. */
function sweepRan(moved: readonly { state?: unknown }[]): Ran {
  if (!moved.length) return { job: 'journal-sweep', outcome: 'ok', line: KEEPER_WORDS.nothingMoved };
  const unknown = moved.filter(record => record.state === 'outcome_unknown').length;
  if (unknown) {
    return {
      job: 'journal-sweep', outcome: 'warn',
      line: unknown === 1 ? '1 journal entry was left half done and may have gone out. Check it in the journal before trying again.'
        : `${unknown} journal entries were left half done and may have gone out. Check them in the journal before trying again.`,
    };
  }
  return { job: 'journal-sweep', outcome: 'ok', line: moved.length === 1 ? '1 approval or proposal ran out and was closed.' : `${moved.length} approvals or proposals ran out and were closed.` };
}

function rulesRan(flagship: string | null, today: string): Ran {
  const rules = playbookRules(flagship, today);
  return { job: 'rule-freshness', outcome: rules.some(rule => rule.stale) ? 'warn' : 'ok', line: `Platform rules: ${rulesSummary(rules)}` };
}

function ratesRan(state: State, venture: VentureRecord): Ran {
  const waiting = unconfirmedRateTables(state, venture.id).length;
  if (!waiting) return { job: 'rate-tables', outcome: 'ok', line: 'Every tax rate table is confirmed by your CA.' };
  return { job: 'rate-tables', outcome: 'warn', line: waiting === 1 ? '1 tax rate table waits for your CA to confirm it.' : `${waiting} tax rate tables wait for your CA to confirm them.` };
}

/** The oldest day each platform's posting steps last worked, for the platforms this computer has dated anything on. */
function stepsRan(state: State, venture: VentureRecord): Ran {
  const platforms = Object.values(BROWSER_SCRIPTS).filter(script => !!stepsRecordOf(state, script.connectorId));
  if (!platforms.length) return { job: 'posting-steps', outcome: 'warn', line: 'No posting step has worked on this computer yet. Check them in Connections before posting from here.' };
  const parts = platforms.map(script => {
    const on = stepsCheckedOnOf(state, script.connectorId);
    return { name: script.name, on };
  });
  const words = parts.map(part => (part.on ? `${part.name} on ${formatVentureDate(part.on, venture.country.dateOrder)}` : `${part.name} not every step yet`)).join('; ');
  return { job: 'posting-steps', outcome: parts.some(part => !part.on) ? 'warn' : 'ok', line: `Posting steps last worked: ${words}.` };
}

/** A record older than this is renewed even when nothing changed, so a card never shows a result over a day old. */
const RENEW_AFTER_MS = 24 * 60 * 60_000;

/** This tick's runs that need writing: a job with no record, a changed outcome or line, or a record a day old. */
function changedRuns(deps: VentureDeps, state: State, venture: VentureRecord, moved: readonly { state?: unknown }[], nowMs: number): Ran[] {
  const today = todayIso(deps, venture);
  const flagship = businessFlagship(state, venture);
  const ran: Ran[] = [sweepRan(moved)];
  if (needed(state, venture, 'rule-freshness', today)) ran.push(rulesRan(flagship, today));
  if (needed(state, venture, 'rate-tables', today)) ran.push(ratesRan(state, venture));
  if (needed(state, venture, 'posting-steps', today)) ran.push(stepsRan(state, venture));
  return ran.filter(item => {
    const old = keeperRunOf(state, venture.id, item.job);
    return !old || old.outcome !== item.outcome || old.line !== item.line || nowMs - Date.parse(old.at) >= RENEW_AFTER_MS;
  });
}

/** Puts one job's run in place of its last record (one record per job), or adds it. */
function putRun(tx: VentureTx, item: Ran): void {
  const old = tx.list('venture-keeper-run').filter(record => record.job === item.job);
  const record: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: item.job, outcome: item.outcome, line: item.line };
  if (old[0]) tx.replace({ ...record, id: old[0].id });
  else tx.put(record);
}

/**
 * Writes this tick's Keeper runs (the journal sweep's, and each other job this engine runs that applies to the
 * business) that changed, or whose record is a day old, and emits keeper.ran once; writes nothing at all when none
 * did. Called by the journal sweep after it ran.
 */
export async function recordKeeperRuns(deps: VentureDeps, ctx: Context, moved: readonly { state?: unknown }[]): Promise<void> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture || !changedRuns(deps, state, venture, moved, deps.clock().getTime()).length) return;
  await ventureAction(deps, ctx, 'prepare', 'keeper.run', tx => {
    // Worked out again on the state the commit sees.
    const ran = changedRuns(deps, tx.state, tx.venture!, moved, Date.parse(tx.now));
    for (const item of ran) putRun(tx, item);
    if (ran.length) tx.emit('keeper.ran', { jobs: ran.map(item => item.job) });
  });
}

/**
 * A tick whose runs could not be written: recorded as a failed journal-sweep run, so Keeper's card says so rather than
 * showing the run before as if all were well. If even that cannot be written, the error is left to the sweep's caller.
 */
export async function recordKeeperFailure(deps: VentureDeps, ctx: Context, error: unknown): Promise<void> {
  const reason = error instanceof Error && error.message ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'an unknown error';
  await ventureAction(deps, ctx, 'prepare', 'keeper.failed', tx => {
    putRun(tx, { job: 'journal-sweep', outcome: 'failed', line: `The journal sweep ran, but Keeper could not record it: ${reason}` });
    tx.emit('keeper.ran', { jobs: ['journal-sweep'] });
  });
}
