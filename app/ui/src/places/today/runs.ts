/**
 * What Today reads from the runs the engine lists: each run's state as a ring, each agent's state from its runs, and
 * the step a run is on. Only counting and choosing: nothing is worked out from a figure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../../engine/context';
import type { RunDetail, RunSummary, VentureRunEvent } from '../../engine/types';
import type { AvatarState } from '../../parts/Avatar';

/** Run events and queue changes refresh what Today shows about runs. */
export const RUN_EVENTS = (event: VentureRunEvent) => event.type.startsWith('run.') || event.type === 'queue.changed';

/** A run's state as its ring says it: working, waiting on the owner, stopped, or nothing when it is done. */
export function runStateOf(run: Pick<RunSummary, 'state'>): AvatarState {
  switch (run.state) {
    case 'active': return 'working';
    case 'waiting': return 'waiting';
    case 'failed': return 'failed';
    default: return 'idle';
  }
}

/**
 * An agent's state from its runs: it needs you when one of its runs waits on you, it is working when one is active,
 * stopped when its latest run failed, and idle otherwise. Runs are matched by the agent's name, as the engine lists
 * them for the open business.
 */
export function agentStateOf(name: string, runs: readonly RunSummary[]): AvatarState {
  const own = runs.filter((run) => run.agent === name);
  if (own.some((run) => run.state === 'waiting')) return 'waiting';
  if (own.some((run) => run.state === 'active')) return 'working';
  const latest = [...own].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return latest?.state === 'failed' ? 'failed' : 'idle';
}

/** The order agents are listed in: what needs you first, then working, stopped, idle. */
export const STATE_ORDER: Readonly<Record<AvatarState, number>> = { waiting: 0, working: 1, failed: 2, idle: 3 };

/** The agent's live run: the one waiting on you, else the one working. */
export function liveRunOf(name: string, runs: readonly RunSummary[]): RunSummary | undefined {
  const own = runs.filter((run) => run.agent === name);
  return own.find((run) => run.state === 'waiting') ?? own.find((run) => run.state === 'active');
}

/** The step a run is on (current, or waiting on the owner) and its place in the list, counted from 1. */
export function currentStepOf(run: Pick<RunDetail, 'steps'>): { purpose: string; position: number } | null {
  const at = run.steps.findIndex((step) => step.state === 'current' || step.state === 'waiting');
  return at < 0 ? null : { purpose: run.steps[at]!.purpose, position: at + 1 };
}

/** Why a stopped run stopped, in the engine's words: the failed step's error, else the run's. */
export function stopLineOf(run: Pick<RunDetail, 'steps' | 'error' | 'result'>): string | undefined {
  return run.steps.find((step) => step.state === 'failed' && step.error)?.error ?? run.error ?? run.result;
}

/**
 * The detail of each listed run (its steps), read once for the whole page, so the team's live tiles and Working now
 * share one read per run. A run is read again when an event names it, and when it comes back to the list after leaving
 * it. A reply that arrives after a newer read of the same run started is dropped; a run that cannot be read shows no
 * step, and the lists still show the run.
 */
export function useRunDetails(runIds: readonly string[]): ReadonlyMap<string, RunDetail> {
  const client = useEngine();
  const key = [...new Set(runIds)].sort().join(' ');
  const [details, setDetails] = useState<ReadonlyMap<string, RunDetail>>(() => new Map());
  const wanted = useRef<ReadonlySet<string>>(new Set());
  const asked = useRef(new Set<string>());
  const generation = useRef(new Map<string, number>());
  const mounted = useRef(false);

  const load = useCallback((runId: string) => {
    const mine = (generation.current.get(runId) ?? 0) + 1;
    generation.current.set(runId, mine);
    client.request('venture.runs.get', { runId }).then(
      (detail) => { if (mounted.current && generation.current.get(runId) === mine) setDetails((map) => new Map(map).set(runId, detail)); },
      () => {},
    );
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const ids = new Set(key ? key.split(' ') : []);
    wanted.current = ids;
    for (const id of [...asked.current]) if (!ids.has(id)) asked.current.delete(id);
    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      load(id);
    }
  }, [key, load]);

  useEffect(() => client.subscribe((event) => { if (event.runId && wanted.current.has(event.runId)) load(event.runId); }), [client, load]);

  return details;
}
