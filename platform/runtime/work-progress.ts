// One-shot C3 task 9: which step long work is on. Long work (the improvement loop, a rehearsal, About you, the tool
// check) runs inside one request and commits at its end, so the screens had nothing to show but a still line. Each
// handler now says when a step starts and ends; each change goes out as a `work.step` frame through the engine's event
// listeners, and `venture.work.list` reads the live jobs for a page opened mid-job.
//
// A frame has no seq, and nothing here is written to a vault, the event log or any file: it is what is happening now,
// not a record. It never throws into a handler. At most one live job per kind per business: a new one replaces the old.
import type { WorkKind } from './venture/views/work-steps.ts';

export type WorkStepState = 'waiting' | 'current' | 'done' | 'failed';
/** A step's change, as it goes to the screens. businessId '' is before any business is open (the draft desk). */
export type WorkStepEvent = { type: 'work.step'; businessId: string; workId: string; kind: WorkKind; step: string; state: WorkStepState; passed?: boolean; at: string };
export type WorkJobView = { workId: string; kind: WorkKind; startedAt: string; steps: { id: string; state: WorkStepState; passed?: boolean }[] };

export interface Work {
  step(id: string, state: 'current' | 'done' | 'failed', extra?: { passed?: boolean }): void;
  /** The handler threw: the step it stopped on failed. */
  failCurrent(): void;
  /** Always call it in a `finally`, so a thrown handler ends the job too. */
  end(): void;
}

/** A job that says nothing, for code with no WorkProgress (tests that pass none). */
export const NO_WORK: Work = Object.freeze({ step() {}, failCurrent() {}, end() {} });

type Job = { business: string; view: WorkJobView };

export class WorkProgress {
  readonly #send: (event: WorkStepEvent) => void;
  readonly #clock: () => Date;
  readonly #jobs = new Map<string, Job>();
  #made = 0;

  constructor(send: (event: WorkStepEvent) => void, clock: () => Date = () => new Date()) {
    this.#send = send;
    this.#clock = clock;
  }

  begin(kind: WorkKind, stepIds: readonly string[], options: { businessId: string }): Work {
    const place = `${options.businessId}\n${kind}`;
    this.#made += 1;
    const workId = `work_${this.#made}`;
    const view: WorkJobView = { workId, kind, startedAt: this.#clock().toISOString(), steps: stepIds.map((id) => ({ id, state: 'waiting' })) };
    const job: Job = { business: options.businessId, view };
    this.#jobs.set(place, job);
    const live = () => this.#jobs.get(place) === job;
    const work: Work = {
      failCurrent: () => {
        const current = view.steps.find((item) => item.state === 'current');
        if (current) work.step(current.id, 'failed');
      },
      step: (id, state, extra) => {
        if (!live()) return;
        const step = view.steps.find((item) => item.id === id);
        if (step) {
          step.state = state;
          if (extra?.passed !== undefined) step.passed = extra.passed;
        } else {
          view.steps.push({ id, state, ...(extra?.passed !== undefined ? { passed: extra.passed } : {}) });
        }
        try {
          this.#send({ type: 'work.step', businessId: options.businessId, workId, kind, step: id, state, ...(extra?.passed !== undefined ? { passed: extra.passed } : {}), at: this.#clock().toISOString() });
        } catch { /* A listener's failure is its own. */ }
      },
      end: () => { if (live()) this.#jobs.delete(place); },
    };
    return work;
  }

  /** The live jobs of one business, for `venture.work.list`. A copy: nothing outside changes a job. */
  list(businessId: string): WorkJobView[] {
    return [...this.#jobs.values()].filter((job) => job.business === businessId).map((job) => ({ ...job.view, steps: job.view.steps.map((step) => ({ ...step })) }));
  }
}
