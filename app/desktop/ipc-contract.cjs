'use strict';

const REQUEST_CHANNEL = 'chausar:request';
const STATUS_CHANNEL = 'chausar:engine-status';
const TRUSTED_DOCUMENT = 'chausar://app/index.html';
const MAX_REQUEST_BYTES = 2_000_000;
const METHODS = Object.freeze([
  'ui.context',
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.backup', 'workspace.export', 'workspace.delete',
  'workspace.backup.v2.create', 'workspace.backup.v2.read', 'workspace.backup.v2.restoreInert', 'workspace.backup.v2.readRestored', 'workspace.backup.v2.inspectRestored', 'workspace.backup.v2.diagnostics',
  'workspace.activation.target.create', 'workspace.activation.target.get', 'workspace.backup.activation.prepare', 'workspace.backup.activation.inspect', 'workspace.activation.review', 'workspace.activation.execute', 'workspace.activation.get',
  'workspace.interchange.export', 'workspace.interchange.prepare', 'workspace.interchange.review', 'workspace.interchange.discard', 'workspace.interchange.diagnostics',
  'trials.create', 'trials.evaluate', 'trials.get', 'trials.receiptContext', 'trials.list', 'trials.savedQuestions', 'trials.discard', 'trials.impact', 'trials.promote',
  'scenarios.create', 'scenarios.beginRun', 'scenarios.changeAssumption', 'scenarios.addAnalysis', 'scenarios.evaluate', 'scenarios.finalize', 'scenarios.reopen', 'scenarios.discover', 'scenarios.recompute',
  'auth.invite', 'auth.accept', 'auth.session', 'auth.revoke', 'auth.sessions',
  'phone.invite', 'phone.sessions', 'phone.revoke', 'phone.conversation.offer',
  'sync.status', 'sync.identity', 'sync.enable', 'sync.trust', 'sync.preview', 'sync.approve', 'sync.push', 'sync.pull',
  'sync.writer.status', 'sync.writer.review', 'sync.reconcile',
  'dashboard.get', 'conversation.ask', 'conversation.history', 'conversation.get', 'conversation.continuation', 'conversation.synthesis.preview', 'conversation.synthesis.run', 'business.context.receipt', 'business.profile.record', 'business.profile.history', 'business.profile.remove', 'calculation.run', 'receipts.get',
  'answers.recovery.review', 'answers.recovery.prepare', 'answers.recovery.execute', 'answers.recovery.get', 'answers.recovery.list',
  'analysis.bridge.publish', 'analysis.bridge.profiles', 'analysis.bridge.run', 'analysis.bridge.get',
  'investigations.create', 'investigations.get', 'investigations.list', 'investigations.advance', 'investigations.resume', 'investigations.pause', 'investigations.revise', 'investigations.cancel', 'investigations.capsule', 'investigations.drilldown', 'research.search',
  'sources.list', 'sources.delete', 'sources.preview', 'sources.import', 'sources.catalogue', 'sources.groups', 'sources.fetch', 'sources.recipe', 'sources.accept', 'sources.workbook', 'sources.workbookPreview', 'sources.workbookImport',
  'connectors.profiles', 'connectors.read', 'connectors.reviewMapping', 'connectors.capture', 'connectors.publish', 'connectors.ready', 'connectors.captureStatus', 'connectors.releaseRead',
  'ontology.packs', 'ontology.get', 'ontology.publish', 'memory.list', 'memory.correct', 'memory.merge', 'memory.undo', 'memory.precedence', 'memory.lessons', 'memory.decideLesson',
  'decisions.list', 'decisions.create', 'decisions.review',
  'decisions.journal.draft', 'decisions.journal.confirm', 'decisions.journal.revise', 'decisions.journal.review', 'decisions.journal.due',
  'reports.get', 'reports.brief', 'reports.forecast',
  'forecasts.evaluate', 'forecasts.get', 'alerts.create', 'alerts.publish', 'alerts.evaluate', 'alerts.list', 'alerts.get',
  'actions.list', 'actions.catalogue', 'actions.prepare', 'actions.approve', 'actions.revise', 'actions.execute', 'actions.reconcile',
  'jobs.list', 'jobs.types', 'jobs.create', 'jobs.amend', 'jobs.cancel', 'jobs.reconcile', 'jobs.progress', 'jobs.pause', 'jobs.resume', 'jobs.accept', 'jobs.approve', 'jobs.reject', 'jobs.run',
  'jobs.calendar.preview', 'jobs.calendar.configure', 'jobs.calendar.pause', 'jobs.calendar.resume',
  'invoiceFollowUp.create', 'invoiceFollowUp.consent.record', 'invoiceFollowUp.run', 'invoiceFollowUp.read', 'invoiceFollowUp.reconcile',
  'invoiceFollowUp.pause', 'invoiceFollowUp.resume', 'invoiceFollowUp.cancel', 'invoiceFollowUp.approve', 'invoiceFollowUp.accept', 'invoiceFollowUp.reject',
  'invoiceFollowUp.reminder.approve', 'invoiceFollowUp.reminder.execute', 'invoiceFollowUp.reminder.reconcile', 'invoiceFollowUp.reminder.cancel',
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
function assertTrustedSender(event, contents, document = TRUSTED_DOCUMENT) {
  let trusted = false;
  try {
    const selected = new URL(document), actual = new URL(event?.senderFrame?.url);
    trusted = ['chausar://app/index.html', 'chausar://app/ui/index.html'].includes(document)
      && actual.protocol === selected.protocol && actual.host === selected.host
      && actual.pathname === selected.pathname && actual.search === '';
  } catch {}
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame || !trusted) throw failure('UNTRUSTED_SENDER', 'Request sender is not trusted.');
}
function publicError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'The desktop request failed.' };
}
module.exports = Object.freeze({ REQUEST_CHANNEL, STATUS_CHANNEL, TRUSTED_DOCUMENT, MAX_REQUEST_BYTES, METHODS, validateRequest, assertTrustedSender, publicError });
