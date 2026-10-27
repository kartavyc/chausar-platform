'use strict';

const REQUEST_CHANNEL = 'chausar:request';
const STATUS_CHANNEL = 'chausar:engine-status';
// Run events pushed to the window (VentureRunEvent in platform/runtime/venture/contracts.ts). The preload checks them again.
const VENTURE_EVENT_CHANNEL = 'chausar:venture-event';
const VENTURE_EVENT_TYPES = Object.freeze([
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  // Ink v2 wave 4 (VENTURE_RUN_EVENT_TYPES): ids only; notify.new also carries a count.
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  // Ink v2 wave 5 (5-0): an order's chain, a playbook desk's records and an idea changed; ids only.
  'chain.changed', 'desk.changed', 'idea.changed',
]);
// Ink v2 wave 4 channel (package 4-0 named it): the desktop reads one of the owner's network files on this computer in a
// worker and hands the window only what Chausar keeps (4D1, network-files.cjs). The count of things that need the owner
// reaches the window and the tray on notify.new alone (4G3), so it has no channel of its own.
const PICK_FILE_CHANNEL = 'chausar:network:pickFile';
// 4J4 (P12): the desktop asks the engine for one month's CSV for the owner's CA and saves it where the owner picks
// (money-export.cjs); the window names only the month. Chausar never sends the file.
const MONEY_EXPORT_CHANNEL = 'chausar:money:saveExport';
// Ink v2 wave 5 (5A5, P11): the desktop makes a client report and saves its files where the owner picks (report-save.cjs);
// the window names only the draft. Chausar never sends the files.
const REPORT_SAVE_CHANNEL = 'chausar:report:save';
const TRUSTED_DOCUMENT = 'chausar://app/index.html';
const MAX_REQUEST_BYTES = 2_000_000;
const METHODS = Object.freeze([
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.backup', 'workspace.export', 'workspace.delete',
  'workspace.custody.get', 'workspace.list', 'workspace.backups.list', 'workspace.transfer.import', 'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export', 'workspace.custody.neverContactReset',
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
  'venture.countries', 'venture.preview',
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls', 'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
  'venture.create', 'venture.get', 'venture.events', 'venture.interview.next',
  'venture.interview.answer', 'venture.blueprint.draft', 'venture.blueprint.get', 'venture.blueprint.update', 'venture.blueprint.accept', 'venture.models.presets',
  'venture.models.connect', 'venture.models.disconnect', 'venture.models.status', 'venture.models.calls', 'venture.price.quote', 'venture.receipt.get',
  'venture.client.add', 'venture.client.list', 'venture.order.create', 'venture.order.list', 'venture.order.deliver', 'venture.invoice.prepare',
  'venture.invoice.issue', 'venture.invoice.get', 'venture.invoice.list', 'venture.payment.record', 'venture.books.summary', 'venture.spend.list', 'venture.build.brief',
  'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status', 'venture.connectors.list',
  'venture.delivery.playbook', 'venture.simulation.scenarios', 'venture.simulation.run', 'venture.simulation.get', 'venture.simulation.fromSignal', 'venture.launch.status',
  'venture.launch.advance', 'venture.delivery.run', 'venture.delivery.approve', 'venture.delivery.review', 'venture.delivery.list', 'venture.capabilities',
  'venture.files.add', 'venture.files.list', 'venture.delivery.answer', 'venture.work.get', 'venture.improve.status', 'venture.improve.run', 'venture.improve.get', 'venture.improve.adopt', 'venture.delivery.delegate',
  'venture.delegate.get',
  'venture.queue.list', 'venture.queue.decide', 'venture.runs.list', 'venture.runs.get', 'venture.team.list', 'venture.team.gate',
  'venture.evidence.list', 'venture.evidence.apply',
  'venture.journal.list', 'venture.journal.resolve',
  'venture.untrusted.mode', 'venture.untrusted.release',
  'venture.bank.import', 'venture.bank.consent', 'venture.site.stage', 'venture.site.apply', 'venture.site.revert',
  'venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend',
  'venture.spend.policy.get', 'venture.spend.policy.set',
  'venture.queue.view', 'venture.team.posture', 'venture.evidence.dismiss', 'venture.money.overview', 'venture.tax.working',
  'venture.ca.get', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
  'venture.leads.block', 'venture.share.create', 'venture.share.list', 'venture.share.revoke',
  'venture.delivery.judge', 'venture.delivery.judgeSend', 'venture.improve.rollback', 'venture.files.transcribe',
  'venture.posting.propose', 'venture.posting.signIn', 'venture.posting.checkSteps', 'venture.share.recordAnswer', 'venture.social.calendar',
  'venture.bank.ledger', 'venture.bank.apply', 'venture.bank.alerts.get', 'venture.bank.alerts.set',
  'venture.ca.receipt', 'venture.ca.explainDiff', 'venture.rules.list',
  'venture.judge.auto.get', 'venture.judge.auto.set',
  'venture.posting.limits.get', 'venture.posting.limits.set',
  'venture.transcription.get', 'venture.transcription.set',
  // Ink v2 wave 4 (W4_METHODS in platform/runtime/venture/contracts.ts, same order)
  'venture.team.keeper', 'venture.team.clearQuarantine',
  'venture.agents.thread.list', 'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo',
  'venture.agents.orders.list', 'venture.chats.consent',
  'venture.agents.notes.list', 'venture.agents.notes.edit', 'venture.agents.notes.forget', 'venture.agents.notes.undo',
  'venture.chief.threads', 'venture.chief.thread.list', 'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.chief.fit',
  'venture.proposals.raise', 'venture.proposals.dismiss',
  'venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget',
  'venture.network.hide', 'venture.network.people', 'venture.network.person', 'venture.network.sources',
  'venture.network.recompute', 'venture.network.know', 'venture.network.link',
  'venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research',
  'venture.pipeline.list', 'venture.pipeline.followups', 'venture.pipeline.add', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.mailbox.sync', 'venture.inbound.list', 'venture.inbound.confirm',
  'venture.network.calendar', 'venture.meeting.digest',
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set', 'venture.away.get',
  'venture.runs.allowWrites',
  'venture.notify.list', 'venture.notify.read', 'venture.notify.settings',
  'venture.notify.push.key', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  'venture.models.cli.status', 'venture.models.roles',
  'venture.goals.get', 'venture.goals.set', 'venture.goals.suggest',
  'venture.decisions.list', 'venture.policy.allowSession',
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.queue.set', 'venture.triage.set', 'venture.triage.preview',
  'venture.delivery.fix', 'venture.delivery.decideChange', 'venture.delivery.changes', 'venture.settings.draft', 'venture.settings.drafts',
  'venture.queue.setPreview', 'venture.delivery.copy',
  'venture.files.poster',
  'venture.money.aging', 'venture.money.flow', 'venture.money.cash', 'venture.money.margins', 'venture.money.export',
  'venture.bills.add', 'venture.bills.pay', 'venture.bills.list', 'venture.credit.issue', 'venture.invoice.recurring', 'venture.invoice.recurringList',
  'venture.invoice.remind', 'venture.payment.clear', 'venture.bills.stop',
  'venture.money.across', 'venture.runs.across',
  'venture.connectors.check', 'venture.share.request',
  'venture.playbooks.list', 'venture.blueprint.suggest',
  'venture.owner.get', 'venture.owner.set',
  'venture.receipt.verify', 'venture.journal.chain', 'venture.journal.acceptBreak',
  'venture.order.contract', 'venture.order.contract.propose', 'venture.order.contract.sign',
  'venture.routines.list', 'venture.routines.runs', 'venture.routines.set', 'venture.routines.remove',
  'venture.options.rerank',
  'venture.drills.run', 'venture.drills.list', 'venture.auto.readiness', 'venture.shadow.summary',
  'venture.playbook.guidance',
  'venture.voice.get', 'venture.voice.set', 'venture.voice.learn', 'venture.persona.get', 'venture.persona.set', 'venture.persona.test',
  'venture.agents.export', 'venture.agents.import',
  'venture.knowledge.list', 'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test',
  'venture.ideas.list', 'venture.ideas.start', 'venture.ideas.dismiss', 'venture.agents.capabilities',
  // Ink v2 wave 5 (W5_METHODS in platform/runtime/venture/contracts.ts, same order)
  'venture.order.chain',
  'venture.salesProposal.draft', 'venture.salesProposal.get', 'venture.goNoGo.card', 'venture.goNoGo.list',
  'venture.ideas.add', 'venture.ideas.move', 'venture.ideas.grade',
  'venture.brandKit.get', 'venture.brandKit.set', 'venture.assets.list', 'venture.assets.rerun', 'venture.assets.reuse',
  'venture.voiceConsent.record', 'venture.voiceConsent.revoke', 'venture.voiceConsent.list',
  'venture.report.render', 'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable', 'venture.report.list',
  'venture.monitors.list', 'venture.monitors.add', 'venture.monitors.remove', 'venture.mail.import', 'venture.mail.threads',
  'venture.localApps.list', 'venture.webhook.set', 'venture.speechOut.providers',
  'venture.ca.confirmCitations', 'venture.ca.signoff.get', 'venture.ca.differential.add', 'venture.ca.dataPack.export',
  'venture.desk.list', 'venture.desk.get', 'venture.desk.act',
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
  'https://x.com', 'https://www.instagram.com', 'https://www.facebook.com', 'https://ads.google.com', 'https://buffer.com', 'https://wa.me',
  'https://www.youtube.com', 'https://studio.youtube.com',
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
// The Ink app routes with the hash (#/today), which changes the frame's URL but not the document; a query still fails.
const documentOf = url => typeof url === 'string' && /^[^#]*#\/[A-Za-z0-9/?=&%:._-]*$/.test(url) ? url.slice(0, url.indexOf('#')) : url;
/** True for the app's own page, with or without an Ink '#/' route. main.cjs uses it for the clipboard permission too. */
function isTrustedDocument(url) { return documentOf(url) === TRUSTED_DOCUMENT; }
function assertTrustedSender(event, contents) {
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame || !isTrustedDocument(event.senderFrame?.url)) throw failure('UNTRUSTED_SENDER', 'Request sender is not trusted.');
}
// 4E2: a mail handoff opens the owner's own mail app with one address, a subject and a body filled in; nothing else
// (no second address, no cc or bcc, no attachment, no header slipped in with a line break) and the owner presses send
// there. The link is read field by field from the text as given (a broken escape refuses it), then rebuilt with each
// field encoded again, and the rebuilt link is the one opened: the engine's handoff (network/handoff.ts) spells it the same.
const MAILTO_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
// Any control character (NUL, tab, CR and LF among them), next line, line separator or paragraph separator: a header
// break in some mail app, so never in the address or the subject. The body keeps its CRLF line breaks.
const MAILTO_BREAKS = /[\p{Cc}\u0085\u2028\u2029]/u;
function rebuiltMailto(input) {
  const decode = value => { try { return decodeURIComponent(value); } catch { return null; } };
  const rest = input.replace(/^mailto:/i, '');
  const mark = rest.indexOf('?');
  const rawAddress = mark < 0 ? rest : rest.slice(0, mark), rawQuery = mark < 0 ? '' : rest.slice(mark + 1);
  if (rest.includes('#')) return null;
  const address = decode(rawAddress);
  if (address === null || MAILTO_BREAKS.test(address) || !MAILTO_ADDRESS.test(address)) return null;
  const fields = {};
  for (const pair of rawQuery ? rawQuery.split('&') : []) {
    const equals = pair.indexOf('=');
    if (equals < 0) return null;
    const key = pair.slice(0, equals), value = decode(pair.slice(equals + 1));
    if ((key !== 'subject' && key !== 'body') || Object.hasOwn(fields, key) || value === null) return null;
    if (key === 'subject' && MAILTO_BREAKS.test(value)) return null;
    fields[key] = value;
  }
  const query = ['subject', 'body'].filter(key => Object.hasOwn(fields, key)).map(key => `${key}=${encodeURIComponent(fields[key])}`).join('&');
  return `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}${query ? `?${query}` : ''}`;
}
// The only links the app opens in the system browser: one https partner link from a user click, or one mail handoff.
function validateExternalUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_EXTERNAL_URL) throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.');
  let url;
  try { url = new URL(input); } catch { throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.'); }
  if (url.protocol === 'mailto:') {
    const rebuilt = rebuiltMailto(input);
    if (rebuilt === null || rebuilt.length > MAX_EXTERNAL_URL) throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.');
    return rebuilt;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw failure('INVALID_EXTERNAL_URL', 'Use one partner link.');
  if (!EXTERNAL_ORIGINS.includes(url.origin)) throw failure('EXTERNAL_URL_NOT_ALLOWED', 'Chausar opens only its listed partner sites.');
  return url.href;
}
function publicError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'The desktop request failed.' };
}
// A run event from the engine worker, cut down to its plain fields (seq when present, count on notify.new only); null
// when anything is off.
function validateVentureEvent(input) {
  if (!isRecord(input) || !VENTURE_EVENT_TYPES.includes(input.type)) return null;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  if (!id(input.businessId) || (input.runId !== undefined && !id(input.runId))) return null;
  if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input.at)) return null;
  if ((input.seq !== undefined && !whole(input.seq)) || (input.count !== undefined && (input.type !== 'notify.new' || !whole(input.count)))) return null;
  return Object.freeze({
    type: input.type, businessId: input.businessId, ...(input.runId !== undefined ? { runId: input.runId } : {}), at: input.at,
    ...(input.seq !== undefined ? { seq: input.seq } : {}), ...(input.count !== undefined ? { count: input.count } : {}),
  });
}
module.exports = Object.freeze({ REQUEST_CHANNEL, STATUS_CHANNEL, VENTURE_EVENT_CHANNEL, PICK_FILE_CHANNEL, MONEY_EXPORT_CHANNEL, REPORT_SAVE_CHANNEL, TRUSTED_DOCUMENT, MAX_REQUEST_BYTES, METHODS, OPEN_EXTERNAL_CHANNEL, EXTERNAL_ORIGINS, validateRequest, validateExternalUrl, assertTrustedSender, isTrustedDocument, publicError, validateVentureEvent });
