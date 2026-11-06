import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORK_STEPS, type WorkKind } from '../../../../platform/runtime/venture/views/work-steps';
import { useEngine } from './context';
import type { VentureRunEvent, WorkStepStateLite } from './types';

/** One step of a job for the screens: its words (empty when the job's own list names it), its state and when it began. */
export type WorkStepView = { id: string; label: string; state: WorkStepStateLite; passed?: boolean; since?: string };
export type WorkView = { steps: WorkStepView[]; startedAt: string | null; live: boolean };

/** How often the list is read again while work runs, so a page with no push (the poll fallback) still moves. */
export const WORK_POLL_MS = 5000;

type Job = { workId: string; startedAt: string; steps: { id: string; state: WorkStepStateLite; passed?: boolean; since?: string }[] };

const labelOf = (kind: WorkKind, id: string) => WORK_STEPS[kind].find((step) => step.id === id)?.label ?? '';

/**
 * Which step long work of `kind` is on (one-shot C3 task 10). Seeded from `venture.work.list` on mount, so a page opened
 * again mid-job shows where it is; `work.step` frames move it on; and while it runs the list is read again on the poll's
 * pace, so a dropped frame or a page with no push catches up. `active`: the page's own request is on its way, so the
 * kind's steps show before the first frame. `live` is false once no job runs and the page is not waiting on one.
 */
export function useWork(kind: WorkKind, options: { active?: boolean | undefined; stepIds?: readonly string[] | undefined } = {}): WorkView {
  const client = useEngine();
  const active = options.active ?? false;
  const [job, setJob] = useState<Job | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const live = useRef(true);
  const frames = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    if (active) setSince((now) => now ?? new Date().toISOString());
    else { setSince(null); setJob(null); }
  }, [active]);

  const read = useCallback(() => {
      const heard = frames.current;
      client.request('venture.work.list', {}).then((answer) => {
        if (!live.current) return;
        const found = answer.work.find((item) => item.kind === kind);
        // A frame that came while this read was on its way is newer than its answer.
        if (found) { if (frames.current === heard) setJob({ workId: found.workId, startedAt: found.startedAt, steps: found.steps }); }
        // None listed, and the page is not waiting on its own request: nothing runs.
        else if (frames.current === heard && !activeRef.current) setJob(null);
      }, () => { /* An engine that cannot say shows the page's own wait. */ });
  }, [client, kind]);

  useEffect(() => {
    read();
    const off = client.subscribe((event: VentureRunEvent) => {
      if (event.type !== 'work.step' || event.kind !== kind || !event.step || !event.state) return;
      frames.current += 1;
      const { step, state, at, workId } = event;
      const passed = event.passed;
      setJob((now) => {
        const base: Job = now && now.workId === workId ? now : { workId: workId ?? '', startedAt: at, steps: [] };
        const known = base.steps.some((item) => item.id === step);
        const steps = known ? base.steps.map((item) => (item.id === step ? { ...item, state, ...(passed !== undefined ? { passed } : {}), ...(state === 'current' ? { since: at } : {}) } : item))
          : [...base.steps, { id: step, state, ...(passed !== undefined ? { passed } : {}), ...(state === 'current' ? { since: at } : {}) }];
        return { ...base, steps };
      });
    });
    return off;
  }, [client, kind, read]);

  // Only while something runs here: a page at rest asks for nothing, and holds no timer.
  const running = active || job !== null;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(read, WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [running, read]);

  const stepIds = options.stepIds;
  return useMemo(() => {
    const ids = stepIds ?? (WORK_STEPS[kind].length ? WORK_STEPS[kind].map((step) => step.id) : job?.steps.map((step) => step.id) ?? []);
    const known = new Map(job?.steps.map((step) => [step.id, step]));
    const listed = [...ids, ...(job?.steps.map((step) => step.id).filter((id) => !ids.includes(id)) ?? [])];
    const steps = listed.map((id): WorkStepView => {
      const step = known.get(id);
      return { id, label: labelOf(kind, id), state: step?.state ?? 'waiting', ...(step?.passed !== undefined ? { passed: step.passed } : {}), ...(step?.since ? { since: step.since } : {}) };
    });
    return { steps, startedAt: job?.startedAt ?? since, live: active || job !== null };
  }, [kind, job, since, active, stepIds]);
}
