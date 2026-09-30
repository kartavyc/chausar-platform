import {
  ActivityFailure, ApplicationFailure, condition, defineQuery, defineSignal,
  proxyActivities, setHandler, workflowInfo,
} from '@temporalio/workflow';
import type { InvestigationActivities } from './activities.ts';

export type InvestigationInput = { investigationId: string };
export type InvestigationState = {
  phase: 'executing' | 'waiting-owner' | 'completed' | 'blocked' | 'failed';
  waits: number;
  ownerSignalVersion: number;
};
export type InvestigationOutcome =
  | { status: 'completed'; resultId: string; revision: number }
  | { status: 'blocked'; code: 'authority_denied' }
  | { status: 'failed'; code: 'execution_failed' };

export const ownerAssigned = defineSignal('ownerAssigned');
export const state = defineQuery<InvestigationState>('state');
const activities = proxyActivities<InvestigationActivities>({
  startToCloseTimeout: '60 seconds',
  scheduleToCloseTimeout: '3 minutes',
  retry: { initialInterval: '1 second', maximumInterval: '5 seconds', maximumAttempts: 3 },
});

export async function investigate(input: InvestigationInput): Promise<InvestigationOutcome> {
  if (!input.investigationId || typeof input.investigationId !== 'string') {
    throw ApplicationFailure.nonRetryable('Investigation reference required', 'InvalidInput');
  }
  const current: InvestigationState = { phase: 'executing', waits: 0, ownerSignalVersion: 0 };
  setHandler(ownerAssigned, () => { current.ownerSignalVersion += 1; });
  setHandler(state, () => ({ ...current }));
  const operationId = `${workflowInfo().workflowId}/execute`;

  for (;;) {
    // Capture BEFORE dispatch: assignment during the request must not be lost before condition().
    const observedOwnerVersion = current.ownerSignalVersion;
    current.phase = 'executing';
    try {
      const result = await activities.executeInvestigation({ investigationId: input.investigationId, operationId });
      if (result.status === 'completed') {
        current.phase = 'completed';
        return result;
      }
      current.phase = 'waiting-owner';
      current.waits += 1;
      await condition(() => current.ownerSignalVersion > observedOwnerVersion);
    } catch (error) {
      if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
        if (error.cause.type === 'AuthorityDenied') {
          current.phase = 'blocked';
          return { status: 'blocked', code: 'authority_denied' };
        }
        current.phase = 'failed';
        return { status: 'failed', code: 'execution_failed' };
      }
      // Preserve Temporal cancellation semantics and unexpected workflow failures.
      throw error;
    }
  }
}
