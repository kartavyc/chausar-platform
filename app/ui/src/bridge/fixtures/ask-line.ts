/**
 * Synthetic replies for the ask line (SH-04, SH-05) in the shapes of the owning lanes' Round 4
 * contracts: models-ext's `voice.*` and `modelsx.speech*`, ask's `askx.suggest` / `askx.search`,
 * and work-books' `records.search` / `books.memoryPropose` / `books.memoryConfirm`. The fake
 * engine serves none of these families itself; previews and tests register them with
 * `registerAskLineFixtures()`. Only previews and tests import this.
 *
 * The fake "speech" is text: a hold's transcript is used as heard, and a dropped note's
 * `audioBase64` is synthetic UTF-8 words in base64. The reading is a small fixed table
 * (Hindi and English number words, "lakh", "hazaar", "nahi"), never a model.
 */
import { registerFakeMethods, type FakeHandler } from '../fake.ts';
import { DEMO_CUSTOMERS, fakeHash } from './shop.ts';
import { indianGroup } from '../../format/money.ts';

export interface VoiceFixtureOptions {
  /** Off by default, as in the engine. */
  readonly enabled?: boolean;
  readonly mode?: 'browser' | 'local' | 'paid';
  /** Paid speech asks for approval before audio leaves. */
  readonly approval?: boolean;
  /** Send is nothing or shape: a cloud provider refuses. */
  readonly localOnly?: boolean;
}

const UNITS: Record<string, bigint> = {
  ek: 1n, do: 2n, teen: 3n, char: 4n, chaar: 4n, paanch: 5n, panch: 5n, chhe: 6n, saat: 7n, aath: 8n, nau: 9n, das: 10n, bees: 20n, pachas: 50n,
  one: 1n, two: 2n, three: 3n, four: 4n, five: 5n, six: 6n, seven: 7n, eight: 8n, nine: 9n, ten: 10n, twenty: 20n, fifty: 50n,
  'एक': 1n, 'दो': 2n, 'तीन': 3n, 'चार': 4n, 'पाँच': 5n, 'दस': 10n,
};
const MULTS: Record<string, bigint> = { sau: 100n, hundred: 100n, hazaar: 1000n, hazar: 1000n, thousand: 1000n, lakh: 100000n, 'लाख': 100000n, crore: 10000000n, 'करोड़': 10000000n, 'हज़ार': 1000n };
const NEGATIONS = new Set(['nahi', 'nahin', 'नहीं', 'not', "don't", 'dont', 'mat']);
const RUPEES = new Set(['rupaye', 'rupees', 'rupee', 'rs', '₹', 'रुपये']);

/** The fixed reading in `modelsx.speechInterpret`'s shape. */
export function fakeReading(text: string): Record<string, unknown> {
  const words = text.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const numbers: Record<string, unknown>[] = [], negations: Record<string, unknown>[] = [];
  const rupees = words.some(w => RUPEES.has(w));
  let value: bigint | null = null, said: string[] = [];
  const flush = () => {
    if (value === null) return;
    const integer = value.toString();
    numbers.push({ text: said.join(' '), integer, unit: rupees ? 'rupees' : null, paise: rupees ? (value * 100n).toString() : null, display: indianGroup(integer) });
    value = null; said = [];
  };
  for (const w of words) {
    const digits = /^\d{1,12}$/.test(w) ? BigInt(w) : null;
    if (digits !== null || UNITS[w] !== undefined) { if (value !== null && said.length && MULTS[said[said.length - 1]!] === undefined) flush(); value = (value ?? 0n) + (digits ?? UNITS[w]!); said.push(w); continue; }
    if (MULTS[w] !== undefined && value !== null) { value = value * MULTS[w]!; said.push(w); continue; }
    flush();
    if (NEGATIONS.has(w)) negations.push({ text: w, start: 0, end: w.length, kind: 'negation', note: 'This flips the meaning.', ambiguous: false });
  }
  flush();
  return {
    version: 1, normalised: text, understood: text, language: /[ऀ-ॿ]/.test(text) ? 'hi' : 'en', segments: [{ kind: 'text', text }],
    negations, numbers, ambiguities: [], unclear: text.trim() ? [] : [{ text: '', start: 0, end: 0, state: 'absent', note: 'Nothing was heard.' }],
    flipsMeaning: negations.length > 0, requiresConfirmation: true, digest: fakeHash(`reading:${text}`), receiptId: null,
  };
}

function decode(base64: string): string {
  try { return new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))); } catch { return ''; }
}

/** `voice.*` in models-ext's Round 4 shapes, kept in the fake engine's memory. */
export function voiceHandlers(options: VoiceFixtureOptions = {}): Readonly<Record<string, FakeHandler>> {
  const enabled = options.enabled === true, mode = enabled ? options.mode ?? 'local' : 'off';
  const sessions = new Map<string, { text: string | null; digest: string | null }>();
  let next = 0;
  const provider = mode === 'paid' ? { id: 'speech_paid_demo', kind: 'sarvam-stt', label: 'Paid speech (demo)', local: false, ratePerMinuteMinor: '200' }
    : mode === 'off' ? null : { id: 'speech_local_demo', kind: mode === 'browser' ? 'browser-transcript' : 'whisper-local', label: 'On this computer', local: true, ratePerMinuteMinor: null };
  const usage = (month: string) => ({
    month, providers: provider === null ? [] : [{ providerId: provider.id, kind: provider.kind, minutes: mode === 'paid' ? 3 : 0, minutesMs: mode === 'paid' ? 180000 : 0, costMinor: mode === 'paid' ? '600' : '0', basis: mode === 'paid' ? 'measured' : 'local' }],
    totals: { minutesMs: mode === 'paid' ? 180000 : 0, costMinor: mode === 'paid' ? '600' : '0' },
  });
  const on = (context: Parameters<FakeHandler>[1]) => {
    if (!enabled) throw context.refuse('VOICE_OFF', 'Voice is off.');
    if (context.role === 'viewer') throw context.refuse('FORBIDDEN', 'A viewer seat changes nothing.');
  };
  const heard = (sessionId: string, text: string) => {
    const reading = text.trim() ? fakeReading(text) : null;
    sessions.set(sessionId, { text: reading ? text : null, digest: reading ? reading['digest'] as string : null });
    return reading === null
      ? { sessionId, heard: null, understood: null, needsConfirmation: true, words: 'Not sure what was said.' }
      : { sessionId, heard: text, understood: reading, needsConfirmation: true, words: text };
  };
  return {
    status: (_p, context) => ({ enabled, mode, send: options.localOnly ? 'shape' : 'samples', localOnly: options.localOnly === true, provider, live: null, speaking: null, usage: usage(context.date.slice(0, 7)) }),
    usage: (payload, context) => usage(typeof payload['month'] === 'string' ? payload['month'] : context.date.slice(0, 7)),
    providers: () => ({ providers: provider === null ? [] : [provider] }),
    start: (_p, context) => {
      on(context);
      if (options.localOnly && mode === 'paid') throw context.refuse('VOICE_LOCAL_ONLY', 'Speech stays on this computer.');
      const sessionId = `voice_session_${++next}`;
      sessions.set(sessionId, { text: null, digest: null });
      return { sessionId, capture: mode === 'browser' ? 'browser-transcript' : 'record-audio', provider, capMs: 60000,
        ...(options.approval && mode === 'paid' ? { approval: { previewId: `speech_preview_${next}`, digest: fakeHash(`approval:${next}`), costCapMinor: '200' } } : {}) };
    },
    stop: (payload, context) => {
      on(context);
      const sessionId = String(payload['sessionId']);
      if (!sessions.has(sessionId)) throw context.refuse('VOICE_SESSION_NOT_FOUND', 'No such session.');
      const text = typeof payload['transcript'] === 'string' ? payload['transcript'] : typeof payload['audioBase64'] === 'string' ? decode(payload['audioBase64']) : '';
      return heard(sessionId, text);
    },
    dropNote: (payload, context) => {
      on(context);
      const sessionId = `voice_note_${++next}`;
      return heard(sessionId, typeof payload['audioBase64'] === 'string' ? decode(payload['audioBase64']) : '');
    },
    confirm: (payload, context) => {
      on(context);
      const session = sessions.get(String(payload['sessionId']));
      if (!session || session.digest === null || session.digest !== payload['digest']) throw context.refuse('UNDERSTOOD_CHANGED', 'What was heard changed.');
      if (payload['text'] !== undefined && payload['text'] !== session.text) throw context.refuse('UNDERSTOOD_CHANGED', 'What was heard changed.');
      sessions.delete(String(payload['sessionId']));
      return { confirmationId: `voice_confirmation_${next}`, text: session.text, digest: session.digest };
    },
    speak: (payload, context) => {
      on(context);
      const receiptId = String(payload['receiptId'] ?? '');
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(receiptId)) throw context.refuse('RECEIPT_NOT_FOUND', 'No such receipt.');
      return { utteranceId: `utterance_${++next}`, language: payload['language'] === 'hi' ? 'hi' : 'en', segments: [{ text: 'The figure on this receipt is' }, { text: '25 lakh 36 thousand 850 rupees', figureKey: 'value' }] };
    },
    stopSpeaking: (_p, context) => { on(context); return { stopped: true }; },
  };
}

/** `askx.suggest` and `askx.search` (ask), `records.search` (work-books). */
export function askSuggestHandlers(): { askx: Readonly<Record<string, FakeHandler>>; records: Readonly<Record<string, FakeHandler>> } {
  return {
    askx: {
      suggest: () => ({ suggestions: [
        { operationId: 'received', label: 'Money received', periodId: 'last-month', asked: 3, why: 'asked-before' },
        { operationId: 'billed', label: 'Amount billed', periodId: 'last-month', asked: 0, why: 'starter' },
        { operationId: 'aging', label: 'Money owed to us', periodId: 'this-month', asked: 0, why: 'starter' },
      ] }),
      search: payload => {
        const q = String(payload['query'] ?? '').toLowerCase();
        const saved = [{ id: 'saved_demo_1', text: 'Billed in September' }, { id: 'saved_demo_2', text: 'Received from Kiran Retail Demo' }]
          .filter(s => s.text.toLowerCase().includes(q)).map(s => ({ ...s, marks: [], ref: { savedKind: 'answer', receiptId: null, refId: null } }));
        return { query: payload['query'], groups: [{ kind: 'saved', hits: saved }, { kind: 'decision', hits: [] }] };
      },
    },
    records: {
      search: payload => {
        const q = String(payload['text'] ?? '').toLowerCase();
        return { records: DEMO_CUSTOMERS.filter(name => name.toLowerCase().includes(q)).map((name, i) => ({ id: `customer_demo_${i + 1}`, kind: 'customer', name, sources: ['src_demo'], facts: 3 })) };
      },
    },
  };
}

/** `books.memoryPropose` and `books.memoryConfirm` (work-books, BK-17), and what was stored. */
export function memoryHandlers(): { handlers: Readonly<Record<string, FakeHandler>>; lines: { id: string; text: string; status: string }[] } {
  const lines: { id: string; text: string; kind: string; status: string }[] = [];
  return {
    lines,
    handlers: {
      memoryPropose: (payload, context) => {
        if (context.role === 'viewer') throw context.refuse('FORBIDDEN', 'A viewer seat changes nothing.');
        const line = { id: `memory_demo_${lines.length + 1}`, text: String(payload['text']), kind: String(payload['kind']), status: 'proposed' };
        lines.push(line);
        return { ...line, source: 'told-by-owner', receiptId: null, learnedAt: `${context.date}T06:00:00.000Z`, confirmedAt: null, earlier: [] };
      },
      memoryConfirm: (payload, context) => {
        const line = lines.find(l => l.id === payload['id']);
        if (!line) throw context.refuse('MEMORY_NOT_FOUND', 'Not found.');
        line.status = 'told-by-owner';
        return { ...line, source: 'told-by-owner', receiptId: null, learnedAt: `${context.date}T06:00:00.000Z`, confirmedAt: `${context.date}T06:01:00.000Z`, earlier: [] };
      },
    },
  };
}

/** `modelsx.speechInterpret` and `modelsx.speechConfirm` for Today's cash by voice. */
export function speechHandlers(): Readonly<Record<string, FakeHandler>> {
  return {
    speechInterpret: payload => fakeReading(String(payload['text'] ?? '')),
    speechConfirm: payload => ({ confirmationId: 'speech_confirmation_demo', digest: payload['digest'], understood: String(payload['text'] ?? ''), receiptId: null, confirmedAt: '2026-09-30T06:05:00.000Z' }),
  };
}

/** Registers every family above. Returns the stored memory lines and a function that removes them all. */
export function registerAskLineFixtures(options: VoiceFixtureOptions & { readonly speech?: boolean } = {}): { undo: () => void; memory: ReturnType<typeof memoryHandlers>['lines'] } {
  const suggest = askSuggestHandlers(), memory = memoryHandlers();
  const undos = [
    registerFakeMethods('voice', voiceHandlers(options)),
    registerFakeMethods('askx', suggest.askx),
    registerFakeMethods('records', suggest.records),
    registerFakeMethods('books', memory.handlers),
    ...(options.speech === false ? [] : [registerFakeMethods('modelsx', speechHandlers())]),
  ];
  return { undo: () => { for (const u of undos) u(); }, memory: memory.lines };
}
