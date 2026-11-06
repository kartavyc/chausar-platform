/**
 * The fake engine's push-to-talk (wave 6, 6I1, D45), in the engine's shapes, codes, order and words (agents/talk.ts).
 * The notice, the words, Sarvam's dated price and the spoken-text rule come from the engine's own browser-safe file
 * (agents/talk-core.ts). Nothing is recognized here: a recording is checked as the engine checks it, and the words that
 * come back say so. Reading aloud never makes audio here; it quotes when the rehearsal speech key is set, as the engine
 * would, and says to read on screen otherwise.
 */

import { EngineError } from './types';
import type { ChiefMessageView, TalkHeard, TalkSaid, TalkStarted, TalkView, TranscriptionSetupView } from './types';
import type { W4DeskHost } from './fake-w4';
import { fakeSpeechAccount } from './fake-speech-account';
import { reportNumberEstimate } from './fake-report-numbers';
import { captionAudioBytes } from '../../../../platform/runtime/venture/playbooks/translation-studio/caption-audio';
import { hash } from '../../../../platform/runtime/portable';
import {
  SARVAM_DEFAULT_CAP_MINOR, SARVAM_RATE_DIGEST, SARVAM_STT_PRICE, TALK_CONSENT_DIGEST, TALK_CONSENT_TEXT, TALK_SECONDS, TALK_SESSION_MS, TALK_WORDS,
  monthOf, rupees, sarvamCostMinor, spokenFrom, wavMs, type TalkPart,
} from '../../../../platform/runtime/venture/agents/talk-core';

const METHODS = new Set(['venture.talk.get', 'venture.talk.consent', 'venture.talk.setup', 'venture.talk.start', 'venture.talk.hear', 'venture.talk.say']);
const READ_LINE = 'An AI voice is reading Chausar\'s answer. The audio is played once and not kept.';
/** What the rehearsal hands back for a recording: it recognizes nothing, and says so. */
export const FAKE_TALK_WORDS = 'Rehearsal words. No audio was recognized.';

type Listen = 'whisper-local' | 'sarvam';
type Setting = { consentDigest: string | null; consentAt: string | null; keepAudio: boolean; listen: Listen; capMinor: string; rateDigest: string | null; sarvamKey: boolean };
type Heard = { at: string; provider: Listen; costMinor: string; kept: boolean };
type Session = { id: string; business: string; provider: Listen; expires: number };

function need(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EngineError(code, message);
}
function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const body = value as Record<string, unknown>;
  need(Object.keys(body).every(key => allowed.includes(key)) && required.every(key => body[key] !== undefined), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return body;
}
function engineChecked<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof EngineError) throw error;
    const known = error as { code?: string; message?: string };
    throw new EngineError(known.code ?? 'INVALID_VENTURE_REQUEST', known.message ?? 'Send the required fields and nothing else.');
  }
}

export class FakeTalkDesk {
  private readonly host: W4DeskHost;
  private readonly settings = new Map<string, Setting>();
  private readonly heard = new Map<string, Heard[]>();
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  constructor(host: W4DeskHost) { this.host = host; }

  handles(method: string): boolean { return METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    return engineChecked(() => {
      switch (method) {
        case 'venture.talk.get': exact(p ?? {}, []); return this.view();
        case 'venture.talk.consent': return this.consent(p);
        case 'venture.talk.setup': return this.setup(p);
        case 'venture.talk.start': return this.start(p);
        case 'venture.talk.hear': return this.hear(p);
        case 'venture.talk.say': return this.say(p);
        default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
      }
    });
  }

  private setting(): Setting {
    return this.settings.get(this.host.current()) ?? { consentDigest: null, consentAt: null, keepAudio: false, listen: 'whisper-local', capMinor: SARVAM_DEFAULT_CAP_MINOR, rateDigest: null, sarvamKey: false };
  }
  private rows(): Heard[] {
    const id = this.host.current();
    let rows = this.heard.get(id);
    if (!rows) { rows = []; this.heard.set(id, rows); }
    return rows;
  }
  private nowMs(): number { return Date.parse(this.host.now()); }
  private live(): Session[] {
    for (const [id, session] of this.sessions) if (session.expires <= this.nowMs()) this.sessions.delete(id);
    return [...this.sessions.values()].filter(session => session.business === this.host.current());
  }
  private whisperReady(): boolean { return (this.host.ask('venture.transcription.get', {}) as TranscriptionSetupView).status === 'set-up'; }
  private sarvamReady(setting: Setting): boolean { return setting.sarvamKey && setting.rateDigest === SARVAM_RATE_DIGEST; }
  private spent(): bigint {
    const month = monthOf(this.host.now());
    return this.rows().filter(row => row.provider === 'sarvam' && monthOf(row.at) === month).reduce((sum, row) => sum + BigInt(row.costMinor), 0n);
  }

  /** venture.talk.get: talk.ts talkView. */
  private view(): TalkView {
    const setting = this.setting();
    const given = setting.consentDigest === TALK_CONSENT_DIGEST;
    const connected = this.sarvamReady(setting);
    const spent = String(this.spent());
    const speaks = fakeSpeechAccount(this.host) !== null;
    const session = this.live()[0] ?? null;
    const local = this.whisperReady();
    return {
      desktop: !this.host.hosted(),
      consent: { given, stale: !!setting.consentDigest && !given, text: TALK_CONSENT_TEXT, digest: TALK_CONSENT_DIGEST, at: given ? setting.consentAt : null, keepAudio: setting.keepAudio },
      listen: setting.listen,
      whisper: { ready: local, line: local ? 'whisper.cpp is set up on this computer. Recordings stay here.' : 'No whisper.cpp is set up on this computer.' },
      sarvam: {
        label: 'fixture-tested', connected, price: { ...SARVAM_STT_PRICE }, rateDigest: SARVAM_RATE_DIGEST,
        capMinor: setting.capMinor, cap: rupees(setting.capMinor), spentMinor: spent, spent: rupees(spent),
        line: connected
          ? `Not tried live yet: Sarvam's call follows its public docs and hasn't run on a real key. ${rupees(spent)} of ${rupees(setting.capMinor)} used this month.`
          : `Sarvam waits on your key. Its price is ${rupees(SARVAM_STT_PRICE.paisePerMinute)} a minute, read on its page on ${SARVAM_STT_PRICE.checkedOn}.`,
      },
      speak: { label: speaks ? 'write' : 'planned: write', line: speaks ? READ_LINE : TALK_WORDS.readOnScreen },
      session: session ? { id: session.id, expiresAt: new Date(session.expires).toISOString() } : null,
      recordings: this.rows().filter(row => row.kept).length,
      line: this.host.hosted() ? TALK_WORDS.hosted : given ? TALK_WORDS.checkWords : TALK_WORDS.consent,
    };
  }

  /** venture.talk.consent: talk.ts talkConsentHandler. */
  private consent(p: Record<string, unknown>): TalkView {
    const body = exact(p, ['digest', 'keepAudio', 'withdraw']);
    if (body.withdraw !== undefined) need(body.withdraw === true && body.digest === undefined && body.keepAudio === undefined, 'INVALID_VENTURE_REQUEST', 'Send withdraw alone.');
    else {
      need(typeof body.keepAudio === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether to keep recordings.');
      need(body.digest === TALK_CONSENT_DIGEST, 'APPROVAL_STALE', TALK_WORDS.stale);
    }
    const setting = this.setting();
    if (body.withdraw) {
      for (const row of this.rows()) row.kept = false;
      this.settings.set(this.host.current(), { ...setting, consentDigest: null, consentAt: null, keepAudio: false });
      for (const session of this.live()) this.sessions.delete(session.id);
    } else {
      this.settings.set(this.host.current(), { ...setting, consentDigest: TALK_CONSENT_DIGEST, consentAt: this.host.now(), keepAudio: body.keepAudio as boolean });
    }
    return this.view();
  }

  /** venture.talk.setup: talk.ts talkSetupHandler. The rehearsal keeps only whether a key was given. */
  private setup(p: Record<string, unknown>): TalkView {
    const body = exact(p, ['listen', 'key', 'capMinor', 'rateDigest', 'clearSarvam']);
    const setting = this.setting();
    if (body.clearSarvam !== undefined) {
      need(body.clearSarvam === true && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Send clearSarvam alone.');
      this.settings.set(this.host.current(), { ...setting, listen: 'whisper-local', rateDigest: null, sarvamKey: false });
    } else if (body.listen === 'sarvam') {
      need(typeof body.capMinor === 'string' && /^\d{1,12}$/.test(body.capMinor), 'INVALID_AMOUNT', 'Give your monthly Sarvam limit in whole paise.');
      need(body.rateDigest === SARVAM_RATE_DIGEST, 'APPROVAL_STALE', 'Sarvam\'s price changed. Review it again before approving.');
      if (body.key !== undefined) need(typeof body.key === 'string' && body.key.length >= 8 && body.key.length <= 500 && !/\s/.test(body.key), 'INVALID_VENTURE_REQUEST', 'Paste your Sarvam API subscription key.');
      else need(setting.sarvamKey, 'TALK_NOT_READY', TALK_WORDS.noSarvam);
      this.settings.set(this.host.current(), { ...setting, listen: 'sarvam', capMinor: body.capMinor as string, rateDigest: SARVAM_RATE_DIGEST, sarvamKey: true });
    } else {
      need(body.listen === 'whisper-local' && Object.keys(body).length === 1, 'INVALID_VENTURE_REQUEST', 'Choose whisper.cpp or Sarvam.');
      this.settings.set(this.host.current(), { ...setting, listen: 'whisper-local' });
    }
    return this.view();
  }

  /** venture.talk.start: talk.ts talkStartHandler. */
  private start(p: Record<string, unknown>): TalkStarted {
    exact(p ?? {}, []);
    need(!this.host.hosted(), 'TIER_UNAVAILABLE', TALK_WORDS.hosted);
    const setting = this.setting();
    need(setting.consentDigest === TALK_CONSENT_DIGEST, 'TALK_CONSENT_REQUIRED', setting.consentDigest ? TALK_WORDS.stale : TALK_WORDS.consent);
    const provider = setting.listen;
    need(provider === 'sarvam' ? this.sarvamReady(setting) : this.whisperReady(), 'TALK_NOT_READY', provider === 'sarvam' ? TALK_WORDS.noSarvam : TALK_WORDS.noWhisper);
    for (const session of this.live()) this.sessions.delete(session.id);
    const session: Session = { id: `talk-${++this.seq}`, business: this.host.current(), provider, expires: this.nowMs() + TALK_SESSION_MS };
    this.sessions.set(session.id, session);
    return { sessionId: session.id, expiresAt: new Date(session.expires).toISOString(), seconds: TALK_SECONDS, provider };
  }

  /** venture.talk.hear: talk.ts talkHearHandler, with the rehearsal's own words in place of recognition. */
  private hear(p: Record<string, unknown>): TalkHeard {
    need(!this.host.hosted(), 'TIER_UNAVAILABLE', TALK_WORDS.hosted);
    const body = exact(p, ['sessionId', 'audioBase64'], ['sessionId', 'audioBase64']);
    const session = typeof body.sessionId === 'string' ? this.live().find(item => item.id === body.sessionId) : undefined;
    need(session, 'TALK_SESSION_EXPIRED', TALK_WORDS.session);
    this.sessions.delete(session.id);
    const audio = captionAudioBytes(body.audioBase64);
    const durationMs = wavMs(audio.length);
    need(durationMs > 0, 'INVALID_AUDIO', TALK_WORDS.nothing);
    const setting = this.setting();
    need(setting.consentDigest === TALK_CONSENT_DIGEST, 'TALK_CONSENT_REQUIRED', TALK_WORDS.consent);
    if (session.provider === 'whisper-local') {
      need(this.whisperReady(), 'TALK_NOT_READY', TALK_WORDS.noWhisper);
      this.rows().push({ at: this.host.now(), provider: 'whisper-local', costMinor: '0', kept: setting.keepAudio });
      return { text: FAKE_TALK_WORDS, provider: 'whisper-local', kept: setting.keepAudio, cost: null, line: TALK_WORDS.checkWords };
    }
    need(this.sarvamReady(setting), 'TALK_NOT_READY', TALK_WORDS.noSarvam);
    const cost = sarvamCostMinor(durationMs);
    need(this.spent() + BigInt(cost) <= BigInt(setting.capMinor), 'TALK_CAP_REACHED', TALK_WORDS.cap);
    this.rows().push({ at: this.host.now(), provider: 'sarvam', costMinor: cost, kept: setting.keepAudio });
    return { text: FAKE_TALK_WORDS, provider: 'sarvam', kept: setting.keepAudio, cost: { minor: cost, figure: rupees(cost) }, line: TALK_WORDS.checkWords };
  }

  /** venture.talk.say: talk.ts talkSayHandler. The rehearsal never makes audio: with the quote seen it still says so. */
  private say(p: Record<string, unknown>): TalkSaid {
    const body = exact(p, ['threadId', 'messageId', 'quoted', 'approvedRateDigest'], ['threadId', 'messageId']);
    need(typeof body.threadId === 'string' && typeof body.messageId === 'string', 'TALK_NOT_FOUND', TALK_WORDS.notFound);
    let messages: ChiefMessageView[] = [];
    try { messages = (this.host.ask('venture.chief.thread.list', { threadId: body.threadId }) as { messages: ChiefMessageView[] }).messages; } catch { messages = []; }
    const message = messages.find(item => item.id === body.messageId && item.from === 'chief');
    need(message, 'TALK_NOT_FOUND', TALK_WORDS.notFound);
    const spoken = spokenFrom(message.parts as TalkPart[], message.worked.length, reportNumberEstimate);
    need(spoken, 'TALK_NOT_FOUND', TALK_WORDS.notFound);
    if (fakeSpeechAccount(this.host) === null) return { spoken, quote: null, audioBase64: null, line: TALK_WORDS.readOnScreen };
    // Google's standard price as speech-out.ts quotes it: four US dollars a million characters, rounded up to the micro-dollar.
    const chars = [...spoken].length;
    const micros = (BigInt(chars) * 4_000_000n + 999_999n) / 1_000_000n;
    const units = (micros + 50n) / 100n;
    const quote = { chars, figure: `USD ${units / 10000n}.${String(units % 10000n).padStart(4, '0')}`, checkedOn: '2026-10-29', textDigest: hash(spoken), rateDigest: hash(`rehearsal:${micros}`) };
    if (body.quoted === undefined) return { spoken, quote, audioBase64: null, line: READ_LINE };
    need(body.quoted === quote.textDigest, 'QUOTE_FIRST', `Show the quote first: ${chars} characters with Google Cloud Text-to-Speech costs about ${quote.figure} at its price of ${quote.checkedOn}.`);
    throw new EngineError('SPEECH_PLANNED', 'The rehearsal makes no audio. Read the answer on screen.');
  }
}
