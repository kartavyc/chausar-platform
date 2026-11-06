'use strict';

const REQUEST_CHANNEL = 'chausar:request';
const STATUS_CHANNEL = 'chausar:engine-status';
const { WINDOW_PHASES } = require('./diagnostics.cjs');
// Run events pushed to the window (VentureRunEvent in platform/runtime/venture/contracts.ts). The preload checks them again.
const VENTURE_EVENT_CHANNEL = 'chausar:venture-event';
const VENTURE_EVENT_TYPES = Object.freeze([
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  // Ink v2 wave 4 (VENTURE_RUN_EVENT_TYPES): ids only; notify.new also carries a count.
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  // Ink v2 wave 5 (5-0): an order's chain, a playbook desk's records and an idea changed; ids only.
  'chain.changed', 'desk.changed', 'idea.changed', 'privacy.forgotten',
  // One-shot C3 task 9: which step long work is on. No seq; its own fields; businessId '' before a business is open.
  'work.step',
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
// One-shot A5 (founder answer 5): onboarding and Settings read start at login and keep running (background.cjs's state,
// the login item read back from the computer) and change either; the window sends only the two ticks.
const BACKGROUND_GET_CHANNEL = 'chausar:background:get';
const BACKGROUND_SET_CHANNEL = 'chausar:background:set';
// A5 fix round 3: the day the owner put Today's start-at-login question aside; it changes nothing else.
const BACKGROUND_LATER_GET_CHANNEL = 'chausar:background:later:get';
const BACKGROUND_LATER_SET_CHANNEL = 'chausar:background:later:set';
// C5 task 26: the window says once that it has painted; the start-up timeline's last step (main.cjs).
const FIRST_PAINT_CHANNEL = 'chausar:first-paint';
// C5 task 27: Export diagnostics. The window reads what's inside, with crash files only when ticked, then saves that preview by its id.
const DIAGNOSTICS_PREVIEW_CHANNEL = 'chausar:diagnostics:preview';
const DIAGNOSTICS_SAVE_CHANNEL = 'chausar:diagnostics:save';
// C5 task 32: Show installer: the window names only which release; main checks it again and shows it in the file manager.
const UPDATE_SHOW_CHANNEL = 'chausar:updates:showInstaller';
const UPDATE_GO_BACK_CHANNEL = 'chausar:updates:goBack';
const UPDATE_GO_BACK_OFFER_CHANNEL = 'chausar:updates:goBackOffer';
const TRUSTED_DOCUMENT = 'chausar://app/index.html';
const MAX_REQUEST_BYTES = 2_000_000;
const METHODS = require('./ipc-methods.cjs');
const allowedMethods = new Set(METHODS);
const hostMethods = new Set(require('./engine-methods.cjs'));
const OPEN_EXTERNAL_CHANNEL = 'chausar:open-external';
// A frozen copy of EXTERNAL_ORIGINS in platform/runtime/venture/contracts.ts, same order.
const EXTERNAL_ORIGINS = Object.freeze([
  'https://accounts.google.com', 'https://lovable.dev', 'https://replit.com', 'https://bolt.new', 'https://v0.app', 'https://github.com',
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
  'https://wordpress.org', 'https://dash.cloudflare.com', 'https://search.google.com',
  'https://boards.greenhouse.io', 'https://jobs.lever.co', 'https://jobs.ashbyhq.com',
  'https://overpass-api.de', 'https://operations.osmfoundation.org', 'https://developers.google.com',
  'https://redditinc.com', 'https://developer.happenstance.ai',
  // Exact catalogue Visit site origins only; no API permission or wildcard access.
  'https://bsky.app',
  'https://joinmastodon.org',
  'https://developer-docs.amazon.com',
  'https://advertising.amazon.com',
  'https://seller.flipkart.com',
  'https://supplier.meesho.com',
  'https://partners.myntrainfo.com',
  'https://seller.ajio.com',
  'https://seller.nykaa.com',
  'https://seller.jiomart.com',
  'https://apidocs.shiprocket.in',
  'https://help.delhivery.com',
  'https://www.whatsapp.com',
  'https://sorftime.com',
  'https://shopify.dev',
  'https://developer.android.com',
  'https://docs.docker.com',
  // Wave 6 (6C1): the sign-in pages the tools' own logins print (Codex device code; Claude Code's sign-in).
  'https://auth.openai.com', 'https://claude.ai', 'https://claude.com',
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
function validateRequest(input) { return checkedRequest(input, allowedMethods, false); }
/** Main owns its file dialogs. No request field can select this trusted path. */
function validateHostRequest(input) { return checkedRequest(input, hostMethods, true); }
function checkedRequest(input, methods, host) {
  if (!isRecord(input)) throw failure('INVALID_REQUEST', 'Use a named request with an object payload.');
  assertJson(input);
  if (Object.keys(input).some(name => !['method', 'payload'].includes(name)) || !methods.has(input.method) || (input.payload !== undefined && !isRecord(input.payload))) throw failure('INVALID_REQUEST', 'This desktop request is not supported.');
  // One-shot C4 task 36: where an export goes is chosen in main's own save dialog (export-save.cjs), never by the window.
  if (!host && input.method === 'workspace.export' && input.payload && Object.hasOwn(input.payload, 'path')) throw failure('INVALID_REQUEST', 'Choose where to save the copy in the save dialog.');
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
// One-shot A6 (S7): the address may be empty, as the engine leaves it for an invoice to a client with no email on file;
// the owner types it in their mail app. The .eml draft (mail-draft.cjs) reads the same checked fields (mailtoParts).
const MAILTO_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
// Any control character (NUL, tab, CR and LF among them), next line, line separator or paragraph separator: a header
// break in some mail app, so never in the address or the subject. The body keeps its CRLF line breaks.
const MAILTO_BREAKS = /[\p{Cc}\u0085\u2028\u2029]/u;
/** A mail link's fields as given: the address (maybe empty), and the subject and body when present; null when anything is off. */
function mailtoFields(input) {
  if (typeof input !== 'string' || !/^mailto:/i.test(input)) return null;
  const decode = value => { try { return decodeURIComponent(value); } catch { return null; } };
  const rest = input.replace(/^mailto:/i, '');
  const mark = rest.indexOf('?');
  const rawAddress = mark < 0 ? rest : rest.slice(0, mark), rawQuery = mark < 0 ? '' : rest.slice(mark + 1);
  if (rest.includes('#')) return null;
  const address = decode(rawAddress);
  if (address === null || MAILTO_BREAKS.test(address) || (address !== '' && !MAILTO_ADDRESS.test(address))) return null;
  const fields = {};
  for (const pair of rawQuery ? rawQuery.split('&') : []) {
    const equals = pair.indexOf('=');
    if (equals < 0) return null;
    const key = pair.slice(0, equals), value = decode(pair.slice(equals + 1));
    if ((key !== 'subject' && key !== 'body') || Object.hasOwn(fields, key) || value === null) return null;
    if (key === 'subject' && MAILTO_BREAKS.test(value)) return null;
    fields[key] = value;
  }
  // A6 round 1: a link with no address carries at least a subject, so a bare "mailto:" never opens an empty email.
  if (address === '' && !fields.subject) return null;
  return { address, fields };
}
/** A6: the checked address (maybe empty), subject and body of a mail link, or null. */
function mailtoParts(input) {
  const read = mailtoFields(input);
  return read === null ? null : { address: read.address, subject: read.fields.subject ?? '', body: read.fields.body ?? '' };
}
function rebuiltMailto(input) {
  const read = mailtoFields(input);
  if (read === null) return null;
  const { address, fields } = read;
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
/** A5 fix round 3: { day: 'YYYY-MM-DD' } and nothing else. */
function validateLaterDay(input) {
  if (!isRecord(input) || Object.keys(input).length !== 1 || typeof input.day !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.day)) throw failure('INVALID_REQUEST', 'Send the day as YYYY-MM-DD.');
  return input.day;
}
/** A5: one change of start at login or keep running, as true or false; anything else is refused. */
function validateBackgroundChange(input) {
  const keys = isRecord(input) ? Object.keys(input) : [];
  if (keys.length === 0 || keys.some(key => !['startAtLogin', 'keepRunning'].includes(key) || typeof input[key] !== 'boolean')) throw failure('INVALID_REQUEST', 'Change start at login or keep running, as on or off.');
  return { ...(keys.includes('startAtLogin') ? { startAtLogin: input.startAtLogin } : {}), ...(keys.includes('keepRunning') ? { keepRunning: input.keepRunning } : {}) };
}
// B1 fix round 1: `owner: true` (only ever true) says the engine wrote these words for the owner, so the page shows them as sent.
/** D4 task 4: what the window may hear about the engine: a known state, and a known phase while it starts. */
const ENGINE_STATES = Object.freeze(['starting', 'ready', 'failed', 'stopping', 'stopped', 'reconnecting']);
function validateEngineStatus(input) {
  const state = ENGINE_STATES.includes(input?.state) ? input.state : 'failed';
  const status = { state, healthy: state === 'ready' && input?.healthy === true };
  if (state === 'starting' && WINDOW_PHASES.includes(input?.phase)) status.phase = input.phase;
  return Object.freeze(status);
}
function publicError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'The desktop request failed.', ...(error?.owner === true ? { owner: true } : {}) };
}
// A run event from the engine worker, cut down to its plain fields (seq when present, count on notify.new only); null
// when anything is off.
function validateVentureEvent(input) {
  if (!isRecord(input) || !VENTURE_EVENT_TYPES.includes(input.type)) return null;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
  if (input.type === 'work.step') {
    if ((input.businessId !== '' && !id(input.businessId)) || !id(input.workId) || !id(input.kind) || !id(input.step) || !['current', 'done', 'failed'].includes(input.state)) return null;
    if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input.at)) return null;
    if (input.passed !== undefined && typeof input.passed !== 'boolean') return null;
    return Object.freeze({ type: input.type, businessId: input.businessId, workId: input.workId, kind: input.kind, step: input.step, state: input.state, at: input.at, ...(input.passed !== undefined ? { passed: input.passed } : {}) });
  }
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  if (!id(input.businessId) || (input.type !== 'privacy.forgotten' && input.runId !== undefined && !id(input.runId))) return null;
  if (typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input.at)) return null;
  if ((input.seq !== undefined && !whole(input.seq)) || (input.count !== undefined && (input.type !== 'notify.new' || !whole(input.count)))) return null;
  return Object.freeze({
    type: input.type, businessId: input.businessId, ...(input.type !== 'privacy.forgotten' && input.runId !== undefined ? { runId: input.runId } : {}), at: input.at,
    ...(input.seq !== undefined ? { seq: input.seq } : {}), ...(input.count !== undefined ? { count: input.count } : {}),
  });
}
module.exports = Object.freeze({ UPDATE_GO_BACK_CHANNEL, UPDATE_GO_BACK_OFFER_CHANNEL, UPDATE_SHOW_CHANNEL, DIAGNOSTICS_PREVIEW_CHANNEL, DIAGNOSTICS_SAVE_CHANNEL, FIRST_PAINT_CHANNEL, MAILTO_ADDRESS, mailtoParts, REQUEST_CHANNEL, STATUS_CHANNEL, VENTURE_EVENT_CHANNEL, PICK_FILE_CHANNEL, MONEY_EXPORT_CHANNEL, REPORT_SAVE_CHANNEL, BACKGROUND_GET_CHANNEL, BACKGROUND_SET_CHANNEL, validateBackgroundChange, BACKGROUND_LATER_GET_CHANNEL, BACKGROUND_LATER_SET_CHANNEL, validateLaterDay, TRUSTED_DOCUMENT, MAX_REQUEST_BYTES, METHODS, OPEN_EXTERNAL_CHANNEL, EXTERNAL_ORIGINS, validateRequest, validateHostRequest, validateExternalUrl, assertTrustedSender, isTrustedDocument, publicError, validateEngineStatus, validateVentureEvent });
