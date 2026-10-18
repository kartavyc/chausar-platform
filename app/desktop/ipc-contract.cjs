'use strict';

const REQUEST_CHANNEL = 'chausar:request';
const STATUS_CHANNEL = 'chausar:engine-status';
const TRUSTED_DOCUMENT = 'chausar://app/index.html';
const MAX_REQUEST_BYTES = 2_000_000;
const METHODS = Object.freeze([
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.backup', 'workspace.export', 'workspace.delete',
  'workspace.backup.v2.create', 'workspace.backup.v2.read', 'workspace.backup.v2.restoreInert', 'workspace.backup.v2.readRestored', 'workspace.backup.v2.inspectRestored', 'workspace.backup.v2.diagnostics',
  'workspace.activation.target.create', 'workspace.activation.target.get', 'workspace.backup.activation.prepare', 'workspace.backup.activation.inspect', 'workspace.activation.review', 'workspace.activation.execute', 'workspace.activation.get',
  'workspace.interchange.export', 'workspace.interchange.prepare', 'workspace.interchange.review', 'workspace.interchange.discard', 'workspace.interchange.diagnostics',
  'trials.create', 'trials.evaluate', 'trials.get', 'trials.receiptContext', 'trials.list', 'trials.savedQuestions', 'trials.discard', 'trials.impact', 'trials.promote',
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
  'ontology.packs', 'ontology.get', 'ontology.publish', 'memory.list', 'memory.correct', 'memory.merge', 'memory.undo', 'memory.precedence',
  'decisions.list', 'decisions.create', 'decisions.review',
  'decisions.journal.draft', 'decisions.journal.confirm', 'decisions.journal.revise', 'decisions.journal.review', 'decisions.journal.due',
  'reports.get', 'reports.brief', 'reports.forecast',
  'forecasts.evaluate', 'forecasts.get', 'alerts.create', 'alerts.publish', 'alerts.evaluate', 'alerts.list', 'alerts.get',
  'actions.list', 'actions.catalogue', 'actions.prepare', 'actions.approve', 'actions.revise', 'actions.execute', 'actions.reconcile',
  'jobs.list', 'jobs.types', 'jobs.create', 'jobs.amend', 'jobs.cancel', 'jobs.reconcile', 'jobs.progress', 'jobs.pause', 'jobs.resume', 'jobs.accept', 'jobs.approve', 'jobs.reject', 'jobs.run',
  'jobs.calendar.preview', 'jobs.calendar.configure', 'jobs.calendar.pause', 'jobs.calendar.resume',
  'trust.get', 'trust.update', 'members.list', 'members.add', 'members.revoke',
  'models.list', 'models.configure', 'models.preview', 'models.approve', 'models.test',
  'speech.list', 'speech.configure', 'speech.preview', 'speech.approve', 'speech.transcribe', 'activity.list',
  'learning.list', 'learning.log', 'learning.preview', 'learning.consent', 'learning.sharing', 'learning.share',
  'plugins.list', 'plugins.install', 'plugins.enable', 'plugins.disable', 'plugins.remove', 'plugins.run', 'plugins.miniapp',
  'mcp.info', 'mcp.handle', 'helpers.run', 'updates.status', 'updates.verify', 'updates.stage',
  'venture.countries', 'venture.preview', 'venture.create', 'venture.get', 'venture.events', 'venture.interview.next',
  'venture.interview.answer', 'venture.blueprint.draft', 'venture.blueprint.get', 'venture.blueprint.update', 'venture.blueprint.accept', 'venture.models.presets',
  'venture.models.connect', 'venture.models.disconnect', 'venture.models.status', 'venture.models.calls', 'venture.price.quote', 'venture.receipt.get',
  'venture.client.add', 'venture.client.list', 'venture.order.create', 'venture.order.list', 'venture.order.deliver', 'venture.invoice.prepare',
  'venture.invoice.issue', 'venture.invoice.get', 'venture.invoice.list', 'venture.payment.record', 'venture.books.summary', 'venture.build.brief',
  'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status', 'venture.connectors.list',
  'venture.delivery.playbook', 'venture.simulation.scenarios', 'venture.simulation.run', 'venture.simulation.get', 'venture.simulation.fromSignal', 'venture.launch.status',
  'venture.launch.advance', 'venture.delivery.run', 'venture.delivery.approve', 'venture.delivery.review', 'venture.delivery.list', 'venture.capabilities',
  'venture.files.add', 'venture.files.list', 'venture.delivery.answer', 'venture.work.get', 'venture.improve.status', 'venture.improve.run', 'venture.improve.get', 'venture.improve.adopt', 'venture.delivery.delegate',
  'venture.delegate.get',
]);
const allowedMethods = new Set(METHODS);
const OPEN_EXTERNAL_CHANNEL = 'chausar:open-external';
// A frozen copy of EXTERNAL_ORIGINS in platform/runtime/venture/contracts.ts, same order.
const EXTERNAL_ORIGINS = Object.freeze([
  'https://lovable.dev', 'https://replit.com', 'https://bolt.new', 'https://v0.app', 'https://github.com',
  'https://vercel.com', 'https://www.netlify.com', 'https://www.cloudflare.com', 'https://porkbun.com', 'https://www.namecheap.com',
  'https://razorpay.com', 'https://www.cashfree.com', 'https://stripe.com', 'https://www.paypal.com', 'https://www.lemonsqueezy.com',
  'https://www.paddle.com', 'https://dodopayments.com', 'https://workspace.google.com', 'https://www.zoho.com', 'https://resend.com',
  'https://postmarkapp.com', 'https://cal.com', 'https://calendly.com', 'https://calendar.google.com', 'https://www.hubspot.com',
  'https://attio.com', 'https://business.whatsapp.com', 'https://telegram.org', 'https://slack.com', 'https://discord.com',
  'https://www.notion.com', 'https://drive.google.com', 'https://linear.app', 'https://www.airtable.com', 'https://www.linkedin.com',
  'https://x.com', 'https://www.instagram.com', 'https://www.facebook.com', 'https://ads.google.com', 'https://buffer.com',
  'https://tallysolutions.com', 'https://www.xero.com', 'https://quickbooks.intuit.com', 'https://www.mca.gov.in', 'https://www.gst.gov.in',
  'https://documenso.com', 'https://www.docusign.com', 'https://www.firstbase.io', 'https://posthog.com', 'https://plausible.io',
  'https://analytics.google.com', 'https://tally.so', 'https://www.typeform.com', 'https://console.anthropic.com', 'https://platform.openai.com',
]);
const MAX_EXTERNAL_URL = 30_000;
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
// The only links the app opens in the system browser: one https partner link from a user click.
function validateExternalUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_EXTERNAL_URL) throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.');
  let url;
  try { url = new URL(input); } catch { throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.'); }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.');
  if (!EXTERNAL_ORIGINS.includes(url.origin)) throw failure('EXTERNAL_URL_NOT_ALLOWED', 'Chausar opens only its listed partner sites.');
  return url.href;
}
function publicError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'The desktop request failed.' };
}
module.exports = Object.freeze({ REQUEST_CHANNEL, STATUS_CHANNEL, TRUSTED_DOCUMENT, MAX_REQUEST_BYTES, METHODS, OPEN_EXTERNAL_CHANNEL, EXTERNAL_ORIGINS, validateRequest, validateExternalUrl, assertTrustedSender, publicError });
