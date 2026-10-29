/**
 * The fake engine's answers for the smaller wave 2 wiring (Ink v2 wave 2): a transcript made on this computer
 * (venture.files.transcribe, package 2E2), the calendar file (venture.social.calendar, 2F2) and the dated platform
 * rules (venture.rules.list, 2H, answered from fixtures-rules.ts). A method no package has filled yet is refused, as
 * the fake engine refuses any it does not know.
 */

import {
  EngineError, type BlueprintViewLite, type CalendarIntakeLite, type DeliveryLite, type DraftPostLite, type OrderLite, type ShareLink,
  type SocialCalendarFile, type TranscriptionSetupView, type UploadLite, type VentureRunEvent,
} from './types';
import { rulesListFor } from './fixtures-rules';

export interface WiringHost {
  current(): string;
  now(): string;
  emit(event: VentureRunEvent): void;
  /** Whether this answers as the hosted web server, which reads no file on the owner's computer. */
  hosted(): boolean;
  /** Another desk's answer, for the records this desk reads and adds to (orders, files, delivery runs, the plan). */
  ask(method: string, params: Record<string, unknown>): unknown;
  /** 2E2: keeps a transcript made "on this computer" on the order, with its origin (fake-work.ts keepMade). */
  keepMadeTranscript?(params: Record<string, unknown>): UploadLite;
}

const WIRING_METHODS = new Set<string>(['venture.rules.list', 'venture.files.transcribe', 'venture.social.calendar', 'venture.transcription.get', 'venture.transcription.set']);

/** 2F2: the engine's words and file header (platform/runtime/venture/playbooks/social/calendar-export.ts, approvals.ts). */
const CALENDAR_HEADER = 'date,channel,text,alt_text,owner_approved_at,client_approved_at';
const CALENDAR_WORDS = {
  notSocial: 'Only a social media draft has a calendar file.',
  noSlots: 'This order has no calendar, so code planned no slots. Only a content calendar order has a calendar file.',
  noDraft: 'This run has no draft yet. The calendar file comes from a draft you approved.',
  practice: 'A practice draft never goes to a client.',
  noSlot: 'This post has no slot in the calendar.',
  owner: 'You have not approved this draft.',
  client: 'Your client has not approved this draft.',
  changes: 'Your client asked for changes.',
};

/** The engine's slot plan (social/calendar.ts planCalendar): the month's days on the chosen weekdays, spread evenly. */
function planSlots(calendar: CalendarIntakeLite): { channel: string; date: string }[] {
  const [year, month] = calendar.month.split('-').map(Number) as [number, number];
  const days: string[] = [];
  for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day += 1) {
    if (calendar.weekdays.includes(((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1)) days.push(`${calendar.month}-${String(day).padStart(2, '0')}`);
  }
  return calendar.channels.flatMap((channel) => Array.from({ length: calendar.postsPerChannel }, (_, i) => ({ channel, date: days[Math.floor((i * days.length) / calendar.postsPerChannel)]! })));
}

/** The engine writes approval times on the business's own clock; the fake's businesses are all in India. */
const indiaTime = (at: string | null | undefined) => (at ? `${new Date(Date.parse(at) + 330 * 60000).toISOString().slice(0, 16)}+05:30` : '');

/** The channel names the engine uses (social/channels.ts), for a gap line on a channel the draft has no post for. */
const CHANNEL_NAMES: Record<string, string> = {
  linkedin: 'LinkedIn', instagram: 'Instagram', x: 'X', facebook: 'Facebook Page', threads: 'Threads', tiktok: 'TikTok', 'youtube-shorts': 'YouTube Shorts',
};
/** A cell that starts with a mark spreadsheets read as a formula (social/approvals.ts startsLikeFormula). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A CSV cell as the engine writes it: a leading formula character defused, quoted when it holds a comma, quote or new line. */
function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 2E2: what the fake's whisper.cpp "hears" in any cut: three timed lines, so the order's transcript has content. */
const SAMPLE_TRANSCRIPT = '1\n00:00:00,000 --> 00:00:04,500\nWelcome back. Today is about budgets.\n\n2\n00:00:05,000 --> 00:00:09,500\nStart with what comes in each month.\n\n3\n00:00:10,000 --> 00:00:14,500\nThen list the bills that never change.\n';
/** The engine's words (platform/runtime/venture/playbooks/youtube/transcribe.ts and delivery/harness/files.ts). */
const HOSTED_NO_TRANSCRIBE = "The shared hosted server can't make a transcript: it never reads a file on your computer. Use the desktop app, or add the transcript as an SRT or VTT file.";

export class FakeWiringDesk {
  private readonly host: WiringHost;
  private readonly fresh: boolean;

  constructor(host: WiringHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return WIRING_METHODS.has(method);
  }

  request(method: string, _p: Record<string, unknown>): unknown {
    // 2H: the playbook the plan names, its dated rules on the fake's day (fixtures-rules.ts).
    if (method === 'venture.rules.list') {
      const p=_p??{};
      if (typeof p!=='object' || Array.isArray(p) || ![Object.prototype,null].includes(Object.getPrototypeOf(p))) throw new EngineError('INVALID_VENTURE_REQUEST','Send one request object.');
      if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
      return rulesListFor((this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null)?.playbook, new Date(Date.parse(this.host.now())+330*60_000).toISOString().slice(0, 10));
    }
    if (method === 'venture.files.transcribe') return this.transcribe(_p);
    if (method === 'venture.transcription.get') return this.whisperView();
    if (method === 'venture.transcription.set') return this.setWhisper(_p);
    if (method === 'venture.social.calendar') return this.calendar(_p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  /**
   * 2F2, venture.social.calendar: the engine's refusals in its order, then a file with one row per post that the owner
   * accepted and the client approved, on its slot's date, in date order; every other post is left out with why. The
   * fake has no checks or digests and counts every post the share list names; the engine also checks each post's text.
   */
  private calendar(p: Record<string, unknown>): SocialCalendarFile {
    if (typeof p.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.runId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Draft must be a known identifier.');
    const run = (this.host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((d) => d.id === p.runId);
    if (!run) throw new EngineError('DELIVERY_NOT_FOUND', 'That draft was not found.');
    if ((this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null)?.playbook?.id !== 'social-agency') throw new EngineError('CALENDAR_NOT_A_SOCIAL_DRAFT', CALENDAR_WORDS.notSocial);
    if (run.practice) throw new EngineError('PRACTICE_DRAFT', CALENDAR_WORDS.practice);
    const order = (this.host.ask('venture.order.list', {}) as OrderLite[]).find((o) => o.id === run.orderId);
    const calendar = (order?.intake as { calendar?: CalendarIntakeLite } | undefined)?.calendar;
    if (!calendar) throw new EngineError('CALENDAR_NO_SLOTS', CALENDAR_WORDS.noSlots);
    if (!run.deliverable) throw new EngineError('DELIVERY_NOT_READY', CALENDAR_WORDS.noDraft);
    const listed = this.host.ask('venture.share.list', { deliveryId: run.id }) as { links?: ShareLink[]; posts?: DraftPostLite[] };
    const answer = (listed.links ?? []).find((link) => link.answer)?.answer ?? null;
    const reasons = [
      ...(run.status === 'accepted' || run.status === 'edited' ? [] : [CALENDAR_WORDS.owner]),
      ...(answer?.decision === 'approved' ? [] : [answer?.decision === 'changes' ? CALENDAR_WORDS.changes : CALENDAR_WORDS.client]),
    ];
    const slots = planSlots(calendar);
    const posts = listed.posts ?? [];
    // The engine's gap lines (social/draft-posts.ts assignSlots), one per channel whose posts and slots differ.
    const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
    const gaps = [...new Set([...slots.map((s) => s.channel), ...posts.map((post) => post.channel)])].flatMap((channel) => {
      const own = slots.filter((s) => s.channel === channel).length;
      const drafted = posts.filter((post) => post.channel === channel).length;
      const name = posts.find((post) => post.channel === channel)?.name ?? CHANNEL_NAMES[channel] ?? channel;
      if (!own) return [`${name} has no slots in this calendar, and the draft has ${plural(drafted, 'post')} for it.`];
      return own === drafted ? [] : [`${name} has ${plural(own, 'slot')} and ${plural(drafted, 'post')}.`];
    });
    const taken: Record<string, number> = {};
    const rows: { draftId: string; date: string; channel: string; text: string }[] = [];
    const blocked: SocialCalendarFile['blocked'] = [];
    for (const post of posts) {
      const nth = taken[post.channel] ?? 0;
      taken[post.channel] = nth + 1;
      const slot = slots.filter((s) => s.channel === post.channel)[nth];
      const problem = gaps.find((gap) => gap.startsWith(`${post.name} has `));
      if (!slot) blocked.push({ draftId: post.draftId, name: post.name, text: post.text, line: problem ? `${CALENDAR_WORDS.noSlot} ${problem}` : CALENDAR_WORDS.noSlot });
      else if (reasons.length) blocked.push({ draftId: post.draftId, name: post.name, text: post.text, line: reasons.join(' ') });
      else rows.push({ draftId: post.draftId, date: slot.date, channel: post.channel, text: post.text });
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const lines = rows.map((row) => [row.date, row.channel, row.text, '', indiaTime(run.verdict?.at), indiaTime(answer?.at)].map(csvCell).join(','));
    return {
      // The engine's file starts with a UTF-8 byte order mark. The fake splits no thread, so it names none.
      csv: `﻿${[CALENDAR_HEADER, ...lines].join('\n')}\n`, fileName: `chausar-calendar-${calendar.month}.csv`, rows: rows.length, blocked,
      defused: posts.filter((post) => rows.some((row) => row.draftId === post.draftId && FORMULA_START.test(row.text))).map((post) => post.draftId),
      threads: [], gaps,
    };
  }

  /**
   * 2E2, venture.files.transcribe: the engine's refusals (hosted, unknown order, no cut named at intake, a transcript
   * already there), then the order's transcript kept like a client file, marked as made on this computer. The fake
   * pretends ffmpeg and whisper.cpp are here; the real engine says plainly when they are not.
   */
  private transcribe(p: Record<string, unknown>): UploadLite {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_NO_TRANSCRIBE);
    const order = (this.host.ask('venture.order.list', {}) as OrderLite[]).find((o) => o.id === p.orderId);
    if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
    const cut = order.intake?.cutFile;
    if (!cut) throw new EngineError('INVALID_VENTURE_REQUEST', 'This order names no finished cut on this computer. Add the transcript as an SRT or VTT file instead.');
    const problem = pathProblem(cut);
    if (problem) throw new EngineError('INVALID_VENTURE_REQUEST', `The cut: ${problem}`);
    const files = this.host.ask('venture.files.list', { orderId: order.id }) as UploadLite[];
    if (files.some((f) => f.format === 'transcript')) throw new EngineError('TRANSCRIPT_EXISTS', 'This order already has a transcript.');
    const name = `${(cut.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').slice(0, 100) || 'transcript'}.srt`;
    // Kept with its origin on the file itself, as the engine keeps it, through the work desk directly.
    if (!this.host.keepMadeTranscript) throw new EngineError('METHOD_NOT_ALLOWED', 'The fake engine does not answer venture.files.transcribe here.');
    return this.host.keepMadeTranscript({ orderId: order.id, name, contentBase64: btoa(SAMPLE_TRANSCRIPT) });
  }

  /** 2E2: the owner's whisper.cpp per business. The fake has no disk to check, so a setup it keeps reads as set up. */
  private readonly whisper: Record<string, { command: string; model: string } | null> = {};

  /** venture.transcription.get: the engine's view and words (playbooks/youtube/transcribe.ts transcriptionSetupView). */
  private whisperView(): TranscriptionSetupView {
    if (this.host.hosted()) return { status: 'not-set-up', command: null, model: null, ffmpeg: false, line: HOSTED_NO_TRANSCRIBE };
    const setup = this.whisper[this.host.current()] ?? null;
    return setup
      ? { status: 'set-up', command: setup.command, model: setup.model, ffmpeg: true, line: 'whisper.cpp is set up on this computer.' }
      : { status: 'not-set-up', command: null, model: null, ffmpeg: true, line: 'No whisper.cpp is set up on this computer.' };
  }

  /** venture.transcription.set { command, model } or { clear: true }: the engine's refusals, in its words. */
  private setWhisper(p: Record<string, unknown>): TranscriptionSetupView {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_NO_TRANSCRIBE);
    const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
    if ('clear' in p) {
      if (p.clear !== true || p.command !== undefined || p.model !== undefined) throw invalid('Send clear: true on its own to remove the setup.');
      this.whisper[this.host.current()] = null;
      return this.whisperView();
    }
    if (typeof p.command !== 'string' || typeof p.model !== 'string') throw invalid('Give the full paths to whisper-cli and to its model file.');
    for (const [path, what] of [[p.command, 'whisper-cli'], [p.model, 'The model file']] as const) {
      const problem = pathProblem(path);
      if (problem) throw invalid(`${what}: ${problem}`);
    }
    // The engine's name rule (speech.ts isWhisperCli): a Windows path needs whisper-cli.exe, which is what Windows starts.
    const program = p.command.split(/[\\/]/).pop() ?? '';
    if (!(/^[A-Za-z]:/.test(p.command) ? /^whisper-cli\.exe$/i : /^whisper-cli(?:\.exe)?$/).test(program)) throw invalid('Choose the whisper-cli program from your whisper.cpp folder.');
    this.whisper[this.host.current()] = { command: p.command, model: p.model };
    return this.whisperView();
  }
}

/** The engine's path rule (platform/runtime/speech.ts localPathProblem), for a Windows or a Unix path. */
function pathProblem(path: string): string | null {
  if (!path || path.length > 500 || /[\u0000-\u001F\u007F]/.test(path)) return 'Give the full path to a file on this computer.';
  if (/^[\\/]{2}/.test(path)) return 'A file on a network share is not read. Copy it to this computer and give that path.';
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(path)) return 'Give the full path to a file on this computer, starting with a drive letter such as C:\\.';
  return null;
}
