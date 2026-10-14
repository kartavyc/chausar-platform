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
  'INVALID_DICTIONARY', 'INVALID_CURRENCY', 'INVALID_GST_MODE', 'INVALID_FIELD', 'INVALID_DEFINITION', 'RESERVED_MEASURE',
  'UNKNOWN_PACK', 'COMPILED_SUM_INVALID', 'INVALID_DICTIONARY_OPTIONS', 'INVALID_DICTIONARY_RECEIPT',
  'DICTIONARY_REVIEW_REQUIRED', 'DICTIONARY_CONFLICT', 'DICTIONARY_ATTEMPT_REUSED', 'DICTIONARY_ATTEMPT_AUTHORITY', 'INVALID_DICTIONARY_MODE',
  'TODAY_INVALID_REQUEST', 'INVALID_TODAY_REQUEST', 'TODAY_AUTHORITY_REQUIRED', 'TODAY_HOST_AUTHORITY_REQUIRED',
  'TODAY_SERVICE_REQUIRED', 'TODAY_AUTHORITY_STORE_MISMATCH', 'TODAY_AUTHORITY_UNAVAILABLE', 'TODAY_AUTHORITY_CHANGED', 'TODAY_READ_ONLY',
  'TODAY_SELECTION_POLICY_REQUIRED', 'TODAY_SELECTION_INVALID', 'TODAY_CONFIGURATION_INVALID', 'TODAY_PREPARATION_FORBIDDEN',
  'TODAY_CAPTURE_UNAVAILABLE', 'TODAY_TILES_SERVICE_UNAVAILABLE', 'TODAY_TILES_CALCULATOR_REQUIRED', 'TODAY_TILES_INVALID_REQUEST',
  'TODAY_TILES_DEFINITION_CHANGED', 'TODAY_TILES_INPUT_CHANGED', 'TODAY_TILES_RECEIPT_CHANGED', 'TODAY_TILES_HELD_RESULT_FORBIDDEN',
  'TODAY_TILES_RECEIPT_MISMATCH', 'TODAY_TILES_RETENTION_EXPIRED', 'TODAY_ATTENTION_SERVICE_UNAVAILABLE', 'INVALID_TODAY_ATTENTION',
  'TODAY_ATTENTION_STALE', 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'TODAY_EVENTS_SERVICE_UNAVAILABLE', 'INVALID_TODAY_DAY',
  'INVALID_TODAY_EVENT_REFERENCE', 'TODAY_VIEW_CHANGED', 'TODAY_HELD_RESULT_FORBIDDEN', 'TODAY_EVENT_REFERENCE_UNAVAILABLE',
  'TODAY_REVIEW_SERVICE_UNAVAILABLE', 'REVIEW_WORKSPACE_CHANGED', 'REVIEW_AUTHORITY_UNAVAILABLE', 'REVIEW_AUTHORITY_CHANGED',
  'INVALID_REVIEW_PAGE', 'REVIEW_QUEUE_CHANGED', 'REVIEW_REFERENCE_UNAVAILABLE',
  'INVALID_JOB_ACCEPTANCE_REFERENCE', 'PREVIEW_CHANGED', 'JOB_EVIDENCE_REVOKED',
  'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'UNTRUSTED_SENDER', 'REQUEST_FAILED',
]);
// Engine-module refusal codes that may reach the screen. Each lane appends codes only to its own line.
const laneRefusals = [
  ['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE', 'OPEN_DESKTOP', 'DEMO_EXTERNAL_DISABLED'],

  /* frame-today */ [],

  /* ask */ [],

  /* work-books */ [],

  /* reports-tools-trust */ ['ALWAYS_WAITS', 'ASSISTANTS_OFF', 'BACKUP_CHECK_FAILED', 'CAPABILITY_MISMATCH', 'CHANGE_AUTHORITY_CHANGED', 'CHANGE_AUTHOR_REVOKED', 'CHANGE_EXPIRED', 'CHANGE_NEEDS_OTHER', 'CHANGE_NOT_FOUND', 'CHANGE_UNKNOWN', 'CHANNEL_ADDRESS_REQUIRED', 'CONFIRMATION_REQUIRED', 'EXPORT_FAILED', 'FORBIDDEN', 'INVALID_AMOUNT', 'INVALID_AUTONOMY', 'INVALID_CAP', 'INVALID_CHANNEL', 'INVALID_CONTACT', 'INVALID_DUE_PROFILE', 'INVALID_DUE_REQUEST', 'INVALID_END_DATE', 'INVALID_EXPORT_FORMAT', 'INVALID_EXPORT_REQUEST', 'INVALID_KEEP', 'INVALID_KEY', 'INVALID_LANGUAGE', 'INVALID_LOCK', 'INVALID_MARKING', 'INVALID_MINOR_UNITS', 'INVALID_PASSPHRASE', 'INVALID_QUESTION', 'INVALID_RHYTHM', 'INVALID_SAMPLE', 'INVALID_SEAT', 'INVALID_WASM', 'LAST_OWNER', 'MEMBER_ALREADY_REMOVED', 'OWNER_REQUIRED', 'PDF_USES_PRINT', 'PLUGIN_REFUSED', 'PREVIEW_CHANGED', 'RELAY_NOT_AVAILABLE', 'SEAT_FIXED', 'SEAT_NOT_INVITABLE', 'SELF_CONFIRM', 'SIGNATURE_INVALID', 'SOURCE_NOT_FOUND', 'TALLY_PAGE_EXPORT_NOT_AVAILABLE', 'UNKNOWN_KIND', 'UNKNOWN_REPORT_PAGE', 'UNSUPPORTED_CAPABILITY', 'WEEK_NOT_STARTED', 'WITHDRAW_NOT_AVAILABLE', 'INVALID_PERIOD'],

  /* connectors-ext */ [],

  /* writeback */ [],

  /* jobs-ext */ [],

  /* learning-ext */ [],

  /* hosted-link */ [],

  /* release */ [],

  /* models-ext */ [],
];
for (const codes of laneRefusals) for (const code of codes) refusalCodes.add(code);
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
