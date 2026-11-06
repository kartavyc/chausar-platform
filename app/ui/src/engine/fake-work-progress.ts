import { WORK_STEPS, type WorkKind } from '../../../../platform/runtime/venture/views/work-steps';
import type { VentureRunEvent, WorkJobLite, WorkStepStateLite } from './types';

/**
 * The fake's long work (one-shot C3 task 9), with the engine's frames (platform/runtime/work-progress.ts): `work.step`
 * events with no seq, and `venture.work.list` for a page opened mid-job. `delayMs` is how long each step takes; the dev
 * page and a test that watches the steps set it, and the rest of the suite runs them in one tick.
 */
export class FakeWorkProgress {
  private readonly jobs = new Map<WorkKind, WorkJobLite>();
  private made = 0;

  constructor(
    private readonly emit: (event: VentureRunEvent) => void,
    private readonly now: () => string,
    private readonly business: () => string,
    private readonly delayMs: number,
  ) {}

  list(): { work: WorkJobLite[] } {
    return { work: [...this.jobs.values()].map((job) => ({ ...job, steps: job.steps.map((step) => ({ ...step })) })) };
  }

  private mark(job: WorkJobLite, kind: WorkKind, step: string, state: WorkStepStateLite, passed?: boolean): void {
    const row = job.steps.find((item) => item.id === step);
    if (row) {
      row.state = state;
      if (passed !== undefined) row.passed = passed;
    }
    this.emit({ type: 'work.step', businessId: this.business(), workId: job.workId, kind, step, state, ...(passed !== undefined ? { passed } : {}), at: this.now() });
  }

  private async pause(): Promise<void> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  /**
   * Run `work` as a job of `kind`. Each step goes current then done, in order, and then `work` answers; `passedOf` says
   * how a step ended when the answer knows (a practice client). A thrown answer fails the step it stopped on and ends
   * the job, as the engine's `finally` does.
   */
  async run<T>(kind: WorkKind, stepIds: readonly string[] | null, work: () => Promise<T> | T, passedOf?: (answer: T, step: string) => boolean): Promise<T> {
    const ids = stepIds ?? WORK_STEPS[kind].map((step) => step.id);
    this.made += 1;
    const job: WorkJobLite = { workId: `work_${this.made}`, kind, startedAt: this.now(), steps: ids.map((id) => ({ id, state: 'waiting' })) };
    this.jobs.set(kind, job);
    try {
      const answer = await work();
      for (const step of ids) {
        this.mark(job, kind, step, 'current');
        await this.pause();
        const passed = passedOf?.(answer, step);
        this.mark(job, kind, step, 'done', passed);
      }
      return answer;
    } catch (error) {
      const at = job.steps.find((step) => step.state === 'current')?.id ?? ids[0];
      if (at) this.mark(job, kind, at, 'failed');
      throw error;
    } finally {
      if (this.jobs.get(kind) === job) this.jobs.delete(kind);
    }
  }
}
