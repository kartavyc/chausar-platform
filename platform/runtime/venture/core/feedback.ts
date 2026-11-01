// Chausar venture launcher, core (wave 6, package 6J2, D47): feedback. An opt-in "Send report" the owner previews
// before anything leaves; PostHog for milestones, drop-off, friction counts, AI health, quality and earnings in ranges;
// Sentry for crashes; short questions after milestones; a privacy notice and "Delete my reports". The parts the fake
// engine shares are in feedback-core.ts; the allowlist is telemetry.ts's.
//
// The rules, held by code here:
// - Off by default (no record means off). venture.feedback.consent agrees by the notice's digest, in the app only.
// - Nothing is sent on its own. venture.feedback.get shows the exact events; venture.feedback.send sends exactly those,
//   by the preview's digest, and only the services' own keys are added on the way (PostHog's project key in the body,
//   Sentry's public key in its auth header). Keys come from the host (deps.feedback, from the build's environment),
//   never from a request, a record or a screen.
// - The report is worked out from the business's own records when it is shown: counts, steps reached, ranges. Money is
//   summed by the money module's plans in minor units and only its range leaves.
// - A crash is scrubbed once, when it is noted, and kept only while crash reports are on; after it is sent, or when the
//   owner turns reports off or deletes them, its words are erased.
// - PostHog and Sentry let only a project admin delete data (a personal or auth token the app must never carry). So
//   "Delete my reports" sends one deletion request event under the report id, says honestly that the Chausar team
//   deletes by hand, turns reports off and forgets the id. Nothing is claimed deleted that was not.
import { randomBytes } from 'node:crypto';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type { FeedbackItemRecord, FeedbackSettingRecord, RecordBase, VentureDeps, VentureMethod, VentureRecord } from '../contracts.ts';
import { VENTURE_METHODS } from '../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { guardedFetch } from './net-guard.ts';
import { currencyMinorDigits } from '../../currency.ts';
import { calendarMonth, todayLocal } from '../money/dates.ts';
import { invoicedPlan } from '../money/goal-plans.ts';
import { REPORT_ANSWERS, REPORT_MILESTONES, type ReportMilestone } from './telemetry.ts';
import {
  ANSWER_LABELS, CRASH_QUEUE_LIMIT, CRASH_SOURCES, FEEDBACK_NOTICE_DIGEST, FEEDBACK_NOTICE_TEXT, FEEDBACK_WORDS, QUESTION_MILESTONES, QUESTION_TEXT,
  deletionEvent, deletionLine, earningRange, feedbackPreview, keptCrash, sendLine,
  type CrashSource, type FeedbackCrashKept, type FeedbackPreview, type FeedbackView, type ReportEvent, type SentryEvent,
} from './feedback-core.ts';

/** What the host gives the engine for reports (VentureDeps.feedback), read from the build's environment by host-env.ts. */
export type FeedbackPort = {
  posthog?: { key: string; host: string };
  sentry?: { dsn: string };
  /** The app's version (x.y.z) and the computer's system, each reported as a fixed word. */
  appVersion?: string;
  os?: 'windows' | 'linux' | 'mac' | 'other';
};

type Services = {
  posthog: { key: string; url: URL } | null;
  sentry: { key: string; url: URL; host: string } | null;
};

const portOf = (deps: VentureDeps): FeedbackPort | undefined => (deps as { feedback?: FeedbackPort }).feedback;

/** The configured services, checked: an https PostHog host and a Sentry DSN with its public key and project. */
function services(deps: VentureDeps): Services {
  const port = portOf(deps);
  let posthog: Services['posthog'] = null;
  let sentry: Services['sentry'] = null;
  try {
    if (port?.posthog && typeof port.posthog.key === 'string' && port.posthog.key.length >= 8) {
      const host = new URL(port.posthog.host);
      if (host.protocol === 'https:') posthog = { key: port.posthog.key, url: new URL('/batch/', host.origin) };
    }
  } catch { posthog = null; }
  try {
    if (port?.sentry && typeof port.sentry.dsn === 'string') {
      const dsn = new URL(port.sentry.dsn);
      const project = dsn.pathname.split('/').filter(Boolean).pop() ?? '';
      if (dsn.protocol === 'https:' && dsn.username && /^\d+$/.test(project)) {
        const prefix = dsn.pathname.slice(0, dsn.pathname.lastIndexOf('/'));
        sentry = { key: decodeURIComponent(dsn.username), url: new URL(`${prefix}/api/${project}/envelope/`, dsn.origin), host: dsn.hostname };
      }
    }
  } catch { sentry = null; }
  return { posthog, sentry };
}

type SettingBody = Omit<FeedbackSettingRecord, keyof RecordBase<'venture-feedback-setting'>>;
const DEFAULTS: SettingBody = {
  consentDigest: null, consentAt: null, usage: false, crashes: false, reportId: null, milestonesSent: [], asked: [],
  sentAny: false, lastSend: null, deletion: null,
};

function settingOf(state: State, ventureId: string): FeedbackSettingRecord | null {
  return listRecords(state, 'venture-feedback-setting', ventureId).at(-1) ?? null;
}
function bodyOf(setting: FeedbackSettingRecord | null): SettingBody {
  if (!setting) return structuredClone(DEFAULTS);
  const { id: _id, kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, ...body } = setting;
  return structuredClone(body);
}
const consented = (setting: FeedbackSettingRecord | null) => !!setting && setting.consentDigest === FEEDBACK_NOTICE_DIGEST && (setting.usage || setting.crashes);
const queued = (state: State, ventureId: string) => listRecords(state, 'venture-feedback-item', ventureId).filter(item => item.status === 'queued');
const newReportId = () => `rep_${randomBytes(8).toString('hex')}`;
const channelOf = (deps: VentureDeps) => (['desktop', 'hosted-web', 'local-web'].includes(deps.host) ? deps.host : 'test');

// ---------------------------------------------------------------------------
// What the report says, worked out from the business's records
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const FINISHED = new Set(['ready-for-review', 'accepted', 'edited', 'rejected']);

/** The milestones this business reached, in order. */
function milestonesOf(state: State, venture: VentureRecord): ReportMilestone[] {
  const id = venture.id;
  const reached: Record<ReportMilestone, boolean> = {
    business_started: true,
    plan_accepted: !!venture.acceptedBlueprintId,
    ai_connected: listRecords(state, 'venture-model-connection', id).some(row => row.status === 'connected' && row.routeKind !== 'template')
      || listRecords(state, 'venture-model-call', id).some(row => row.status === 'completed' && row.routeKind !== 'template')
      || listRecords(state, 'venture-delivery-run', id).some(row => !!row.agentJob),
    first_client: listRecords(state, 'venture-client', id).length > 0,
    first_order: listRecords(state, 'venture-order', id).length > 0,
    first_job_done: listRecords(state, 'venture-delivery-run', id).some(row => row.status === 'accepted' || row.status === 'edited'),
    first_invoice: listRecords(state, 'venture-invoice', id).some(row => row.number !== null && row.status !== 'void'),
    first_payment: listRecords(state, 'venture-payment', id).length > 0,
  };
  return REPORT_MILESTONES.filter(milestone => reached[milestone]);
}

/** The AI the business uses, as a fixed word: the newest connected route. */
function aiRouteOf(state: State, venture: VentureRecord): 'codex' | 'claude-code' | 'api-key' | 'none' {
  const connected = listRecords(state, 'venture-model-connection', venture.id).filter(row => row.status === 'connected' && row.routeKind !== 'template');
  const kind = connected.at(-1)?.routeKind;
  if (kind === 'codex-cli') return 'codex';
  if (kind === 'claude-cli') return 'claude-code';
  if (kind === 'anthropic-messages' || kind === 'openai-responses') return 'api-key';
  return 'none';
}

/** The report's counts, steps and ranges. Each is a count, a fixed word or a range; telemetry.ts drops anything else. */
async function reportOf(deps: VentureDeps, state: State, venture: VentureRecord): Promise<Record<string, string | number | boolean>> {
  const port = portOf(deps);
  const now = deps.clock().getTime();
  const recent = <T extends { at: string }>(rows: T[]) => rows.filter(row => now - Date.parse(row.at) <= 30 * DAY);
  const runs = recent(listRecords(state, 'venture-delivery-run', venture.id));
  const calls = recent(listRecords(state, 'venture-model-call', venture.id));
  const denied = recent(listRecords(state, 'venture-queue-decision', venture.id)).filter(row => row.action === 'deny' && !row.undoneAt);
  const reached = milestonesOf(state, venture);
  const started = listRecords(state, 'venture-record')[0]?.at ?? venture.at;
  const currency = venture.country?.currency;
  let invoiced: string | undefined;
  let received: string | undefined;
  if (currency) {
    const digits = currencyMinorDigits(currency);
    const month = todayLocal(deps.clock, venture.country).slice(0, 7);
    const period = calendarMonth(month);
    // Loaded when needed: the sums module pulls in most of money/, which loads core on its own.
    const { planTotal, receivedPlan } = await import('../money/sums.ts');
    invoiced = earningRange(planTotal(invoicedPlan(state, venture, { type: 'invoiced', month, which: 'issued' })), digits);
    received = earningRange(planTotal(receivedPlan(state, venture, period.from, period.to)), digits);
  }
  return {
    ...(port?.appVersion ? { appVersion: port.appVersion } : {}),
    os: port?.os ?? 'other',
    furthestMilestone: reached.at(-1) ?? 'none',
    weeksSinceStart: Math.min(104, Math.max(0, Math.floor((now - Date.parse(started)) / (7 * DAY)))),
    aiRoute: aiRouteOf(state, venture),
    runsStarted30d: runs.length,
    runsFinished30d: runs.filter(run => FINISHED.has(run.status)).length,
    runsFailed30d: runs.filter(run => run.status === 'failed').length,
    runsStopped30d: runs.filter(run => run.status === 'stopped').length,
    aiCallsDone30d: calls.filter(call => call.status === 'completed').length,
    aiCallsFailed30d: calls.filter(call => call.status === 'failed').length,
    draftsAccepted30d: runs.filter(run => run.verdict?.choice === 'accepted').length,
    draftsEdited30d: runs.filter(run => run.verdict?.choice === 'edited').length,
    draftsRejected30d: runs.filter(run => run.verdict?.choice === 'rejected').length,
    cardsDenied30d: denied.length,
    ...(invoiced ? { invoicedThisMonth: invoiced } : {}),
    ...(received ? { receivedThisMonth: received } : {}),
    ...(currency ? { currency } : {}),
  };
}

type Built = { preview: FeedbackPreview; milestones: ReportMilestone[]; answerIds: string[]; crashIds: string[] };

/** Exactly what Send report would send now, with the records behind it. Null while reports are off. */
async function built(deps: VentureDeps, state: State, venture: VentureRecord, setting: FeedbackSettingRecord | null): Promise<Built | null> {
  if (!setting || !consented(setting) || !setting.reportId) return null;
  const port = portOf(deps);
  const live = services(deps);
  const items = queued(state, venture.id);
  const milestones = setting.usage ? milestonesOf(state, venture).filter(milestone => !setting.milestonesSent.includes(milestone)) : [];
  const answers = setting.usage ? items.filter(item => item.item === 'answer' && item.answer) : [];
  const crashes = setting.crashes ? items.filter(item => item.item === 'crash' && item.crash) : [];
  const preview = feedbackPreview({
    reportId: setting.reportId, channel: channelOf(deps),
    report: setting.usage ? await reportOf(deps, state, venture) : null,
    milestones, answers: answers.map(item => ({ question: item.answer!.question, answer: item.answer!.answer })),
    crashes: crashes.map(item => ({ id: item.id, crash: item.crash! })),
    appVersion: port?.appVersion ?? '', os: port?.os ?? 'other',
    to: { posthog: live.posthog?.url.hostname ?? 'PostHog (not set up)', sentry: live.sentry?.host ?? 'Sentry (not set up)' },
  });
  return { preview, milestones, answerIds: answers.map(item => item.id), crashIds: crashes.map(item => item.id) };
}

/** The next short question: the first milestone in QUESTION_MILESTONES reached and not yet asked, while usage reports are on. */
function questionOf(state: State, venture: VentureRecord, setting: FeedbackSettingRecord | null): FeedbackView['question'] {
  if (!setting || !consented(setting) || !setting.usage) return null;
  const reached = milestonesOf(state, venture);
  const id = QUESTION_MILESTONES.find(milestone => reached.includes(milestone) && !setting.asked.includes(milestone));
  return id ? { id, text: QUESTION_TEXT[id], choices: REPORT_ANSWERS.map(answer => ({ id: answer, label: ANSWER_LABELS[answer] })) } : null;
}

/** The screen's view. */
export async function feedbackView(deps: VentureDeps, ctx: Context, line?: string): Promise<FeedbackView> {
  const { state, venture } = readAs(deps, ctx, 'read');
  const setting = settingOf(state, venture.id);
  const live = services(deps);
  const given = consented(setting);
  const made = await built(deps, state, venture, setting);
  return {
    host: deps.host,
    notice: { text: FEEDBACK_NOTICE_TEXT, digest: FEEDBACK_NOTICE_DIGEST },
    consent: {
      given, stale: !!setting?.consentDigest && setting.consentDigest !== FEEDBACK_NOTICE_DIGEST,
      usage: given && !!setting?.usage, crashes: given && !!setting?.crashes, at: given ? setting!.consentAt : null,
    },
    setUp: { posthog: !!live.posthog, sentry: !!live.sentry, line: live.posthog || live.sentry ? FEEDBACK_WORDS.setUp : FEEDBACK_WORDS.notSetUp },
    reportId: setting?.reportId ?? null,
    preview: made?.preview ?? null,
    question: questionOf(state, venture, setting),
    lastSend: setting?.lastSend ?? null,
    deletion: setting?.deletion ?? null,
    line: line ?? (given ? FEEDBACK_WORDS.on : FEEDBACK_WORDS.off),
  };
}

// ---------------------------------------------------------------------------
// The two services
// ---------------------------------------------------------------------------

/** One POST through the network guard; the HTTP status, or null when the service could not be reached. */
async function post(deps: VentureDeps, url: URL, headers: Record<string, string>, body: string): Promise<number | null> {
  try {
    const answer = await guardedFetch({ url: url.href, method: 'POST', headers, body, maxRedirects: 0, timeoutMs: 15_000, maxBytes: 64 * 1024 }, deps.net ?? {});
    return answer.status;
  } catch {
    return null;
  }
}
const ok = (status: number | null | undefined) => typeof status === 'number' && status >= 200 && status < 300;

function postPostHog(deps: VentureDeps, posthog: NonNullable<Services['posthog']>, events: ReportEvent[]) {
  return post(deps, posthog.url, { 'content-type': 'application/json', 'user-agent': 'chausar-feedback' }, JSON.stringify({ api_key: posthog.key, batch: events }));
}

function postSentry(deps: VentureDeps, sentry: NonNullable<Services['sentry']>, event: SentryEvent) {
  const envelope = `${JSON.stringify({ event_id: event.event_id })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
  return post(deps, sentry.url, {
    'content-type': 'application/x-sentry-envelope', 'user-agent': 'chausar-feedback',
    'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${sentry.key}, sentry_client=chausar-feedback/1.0`,
  }, envelope);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** venture.feedback.get {} (read). */
export async function feedbackGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackView> {
  exactPayload(payload ?? {}, []);
  return feedbackView(deps, ctx);
}

/** Erases the words of what is still waiting (dropped), of the kinds named (both by default), in one transaction. */
function dropQueued(tx: VentureTx, kinds: readonly FeedbackItemRecord['item'][] = ['crash', 'answer']) {
  for (const item of queued(tx.state, tx.venture!.id)) {
    if (kinds.includes(item.item)) tx.replace<FeedbackItemRecord>({ ...item, status: 'dropped', crash: null, answer: null });
  }
}

/**
 * venture.feedback.consent { digest, usage, crashes } or { withdraw: true } (approve, app only). Agreeing makes a random
 * report id the first time; withdrawing turns both off and drops what was waiting, keeping the id for a later deletion
 * request.
 */
export async function feedbackConsentHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackView> {
  requireAppChannel(ctx, 'venture.feedback.consent');
  const body = exactPayload(payload, ['digest', 'usage', 'crashes', 'withdraw']);
  if (body.withdraw !== undefined) check(body.withdraw === true && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Send withdraw alone.');
  else {
    check(typeof body.usage === 'boolean' && typeof body.crashes === 'boolean', 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.pickOne);
    check(body.usage || body.crashes, 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.pickOne);
    check(body.digest === FEEDBACK_NOTICE_DIGEST, 'APPROVAL_STALE', FEEDBACK_WORDS.stale);
  }
  readAs(deps, ctx, 'approve');
  await ventureAction(deps, ctx, 'approve', body.withdraw ? 'feedback.consent.withdraw' : 'feedback.consent', tx => {
    const current = bodyOf(settingOf(tx.state, tx.venture!.id));
    if (body.withdraw) {
      dropQueued(tx);
      tx.put<FeedbackSettingRecord>({ ...tx.base('venture-feedback-setting'), ...current, consentDigest: null, consentAt: null, usage: false, crashes: false });
    } else {
      // Turning one kind off drops only what waits of that kind: crashes without crash reports, answers without usage reports.
      dropQueued(tx, [...(body.crashes ? [] : ['crash' as const]), ...(body.usage ? [] : ['answer' as const])]);
      tx.put<FeedbackSettingRecord>({
        ...tx.base('venture-feedback-setting'), ...current, consentDigest: FEEDBACK_NOTICE_DIGEST, consentAt: tx.now,
        usage: body.usage as boolean, crashes: body.crashes as boolean, reportId: current.reportId ?? newReportId(),
      });
    }
  });
  return feedbackView(deps, ctx);
}

/**
 * venture.feedback.send { digest } (approve, app only): sends exactly the preview the owner saw, PostHog's events in one
 * batch and each crash in its own Sentry envelope. What a service did not accept stays for the next send.
 */
export async function feedbackSendHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackView> {
  requireAppChannel(ctx, 'venture.feedback.send');
  const body = exactPayload(payload, ['digest'], ['digest']);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const setting = settingOf(state, venture.id);
  check(consented(setting), 'FEEDBACK_OFF', FEEDBACK_WORDS.offRequired);
  const made = await built(deps, state, venture, setting);
  check(made, 'FEEDBACK_OFF', FEEDBACK_WORDS.offRequired);
  const live = services(deps);
  check((!made.preview.posthog || live.posthog) && (!made.preview.sentry || live.sentry), 'FEEDBACK_NOT_SET_UP', FEEDBACK_WORDS.notSetUp);
  check(body.digest === made.preview.digest, 'APPROVAL_STALE', FEEDBACK_WORDS.previewStale);
  const posthog = made.preview.posthog ? await postPostHog(deps, live.posthog!, made.preview.posthog.events) : undefined;
  const statuses: (number | null)[] = [];
  const sentCrashes: string[] = [];
  for (const [index, event] of (made.preview.sentry?.events ?? []).entries()) {
    const status = await postSentry(deps, live.sentry!, event);
    statuses.push(status);
    if (ok(status)) sentCrashes.push(made.crashIds[index]!);
  }
  const sentry = made.preview.sentry ? (statuses.find(status => !ok(status)) ?? statuses.at(-1) ?? null) : undefined;
  const said = sendLine(posthog, sentry);
  const countsWent = ok(posthog);
  await ventureAction(deps, ctx, 'approve', 'feedback.send', tx => {
    const current = bodyOf(settingOf(tx.state, tx.venture!.id));
    const done = new Set([...(countsWent ? made.answerIds : []), ...sentCrashes]);
    for (const item of queued(tx.state, tx.venture!.id)) if (done.has(item.id)) tx.replace<FeedbackItemRecord>({ ...item, status: 'sent', crash: null, answer: null });
    tx.put<FeedbackSettingRecord>({
      ...tx.base('venture-feedback-setting'), ...current,
      milestonesSent: countsWent ? [...new Set([...current.milestonesSent, ...made.milestones])] : current.milestonesSent,
      sentAny: current.sentAny || countsWent || sentCrashes.length > 0,
      lastSend: { at: tx.now, posthog: posthog ?? null, sentry: sentry ?? null, accepted: said.accepted, line: said.line },
    });
  });
  return feedbackView(deps, ctx, said.line);
}

/** venture.feedback.answer { questionId, answer } (prepare, app only): the open question, a fixed answer or skip. */
export async function feedbackAnswerHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackView> {
  requireAppChannel(ctx, 'venture.feedback.answer');
  const body = exactPayload(payload, ['questionId', 'answer'], ['questionId', 'answer']);
  check(typeof body.answer === 'string' && [...REPORT_ANSWERS, 'skip'].includes(body.answer), 'INVALID_VENTURE_REQUEST', 'Choose Easy, Okay or Hard.');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const open = questionOf(state, venture, settingOf(state, venture.id));
  check(open && open.id === body.questionId, 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.noQuestion);
  await ventureAction(deps, ctx, 'prepare', 'feedback.answer', tx => {
    const current = bodyOf(settingOf(tx.state, tx.venture!.id));
    if (body.answer !== 'skip') {
      tx.put<FeedbackItemRecord>({ ...tx.base('venture-feedback-item'), item: 'answer', status: 'queued', crash: null, answer: { question: open.id, answer: body.answer as string } });
    }
    tx.put<FeedbackSettingRecord>({ ...tx.base('venture-feedback-setting'), ...current, asked: [...new Set([...current.asked, open.id])] });
  });
  return feedbackView(deps, ctx);
}

/** Keeps one scrubbed crash while crash reports are on and fewer than the limit wait. */
async function keepCrash(deps: VentureDeps, ctx: Context, source: CrashSource, name: unknown, message: unknown, stack: unknown, method: string | null): Promise<FeedbackCrashKept> {
  const state = deps.store.read();
  const venture = listRecords(state, 'venture-record').at(-1);
  if (!venture) return { kept: false, line: FEEDBACK_WORDS.off };
  const setting = settingOf(state, venture.id);
  if (!setting || !consented(setting) || !setting.crashes) return { kept: false, line: FEEDBACK_WORDS.off };
  if (queued(state, venture.id).filter(item => item.item === 'crash').length >= CRASH_QUEUE_LIMIT) return { kept: false, line: FEEDBACK_WORDS.crashFull };
  const crash = keptCrash(source, name, message, stack, method);
  await ventureAction(deps, ctx, 'prepare', 'feedback.crash', tx => {
    tx.put<FeedbackItemRecord>({ ...tx.base('venture-feedback-item'), item: 'crash', status: 'queued', crash, answer: null });
  });
  return { kept: true, line: 'Kept for your next report. You see it before it is sent.' };
}

/**
 * venture.feedback.crash { source, name, message, stack? } (prepare, app only): the app window or the desktop shell
 * notes a crash. Kept, scrubbed, only while crash reports are on; otherwise nothing is written.
 */
export async function feedbackCrashHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackCrashKept> {
  requireAppChannel(ctx, 'venture.feedback.crash');
  const body = exactPayload(payload, ['source', 'name', 'message', 'stack'], ['source', 'name', 'message']);
  check(typeof body.source === 'string' && (CRASH_SOURCES as readonly string[]).includes(body.source), 'INVALID_VENTURE_REQUEST', 'Say where the crash came from.');
  check(typeof body.name === 'string' && body.name.length <= 200 && typeof body.message === 'string' && body.message.length <= 8000, 'INVALID_VENTURE_REQUEST', 'Send the crash kind and its message.');
  check(body.stack === undefined || (typeof body.stack === 'string' && body.stack.length <= 40000), 'INVALID_VENTURE_REQUEST', 'Send the stack as text.');
  readAs(deps, ctx, 'prepare');
  return keepCrash(deps, ctx, body.source as CrashSource, body.name, body.message, body.stack, null);
}

/**
 * Notes an engine error the owner's request hit that is not one of Chausar's own refusals (VentureHost.request calls
 * it). Best effort: it never throws, and it writes only while crash reports are on.
 */
export async function noteEngineCrash(deps: VentureDeps, ctx: Context, error: unknown, method: string): Promise<void> {
  try {
    if (error instanceof ChausarError || !(error instanceof Error)) return;
    const known = (VENTURE_METHODS as readonly string[]).includes(method) ? (method as VentureMethod) : null;
    await keepCrash(deps, deps.ownerContext?.() ?? ctx, 'engine', error.name, error.message, error.stack, known);
  } catch { /* a crash note never adds a failure of its own */ }
}

/**
 * venture.feedback.delete {} (approve, app only): "Delete my reports". Drops everything waiting and turns reports off.
 * When something was sent, one deletion request goes to PostHog under the report id (the team deletes in both
 * services by hand: their deletion APIs need an admin token this app never carries), and the id is forgotten, so a
 * later opt-in starts under a new one.
 */
export async function feedbackDeleteHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FeedbackView> {
  requireAppChannel(ctx, 'venture.feedback.delete');
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const setting = settingOf(state, venture.id);
  const live = services(deps);
  const reportId = setting?.sentAny ? setting.reportId : null;
  let reached = false;
  if (reportId && live.posthog) {
    const status = await postPostHog(deps, live.posthog, [deletionEvent(reportId, channelOf(deps))]);
    check(ok(status), 'FEEDBACK_SEND_FAILED', FEEDBACK_WORDS.deleteFailed);
    reached = true;
  }
  const line = reportId ? deletionLine(reportId, reached) : FEEDBACK_WORDS.nothingLeft;
  await ventureAction(deps, ctx, 'approve', 'feedback.delete', tx => {
    const current = bodyOf(settingOf(tx.state, tx.venture!.id));
    dropQueued(tx);
    tx.put<FeedbackSettingRecord>({
      ...tx.base('venture-feedback-setting'), ...current, consentDigest: null, consentAt: null, usage: false, crashes: false,
      reportId: null, milestonesSent: [], sentAny: false, lastSend: null,
      deletion: reportId ? { at: tx.now, reportId, line } : current.deletion,
    });
  });
  return feedbackView(deps, ctx, line);
}
