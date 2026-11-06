// Chausar venture launcher, delivery (Ink v2 wave 4, package 4J13; catalogue H30): report-back. A background job
// (the owner's own tool on heavy work, research) reports into the run that asked, under a message id fixed before the
// job started: the report and its delivery marker (the id, kept on the run) are written in one transaction, so a
// second delivery of the same id, after a retry or a restart, is ignored. A report that names no sources carries a
// warning. On the desktop, background model work waits while the owner is active and the AI is local (it shares this
// computer) or rate-limited (it would only fail again). Code only; the idea is odysseus's background tool jobs,
// learned from, not copied.
import type { Context, State } from '../../contracts.ts';
import { currentVenture, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, IsoTime, ModelStatusView, RunReport, VentureDeps, VentureHostKind } from '../contracts.ts';
import { PRESETS } from '../models/presets.ts';

/** The warning on a report that names no sources. */
export const NO_SOURCES_WARNING = 'This report names no sources, so check it before you rely on it.';
/** Why background model work waits, in plain words, to follow "Waiting: ". */
export const WAITS_LOCAL = 'your AI runs on this computer, so this waits until you are not using Chausar.';
export const WAITS_BUSY = 'your AI said it was busy a moment ago, so this waits until you are not using Chausar.';
/** How long after a busy answer the AI counts as rate-limited. */
export const BUSY_MS = 10 * 60_000;
/** How long after the owner was last seen they still count as active (as the notification centre counts it). */
export const ACTIVE_MS = 2 * 60_000;

/** What a background job reports: the fixed message id, who reports, its line and the sources it names. */
export type ReportInput = { messageId: string; from: RunReport['from']; line: string; sources: readonly string[] };

/** The run with this report added once: unchanged (delivered false) when its message id was delivered already. */
export function withReport(run: DeliveryRunRecord, input: ReportInput, at: IsoTime): { run: DeliveryRunRecord; delivered: boolean } {
  if ((run.reports ?? []).some(report => report.messageId === input.messageId)) return { run, delivered: false };
  const sources = [...new Set(input.sources.map(source => source.trim()).filter(Boolean))];
  const report: RunReport = { messageId: input.messageId, from: input.from, at, line: input.line, sources, warning: sources.length ? null : NO_SOURCES_WARNING };
  return { run: { ...run, reports: [...(run.reports ?? []), report] }, delivered: true };
}

/** Delivers a report into its run inside the caller's transaction: the report and its marker in one write. */
export function deliverReport(tx: VentureTx, runId: string, input: ReportInput): boolean {
  const current = tx.find('venture-delivery-run', runId);
  if (!current) return false;
  const { run, delivered } = withReport(current, input, tx.now);
  if (!delivered) return false;
  tx.replace<DeliveryRunRecord>(run);
  tx.emit('run.step', { runId });
  return true;
}

/** Delivers a report into its run in a transaction of its own. Answers whether it was new. */
export async function reportBack(deps: VentureDeps, ctx: Context, runId: string, input: ReportInput): Promise<boolean> {
  return ventureAction(deps, ctx, 'prepare', 'run.report', tx => deliverReport(tx, runId, input));
}

/** What the background gate reads. watchingAt: when the owner last had Chausar open (now while they do). */
export type BackgroundGate = { host: VentureHostKind; nowMs: number; watchingAt: IsoTime | null; local: boolean; busyAt: IsoTime | null };

/**
 * Whether background model work waits now, and why; null when it may go. Only on the desktop, only while the owner is
 * active (seen within ACTIVE_MS), and only when the AI runs on this computer or said it was busy within BUSY_MS.
 */
export function backgroundWaits(gate: BackgroundGate): string | null {
  if (gate.host !== 'desktop' || !gate.watchingAt || gate.nowMs - Date.parse(gate.watchingAt) > ACTIVE_MS) return null;
  if (gate.local) return WAITS_LOCAL;
  if (gate.busyAt && gate.nowMs - Date.parse(gate.busyAt) <= BUSY_MS) return WAITS_BUSY;
  return null;
}

/** Whether a tier of the model status runs on this computer (the owner's Claude Code or Codex). */
function runsHere(status: ModelStatusView): boolean {
  return Object.values(status.tiers).some(tier => PRESETS.find(preset => preset.id === tier.presetId)?.runsOn === 'this-computer');
}

/** The newest time the owner's AI answered busy (a 429: "busy or your account limit was reached"), from the call records. */
function lastBusy(state: State, ventureId: string): IsoTime | null {
  const busy = listRecords(state, 'venture-model-call', ventureId)
    .filter(call => call.status === 'failed' && call.error?.code === 'MODEL_FAILED' && /\bbusy\b/i.test(call.error.message));
  return busy.reduce<IsoTime | null>((last, call) => (!last || call.at > last ? call.at : last), null);
}

/** The gate as it stands for the open business now. */
export function backgroundGateNow(deps: VentureDeps, ctx: Context, state: State = deps.store.read()): BackgroundGate {
  const venture = currentVenture(state);
  return {
    host: deps.host, nowMs: deps.clock().getTime(), watchingAt: deps.watching?.() ?? null,
    local: runsHere(deps.models.status(ctx)), busyAt: venture ? lastBusy(state, venture.id) : null,
  };
}
