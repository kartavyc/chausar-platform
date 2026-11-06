// Wave 6 package 6J2 (D47): feedback. Off by default. The owner opts in by the notice's digest, sees exactly what
// would leave in a preview, and only "Send report" (by the preview's digest) sends it: PostHog gets milestones, friction
// counts, AI health, quality and earnings as a range; Sentry gets crash reports scrubbed of names, paths, numbers and
// keys. Never client names, client data, message text, file names, amounts or keys. Short questions after milestones
// carry a fixed answer, never free text. "Delete my reports" asks the Chausar team to delete them (PostHog and Sentry
// only let a project admin delete) and says so; nothing is claimed deleted that was not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import type { InvoiceRecord, PaymentRecord, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contract-values.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { handlers } from '../runtime/venture/core/index.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { noteEngineCrash } from '../runtime/venture/core/feedback.ts';
import { FEEDBACK_NOTICE_DIGEST, earningRange, scrubCrashText, scrubStack } from '../runtime/venture/core/feedback-core.ts';
import { reportProperties } from '../runtime/venture/core/telemetry.ts';
import { CLIENT_NAME, ORDER_REQUEST, code, owner, phone, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
// Built at run time: never a string shaped like a real key in the source.
const PROJECT_KEY = ['fixture', 'posthog', 'project'].join('-');
const SENTRY_PUBLIC = ['fixture', 'sentry', 'public'].join('');
const CONFIG = { posthog: { key: PROJECT_KEY, host: 'https://us.i.posthog.com' }, sentry: { dsn: `https://${SENTRY_PUBLIC}@o1.ingest.sentry.io/42` } };

function fb<T = any>(env: Env, method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, `no core handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

/** The two services as stand-ins: every request is kept; each answers the status it is told to. */
function services(env: Env, status: { posthog?: number; sentry?: number } = {}) {
  const sent: PinnedTarget[] = [];
  env.deps.net = {
    resolve: async () => [{ address: PUBLIC, family: 4 }],
    send: async target => {
      sent.push(target);
      const sentry = target.url.hostname.endsWith('sentry.io');
      const code = sentry ? status.sentry ?? 200 : status.posthog ?? 200;
      return { status: code, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(sentry ? { id: 'x' } : { status: 'Ok' })) };
    },
  };
  return sent;
}

async function ready(env: Env, choice: { usage?: boolean; crashes?: boolean } = {}) {
  (env.deps as { feedback?: unknown }).feedback = CONFIG;
  return fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: choice.usage ?? true, crashes: choice.crashes ?? true });
}

async function seedInvoice(env: Env, clientId: string, orderId: string, beforeTaxMinor: string) {
  const day = env.now().slice(0, 10);
  return ventureAction(env.deps, owner, 'approve', 'seed.invoice', tx => tx.put<InvoiceRecord>({
    ...tx.base('venture-invoice'), number: 'INV-0001', documentTitle: 'INVOICE', orderId, clientId, currency: 'INR', issueDate: day, dueDate: day, dueInDays: 0,
    lines: [], subtotalMinor: beforeTaxMinor, discountMinor: '0', taxMinor: '0', totalMinor: beforeTaxMinor, taxLabel: 'GST', taxRateBps: '0', taxTreatment: 'none' as never,
    taxLines: [], supplierTaxId: null, clientTaxId: null, placeOfSupply: null, sacCode: null, priceReceiptId: 'price_x', status: 'issued', digest: 'd', issuedAt: tx.now,
    factIds: [], booksReceiptId: null, booksNote: null, paidMinor: '0', balanceMinor: beforeTaxMinor,
  }));
}

async function seedPayment(env: Env, invoiceId: string, amountMinor: string) {
  return ventureAction(env.deps, owner, 'approve', 'seed.payment', tx => tx.put<PaymentRecord>({
    ...tx.base('venture-payment'), invoiceId, amountMinor, currency: 'INR', receivedOn: env.now().slice(0, 10), method: 'upi', factId: 'fact_x', booksReceiptId: null, booksNote: null, state: 'cleared',
  }));
}

const text = (value: unknown) => JSON.stringify(value);

test('off by default: no consent, no preview, no question; the build says whether reports are set up', async () => {
  const env = await setup();
  const bare = await fb(env, 'venture.feedback.get');
  assert.deepEqual([bare.consent.given, bare.consent.usage, bare.consent.crashes, bare.preview, bare.question, bare.reportId], [false, false, false, null, null, null]);
  assert.equal(bare.notice.digest, FEEDBACK_NOTICE_DIGEST);
  assert.match(bare.notice.text, /never holds names, client details, message text, file names, amounts or keys/);
  assert.deepEqual([bare.setUp.posthog, bare.setUp.sentry], [false, false]);
  assert.equal(bare.setUp.line, 'Reports are not set up in this build, so nothing can be sent.');
  (env.deps as { feedback?: unknown }).feedback = CONFIG;
  const configured = await fb(env, 'venture.feedback.get');
  assert.deepEqual([configured.setUp.posthog, configured.setUp.sentry], [true, true]);
  assert.equal(text(configured).includes(PROJECT_KEY) || text(configured).includes(SENTRY_PUBLIC), false, 'the view never carries a key');
});

test('opting in is an app-only approval by the notice digest; a changed notice asks again; a random report id, not a name', async () => {
  const env = await setup();
  (env.deps as { feedback?: unknown }).feedback = CONFIG;
  await assert.rejects(fb(env, 'venture.feedback.consent', { digest: 'old', usage: true, crashes: true }), code('APPROVAL_STALE'));
  await assert.rejects(fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: true }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: 'yes', crashes: true }), code('INVALID_VENTURE_REQUEST'));
  const view = await fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: false });
  assert.deepEqual([view.consent.given, view.consent.usage, view.consent.crashes], [true, true, false]);
  assert.match(view.reportId, /^rep_[0-9a-f]{16}$/);
  assert.ok(view.preview, 'a preview once usage is on');
  assert.equal(view.preview.sentry, null, 'crash reports stay off');
});

test('the preview holds only allowlisted counts, steps and ranges: no names, client data, message text, file names, amounts or ids', async () => {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  const { client, order } = await seedOrder(env, blueprint);
  const invoice = await seedInvoice(env, client.id, order.id, '1250000'); // ₹12,500.00 before tax
  await seedPayment(env, invoice.id, '1250000');
  const view = await ready(env);
  const preview = view.preview;
  const body = text(preview);
  for (const secret of [CLIENT_NAME, ORDER_REQUEST, env.venture.workingName, env.venture.idea, 'INV-0001', '12,500', '1250000', client.id, order.id, invoice.id, PROJECT_KEY, 'Pune']) {
    assert.equal(body.includes(secret), false, `the preview carries ${secret}`);
  }
  const report = preview.posthog.events.find((event: any) => event.event === 'chausar_report');
  assert.ok(report);
  assert.equal(report.distinct_id, view.reportId);
  assert.equal(report.properties.invoicedThisMonth, '10k-50k');
  assert.equal(report.properties.receivedThisMonth, '10k-50k');
  assert.equal(report.properties.currency, 'INR');
  assert.equal(report.properties.furthestMilestone, 'first_payment');
  assert.equal(report.properties.$geoip_disable, true);
  const milestones = preview.posthog.events.filter((event: any) => event.event === 'chausar_milestone').map((event: any) => event.properties.milestone);
  assert.deepEqual(milestones, ['business_started', 'plan_accepted', 'first_client', 'first_order', 'first_invoice', 'first_payment']);
  for (const event of preview.posthog.events) {
    for (const [field, value] of Object.entries(event.properties)) assert.ok(['string', 'number', 'boolean'].includes(typeof value), `${event.event}.${field}`);
  }
  assert.equal(preview.posthog.to, 'us.i.posthog.com');
  assert.match(preview.digest, /^[0-9a-f]{64}$/);
});

test('reportProperties keeps only allowlisted, well-shaped fields', () => {
  assert.deepEqual(reportProperties('chausar_report', { furthestMilestone: 'first_invoice', runsFailed30d: 2, invoicedThisMonth: '1k-10k', clientName: CLIENT_NAME, runsStarted30d: -1, currency: 'Rupees' }),
    { furthestMilestone: 'first_invoice', runsFailed30d: 2, invoicedThisMonth: '1k-10k' });
  assert.deepEqual(reportProperties('chausar_milestone', { milestone: 'first_client', note: 'Cafe' }), { milestone: 'first_client' });
  assert.deepEqual(reportProperties('chausar_answer', { question: 'first_invoice', answer: 'It was fine, thanks Ravi' }), { question: 'first_invoice' });
  assert.deepEqual(reportProperties('made_up', { milestone: 'first_client' }), {});
});

test('earnings only as a range, from minor units by code', () => {
  assert.equal(earningRange(0n, 2), 'none');
  assert.equal(earningRange(99_900n, 2), 'under-1k');
  assert.equal(earningRange(100_000n, 2), '1k-10k');
  assert.equal(earningRange(1_250_000n, 2), '10k-50k');
  assert.equal(earningRange(5_000_000n, 2), '50k-200k');
  assert.equal(earningRange(20_000_000n, 2), '200k-plus');
  assert.equal(earningRange(1_500n, 0), '1k-10k');
  assert.equal(earningRange(-5n, 2), 'none');
});

test('crash text is scrubbed of paths, emails, phone numbers, quoted words, names, ids and keys; stack keeps code file names only', () => {
  const key = ['sk', 'ant', 'api03', 'Zx9'.repeat(12)].join('-');
  const message = `Cannot open "Acme Traders invoice.pdf" at C:\\Users\\Kartavy\\Documents\\Acme\\bill.pdf for ravi.kumar@example.com, +91 98765 43210, client_8f2a91c3 with ${key} near Ravi`;
  const clean = scrubCrashText(message);
  for (const leak of ['Acme', 'Kartavy', 'bill.pdf', 'ravi.kumar', '98765', '8f2a91c3', key, 'Ravi', 'Documents']) assert.equal(clean.includes(leak), false, `${leak} in ${clean}`);
  assert.match(clean, /^Cannot open <text> at <path> for <email>/);
  assert.ok(scrubCrashText('x'.repeat(2000)).length <= 300);
  const stack = [
    'TypeError: Cannot read properties of undefined (reading \'name\')',
    '    at buildView (C:\\Users\\Kartavy\\chausar\\platform\\runtime\\venture\\core\\venture.ts:120:14)',
    '    at async Promise.all (index 0)',
    '    at file:///home/ravi/Acme%20Books/report.pdf:1:1',
    '    at Object.<anonymous> (/home/ravi/app/ui/src/places/today/index.tsx:44:9)',
  ].join('\n');
  const frames = scrubStack(stack);
  assert.deepEqual(frames[0], { function: 'buildView', filename: 'venture.ts', lineno: 120, colno: 14, in_app: true });
  assert.ok(frames.some(frame => frame.filename === 'index.tsx'));
  assert.equal(text(frames).includes('ravi') || text(frames).includes('Kartavy') || text(frames).includes('report.pdf') || text(frames).includes('Acme'), false);
});

test('a crash is kept only with crash reports on, scrubbed, and shows in the preview as the exact Sentry event', async () => {
  const env = await setup();
  const off = await fb(env, 'venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'Ravi broke it', stack: '' });
  assert.equal(off.kept, false);
  assert.equal(listRecords(env.store.read(), 'venture-feedback-item').length, 0, 'nothing written while off');
  await ready(env, { usage: false, crashes: true });
  await assert.rejects(fb(env, 'venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'x' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(fb(env, 'venture.feedback.crash', { source: 'somewhere', name: 'TypeError', message: 'x' }), code('INVALID_VENTURE_REQUEST'));
  const kept = await fb(env, 'venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'Cannot read "Cafe Aroma Demo" for Ravi', stack: '    at go (C:\\Users\\Ravi\\x\\app\\ui\\src\\main.tsx:3:4)' });
  assert.equal(kept.kept, true);
  const view = await fb(env, 'venture.feedback.get');
  assert.equal(view.preview.posthog, null, 'usage stays off');
  const [event] = view.preview.sentry.events;
  assert.equal(event.exception.values[0].type, 'TypeError');
  assert.equal(event.exception.values[0].value, 'Cannot read <text> for <word>');
  assert.deepEqual(event.exception.values[0].stacktrace.frames, [{ function: 'go', filename: 'main.tsx', lineno: 3, colno: 4, in_app: true }]);
  assert.equal(event.user.id, view.reportId);
  assert.equal(event.tags.source, 'window');
  assert.match(event.event_id, /^[0-9a-f]{32}$/);
  assert.equal(text(view.preview).includes('Ravi') || text(view.preview).includes('Cafe Aroma'), false);
  assert.equal(view.preview.sentry.to, 'o1.ingest.sentry.io');
});

test('Send report sends exactly the previewed events, by its digest, to PostHog and Sentry, and says what each accepted', async () => {
  const env = await setup();
  const sent = services(env);
  await ready(env);
  await fb(env, 'venture.feedback.crash', { source: 'engine', name: 'RangeError', message: 'Invalid array length' });
  const view = await fb(env, 'venture.feedback.get');
  await assert.rejects(fb(env, 'venture.feedback.send', { digest: 'stale' }), code('APPROVAL_STALE'));
  await assert.rejects(fb(env, 'venture.feedback.send', { digest: view.preview.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(sent.length, 0);
  const after = await fb(env, 'venture.feedback.send', { digest: view.preview.digest });
  assert.equal(sent.length, 2);
  const posthog = sent.find(target => target.url.hostname === 'us.i.posthog.com')!;
  assert.equal(posthog.url.pathname, '/batch/');
  assert.equal(posthog.method, 'POST');
  const batch = JSON.parse(String(posthog.body));
  assert.equal(batch.api_key, PROJECT_KEY);
  assert.deepEqual(batch.batch, view.preview.posthog.events, 'PostHog gets exactly the preview');
  const sentry = sent.find(target => target.url.hostname === 'o1.ingest.sentry.io')!;
  assert.equal(sentry.url.pathname, '/api/42/envelope/');
  assert.match(sentry.headers['x-sentry-auth']!, new RegExp(`sentry_key=${SENTRY_PUBLIC}`));
  const lines = String(sentry.body).split('\n');
  assert.equal(JSON.parse(lines[1]!).type, 'event');
  assert.deepEqual(JSON.parse(lines[2]!), view.preview.sentry.events[0], 'Sentry gets exactly the preview');
  assert.deepEqual([after.lastSend.posthog, after.lastSend.sentry, after.lastSend.accepted], [200, 200, true]);
  // Sent milestones and crashes do not go again; the report snapshot does.
  const next = await fb(env, 'venture.feedback.get');
  assert.equal(next.preview.sentry, null);
  assert.deepEqual(next.preview.posthog.events.map((event: any) => event.event), ['chausar_report']);
  assert.equal(listRecords(env.store.read(), 'venture-feedback-item').filter(item => item.status === 'queued').length, 0);
  assert.equal(text(env.store.read().conversations.filter((record: any) => record.kind === 'venture-feedback-item')).includes('Invalid array length'), false, 'a sent crash keeps no text');
});

test('a refused send keeps what did not go, and says so; nothing goes while off or without keys', async () => {
  const env = await setup();
  const sent = services(env, { sentry: 500 });
  await ready(env);
  await fb(env, 'venture.feedback.crash', { source: 'engine', name: 'Error', message: 'boom' });
  const view = await fb(env, 'venture.feedback.get');
  const after = await fb(env, 'venture.feedback.send', { digest: view.preview.digest });
  assert.deepEqual([after.lastSend.posthog, after.lastSend.sentry, after.lastSend.accepted], [200, 500, false]);
  assert.match(after.lastSend.line, /Sentry did not accept/);
  assert.equal(after.preview.sentry.events.length, 1, 'the crash waits for the next send');
  assert.equal(sent.length, 2);
  await fb(env, 'venture.feedback.consent', { withdraw: true });
  await assert.rejects(fb(env, 'venture.feedback.send', { digest: view.preview.digest }), code('FEEDBACK_OFF'));
  const bare = await setup();
  await fb(bare, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: true });
  const unset = await fb(bare, 'venture.feedback.get');
  await assert.rejects(fb(bare, 'venture.feedback.send', { digest: unset.preview.digest }), code('FEEDBACK_NOT_SET_UP'));
});

test('withdrawing drops what was waiting and keeps the report id for a later deletion request', async () => {
  const env = await setup();
  await ready(env);
  await fb(env, 'venture.feedback.crash', { source: 'window', name: 'Error', message: 'boom' });
  const off = await fb(env, 'venture.feedback.consent', { withdraw: true });
  assert.deepEqual([off.consent.given, off.preview], [false, null]);
  assert.equal(listRecords(env.store.read(), 'venture-feedback-item').filter(item => item.status === 'queued').length, 0);
  assert.equal(text(env.store.read().conversations.filter((record: any) => record.kind === 'venture-feedback-item')).includes('boom'), false);
  assert.match(off.reportId, /^rep_/);
});

test('turning one kind off drops only that kind: crash reports off keeps a waiting answer, usage off keeps a waiting crash', async () => {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  const { client, order } = await seedOrder(env, blueprint);
  await seedInvoice(env, client.id, order.id, '50000');
  await ready(env);
  await fb(env, 'venture.feedback.answer', { questionId: 'first_invoice', answer: 'okay' });
  await fb(env, 'venture.feedback.crash', { source: 'window', name: 'Error', message: 'boom' });
  const usageOnly = await fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: false });
  assert.equal(usageOnly.preview.posthog.events.filter((event: any) => event.event === 'chausar_answer').length, 1, 'the answer stays');
  assert.equal(usageOnly.preview.sentry, null);
  await fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: true });
  await fb(env, 'venture.feedback.crash', { source: 'window', name: 'Error', message: 'boom again' });
  const crashesOnly = await fb(env, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: false, crashes: true });
  assert.equal(crashesOnly.preview.sentry.events.length, 1, 'the crash stays');
  assert.equal(listRecords(env.store.read(), 'venture-feedback-item').filter(item => item.status === 'queued' && item.item === 'answer').length, 0, 'the answer is dropped');
});

test('a short question after a milestone: fixed answers only, asked once, and the answer joins the preview', async () => {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  const { client, order } = await seedOrder(env, blueprint);
  await seedInvoice(env, client.id, order.id, '50000');
  const view = await ready(env);
  assert.equal(view.question.id, 'first_invoice');
  assert.deepEqual(view.question.choices.map((choice: any) => choice.id), ['easy', 'okay', 'hard']);
  await assert.rejects(fb(env, 'venture.feedback.answer', { questionId: 'first_invoice', answer: 'It was fine' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(fb(env, 'venture.feedback.answer', { questionId: 'first_payment', answer: 'easy' }), code('INVALID_VENTURE_REQUEST'));
  const answered = await fb(env, 'venture.feedback.answer', { questionId: 'first_invoice', answer: 'easy' });
  assert.equal(answered.question, null);
  const answers = answered.preview.posthog.events.filter((event: any) => event.event === 'chausar_answer');
  assert.deepEqual(answers.map((event: any) => event.properties), [{ question: 'first_invoice', answer: 'easy', channel: 'test', $geoip_disable: true }]);
  // Skipping asks nothing again and sends nothing.
  await seedPayment(env, listRecords(env.store.read(), 'venture-invoice')[0]!.id, '50000');
  const second = await fb(env, 'venture.feedback.get');
  assert.equal(second.question.id, 'first_payment');
  const skipped = await fb(env, 'venture.feedback.answer', { questionId: 'first_payment', answer: 'skip' });
  assert.equal(skipped.question, null);
  assert.equal(skipped.preview.posthog.events.filter((event: any) => event.event === 'chausar_answer').length, 1);
  // No question while usage reports are off.
  const quiet = await setup();
  await ready(quiet, { usage: false, crashes: true });
  assert.equal((await fb(quiet, 'venture.feedback.get')).question, null);
});

test('Delete my reports: nothing sent means nothing to ask; after a send it asks the team through PostHog and says honestly what happens', async () => {
  const env = await setup();
  const sent = services(env);
  await ready(env);
  const early = await fb(env, 'venture.feedback.delete', {});
  assert.equal(sent.length, 0);
  assert.equal(early.consent.given, false);
  assert.match(early.line, /Nothing had left this computer/);
  const view = await ready(env);
  const firstId = view.reportId;
  await fb(env, 'venture.feedback.send', { digest: view.preview.digest });
  sent.length = 0;
  await assert.rejects(fb(env, 'venture.feedback.delete', {}, phone), code('APP_APPROVAL_REQUIRED'));
  const deleted = await fb(env, 'venture.feedback.delete', {});
  assert.equal(sent.length, 1);
  const request = JSON.parse(String(sent[0]!.body));
  assert.equal(request.batch.length, 1);
  assert.deepEqual([request.batch[0].event, request.batch[0].distinct_id], ['chausar_deletion_requested', firstId]);
  assert.equal(deleted.consent.given, false);
  assert.equal(deleted.deletion.reportId, firstId);
  assert.match(deleted.deletion.line, /only the project owner can delete/);
  assert.doesNotMatch(deleted.deletion.line, /\bdeleted\b/);
  const again = await ready(env);
  assert.notEqual(again.reportId, firstId, 'a new id after a deletion request');
});

test('an engine error the owner never saw is noted as a crash only with crash reports on', async () => {
  const env = await setup();
  await noteEngineCrash(env.deps, owner, new TypeError('Cannot read "Cafe Aroma Demo"'), 'venture.get');
  assert.equal(listRecords(env.store.read(), 'venture-feedback-item').length, 0);
  await ready(env, { usage: false, crashes: true });
  await noteEngineCrash(env.deps, owner, new TypeError('Cannot read "Cafe Aroma Demo"'), 'venture.get');
  const view = await fb(env, 'venture.feedback.get');
  const [event] = view.preview.sentry.events;
  assert.deepEqual([event.tags.source, event.tags.method, event.exception.values[0].value], ['engine', 'venture.get', 'Cannot read <text>']);
});

test('hosted: the same opt-in and preview; the view says where it runs', async () => {
  const env = await setup();
  env.deps.host = 'hosted-web';
  const view = await ready(env);
  assert.equal(view.host, 'hosted-web');
  const report = view.preview.posthog.events.find((event: any) => event.event === 'chausar_report');
  assert.equal(report.properties.channel, 'hosted-web');
});

test('static: the feedback files throw only declared codes and keep the house style', async () => {
  for (const file of ['feedback.ts', 'feedback-core.ts', 'telemetry.ts']) {
    const source = await readFile(new URL(`../runtime/venture/core/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]!), `${file}: ${match[1]}`);
    assert.deepEqual(houseStyleFindings(source), [], file);
  }
});
