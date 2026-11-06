// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1): what is checked before a run starts or a turn goes
// out. Pause all refuses new runs and approvals, whoever asks, until the owner unpauses. While the owner is away (the
// days they set under Away), no new work starts on its own: only the owner, inside the app, can start a run. A run's
// scope is frozen when it starts (the tools granted, the outside actions it may propose for approval, its spend cap and
// its posture), and a run whose agent step needs a connector that is only planned does not start at all: nothing is
// put in its place. Reads only; the handlers in run-controls.ts and away.ts write.
import { ChausarError, type Context, type State } from '../../contracts.ts';
import { currentVenture, formatVentureDate, isAppChannel, listRecords } from '../records.ts';
import type {
  AwayRecord, ConnectorModeName, DeliveryRunRecord, MicroString, PauseRecord, PlaybookRecord, RunScope, ToolName, VentureRecord,
} from '../contracts.ts';
import { CONNECTOR_CATALOGUE, type CatalogueEntry } from '../build/catalogue.ts';
import { toolDeclaration } from '../policy/effects.ts';
import { effectivePosture } from '../policy/context.ts';
import { localDayAt } from '../local-day.ts';

/** The line a routine (4J13) or anything else that would start on its own shows while the business is paused. */
export const PAUSED_BY_YOU = 'Paused by you';
const PAUSED_LINE = 'This business is paused, so no new work starts. Unpause it from the business menu.';
/** Run statuses a stop applies to: the run waits on the owner or a turn is out. */
export const STOPPABLE: readonly DeliveryRunRecord['status'][] = Object.freeze(['waiting-for-you', 'needs-answer', 'brief-waiting']);

const newest = <T extends { at: string }>(records: readonly T[]): T | null =>
  records.reduce<T | null>((best, item) => (!best || item.at >= best.at ? item : best), null);

/** The owner's latest Pause all choice; the newest record wins. */
export function latestPause(state: State, ventureId: string): PauseRecord | null {
  return newest(listRecords(state, 'venture-pause', ventureId));
}

/** True while the business is paused. */
export function pausedNow(state: State, ventureId: string): boolean {
  return latestPause(state, ventureId)?.paused === true;
}

/** 'Paused by you' while the open business is paused, else null: what a routine says when it skips (4J13). */
export function pauseSkipLine(state: State): string | null {
  const venture = currentVenture(state);
  return venture && pausedNow(state, venture.id) ? PAUSED_BY_YOU : null;
}

/** The owner's latest time away, cleared or not. */
export function latestAway(state: State, ventureId: string): AwayRecord | null {
  return newest(listRecords(state, 'venture-away', ventureId));
}

/** The time away the owner is in now (today on their calendar is one of its days), or null. */
export function awayNow(state: State, venture: VentureRecord, nowIso: string): AwayRecord | null {
  const away = latestAway(state, venture.id);
  if (!away || away.clearedAt) return null;
  const today = localDayAt(nowIso, venture.country ?? { code: 'XX' });
  return away.from <= today && today <= away.to ? away : null;
}

/** What a routine (4J13) or another start on its own says while the owner is away, else null. */
export function awaySkipLine(state: State, nowIso: string): string | null {
  const venture = currentVenture(state);
  const away = venture ? awayNow(state, venture, nowIso) : null;
  return away ? `You are away until ${formatVentureDate(away.to, venture!.country?.dateOrder ?? 'year-month-day')}` : null;
}

/**
 * Refuses new work while paused (any channel), and while the owner is away for anything that is not the owner inside
 * the app: no run starts on its own then. The same check stands before a turn goes out.
 */
export function refuseNewWork(state: State, venture: VentureRecord, ctx: Context, nowIso: string): void {
  if (pausedNow(state, venture.id)) throw new ChausarError('BUSINESS_PAUSED', PAUSED_LINE);
  if (!isAppChannel(ctx) && awayNow(state, venture, nowIso)) {
    throw new ChausarError('BUSINESS_PAUSED', `${awaySkipLine(state, nowIso)}, so no new work starts on its own. Start it yourself in the app.`);
  }
}

// ---------------------------------------------------------------------------
// The run's scope (O21)
// ---------------------------------------------------------------------------

/** The effects that make a tool an outside action the agent may only propose for the owner's approval. */
const OUTSIDE: readonly string[] = ['send', 'money', 'egress'];

/** A run's scope as it starts: its granted tools, the ones that propose an outside action, the cap and the posture now. */
export function freezeScope(state: State, venture: VentureRecord, grant: readonly ToolName[], capMicros: MicroString, at: string): RunScope {
  const actions = grant.filter(tool => (toolDeclaration(tool)?.effects ?? []).some(effect => OUTSIDE.includes(effect)));
  return { tools: [...grant], actions, capMicros, posture: effectivePosture(state, venture), frozenAt: at };
}

/** What a connector mode does, in the owner's words: posting to LinkedIn, reading Razorpay. */
function capabilityWords(entry: CatalogueEntry | undefined, connector: string, mode: ConnectorModeName): string {
  const name = entry?.name ?? connector;
  if (mode === 'read') return `reading ${name}`;
  if (mode === 'handoff') return `handing off to ${name}`;
  if (entry?.category === 'marketing' || entry?.category === 'messaging') return `posting to ${name}`;
  if (entry?.category === 'email') return `sending email through ${name}`;
  if (entry?.category === 'payments') return `taking payments through ${name}`;
  return `writing to ${name}`;
}

/**
 * Refuses a run whose agent step needs a connector mode that is only planned in this build (or not there at all),
 * with RUN_CAPABILITY_MISSING and what it needs. A step the owner does never stops the agent's run.
 */
export async function refuseMissingCapability(playbook: Pick<PlaybookRecord, 'steps'>): Promise<void> {
  const needs = playbook.steps.filter(step => step.doneBy !== 'you').flatMap(step => step.needs ?? []);
  if (!needs.length) return;
  const { connectorModes } = await import('../build/connectors.ts');
  for (const need of needs) {
    const entry = CONNECTOR_CATALOGUE.find(item => item.id === need.connector);
    const mode = entry ? connectorModes(entry).find(item => item.mode === need.mode) : undefined;
    if (mode?.status === 'available') continue;
    const what = capabilityWords(entry, need.connector, need.mode);
    throw new ChausarError('RUN_CAPABILITY_MISSING', mode
      ? `This run needs ${what}, which is planned. Nothing was put in its place.`
      : `This run needs ${what}, which this build cannot do. Nothing was put in its place.`);
  }
}
