import { check, type Context } from '../../contracts.ts';
import type { AgentJobScope } from './driver-types.ts';

/** A host-created capability. No model argument can widen its identity or lifetime. */
export class JobCapability {
  readonly scope: Readonly<AgentJobScope>;
  readonly context: Readonly<Context>;
  private active = true;
  private authorize: (scope: Readonly<AgentJobScope>) => void;
  constructor(scope: AgentJobScope, context: Context, authorize: (scope: Readonly<AgentJobScope>) => void) {
    this.scope = Object.freeze(structuredClone(scope));
    this.context = Object.freeze({...context, channel: 'mcp', sourceTainted: true});
    this.authorize = authorize;
  }
  assert(): void {
    check(this.active, 'JOB_CLOSED', 'This job is no longer running.');
    check(this.context.memberId === this.scope.memberId && this.context.epoch === this.scope.epoch, 'JOB_SCOPE_CHANGED', 'This job belongs to another signed-in workspace.');
    this.authorize(this.scope);
  }
  async guard<T>(work: () => Promise<T> | T): Promise<T> { this.assert(); const answer = await work(); this.assert(); return answer; }
  close(): void { this.active = false; }
}
