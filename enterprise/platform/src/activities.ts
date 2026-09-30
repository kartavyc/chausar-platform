import { ApplicationFailure } from '@temporalio/common';

export type ExecuteInput = { investigationId: string; operationId: string };
export type ExecuteResult =
  | { status: 'completed'; resultId: string; revision: number }
  | { status: 'owner_missing' };

/** Configuration and credentials stay in the activity process, outside workflow history. */
export function createActivities(config: { coreUrl: string; serviceToken: string }) {
  const base = new URL(config.coreUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Invalid core URL');
  }
  if (!config.serviceToken) throw new Error('Internal service token is required');

  return {
    async executeInvestigation(input: ExecuteInput): Promise<ExecuteResult> {
      const url = new URL(`/internal/investigations/${encodeURIComponent(input.investigationId)}/execute`, base);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${config.serviceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationId: input.operationId }),
          signal: AbortSignal.timeout(45_000),
        });
      } catch {
        // Do not propagate URL, response payload, request headers or fetch causes into history/logs.
        throw ApplicationFailure.retryable('Core request unavailable', 'CoreUnavailable');
      }
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (response.status === 409 && data.code === 'owner_missing') return { status: 'owner_missing' };
      if (response.status === 403 && data.code === 'authority_denied') {
        throw ApplicationFailure.nonRetryable('Investigation authority denied', 'AuthorityDenied');
      }
      if (response.status === 200 && data.status === 'completed'
          && typeof data.resultId === 'string' && data.resultId.length > 0
          && Number.isSafeInteger(data.revision) && (data.revision as number) >= 0) {
        return { status: 'completed', resultId: data.resultId, revision: data.revision as number };
      }
      if (response.status === 429 || response.status >= 500) {
        throw ApplicationFailure.retryable('Core temporarily unavailable', 'CoreUnavailable');
      }
      throw ApplicationFailure.nonRetryable('Unexpected core response', 'CoreProtocolError');
    },
  };
}

export type InvestigationActivities = ReturnType<typeof createActivities>;
