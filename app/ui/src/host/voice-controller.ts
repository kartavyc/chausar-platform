/**
 * Talking to it (SH-05) over the models-ext lane's `voice.*` (bridge/voice-contract.ts).
 *
 * One hold is one session: `voice.start`, the words as they are heard (from the capture port),
 * then `voice.stop` with the transcript or the hold's audio. What was heard comes back as text;
 * any amount or date in it is shown back large to be answered Yes or Change, and the question is
 * confirmed as text with `voice.confirm` before it goes anywhere. Nothing runs from a hold alone.
 *
 * The audio of one hold lives only inside the capture port until `voice.stop` is sent; this
 * controller never stores it. Answers are spoken from `voice.speak` segments, which the engine
 * reads from the receipt's own figures. Voice is off by default: the status says so until the
 * person switches it on in Trust.
 */
import type { PlaceRpc } from '../places/types.ts';
import { notBuilt } from '../bridge/todayx-contract.ts';
import {
  isVoiceConfirm, isVoiceHeard, isVoiceStatus, readVoiceSpeak, readVoiceStart, VOICE_METHODS,
  type VoiceHeard, type VoiceStatus,
} from '../bridge/voice-contract.ts';

/** What one hold produced, in the capture port's hands until `voice.stop` takes it. */
export type VoiceTake =
  | { readonly transcript: string; readonly durationMs: number }
  | { readonly audioBase64: string; readonly mimeType: string; readonly durationMs: number };

/** Listening on this computer. The host supplies a browser one (voice-capture.ts); tests a fake. */
export interface VoiceCapturePort {
  /** Starts listening. False when this computer cannot capture this way. */
  begin(capture: 'browser-transcript' | 'record-audio', language: 'en' | 'hi', onWords: (words: string) => void): boolean;
  /** Ends listening and hands over the take (null when nothing was captured). */
  end(): Promise<VoiceTake | null>;
  /** Drops whatever was captured. */
  cancel(): void;
}
/** Speaking on this computer (browser speech synthesis). No audio leaves. */
export interface VoiceSpeakerPort {
  speak(texts: readonly string[], language: 'en' | 'hi', onEnd: () => void): boolean;
  stop(): void;
}

export type ReadBack = { readonly kind: 'amount'; readonly paise: string } | { readonly kind: 'date'; readonly text: string };

export type VoicePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'listening'; readonly words: string }
  | { readonly kind: 'reading'; readonly words: string }
  /** A paid provider waits for the owner's approval in Trust before audio leaves. */
  | { readonly kind: 'approval'; readonly costCapMinor: string }
  | {
    readonly kind: 'heard'; readonly sessionId: string; readonly text: string; readonly digest: string;
    /** Each amount or date heard, shown back large, and the answers so far (null: not answered). */
    readonly readBacks: readonly ReadBack[]; readonly answers: readonly (boolean | null)[];
    /** Words such as "nahi" that flip the meaning. */
    readonly flips: readonly string[]; readonly confirming: boolean;
  }
  | { readonly kind: 'unsure'; readonly words: string }
  | { readonly kind: 'off' }
  | { readonly kind: 'local-only' }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'failed'; readonly code: string };

export type VoiceStatusState = { readonly kind: 'loading' } | { readonly kind: 'not-built' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly value: VoiceStatus };
export type SpeakState = { readonly kind: 'quiet' } | { readonly kind: 'reading' } | { readonly kind: 'speaking'; readonly utteranceId: string; readonly receiptId: string } | { readonly kind: 'not-built' } | { readonly kind: 'failed' };

export interface VoiceSnapshot { readonly status: VoiceStatusState; readonly phase: VoicePhase; readonly speak: SpeakState }

export interface VoiceController {
  subscribe(listener: () => void): () => void;
  snapshot(): VoiceSnapshot;
  refresh(): Promise<void>;
  /** Hold start: begin a session. */
  start(): void;
  /** Hold end: send what was heard and read it back. */
  stop(): Promise<void>;
  /** A recorded voice note dropped on the ask line. Its bytes go to `voice.dropNote` and are not kept. */
  dropNote(note: { readonly audioBase64: string; readonly mimeType: string; readonly durationMs: number }): Promise<void>;
  /** Yes (true) or Change (false) to one amount or date shown back. */
  answer(index: number, yes: boolean): void;
  /** The person's yes to the question as text: `voice.confirm`, then the confirmed text (null when it could not be confirmed). */
  confirm(): Promise<string | null>;
  /** Drop the heard question (Change, or leaving it). */
  reset(): void;
  speak(receiptId: string, language: 'en' | 'hi'): Promise<void>;
  stopSpeaking(): void;
  /** Cash by voice (TD-02): one hold turned into text, nothing confirmed here. */
  listenOnce(): { start(): void; stop(): Promise<string | null> };
  dispose(): void;
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर';
const DATE = new RegExp(`\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, 'giu');

/** The amounts and dates in a reading, in order. Amounts are the engine's exact paise; a number with no unit is rupees. */
export function readBacksOf(heard: VoiceHeard): readonly ReadBack[] {
  const understood = heard.understood;
  if (understood === null) return [];
  const out: ReadBack[] = [];
  for (const n of understood.numbers) {
    const paise = n.paise ?? (n.unit === null && n.integer !== null ? (BigInt(n.integer) * 100n).toString() : null);
    if (paise !== null) out.push({ kind: 'amount', paise });
  }
  for (const match of understood.understood.matchAll(DATE)) out.push({ kind: 'date', text: match[0] });
  return out;
}
/** The negation words in a reading ("nahi", "नहीं", "don't"): the text shown must say they flip the meaning. */
export function flipsOf(heard: VoiceHeard): readonly string[] {
  const list = heard.understood?.negations ?? [];
  return list.flatMap(n => typeof n === 'object' && n !== null && typeof (n as { text?: unknown }).text === 'string' && (n as { kind?: unknown }).kind !== 'exclusion'
    ? [((n as { text: string }).text).slice(0, 40)] : []);
}

function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

export function createVoiceController(rpc: PlaceRpc, capture: VoiceCapturePort | null, speaker: VoiceSpeakerPort | null, language: () => 'en' | 'hi'): VoiceController {
  let state: VoiceSnapshot = { status: { kind: 'loading' }, phase: { kind: 'idle' }, speak: { kind: 'quiet' } };
  const listeners = new Set<() => void>();
  let turn = 0, speakTurn = 0, disposed = false;
  let session: { readonly id: string; readonly turn: number } | null = null;
  const set = (next: Partial<VoiceSnapshot>) => { if (disposed) return; state = { ...state, ...next }; for (const l of [...listeners]) l(); };
  const phase = (p: VoicePhase) => set({ phase: p });
  const refusal = (error: unknown, mine: number): void => {
    if (mine !== turn) return;
    const code = codeOf(error);
    if (notBuilt(error)) phase({ kind: 'not-built' });
    else if (code === 'VOICE_OFF') { phase({ kind: 'off' }); void controller.refresh(); }
    else if (code === 'VOICE_LOCAL_ONLY') phase({ kind: 'local-only' });
    else phase({ kind: 'failed', code });
  };
  const heardPhase = (reply: VoiceHeard, caught: string): VoicePhase => {
    if (reply.heard === null || reply.understood === null) return { kind: 'unsure', words: caught };
    const readBacks = readBacksOf(reply);
    return { kind: 'heard', sessionId: reply.sessionId, text: reply.understood.understood, digest: reply.understood.digest, readBacks, answers: readBacks.map(() => null), flips: flipsOf(reply), confirming: false };
  };
  const send = async (method: string, payload: Record<string, unknown>, mine: number, caught: string, sessionId?: string) => {
    try {
      const reply = await rpc.request(method, payload);
      if (mine !== turn) return;
      phase(isVoiceHeard(reply, sessionId) ? heardPhase(reply, caught) : { kind: 'failed', code: 'INVALID_REPLY' });
    } catch (error) { refusal(error, mine); }
  };

  const controller: VoiceController = {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    async refresh() {
      try {
        const reply = await rpc.request(VOICE_METHODS.status, {});
        set({ status: isVoiceStatus(reply) ? { kind: 'ready', value: reply } : { kind: 'failed' } });
      } catch (error) { set({ status: notBuilt(error) ? { kind: 'not-built' } : { kind: 'failed' } }); }
    },
    start() {
      const mine = ++turn; session = null;
      capture?.cancel();
      if (capture === null) { phase({ kind: 'not-built' }); return; }
      phase({ kind: 'starting' });
      void rpc.request(VOICE_METHODS.start, {}).then(reply => {
        if (mine !== turn) return;
        const started = readVoiceStart(reply);
        if (started === null) { phase({ kind: 'failed', code: 'INVALID_REPLY' }); return; }
        if (started.approval !== null) { phase({ kind: 'approval', costCapMinor: started.approval.costCapMinor }); return; }
        // Live (WebRTC) voice is not on this base: the ask line never asks for it.
        if (started.live || started.capture === 'live-session') { phase({ kind: 'failed', code: 'LIVE_VOICE_NOT_BUILT' }); return; }
        session = { id: started.sessionId, turn: mine };
        const began = capture.begin(started.capture, language(), words => { if (mine === turn && state.phase.kind === 'listening') phase({ kind: 'listening', words: words.slice(0, 2000) }); });
        if (!began) { session = null; phase({ kind: 'not-built' }); return; }
        phase({ kind: 'listening', words: '' });
      }, error => refusal(error, mine));
    },
    async stop() {
      const mine = turn, current = session;
      if (state.phase.kind === 'starting') { turn++; phase({ kind: 'idle' }); return; }
      if (current === null || current.turn !== mine || state.phase.kind !== 'listening' || capture === null) return;
      const caught = state.phase.words;
      session = null;
      phase({ kind: 'reading', words: caught });
      let take: VoiceTake | null;
      try { take = await capture.end(); } catch { take = null; }
      if (mine !== turn) return;
      const payload: Record<string, unknown> = { sessionId: current.id, durationMs: take?.durationMs ?? 0 };
      if (take !== null && 'transcript' in take) payload['transcript'] = take.transcript.slice(0, 10000);
      else if (take !== null) { payload['audioBase64'] = take.audioBase64; payload['mimeType'] = take.mimeType; }
      take = null;
      await send(VOICE_METHODS.stop, payload, mine, caught, current.id);
    },
    async dropNote(note) {
      const mine = ++turn; session = null; capture?.cancel();
      phase({ kind: 'reading', words: '' });
      await send(VOICE_METHODS.dropNote, { audioBase64: note.audioBase64, mimeType: note.mimeType, durationMs: note.durationMs }, mine, '');
    },
    answer(index, yes) {
      const p = state.phase;
      if (p.kind !== 'heard' || p.confirming || index < 0 || index >= p.readBacks.length) return;
      phase({ ...p, answers: p.answers.map((a, i) => i === index ? yes : a) });
    },
    async confirm() {
      const p = state.phase, mine = turn;
      // The intent is confirmed as text, and only once every amount and date shown back was answered Yes.
      if (p.kind !== 'heard' || p.confirming || !p.answers.every(a => a === true)) return null;
      phase({ ...p, confirming: true });
      try {
        const reply = await rpc.request(VOICE_METHODS.confirm, { sessionId: p.sessionId, digest: p.digest });
        if (mine !== turn) return null;
        if (!isVoiceConfirm(reply, p.digest)) { phase({ kind: 'failed', code: 'INVALID_REPLY' }); return null; }
        phase({ kind: 'idle' });
        return reply.text;
      } catch (error) { refusal(error, mine); return null; }
    },
    reset() { turn++; session = null; capture?.cancel(); phase({ kind: 'idle' }); },
    async speak(receiptId, lang) {
      const mine = ++speakTurn;
      speaker?.stop();
      if (speaker === null) { set({ speak: { kind: 'not-built' } }); return; }
      set({ speak: { kind: 'reading' } });
      try {
        const reply = readVoiceSpeak(await rpc.request(VOICE_METHODS.speak, { receiptId, language: lang }));
        if (mine !== speakTurn) return;
        if (reply === null) { set({ speak: { kind: 'failed' } }); return; }
        const spoken = speaker.speak(reply.segments.map(s => s.text), reply.language, () => { if (mine === speakTurn) set({ speak: { kind: 'quiet' } }); });
        set({ speak: spoken ? { kind: 'speaking', utteranceId: reply.utteranceId, receiptId } : { kind: 'not-built' } });
      } catch (error) { if (mine === speakTurn) set({ speak: notBuilt(error) ? { kind: 'not-built' } : { kind: 'failed' } }); }
    },
    stopSpeaking() {
      const current = state.speak;
      speakTurn++; speaker?.stop();
      set({ speak: { kind: 'quiet' } });
      if (current.kind === 'speaking') void rpc.request(VOICE_METHODS.stopSpeaking, { utteranceId: current.utteranceId }).catch(() => undefined);
    },
    listenOnce() {
      let opened: Promise<{ id: string } | null> = Promise.resolve(null);
      return {
        start() {
          capture?.cancel();
          opened = rpc.request(VOICE_METHODS.start, {}).then(reply => {
            const started = readVoiceStart(reply);
            if (started === null || started.approval !== null || started.live || capture === null || started.capture === 'live-session') return null;
            return capture.begin(started.capture, language(), () => undefined) ? { id: started.sessionId } : null;
          }, () => null);
        },
        async stop() {
          const open = await opened;
          if (open === null || capture === null) return null;
          const take = await capture.end().catch(() => null);
          const payload: Record<string, unknown> = { sessionId: open.id, durationMs: take?.durationMs ?? 0 };
          if (take !== null && 'transcript' in take) payload['transcript'] = take.transcript.slice(0, 10000);
          else if (take !== null) { payload['audioBase64'] = take.audioBase64; payload['mimeType'] = take.mimeType; }
          try {
            const reply = await rpc.request(VOICE_METHODS.stop, payload);
            return isVoiceHeard(reply, open.id) ? reply.heard : null;
          } catch { return null; }
        },
      };
    },
    dispose() { turn++; speakTurn++; capture?.cancel(); speaker?.stop(); disposed = true; listeners.clear(); },
  };
  return controller;
}
