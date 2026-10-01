'use strict';

const REQUEST_CHANNEL = 'chausar:request';
const STATUS_CHANNEL = 'chausar:engine-status';
const TRUSTED_DOCUMENT = 'chausar://app/index.html';
const MAX_REQUEST_BYTES = 2_000_000;
const METHODS = Object.freeze([
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.backup', 'workspace.export', 'workspace.delete',
  'auth.invite', 'auth.accept', 'auth.session', 'auth.revoke', 'auth.sessions',
  'sync.status', 'sync.identity', 'sync.enable', 'sync.trust', 'sync.preview', 'sync.approve', 'sync.push', 'sync.pull',
  'dashboard.get', 'conversation.ask', 'business.context.receipt', 'business.profile.record', 'business.profile.history', 'business.profile.remove', 'calculation.run', 'receipts.get',
  'analysis.bridge.publish', 'analysis.bridge.profiles', 'analysis.bridge.run', 'analysis.bridge.get',
  'investigations.create', 'investigations.get', 'investigations.list', 'investigations.advance', 'investigations.resume', 'investigations.pause', 'investigations.revise', 'investigations.cancel', 'investigations.capsule', 'investigations.drilldown', 'research.search',
  'sources.list', 'sources.delete', 'sources.preview', 'sources.import', 'sources.catalogue', 'sources.groups', 'sources.fetch', 'sources.recipe', 'sources.accept', 'sources.workbook', 'sources.workbookPreview', 'sources.workbookImport',
  'connectors.profiles', 'connectors.read', 'connectors.reviewMapping', 'connectors.capture', 'connectors.publish', 'connectors.ready', 'connectors.captureStatus', 'connectors.releaseRead',
  'ontology.packs', 'ontology.get', 'ontology.publish', 'memory.list', 'memory.correct', 'memory.merge', 'memory.undo', 'memory.precedence',
  'decisions.list', 'decisions.create', 'decisions.review',
  'decisions.journal.draft', 'decisions.journal.confirm', 'decisions.journal.revise', 'decisions.journal.review', 'decisions.journal.due',
  'reports.get', 'reports.brief', 'reports.forecast',
  'actions.list', 'actions.catalogue', 'actions.prepare', 'actions.approve', 'actions.revise', 'actions.execute', 'actions.reconcile',
  'jobs.list', 'jobs.types', 'jobs.create', 'jobs.amend', 'jobs.cancel', 'jobs.reconcile', 'jobs.progress', 'jobs.pause', 'jobs.resume', 'jobs.accept', 'jobs.approve', 'jobs.reject', 'jobs.run',
  'jobs.calendar.preview', 'jobs.calendar.configure', 'jobs.calendar.pause', 'jobs.calendar.resume',
  'trust.get', 'trust.update', 'members.list', 'members.add', 'members.revoke',
  'models.list', 'models.configure', 'models.preview', 'models.approve', 'models.test',
  'speech.list', 'speech.configure', 'speech.preview', 'speech.approve', 'speech.transcribe', 'activity.list',
  'learning.list', 'learning.log', 'learning.preview', 'learning.consent', 'learning.sharing', 'learning.share',
  'plugins.list', 'plugins.install', 'plugins.enable', 'plugins.disable', 'plugins.remove', 'plugins.run', 'plugins.miniapp',
  'mcp.info', 'mcp.handle', 'helpers.run', 'updates.status', 'updates.verify', 'updates.stage',
]);
const allowedMethods = new Set(METHODS);
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'toJSON']);
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
// Bound structure before JSON serialization; reject accessors and serialization hooks.
function assertJson(value) {
  const visiting = new Set(); let nodes = 0; let bytes = 0;
  function count(value) { bytes += Buffer.byteLength(value); if (bytes > MAX_REQUEST_BYTES) throw failure('REQUEST_TOO_LARGE', 'The desktop request exceeds the size limit.'); }
  function walk(item, depth) {
    if (++nodes > 100_000 || depth > 32) throw failure('INVALID_REQUEST', 'The request structure is too large.');
    if (typeof item === 'string') { count(item); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !isRecord(item)) throw failure('INVALID_REQUEST', 'Use JSON values in the request.');
    if (Array.isArray(item) && item.length > 100_000) throw failure('INVALID_REQUEST', 'The request array is too large.');
    if (visiting.has(item)) throw failure('INVALID_REQUEST', 'The request contains a cycle.');
    visiting.add(item);
    if (Object.getOwnPropertySymbols(item).length) throw failure('INVALID_REQUEST', 'Symbol keys are not allowed.');
    for (const name of Object.getOwnPropertyNames(item)) {
      if (Array.isArray(item) && name === 'length') continue;
      count(name);
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (forbidden.has(name) || !descriptor.enumerable || !('value' in descriptor)) throw failure('INVALID_REQUEST', 'The request contains an unsupported property.');
      walk(descriptor.value, depth + 1);
    }
    visiting.delete(item);
  }
  walk(value, 0);
}
function validateRequest(input) {
  if (!isRecord(input)) throw failure('INVALID_REQUEST', 'Use a named request with an object payload.');
  assertJson(input);
  if (Object.keys(input).some(name => !['method', 'payload'].includes(name)) || !allowedMethods.has(input.method) || (input.payload !== undefined && !isRecord(input.payload))) throw failure('INVALID_REQUEST', 'This desktop request is not supported.');
  const canonical = JSON.stringify({ method: input.method, payload: input.payload ?? {} });
  if (Buffer.byteLength(canonical) > MAX_REQUEST_BYTES) throw failure('REQUEST_TOO_LARGE', 'The desktop request exceeds the size limit.');
  return JSON.parse(canonical);
}
function assertTrustedSender(event, contents) {
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame || event.senderFrame?.url !== TRUSTED_DOCUMENT) throw failure('UNTRUSTED_SENDER', 'Request sender is not trusted.');
}
function publicError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'The desktop request failed.' };
}
module.exports = Object.freeze({ REQUEST_CHANNEL, STATUS_CHANNEL, TRUSTED_DOCUMENT, MAX_REQUEST_BYTES, METHODS, validateRequest, assertTrustedSender, publicError });
