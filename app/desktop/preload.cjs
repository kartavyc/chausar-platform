const { contextBridge, ipcRenderer } = require('electron');
// Sandbox preloads cannot import project modules; main owns the shared validator.
// Expected refusals must cross contextBridge as data: copied Errors lose .code.
// Keep this allowlist aligned with the renderer adapter in bridge/client.ts.
const refusalCodes = new Set([
  'INVALID_REPLY', 'READ_INVALIDATED', 'ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'EVIDENCE_UNAVAILABLE',
  'ACCESS_REVOKED', 'SOURCE_REVOKED', 'BRANCH_FORBIDDEN', 'RECEIPT_FORBIDDEN', 'FORBIDDEN', 'RECEIPT_NOT_FOUND',
  'INVALID_SESSION', 'ROUTE_REVOKED', 'OUTBOUND_APPROVAL_REQUIRED', 'CONVERSATION_CONTINUATION_RESOLVED',
  'CONVERSATION_CONTINUATION_LIMIT', 'PREVIEW_STALE', 'PAYLOAD_CHANGED', 'PREVIEW_REQUEST_CHANGED', 'SYNTHESIS_STALE',
  'CONVERSATION_CONTINUATION_STALE', 'MODEL_RECEIPT_EXPIRED', 'CALCULATION_STALE', 'CONVERSATION_NOT_FOUND',
  'CONVERSATION_CONTINUATION_UNAVAILABLE', 'MODEL_RECEIPT_NOT_FOUND', 'SYNTHESIS_UNAVAILABLE',
  'SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE', 'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN', 'SCENARIO_AUTHORITY_CHANGED',
  'SCENARIO_ARTIFACT_CHANGED', 'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED', 'SCENARIO_CUSTODY_INVALID', 'SCENARIO_CUSTODY_CONFLICT',
  'SCENARIO_TAINTED_CONTEXT', 'SCENARIO_WORKSPACE_CHANGED', 'SCENARIO_RUN_UNAVAILABLE', 'SCENARIO_READ_ONLY', 'SCENARIO_HEAD_CHANGED',
  'SCENARIO_JOB_UNAVAILABLE', 'SCENARIO_BRANCH_UNAVAILABLE', 'SCENARIO_GRAPH_INVALID', 'SCENARIO_VECTOR_MISMATCH', 'INVALID_SCENARIO',
  'LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITY_REVISION_REQUIRED', 'LESSON_AUTHORITY_CHANGED', 'LESSON_REVIEW_CHANGED',
  'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED', 'EVALUATION_CHANGED', 'EVALUATION_CANDIDATE_MISMATCH', 'EVALUATION_PROVENANCE_REQUIRED',
  'EVALUATION_COMPARISON_MISMATCH', 'INVALID_LESSON_EVALUATION', 'LESSON_EVIDENCE_UNAVAILABLE', 'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED',
  'LESSON_OWNER_REQUIRED', 'LESSON_WORKSPACE_CHANGED', 'LESSON_NOT_FOUND', 'LESSON_CHANGED', 'INVALID_LESSON', 'INVALID_LESSON_DECISION',
  'INVALID_LESSON_STATE', 'INVALID_LESSON_TARGET', 'APP_LESSON_REVIEW_REQUIRED', 'TAINTED_LESSON', 'LESSON_CONFLICT', 'INVALID_SUPERSESSION',
  'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'UNTRUSTED_SENDER', 'REQUEST_FAILED',
]);
function fields(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(name => !keys.includes(name))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(name => !descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name], 'value'))) return null;
  return descriptors;
}
const failed = () => ({ version: 1, ok: false, error: { code: 'REQUEST_FAILED' } });
async function requestEnvelope(method, payload = {}) {
  try {
    const reply = await ipcRenderer.invoke('chausar:request', { method, payload });
    const success = fields(reply, ['ok', 'result']);
    if (success?.ok.value === true) return { version: 1, ok: true, result: success.result.value };
    const refusal = fields(reply, ['ok', 'error']);
    if (refusal?.ok.value !== false) return failed();
    const error = fields(refusal.error.value, ['code', 'message']);
    if (!error || typeof error.message.value !== 'string' || !refusalCodes.has(error.code.value)) return failed();
    // Never forward an engine exception message, stack, cause or other properties.
    return { version: 1, ok: false, error: { code: error.code.value } };
  } catch { return failed(); }
}
contextBridge.exposeInMainWorld('chausar', Object.freeze({
  requestEnvelope,
  request: async (method, payload = {}) => {
    const reply = await ipcRenderer.invoke('chausar:request', { method, payload });
    if (reply?.ok === true) return reply.result;
    const error = reply?.error;
    throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'The desktop request failed.'), { code: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED' });
  },
  onEngineStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for engine status updates.');
    const states = ['starting', 'ready', 'failed', 'stopping', 'stopped'];
    const listener = (_event, value) => callback(Object.freeze({ healthy: value?.healthy === true, state: states.includes(value?.state) ? value.state : 'failed' }));
    ipcRenderer.on('chausar:engine-status', listener);
    return () => ipcRenderer.removeListener('chausar:engine-status', listener);
  },
}));
