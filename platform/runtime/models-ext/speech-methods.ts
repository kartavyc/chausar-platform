/**
 * models-ext speech part: the provider catalogue, "what it understood", the person's confirmation
 * of that exact reading, the offline recorded-clip bench and provider revocation. Provider configuration,
 * previews, approvals and transcription stay on the core `speech.*` methods (SpeechService), which keep
 * provider settings in this namespace under `speech.providers`; keys stay in memory, the broker or CHAUSAR_* variables.
 */
import { check, hash, money, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { ModulePart } from './part.ts';
import { MODULE_ID } from './part.ts';
import { SPEECH_DISCLOSURE, SPEECH_KINDS, SPEECH_NETWORK, speechNamespace } from '../speech.ts';
import type { SpeechKind } from '../speech.ts';
import { BHASHINI_DOCS, LIVE_VOICE_DOCS, SARVAM_DOCS, SARVAM_MAX_MS } from '../speech-providers.ts';
import { interpretSpeech } from '../speech-understood.ts';
import { BENCH_KINDS, runSpeechBench } from '../speech-bench.ts';

type Confirmation = { id: string; digest: string; understood: string; receiptId: string | null; memberId: string; epoch: number; createdAt: string; negations: number; numbers: { display: string; integer: string | null; paise: string | null }[]; ambiguities: number };
type SpeechNamespace = { confirmations?: Confirmation[]; benchRuns?: { id: string; ranAt: string; memberId: string; fixturesDigest: string; providers: unknown[] }[] };
const speechState = (state: State) => { const ns = speechNamespace(state) as SpeechNamespace; ns.confirmations ??= []; ns.benchRuns ??= []; return ns as Required<SpeechNamespace>; };
const onlyKeys = (payload: Record<string, unknown>, keys: string[]) => check(Object.keys(payload).every(k => keys.includes(k)), 'INVALID_REQUEST', 'Unknown speech request field.');

const CATALOGUE: Record<SpeechKind, { label: string; status: 'supported' | 'experimental'; privacyGate: string; cost: 'free' | 'per-minute'; needsFounderAccount: boolean; account: string | null; limits: string; docs: string | null }> = {
  'browser-transcript': { label: 'Browser speech (text only)', status: 'supported', cost: 'free', needsFounderAccount: false, account: null, docs: null,
    privacyGate: 'Chausar receives text only. The browser may send your voice to its own speech service.', limits: 'Up to ten thousand characters of text.' },
  'local-command': { label: 'Local whisper.cpp (slower, free)', status: 'supported', cost: 'free', needsFounderAccount: false, account: null, docs: 'https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md',
    privacyGate: 'Audio stays on this computer. Someone installs whisper-cli and a model file and checks them first.', limits: 'wav, mp3 or ogg, up to five minutes.' },
  'api-upload': { label: 'Recorded upload (OpenAI-compatible)', status: 'experimental', cost: 'per-minute', needsFounderAccount: true, account: 'An API key for the transcription service.', docs: 'https://platform.openai.com/docs/api-reference/audio/createTranscription',
    privacyGate: 'Needs the samples privacy setting. An owner approves the exact recording in the app; it is sent once.', limits: 'wav, mp3, mp4, webm or ogg, up to five minutes.' },
  'sarvam-stt': { label: 'Sarvam speech to text', status: 'experimental', cost: 'per-minute', needsFounderAccount: true, account: 'A Sarvam API subscription key.', docs: SARVAM_DOCS,
    privacyGate: 'Needs the samples privacy setting. An owner approves the exact recording in the app; it is sent once to Sarvam.', limits: `Up to ${SARVAM_MAX_MS / 1000} seconds per recording.` },
  'bhashini-asr': { label: 'Bhashini speech recognition', status: 'experimental', cost: 'per-minute', needsFounderAccount: true, account: 'A Bhashini integrator userID and ULCA API key.', docs: BHASHINI_DOCS,
    privacyGate: 'Needs the samples privacy setting. An owner approves the exact recording and the endpoint in the app. Chausar asks Bhashini where to send without audio, and stops if the answer differs from what was approved.', limits: 'wav recordings, up to five minutes.' },
  'live-voice': { label: 'Paid live voice', status: 'experimental', cost: 'per-minute', needsFounderAccount: true, account: 'An OpenAI API key with realtime access.', docs: LIVE_VOICE_DOCS,
    privacyGate: 'Needs the samples privacy setting. An owner approves the minute cap and its cost in the app. Chausar hands the app a one-minute session secret; it never streams audio itself.', limits: 'A minute cap up to thirty minutes. Minutes used are not measured.' },
};

async function catalogue(ctx: Context, host: ModuleHost) {
  const configured: any[] = await host.services.speech?.providers(ctx) ?? [];
  return {
    providers: SPEECH_KINDS.map(kind => {
      const entry = CATALOGUE[kind];
      return { kind, ...entry, network: SPEECH_NETWORK[kind], disclosure: SPEECH_DISCLOSURE[kind] ?? null,
        configured: configured.filter(p => p.kind === kind).map(p => ({ id: p.id, label: p.label ?? null, enabled: p.enabled, credentialConfigured: p.credentialConfigured,
          ratePerMinuteMinor: entry.cost === 'free' ? null : p.ratePerMinuteMinor, ratePerMinute: entry.cost === 'free' ? 'Free' : `${money(p.ratePerMinuteMinor)} per minute`,
          budgetMinor: entry.cost === 'free' ? null : p.budgetMinor, budget: entry.cost === 'free' ? 'Not applicable' : money(p.budgetMinor) })) };
    }),
    configurationStoredInWorkspace: true, credentialsStoredInWorkspace: false,
    credentials: 'Keys stay in memory, in the credential broker or in a CHAUSAR_ variable. After a restart, give the key again before sending audio.',
    understood: 'Every spoken question is shown as text, with negations and Indian amounts marked, and runs only after you confirm it.',
  };
}

function transcriptOf(ctx: Context, host: ModuleHost, payload: Record<string, any>): { text: string; receiptId: string | null } {
  check((typeof payload.text === 'string') !== (typeof payload.receiptId === 'string'), 'INVALID_REQUEST', 'Give either the transcript text or a speech receipt.');
  if (typeof payload.text === 'string') return { text: payload.text, receiptId: null };
  const receipt = host.store.read().modelReceipts.find(r => r.id === payload.receiptId && ['speech-receipt', 'speech-preview'].includes(r.kind) && r.memberId === ctx.memberId);
  check(receipt && (receipt.kind === 'speech-receipt' || receipt.status === 'completed') && typeof receipt.transcript === 'string', 'SPEECH_RECEIPT_NOT_FOUND', 'That transcript is not available.');
  return { text: receipt.transcript, receiptId: receipt.id };
}

export const speechPart: ModulePart = {
  methods: {
    'modelsx.speechCatalogue': { permission: 'read', handler: (ctx, payload, host) => { onlyKeys(payload, []); return catalogue(ctx, host); } },
    'modelsx.speechInterpret': { permission: 'read', handler: (ctx, payload, host) => {
      onlyKeys(payload, ['text', 'receiptId']); const { text, receiptId } = transcriptOf(ctx, host, payload);
      return { ...interpretSpeech(text), receiptId };
    } },
    'modelsx.speechConfirm': { permission: 'prepare', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['text', 'receiptId', 'digest']); check(typeof payload.digest === 'string' && /^[a-f0-9]{64}$/.test(payload.digest), 'INVALID_REQUEST', 'Confirm the exact reading you were shown.');
      const { text, receiptId } = transcriptOf(ctx, host, payload); const reading = interpretSpeech(text);
      check(reading.digest === payload.digest, 'UNDERSTOOD_CHANGED', 'The reading changed. Check it again before confirming.');
      check(reading.unclear.length === 0, 'SPEECH_UNCLEAR', 'Part of this was not heard clearly. Say it again or type it.');
      return host.store.update(state => {
        const ns = speechState(state);
        const confirmation: Confirmation = { id: newId('speech_confirmation'), digest: reading.digest, understood: reading.understood, receiptId, memberId: ctx.memberId, epoch: ctx.epoch, createdAt: now(),
          negations: reading.negations.length, numbers: reading.numbers.map(n => ({ display: n.display, integer: n.integer, paise: n.paise })), ambiguities: reading.ambiguities.length };
        ns.confirmations.push(confirmation); ns.confirmations.splice(0, Math.max(0, ns.confirmations.length - 500));
        return { confirmationId: confirmation.id, digest: confirmation.digest, understood: confirmation.understood, receiptId, confirmedAt: confirmation.createdAt };
      });
    } },
    'modelsx.speechRevoke': { permission: 'admin', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['providerId']); check(typeof payload.providerId === 'string' && payload.providerId.length <= 80, 'INVALID_REQUEST', 'Name the speech provider to revoke.');
      check(host.services.speech, 'SPEECH_UNAVAILABLE', 'Speech is not available in this workspace.'); return host.services.speech.revoke(ctx, payload.providerId);
    } },
    'modelsx.speechBench': { permission: 'prepare', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['kinds']); check(payload.kinds === undefined || (Array.isArray(payload.kinds) && payload.kinds.every((k: unknown) => typeof k === 'string')), 'INVALID_REQUEST', 'Choose speech provider kinds as a list.');
      check(host.options.speechBench !== undefined, 'SPEECH_BENCH_FIXTURES_REQUIRED', 'The speech bench runs only on recorded clips supplied by this installation.');
      const providers = await runSpeechBench(host.options.speechBench, payload.kinds ?? BENCH_KINDS);
      return host.store.update(state => {
        const ns = speechState(state); const run = { id: newId('speech_bench'), ranAt: now(), memberId: ctx.memberId, fixturesDigest: hash(JSON.stringify(host.options.speechBench)), providers };
        ns.benchRuns.push(run); ns.benchRuns.splice(0, Math.max(0, ns.benchRuns.length - 20));
        return { runId: run.id, ranAt: run.ranAt, fixturesDigest: run.fixturesDigest, recordedOffline: true, providers, notBenched: [{ kind: 'live-voice', reason: 'Live voice returns a session secret, not a transcript.' }, { kind: 'browser-transcript', reason: 'The browser returns text only.' }] };
      });
    } },
  },
  /** Provider settings and bench scores derive from no source. A confirmation goes with its speech receipt, whether this purge or an earlier one removed it. */
  purge(state, reason) {
    const ns = peekModuleState<{ speech?: SpeechNamespace }>(state, MODULE_ID)?.speech; if (!ns?.confirmations) return 0;
    const receipts = new Set(state.modelReceipts.map(r => r.id));
    const before = ns.confirmations.length; ns.confirmations = ns.confirmations.filter(c => !c.receiptId || (!reason.removedIds.has(c.receiptId) && receipts.has(c.receiptId))); return before - ns.confirmations.length;
  },
};
