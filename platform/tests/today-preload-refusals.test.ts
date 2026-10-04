import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadElectronPreloadFixture } from './fixtures/electron-context-bridge.ts';

interface PreloadApi {
  requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
}
const preloadPath = new URL('../../app/desktop/preload.cjs', import.meta.url);
const preloadSource = await readFile(preloadPath, 'utf8');
const privateDetail = 'PRIVATE_SYNTHETIC_TODAY_ENGINE_DETAIL';
const generic = { version: 1, ok: false, error: { code: 'REQUEST_FAILED' } };

// Literal refusal codes from the current Engine Today, tiles, attention, events
// and review queue guards. This list is independent of the preload allowlist:
// accepting a new TODAY_/REVIEW_ prefix is not enough to pass this boundary.
const todayCodes = [
  'TODAY_INVALID_REQUEST', 'INVALID_TODAY_REQUEST',
  'TODAY_AUTHORITY_REQUIRED', 'TODAY_HOST_AUTHORITY_REQUIRED',
  'TODAY_SERVICE_REQUIRED', 'TODAY_AUTHORITY_STORE_MISMATCH',
  'TODAY_AUTHORITY_UNAVAILABLE', 'TODAY_AUTHORITY_CHANGED', 'TODAY_READ_ONLY',
  'TODAY_SELECTION_POLICY_REQUIRED', 'TODAY_SELECTION_INVALID',
  'TODAY_CONFIGURATION_INVALID', 'TODAY_PREPARATION_FORBIDDEN',
  'TODAY_CAPTURE_UNAVAILABLE', 'TODAY_TILES_SERVICE_UNAVAILABLE',
  'TODAY_TILES_CALCULATOR_REQUIRED', 'TODAY_TILES_INVALID_REQUEST',
  'TODAY_TILES_DEFINITION_CHANGED', 'TODAY_TILES_INPUT_CHANGED',
  'TODAY_TILES_RECEIPT_CHANGED', 'TODAY_TILES_HELD_RESULT_FORBIDDEN',
  'TODAY_TILES_RECEIPT_MISMATCH',
  'TODAY_TILES_RETENTION_EXPIRED', 'INVALID_JOB_ACCEPTANCE_REFERENCE', 'PREVIEW_CHANGED', 'JOB_EVIDENCE_REVOKED',
  'TODAY_ATTENTION_SERVICE_UNAVAILABLE', 'INVALID_TODAY_ATTENTION',
  'TODAY_ATTENTION_STALE', 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE',
  'TODAY_EVENTS_SERVICE_UNAVAILABLE', 'INVALID_TODAY_DAY',
  'INVALID_TODAY_EVENT_REFERENCE', 'TODAY_VIEW_CHANGED',
  'TODAY_HELD_RESULT_FORBIDDEN', 'TODAY_EVENT_REFERENCE_UNAVAILABLE',
  'TODAY_REVIEW_SERVICE_UNAVAILABLE',
] as const;
const reviewCodes = [
  'REVIEW_WORKSPACE_CHANGED', 'REVIEW_AUTHORITY_UNAVAILABLE',
  'REVIEW_AUTHORITY_CHANGED', 'INVALID_REVIEW_PAGE',
  'REVIEW_QUEUE_CHANGED', 'REVIEW_REFERENCE_UNAVAILABLE',
] as const;

function fixture(reply: () => unknown) {
  const calls: { channel: string; envelope: unknown }[] = [];
  const { api } = loadElectronPreloadFixture<PreloadApi>({
    source: preloadSource, filename: preloadPath.pathname,
    invoke(channel, envelope) {
      calls.push({ channel, envelope });
      return reply();
    },
  });
  return { api, calls };
}
function refusal(code: string) {
  return { ok: false, error: { code, message: privateDetail } };
}
function assertPrivateDetailsAbsent(wire: unknown) {
  const serialized = JSON.stringify(wire);
  assert.ok(serialized, 'The copied envelope must be JSON data.');
  assert.equal(serialized.includes(privateDetail), false);
  assert.equal(serialized.includes('message'), false);
  assert.equal(serialized.includes('stack'), false);
  assert.equal(serialized.includes('cause'), false);
}

test('actual preload preserves exact current Today and review refusals as copied code-only envelopes', async t => {
  t.diagnostic(`app/desktop/preload.cjs sha256=${createHash('sha256').update(preloadSource).digest('hex')}`);
  for (const code of [...todayCodes, ...reviewCodes]) {
    await t.test(code, async () => {
      const method = reviewCodes.some(value => value === code) ? 'today.review' : 'today.get';
      const payload = method === 'today.review' ? { limit: 4 } : { date: '2026-10-04', timeZone: 'Etc/UTC' };
      const h = fixture(() => refusal(code));
      const wire = await h.api.requestEnvelope(method, payload);
      assert.deepEqual(wire, { version: 1, ok: false, error: { code } });
      assert.equal(Object.isFrozen(wire), true);
      assert.equal(Object.isFrozen((wire as { error: object }).error), true);
      assertPrivateDetailsAbsent(wire);
      assert.deepEqual(h.calls, [{ channel: 'chausar:request', envelope: { method, payload } }],
        'One explicit boundary request invokes IPC once without retrying.');
    });
  }
});

test('unknown prefixed codes and non-refusal Today/review metadata stay generic through the actual preload', async () => {
  for (const code of [
    'TODAY_UNKNOWN_REFUSAL', 'REVIEW_UNKNOWN_REFUSAL',
    'INVALID_TODAY_UNKNOWN_REFUSAL', 'INVALID_REVIEW_UNKNOWN_REFUSAL',
    'TODAY_AUTHORITY_CHANGED_PRIVATE_DETAIL', 'REVIEW_QUEUE_CHANGED_PRIVATE_DETAIL',
    `TODAY_AUTHORITY_CHANGED ${privateDetail}`, `REVIEW_QUEUE_CHANGED\n${privateDetail}`,
    'TODAY_ENGINE_CONTRACT_PARTIAL', 'REVIEW_EVIDENCE_UNAVAILABLE',
    'PRIVATE_DATABASE_FAILURE',
  ]) {
    const h = fixture(() => refusal(code));
    const wire = await h.api.requestEnvelope('today.get', { date: '2026-10-04', timeZone: 'Etc/UTC' });
    assert.deepEqual(wire, generic, code);
    assertPrivateDetailsAbsent(wire);
    assert.equal(h.calls.length, 1);
  }
});

test('private exception properties and malformed known refusals cannot cross the preload envelope boundary', async () => {
  const exception = Object.assign(new Error(privateDetail), {
    code: 'TODAY_AUTHORITY_CHANGED', cause: privateDetail,
  });
  const replies = [
    () => { throw exception; },
    () => ({ ok: false, error: { code: 'TODAY_AUTHORITY_CHANGED', message: privateDetail, stack: privateDetail } }),
    () => ({ ok: false, error: { code: 'REVIEW_QUEUE_CHANGED', message: privateDetail, cause: privateDetail } }),
    () => ({ ok: false, error: { code: 'TODAY_AUTHORITY_CHANGED' } }),
    () => ({ ...refusal('REVIEW_QUEUE_CHANGED'), result: { privateDetail } }),
  ];
  for (const reply of replies) {
    const h = fixture(reply);
    const wire = await h.api.requestEnvelope('today.resolveReview', { reference: { kind: 'action-approval', id: 'synthetic-action', revision: 1, digest: 'a'.repeat(64) } });
    assert.deepEqual(wire, generic);
    assertPrivateDetailsAbsent(wire);
    assert.equal(h.calls.length, 1);
  }
});
