import { check, type Context } from '../../contracts.ts';
import type { AgentJobScope, BusinessWorkScope } from './driver-types.ts';

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

/**
 * The capability of work for the business itself (BusinessWorkScope): host-created, for one piece of work, closed when
 * it ends. The engine runs it for the owner inside the app, so its context stays the owner's own; no AI holds it.
 * It names no order and no client, and carries nothing that could read one.
 */
export class BusinessCapability {
  readonly scope: Readonly<BusinessWorkScope>;
  readonly context: Readonly<Context>;
  private active = true;
  private authorize: (scope: Readonly<BusinessWorkScope>) => void;
  constructor(scope: BusinessWorkScope, context: Context, authorize: (scope: Readonly<BusinessWorkScope>) => void) {
    this.scope = Object.freeze(structuredClone(scope));
    this.context = Object.freeze({ ...context });
    this.authorize = authorize;
  }
  assert(): void {
    check(this.active, 'JOB_CLOSED', 'This search is no longer running.');
    check(this.context.memberId === this.scope.memberId && this.context.epoch === this.scope.epoch, 'JOB_SCOPE_CHANGED', 'This search belongs to another signed-in workspace.');
    this.authorize(this.scope);
  }
  close(): void { this.active = false; }
}
