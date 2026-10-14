/**
 * Recorded-clip speech bench (plan day 8), fully offline.
 *
 * Each recorded clip carries tiny synthetic audio, the meaning a person expects ("payment nahi aaya"
 * is a negation; "do lakh" is 2,00,000) and, per provider kind, the provider's recorded reply. The
 * bench replays those replies through the real `SpeechService` (preview, exact approval, single
 * dispatch) over a scratch in-memory workspace, then reads each transcript with the deterministic
 * interpreter and scores it. The fixtures arrive only from a trusted host option or a test; there
 * is no live provider call and nothing touches the open workspace except the stored score.
 */
import { check, ChausarError, initialState } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { SpeechService } from './speech.ts';
import type { SpeechKind, SpeechProvider } from './speech.ts';
import { BHASHINI_CONFIG_ENDPOINT } from './speech-providers.ts';
import { interpretSpeech } from './speech-understood.ts';

export const BENCH_KINDS = ['api-upload', 'sarvam-stt', 'bhashini-asr', 'local-command'] as const satisfies readonly SpeechKind[];
type BenchKind = typeof BENCH_KINDS[number];
type Http = { status: number; body: string };
export type SpeechBenchClip = { id: string; mimeType: string; durationMs: number; audioBase64: string; trap: 'negation' | 'number' | null; expected: { negated: boolean; numbers: string[] } };
export type SpeechBenchFixtures = { version: 1; clips: SpeechBenchClip[]; providers: Partial<Record<BenchKind, Record<string, Http | { config: Http; compute: Http } | { exitCode: number; stdout: string }>>> };

/** Provider settings the replay uses; the recorded Bhashini config reply must name this pipeline's service. */
export const BENCH_PROVIDERS: Record<BenchKind, SpeechProvider> = {
  'api-upload': { id: 'bench-api-upload', kind: 'api-upload', model: 'whisper-1', ratePerMinuteMinor: '50', budgetMinor: '100000000' },
  'sarvam-stt': { id: 'bench-sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '50', budgetMinor: '100000000' },
  'bhashini-asr': { id: 'bench-bhashini', kind: 'bhashini-asr', language: 'hi', pipelineId: 'benchpipeline01', serviceId: 'bench-asr-hi', budgetMinor: '100000000' },
  'local-command': { id: 'bench-whisper', kind: 'local-command', command: '/bench/whisper-cli', model: '/bench/ggml-base.bin' },
};
const LABELS: Record<BenchKind, string> = { 'api-upload': 'Recorded upload (OpenAI-compatible)', 'sarvam-stt': 'Sarvam', 'bhashini-asr': 'Bhashini', 'local-command': 'Local whisper.cpp' };

const isHttp = (v: any) => v && typeof v === 'object' && Number.isSafeInteger(v.status) && typeof v.body === 'string' && v.body.length <= 262144 && Object.keys(v).length === 2;
const exactKeys = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
export function validateSpeechBench(value: unknown): SpeechBenchFixtures {
  const v = value as any; const fail = () => { throw new ChausarError('INVALID_SPEECH_BENCH', 'The recorded speech clips are malformed.'); };
  if (!exactKeys(v, ['version', 'clips', 'providers']) || v.version !== 1 || !Array.isArray(v.clips) || v.clips.length < 1 || v.clips.length > 100 || !exactKeys(v.providers, [...BENCH_KINDS])) fail();
  const ids = new Set<string>();
  for (const clip of v.clips) {
    if (!exactKeys(clip, ['id', 'mimeType', 'durationMs', 'audioBase64', 'trap', 'expected']) || typeof clip.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(clip.id) || ids.has(clip.id) || typeof clip.mimeType !== 'string' || !Number.isSafeInteger(clip.durationMs) || typeof clip.audioBase64 !== 'string'
      || ![null, 'negation', 'number'].includes(clip.trap) || !exactKeys(clip.expected, ['negated', 'numbers']) || typeof clip.expected.negated !== 'boolean' || !Array.isArray(clip.expected.numbers) || !clip.expected.numbers.every((n: unknown) => typeof n === 'string' && /^\d{1,30}$/.test(n))) fail();
    ids.add(clip.id);
  }
  for (const [kind, replies] of Object.entries(v.providers as Record<string, any>)) {
    if (!exactKeys(replies, [...ids]) || Object.keys(replies).length !== ids.size) fail();
    for (const reply of Object.values(replies as Record<string, any>)) {
      const ok = kind === 'bhashini-asr' ? exactKeys(reply, ['config', 'compute']) && isHttp(reply.config) && isHttp(reply.compute)
        : kind === 'local-command' ? exactKeys(reply, ['exitCode', 'stdout']) && Number.isSafeInteger(reply.exitCode) && typeof reply.stdout === 'string' && reply.stdout.length <= 10000 : isHttp(reply);
      if (!ok) fail();
    }
  }
  return structuredClone(v);
}

class ScratchStore implements StateStore { state: State = initialState('Speech bench'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };

export type SpeechBenchClipResult = { clipId: string; trap: SpeechBenchClip['trap']; transcript: string | null; understood: string | null; negated: boolean | null; numbers: string[]; meaningMatches: boolean; trapCaught: boolean | null; errorCode: string | null };
export type SpeechBenchProviderResult = { kind: BenchKind; label: string; recorded: boolean; clips: SpeechBenchClipResult[]; passed: number; total: number; trapsCaught: number; trapsTotal: number; bothTrapsCaught: boolean };

export async function runSpeechBench(input: unknown, kinds: readonly string[] = BENCH_KINDS): Promise<SpeechBenchProviderResult[]> {
  const fixtures = validateSpeechBench(input);
  check(kinds.every(k => (BENCH_KINDS as readonly string[]).includes(k)) && new Set(kinds).size === kinds.length && kinds.length > 0, 'INVALID_SPEECH_BENCH', 'Choose speech provider kinds the bench covers.');
  const results: SpeechBenchProviderResult[] = [];
  for (const kind of kinds as BenchKind[]) {
    const replies = fixtures.providers[kind]; const clips: SpeechBenchClipResult[] = [];
    if (!replies) { results.push({ kind, label: LABELS[kind], recorded: false, clips, passed: 0, total: 0, trapsCaught: 0, trapsTotal: 0, bothTrapsCaught: false }); continue; }
    let current = ''; const store = new ScratchStore(); store.state.policy.send = 'samples';
    const speech = new SpeechService(store, {
      http: async request => { const reply: any = replies[current]; return kind === 'bhashini-asr' ? (request.endpoint === BHASHINI_CONFIG_ENDPOINT ? reply.config : reply.compute) : reply; },
      process: async () => replies[current] as { exitCode: number; stdout: string },
    });
    const provider = await speech.configure(owner, BENCH_PROVIDERS[kind], kind === 'local-command' ? undefined : kind === 'bhashini-asr' ? 'bench-user:bench-fixture-key' : 'bench-fixture-key');
    for (const clip of fixtures.clips) {
      current = clip.id; let transcript: string | null = null; let errorCode: string | null = null;
      try {
        const preview = await speech.preview(owner, { providerId: provider.id, audioBase64: clip.audioBase64, mimeType: clip.mimeType, durationMs: clip.durationMs });
        const approval = preview.approvalRequired ? await speech.approve(owner, preview.id) : undefined;
        transcript = (await speech.transcribe(owner, { previewId: preview.id, approvalId: approval?.id })).transcript;
      } catch (error) { errorCode = error instanceof ChausarError ? error.code : 'SPEECH_FAILED'; }
      const reading = transcript === null ? null : interpretSpeech(transcript);
      const negated = reading ? reading.negations.some(n => !n.ambiguous) : null;
      const numbers = reading ? reading.numbers.flatMap(n => n.integer === null ? [] : [n.integer]) : [];
      const sameNumbers = numbers.length === clip.expected.numbers.length && [...numbers].sort().every((n, i) => n === [...clip.expected.numbers].sort()[i]);
      const meaningMatches = reading !== null && negated === clip.expected.negated && sameNumbers;
      const trapCaught = clip.trap === null ? null : reading !== null && (clip.trap === 'negation' ? negated === true : clip.expected.numbers.every(n => numbers.includes(n)));
      clips.push({ clipId: clip.id, trap: clip.trap, transcript, understood: reading?.understood ?? null, negated, numbers, meaningMatches, trapCaught, errorCode });
    }
    const traps = clips.filter(c => c.trap !== null);
    results.push({ kind, label: LABELS[kind], recorded: true, clips, passed: clips.filter(c => c.meaningMatches).length, total: clips.length, trapsCaught: traps.filter(c => c.trapCaught).length, trapsTotal: traps.length,
      bothTrapsCaught: ['negation', 'number'].every(trap => traps.some(c => c.trap === trap) && traps.filter(c => c.trap === trap).every(c => c.trapCaught)) });
  }
  return results;
}
