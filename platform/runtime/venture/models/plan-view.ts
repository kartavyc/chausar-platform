// C7 task 3: venture.models.plan { fresh? } (read). The plan meter for Connections, Your AI: Codex and Claude Code on
// this computer, each with its windows, its state and where the figures came from ("As Codex reported at 4:30 pm"). The
// figures are only what the tools reported (plan-meter.ts); nothing is guessed. fresh: true asks Codex once through a
// short app-server read (no thread, no turn) and never asks Claude Code. The hosted app answers TIER_UNAVAILABLE.
import { authorize, check, type Context } from '../../contracts.ts';
import { DELEGATE_CLIS } from '../contract-values.ts';
import type { DelegateCli, IsoTime, VentureDeps } from '../contracts.ts';
import { currentVenture, exactPayload } from '../records.ts';
import { formatTime, formatWeekday, ownerZone } from '../../owner-format.ts';
import { CLI_LABELS } from './presets.ts';
import { fromCodexLimits, type PlanState, type PlanWindowKind } from './plan-meter.ts';
import { planBookOf } from './plan-book.ts';

export type PlanWindowView = { kind: PlanWindowKind; usedPercent: number | null; resetsAt: IsoTime | null; state: PlanState; line: string };
export type PlanToolView = { cli: DelegateCli; label: string; state: PlanState; windows: PlanWindowView[]; readAt: IsoTime | null; source: string; canCheck: boolean };
export type PlanView = { tools: PlanToolView[] };

export const PLAN_WORDS = Object.freeze({
  hosted: 'The plan meter reads the AI tools on your own computer. Open the desktop app to see it.',
  notYet: (tool: string) => `${tool} hasn't reported its plan use yet.`,
  reported: (tool: string, time: string) => `As ${tool} reported at ${time}.`,
  usedUp: (tool: string) => `${tool} said your plan is used up for now.`,
  windowName: { 'five-hour': '5-hour window', week: 'This week' } as Readonly<Record<PlanWindowKind, string>>,
});

function windowLine(kind: PlanWindowKind, usedPercent: number | null, resetsAt: IsoTime | null, zone: string): string {
  const name = PLAN_WORDS.windowName[kind];
  if (usedPercent === null || resetsAt === null) return `${name}: not reported.`;
  const reset = kind === 'week' ? formatWeekday(resetsAt, zone).split(',')[0]!.slice(0, 3) : formatTime(resetsAt, zone);
  return `${name}: ${Math.round(usedPercent)}% used, resets ${reset}`;
}

/** The view of one tool's reading, in the owner's zone. */
export function planToolView(deps: Pick<VentureDeps, 'store'>, cli: DelegateCli, now: IsoTime, zone: string): PlanToolView {
  const reading = planBookOf(deps.store).read(cli, now), label = CLI_LABELS[cli];
  const windows = reading.windows.map(window => ({ ...window, line: windowLine(window.kind, window.usedPercent, window.resetsAt, zone) }));
  const source = reading.readAt === null ? PLAN_WORDS.notYet(label)
    : !windows.length && reading.state === 'used-up' ? PLAN_WORDS.usedUp(label) : PLAN_WORDS.reported(label, formatTime(reading.readAt, zone));
  return { cli, label, state: reading.state, windows, readAt: reading.readAt, source, canCheck: cli === 'codex' };
}

export async function planView(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PlanView> {
  const input = exactPayload(payload, ['fresh']);
  check(input.fresh === undefined || typeof input.fresh === 'boolean', 'INVALID_VENTURE_REQUEST', 'Send fresh as true or false, or leave it out.');
  authorize(deps.store, ctx);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', PLAN_WORDS.hosted);
  if (input.fresh === true) {
    const raw = await deps.models.codexPlan?.().catch(() => null) ?? null;
    if (raw !== null) planBookOf(deps.store).note(fromCodexLimits(raw, deps.clock().toISOString()));
  }
  const venture = currentVenture(deps.store.read());
  const zone = ownerZone(venture?.country?.code, 'Etc/GMT'), now = deps.clock().toISOString();
  return { tools: DELEGATE_CLIS.map(cli => planToolView(deps, cli, now, zone)) };
}
