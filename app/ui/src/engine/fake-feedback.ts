/**
 * The fake engine's feedback (wave 6, 6J2, D47), in the engine's shapes, codes, order and words (core/feedback.ts).
 * The notice, the questions, the scrubbing and the exact events come from the engine's own browser-safe file
 * (core/feedback-core.ts). The rehearsal has no report keys, as a build without them: the preview shows exactly what
 * would go, and Send report answers FEEDBACK_NOT_SET_UP. Its report is sample data shaped like the engine's: the
 * rehearsal business has started, has its plan and its AI, and has earned nothing yet.
 */

import { diagnosticsLine } from '../../../../platform/shared/venture/views/diagnostics-core.ts';
import { EngineError } from './types';
import type { FeedbackCrashKept, FeedbackView } from './types';
import type { W4DeskHost } from './fake-w4';
import { REPORT_ANSWERS, REPORT_MILESTONES } from '../../../../platform/shared/venture/core/telemetry.ts';
import type { ReportMilestone } from '../../../../platform/runtime/venture/core/telemetry.ts';
import { ANSWER_LABELS, CRASH_QUEUE_LIMIT, CRASH_SOURCES, FEEDBACK_NOTICE_DIGEST, FEEDBACK_NOTICE_TEXT, FEEDBACK_WORDS, QUESTION_MILESTONES, QUESTION_TEXT, feedbackPreview, keptCrash } from '../../../../platform/shared/venture/core/feedback-core.ts';
import type { CrashSource, KeptCrash } from '../../../../platform/runtime/venture/core/feedback-core.ts';

const METHODS = new Set(['venture.diagnostics.today', 'venture.feedback.get', 'venture.feedback.consent', 'venture.feedback.send', 'venture.feedback.answer', 'venture.feedback.crash', 'venture.feedback.delete']);
/** The milestones the rehearsal business has reached. */
const REACHED: readonly ReportMilestone[] = ['business_started', 'plan_accepted', 'ai_connected'];

type Setting = {
  consentDigest: string | null; consentAt: string | null; usage: boolean; crashes: boolean; reportId: string | null;
  milestonesSent: string[]; asked: string[]; sentAny: boolean; deletion: FeedbackView['deletion'];
};
type Item = { id: string; item: 'crash' | 'answer'; status: 'queued' | 'sent' | 'dropped'; crash: KeptCrash | null; answer: { question: string; answer: string } | null };

function need(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EngineError(code, message);
}
function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const body = value as Record<string, unknown>;
  need(Object.keys(body).every(key => allowed.includes(key)) && required.every(key => body[key] !== undefined), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return body;
}

export class FakeFeedbackDesk {
  private readonly host: W4DeskHost;
  private readonly settings = new Map<string, Setting>();
  private readonly items = new Map<string, Item[]>();
  private seq = 0;

  constructor(host: W4DeskHost) { this.host = host; }

  handles(method: string): boolean { return METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      // C5 task 28: the rehearsal's runs keep no call times, so it says what a business with nothing today says.
      case 'venture.diagnostics.today': exact(p ?? {}, []); return { day: this.host.now().slice(0, 10), line: diagnosticsLine([], 0), rows: [], modelCalls: 0 };
      case 'venture.feedback.get': exact(p ?? {}, []); return this.view();
      case 'venture.feedback.consent': return this.consent(p);
      case 'venture.feedback.send': return this.send(p);
      case 'venture.feedback.answer': return this.answer(p);
      case 'venture.feedback.crash': return this.crash(p);
      case 'venture.feedback.delete': return this.remove(p);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  private setting(): Setting {
    return this.settings.get(this.host.current()) ?? { consentDigest: null, consentAt: null, usage: false, crashes: false, reportId: null, milestonesSent: [], asked: [], sentAny: false, deletion: null };
  }
  private save(setting: Setting) { this.settings.set(this.host.current(), setting); }
  private list(): Item[] {
    const id = this.host.current();
    let rows = this.items.get(id);
    if (!rows) { rows = []; this.items.set(id, rows); }
    return rows;
  }
  private queued(): Item[] { return this.list().filter(item => item.status === 'queued'); }
  private consented(setting = this.setting()): boolean { return setting.consentDigest === FEEDBACK_NOTICE_DIGEST && (setting.usage || setting.crashes); }
  private drop(kinds: readonly Item['item'][] = ['crash', 'answer']) {
    for (const item of this.queued()) if (kinds.includes(item.item)) Object.assign(item, { status: 'dropped', crash: null, answer: null });
  }
  private channel(): string { return this.host.hosted() ? 'hosted-web' : 'desktop'; }
  private reportId(): string {
    this.seq += 1;
    return `rep_${(0xfeed0000 + this.seq).toString(16).padStart(16, '0')}`;
  }

  private preview(setting: Setting): FeedbackView['preview'] {
    if (!this.consented(setting) || !setting.reportId) return null;
    const items = this.queued();
    return feedbackPreview({
      reportId: setting.reportId, channel: this.channel(),
      report: setting.usage ? {
        os: 'other', furthestMilestone: REACHED.at(-1)!, weeksSinceStart: 0, aiRoute: 'none',
        runsStarted30d: 0, runsFinished30d: 0, runsFailed30d: 0, runsStopped30d: 0, aiCallsDone30d: 0, aiCallsFailed30d: 0,
        draftsAccepted30d: 0, draftsEdited30d: 0, draftsRejected30d: 0, cardsDenied30d: 0,
        invoicedThisMonth: 'none', receivedThisMonth: 'none', currency: 'INR',
      } : null,
      milestones: setting.usage ? REPORT_MILESTONES.filter(milestone => REACHED.includes(milestone) && !setting.milestonesSent.includes(milestone)) : [],
      answers: setting.usage ? items.filter(item => item.item === 'answer' && item.answer).map(item => item.answer!) : [],
      crashes: setting.crashes ? items.filter(item => item.item === 'crash' && item.crash).map(item => ({ id: item.id, crash: item.crash! })) : [],
      appVersion: '', os: 'other',
      to: { posthog: 'PostHog (not set up)', sentry: 'Sentry (not set up)' },
    });
  }

  private question(setting: Setting): FeedbackView['question'] {
    if (!this.consented(setting) || !setting.usage) return null;
    const id = QUESTION_MILESTONES.find(milestone => REACHED.includes(milestone) && !setting.asked.includes(milestone));
    return id ? { id, text: QUESTION_TEXT[id], choices: REPORT_ANSWERS.map(answer => ({ id: answer, label: ANSWER_LABELS[answer] })) } : null;
  }

  /** venture.feedback.get: feedback.ts feedbackView. */
  private view(line?: string): FeedbackView {
    const setting = this.setting();
    const given = this.consented(setting);
    return {
      host: this.host.hosted() ? 'hosted-web' : 'desktop',
      notice: { text: FEEDBACK_NOTICE_TEXT, digest: FEEDBACK_NOTICE_DIGEST },
      consent: { given, stale: !!setting.consentDigest && setting.consentDigest !== FEEDBACK_NOTICE_DIGEST, usage: given && setting.usage, crashes: given && setting.crashes, at: given ? setting.consentAt : null },
      setUp: { posthog: false, sentry: false, line: FEEDBACK_WORDS.notSetUp },
      reportId: setting.reportId,
      preview: this.preview(setting),
      question: this.question(setting),
      lastSend: null,
      deletion: setting.deletion,
      line: line ?? (given ? FEEDBACK_WORDS.on : FEEDBACK_WORDS.off),
    };
  }

  /** venture.feedback.consent: feedback.ts feedbackConsentHandler. */
  private consent(p: Record<string, unknown>): FeedbackView {
    const body = exact(p, ['digest', 'usage', 'crashes', 'withdraw']);
    const current = this.setting();
    if (body.withdraw !== undefined) {
      need(body.withdraw === true && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Send withdraw alone.');
      this.drop();
      this.save({ ...current, consentDigest: null, consentAt: null, usage: false, crashes: false });
      return this.view();
    }
    need(typeof body.usage === 'boolean' && typeof body.crashes === 'boolean', 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.pickOne);
    need(body.usage || body.crashes, 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.pickOne);
    need(body.digest === FEEDBACK_NOTICE_DIGEST, 'APPROVAL_STALE', FEEDBACK_WORDS.stale);
    this.drop([...(body.crashes ? [] : ['crash' as const]), ...(body.usage ? [] : ['answer' as const])]);
    this.save({ ...current, consentDigest: FEEDBACK_NOTICE_DIGEST, consentAt: this.host.now(), usage: body.usage as boolean, crashes: body.crashes as boolean, reportId: current.reportId ?? this.reportId() });
    return this.view();
  }

  /** venture.feedback.send: feedback.ts feedbackSendHandler. The rehearsal has no report keys, as a build without them. */
  private send(p: Record<string, unknown>): FeedbackView {
    exact(p, ['digest'], ['digest']);
    const setting = this.setting();
    need(this.consented(setting), 'FEEDBACK_OFF', FEEDBACK_WORDS.offRequired);
    need(this.preview(setting), 'FEEDBACK_OFF', FEEDBACK_WORDS.offRequired);
    throw new EngineError('FEEDBACK_NOT_SET_UP', FEEDBACK_WORDS.notSetUp);
  }

  /** venture.feedback.answer: feedback.ts feedbackAnswerHandler. */
  private answer(p: Record<string, unknown>): FeedbackView {
    const body = exact(p, ['questionId', 'answer'], ['questionId', 'answer']);
    need(typeof body.answer === 'string' && [...REPORT_ANSWERS, 'skip'].includes(body.answer), 'INVALID_VENTURE_REQUEST', 'Choose Easy, Okay or Hard.');
    const setting = this.setting();
    const open = this.question(setting);
    need(open && open.id === body.questionId, 'INVALID_VENTURE_REQUEST', FEEDBACK_WORDS.noQuestion);
    if (body.answer !== 'skip') {
      this.seq += 1;
      this.list().push({ id: `fbitem_${this.seq}`, item: 'answer', status: 'queued', crash: null, answer: { question: open.id, answer: body.answer as string } });
    }
    this.save({ ...setting, asked: [...new Set([...setting.asked, open.id])] });
    return this.view();
  }

  /** venture.feedback.crash: feedback.ts feedbackCrashHandler. */
  private crash(p: Record<string, unknown>): FeedbackCrashKept {
    const body = exact(p, ['source', 'name', 'message', 'stack'], ['source', 'name', 'message']);
    need(typeof body.source === 'string' && (CRASH_SOURCES as readonly string[]).includes(body.source), 'INVALID_VENTURE_REQUEST', 'Say where the crash came from.');
    need(typeof body.name === 'string' && body.name.length <= 200 && typeof body.message === 'string' && body.message.length <= 8000, 'INVALID_VENTURE_REQUEST', 'Send the crash kind and its message.');
    need(body.stack === undefined || (typeof body.stack === 'string' && body.stack.length <= 40000), 'INVALID_VENTURE_REQUEST', 'Send the stack as text.');
    const setting = this.setting();
    if (!this.consented(setting) || !setting.crashes) return { kept: false, line: FEEDBACK_WORDS.off };
    if (this.queued().filter(item => item.item === 'crash').length >= CRASH_QUEUE_LIMIT) return { kept: false, line: FEEDBACK_WORDS.crashFull };
    this.seq += 1;
    this.list().push({ id: `fbitem_${this.seq}`, item: 'crash', status: 'queued', crash: keptCrash(body.source as CrashSource, body.name, body.message, body.stack, null), answer: null });
    return { kept: true, line: 'Kept for your next report. You see it before it is sent.' };
  }

  /** venture.feedback.delete: feedback.ts feedbackDeleteHandler. The rehearsal never sent anything, so nothing is asked. */
  private remove(p: Record<string, unknown>): FeedbackView {
    exact(p ?? {}, []);
    const current = this.setting();
    this.drop();
    this.save({ ...current, consentDigest: null, consentAt: null, usage: false, crashes: false, reportId: null, milestonesSent: [], sentAny: false });
    return this.view(FEEDBACK_WORDS.nothingLeft);
  }
}
