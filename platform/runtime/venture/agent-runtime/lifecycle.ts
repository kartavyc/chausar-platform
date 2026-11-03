/** Process-local interruption only. Persistent job status and consent remain the authority. */
import { check } from '../../portable.ts';
import type { StateStore } from '../../contracts.ts';

type Live = { runId: string; clientId: string; jobId: string; stop(): void };
const active = new WeakMap<StateStore, Map<string, Live>>();
export function registerAgentJob(store: StateStore, identity: Omit<Live, 'stop'>, stop: () => void): () => void {
  let jobs = active.get(store); if (!jobs) { jobs = new Map(); active.set(store, jobs); }
  check(!jobs.has(identity.runId), 'JOB_BUSY', 'This AI job is already running.');
  const job = { ...identity, stop }; jobs.set(identity.runId, job);
  return () => { if (jobs.get(identity.runId) === job) jobs.delete(identity.runId); };
}
export function hasAgentJob(store: StateStore, runId: string): boolean { return active.get(store)?.has(runId) ?? false; }
export function stopAgentJob(store: StateStore, runId: string): boolean {
  const jobs = active.get(store), job = jobs?.get(runId); if (!job) return false;
  jobs!.delete(runId); job.stop(); return true;
}
export function stopClientAgentJobs(store: StateStore, clientId: string): void {
  for (const job of [...(active.get(store)?.values() ?? [])]) if (job.clientId === clientId) stopAgentJob(store, job.runId);
}
