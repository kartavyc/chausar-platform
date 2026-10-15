/**
 * models-ext voice part (SH-05): the `voice.*` family over SpeechService, plus `modelsx.speechKey`.
 *
 * Voice is off by default; the setting lives in this namespace under `voice`. Every transcription goes through
 * SpeechService (browser transcript, local whisper, upload, Sarvam, Bhashini), every reading through `interpretSpeech`,
 * and every confirmation through the same code as `modelsx.speechConfirm`. When Send is `nothing` or `shape`, only
 * providers on this computer run (`VOICE_LOCAL_ONLY`). No raw audio is kept: SpeechService drops the bytes once a
 * preview is sent or fails, and this part drops them from previews that are cancelled or never sent.
 *
 * Live voice runs only here: `voice.start {live}` records the session, passes SpeechService a per-call trusted flag
 * (the core `speech.*` path stays refused with LIVE_VOICE_CAP_NOT_ENFORCED), and the session is closed at its cap:
 * `voice.stop` records the minutes used, and a session past `endsAt` is closed and charged the cap on the next voice call.
 * The renderer (app/ui/src/screens/voice/live-client.ts) hangs up by itself at `endsAt`.
 */
import { audit, check, ChausarError, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { ModulePart } from './part.ts';
import { MODULE_ID } from './part.ts';
import { CLOUD_SPEECH_KINDS, dropAudio } from '../speech.ts';
import type { SpeechKind, SpeechService, SpeechTrusted } from '../speech.ts';
import { LIVE_MAX_MS, SARVAM_MAX_MS } from '../speech-providers.ts';
import { interpretSpeech } from '../speech-understood.ts';
import { speakFigures } from '../speech-spoken.ts';
import { catalogue, confirmReading } from './speech-methods.ts';
import { isVoiceMonth, voiceMonth, voiceUsage } from './voice-usage.ts';

type Capture = 'browser-transcript' | 'record-audio' | 'live-session';
type SessionStatus = 'listening' | 'awaiting-approval' | 'live' | 'heard' | 'confirmed' | 'closed' | 'expired' | 'failed';
type VoiceSession = { id: string; memberId: string; epoch: number; providerId: string; kind: SpeechKind; capture: Capture; status: SessionStatus; createdAt: number;
  ratePerMinuteMinor: string; capMs: number | null; previewId?: string; receiptId?: string; startedAt?: number; endsAt?: number; closedBy?: 'stop' | 'cap' | 'voice-off'; heardRecorded?: boolean; confirmationId?: string };
type Speaking = { utteranceId: string; memberId: string; receiptId: string; at: number };
type VoiceNamespace = { enabled: boolean; providerId: string | null; sessions: VoiceSession[]; speaking: Speaking[] };

/** A session nobody finishes, and its unsent recording, is dropped after ten minutes. */
const IDLE_MS = 600000;
const DEFAULT_LIVE_CAP_MS = 300000;
const RECORD_KINDS: readonly SpeechKind[] = ['local-command', 'api-upload', 'sarvam-stt', 'bhashini-asr'];
const NOT_SURE = 'Not sure what was said.';

function voiceState(state: State): VoiceNamespace {
  const ns = moduleState<{ voice?: Partial<VoiceNamespace> }>(state, MODULE_ID, () => ({}));
  const voice = ns.voice ??= {}; voice.enabled ??= false; voice.providerId ??= null; voice.sessions ??= []; voice.speaking ??= [];
  return voice as VoiceNamespace;
}
const peekVoice = (state: State): VoiceNamespace => {
  const voice = peekModuleState<{ voice?: Partial<VoiceNamespace> }>(state, MODULE_ID)?.voice;
  return { enabled: voice?.enabled ?? false, providerId: voice?.providerId ?? null, sessions: voice?.sessions ?? [], speaking: voice?.speaking ?? [] };
};
const onlyKeys = (payload: Record<string, unknown>, keys: string[]) => check(Object.keys(payload).every(k => keys.includes(k)), 'INVALID_REQUEST', 'Unknown voice request field.');
const idOf = (value: unknown, prefix: string) => typeof value === 'string' && value.length <= 120 && value.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(value);
const charge = (ms: number, rate: string) => String((BigInt(ms) * BigInt(rate) + 59999n) / 60000n);
const iso = (ms: number) => new Date(ms).toISOString();

/** Milliseconds now: a trusted host clock when one is given (tests, fixtures), else the system clock. */
function clockMs(host: ModuleHost): number {
  const clock = host.options.clock; if (clock === undefined) return Date.now();
  check(typeof clock === 'function', 'VOICE_CLOCK_INVALID', 'The configured clock is not usable.');
  const value = clock(); const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  check(typeof ms === 'number' && Number.isFinite(ms), 'VOICE_CLOCK_INVALID', 'The configured clock is not usable.'); return ms;
}
function speechService(host: ModuleHost): SpeechService { check(host.services.speech, 'SPEECH_UNAVAILABLE', 'Speech is not available in this workspace.'); return host.services.speech; }
/** Trusted transports for tests and fixtures only; the installed app passes none and the real ones are used. */
function transports(host: ModuleHost): SpeechTrusted {
  const out: SpeechTrusted = {};
  if (typeof host.options.speechHttp === 'function') out.http = host.options.speechHttp as SpeechTrusted['http'];
  if (typeof host.options.speechProcess === 'function') out.process = host.options.speechProcess as SpeechTrusted['process'];
  return out;
}
const voiceOn = (host: ModuleHost) => check(peekVoice(host.store.read()).enabled, 'VOICE_OFF', 'Voice is off. Switch it on in Trust, Rules, Send.');
const desktop = (ctx: Context) => check(ctx.channel === 'desktop', 'VOICE_DESKTOP_ONLY', 'Voice runs inside the desktop app.');
const notDemo = (host: ModuleHost) => check(!host.demo, 'DEMO_PROVIDER_DISABLED', 'Synthetic demo mode keeps speech providers disabled. Use typed questions.');
const localOnly = (state: State) => state.policy.send === 'nothing' || state.policy.send === 'shape';

async function providerFor(ctx: Context, host: ModuleHost, id: unknown) {
  check(id === undefined || (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)), 'INVALID_REQUEST', 'Name the speech provider.');
  const chosen = id ?? peekVoice(host.store.read()).providerId ?? 'browser';
  const provider = (await speechService(host).providers(ctx)).find((p: any) => p.id === chosen);
  check(provider?.enabled, 'SPEECH_UNAVAILABLE', 'Configure and turn on that speech provider first.');
  return provider as { id: string; kind: SpeechKind; label?: string; ratePerMinuteMinor: string; credentialConfigured: boolean };
}
const publicProvider = (p: { id: string; kind: SpeechKind; label?: string; ratePerMinuteMinor?: string }) => ({
  id: p.id, kind: p.kind, label: p.label ?? null, local: !CLOUD_SPEECH_KINDS.includes(p.kind), ratePerMinuteMinor: CLOUD_SPEECH_KINDS.includes(p.kind) ? p.ratePerMinuteMinor ?? null : null });

/** Ends a live session: minutes on the engine clock, never past the cap, charged at the session's rate onto its receipt. */
function closeLive(state: State, session: VoiceSession, at: number, by: 'stop' | 'cap' | 'voice-off') {
  const minutesMs = Math.max(0, Math.min(at - session.startedAt!, session.capMs!)); const cost = charge(minutesMs, session.ratePerMinuteMinor);
  session.status = 'closed'; session.closedBy = by;
  const receipt = state.modelReceipts.find(r => r.id === session.receiptId);
  if (receipt) Object.assign(receipt, { liveMinutesMs: minutesMs, liveEndedAt: iso(session.startedAt! + minutesMs), liveChargedMinor: cost, liveClosedBy: by, costReservedMinor: cost });
  audit(state, 'voice.live.closed', { sessionId: session.id, providerId: session.providerId, minutesMs, costMinor: cost, closedBy: by });
  return { minutesMs, costMinor: cost, closedBy: by };
}
function dropPreview(state: State, previewId: string | undefined, status: 'expired' | 'dropped') {
  const preview = state.modelReceipts.find(r => r.id === previewId && r.kind === 'speech-preview');
  if (preview) { if (preview.status === 'preview') preview.status = status; dropAudio(preview); }
}
const due = (session: VoiceSession, at: number) => (session.status === 'live' && session.endsAt! <= at) || (['listening', 'awaiting-approval'].includes(session.status) && session.createdAt + IDLE_MS <= at);

/** Closes live sessions past their cap (charged the cap) and drops idle sessions and unsent recordings. Runs on every voice call. */
export async function sweepVoice(host: ModuleHost, at = clockMs(host)) {
  const state = host.store.read(); const voice = peekVoice(state);
  if (voice.sessions.some(s => due(s, at)) || voice.speaking.some(s => s.at + IDLE_MS <= at)) await host.store.update(next => {
    const ns = voiceState(next);
    for (const session of ns.sessions) {
      if (!due(session, at)) continue;
      if (session.status === 'live') closeLive(next, session, session.endsAt!, 'cap');
      else { session.status = 'expired'; dropPreview(next, session.previewId, 'expired'); }
    }
    ns.speaking = ns.speaking.filter(s => s.at + IDLE_MS > at);
    ns.sessions.splice(0, Math.max(0, ns.sessions.length - 200));
  });
  await host.services.speech?.expireUnsent(IDLE_MS);
}

function sessionOf(ctx: Context, host: ModuleHost, id: unknown): VoiceSession {
  check(idOf(id, 'voice_session_'), 'INVALID_REQUEST', 'Name the voice session.');
  const session = peekVoice(host.store.read()).sessions.find(s => s.id === id && s.memberId === ctx.memberId && s.epoch === ctx.epoch);
  check(session, 'VOICE_SESSION_NOT_FOUND', 'That voice session is not available.'); return structuredClone(session);
}
async function patchSession(host: ModuleHost, id: string, change: (session: VoiceSession, state: State) => void) {
  return host.store.update(state => { const session = voiceState(state).sessions.find(s => s.id === id); check(session, 'VOICE_SESSION_NOT_FOUND', 'That voice session is not available.'); change(session, state); return structuredClone(session); });
}

function heardReply(sessionId: string, heard: string | null, receiptId: string | null, extra: Record<string, unknown> = {}) {
  const understood = heard === null ? null : { ...interpretSpeech(heard), receiptId };
  const unsure = understood === null || understood.unclear.length > 0;
  return { sessionId, heard, understood, needsConfirmation: true as const, words: unsure ? NOT_SURE : 'Check what was understood, then confirm it.', receiptId, ...extra };
}

/** Sends one prepared recording (approved when it leaves this computer) and records what was heard. Nothing caught is `heard: null`. */
async function transcribeSession(ctx: Context, host: ModuleHost, session: VoiceSession, approvalId?: string) {
  const speech = speechService(host); let transcript: string | null = null;
  try {
    const result: any = await speech.transcribe(ctx, { previewId: session.previewId!, ...(approvalId ? { approvalId } : {}) }, transports(host)); transcript = result.transcript;
  } catch (error) {
    const preview = host.store.read().modelReceipts.find(r => r.id === session.previewId);
    if (preview?.status === 'preview') throw error;
    await patchSession(host, session.id, (s, state) => { s.status = 'failed'; dropPreview(state, s.previewId, 'dropped'); });
    if (!(error instanceof ChausarError && error.code === 'INVALID_TRANSCRIPT')) throw error;
  }
  const at = clockMs(host);
  await patchSession(host, session.id, (s, state) => {
    if (transcript === null) return;
    s.status = 'heard'; s.receiptId = s.previewId; s.heardRecorded = true;
    const receipt = state.modelReceipts.find(r => r.id === s.previewId); if (receipt) Object.assign(receipt, { voiceAt: iso(at), voiceSessionId: s.id });
  });
  return heardReply(session.id, transcript, transcript === null ? null : session.previewId!);
}

/** Validates a recorded clip's fields; SpeechService checks the bytes themselves. */
function recording(payload: Record<string, any>) {
  check(typeof payload.audioBase64 === 'string' && typeof payload.mimeType === 'string' && Number.isSafeInteger(payload.durationMs), 'INVALID_AUDIO', 'Give the recording, its type and its length.');
  return { audioBase64: payload.audioBase64 as string, mimeType: payload.mimeType as string, durationMs: payload.durationMs as number };
}

/** A recorded clip for a listening session: transcribed at once on this computer, or prepared for the owner's approval when it would leave. */
async function recordOnto(ctx: Context, host: ModuleHost, session: VoiceSession, clip: ReturnType<typeof recording>) {
  const preview: any = await speechService(host).preview(ctx, { providerId: session.providerId, ...clip });
  const updated = await patchSession(host, session.id, s => { s.previewId = preview.id; if (preview.approvalRequired) s.status = 'awaiting-approval'; });
  if (preview.approvalRequired) return { ...heardReply(session.id, null, null), words: 'Approve sending this recording, then stop again with the approval.',
    approval: { previewId: preview.id, digest: preview.digest, costCapMinor: preview.estimatedCostMinor } };
  return transcribeSession(ctx, host, updated);
}

async function newSession(ctx: Context, host: ModuleHost, provider: { id: string; kind: SpeechKind; ratePerMinuteMinor: string }, capture: Capture, capMs: number | null) {
  const session: VoiceSession = { id: newId('voice_session'), memberId: ctx.memberId, epoch: ctx.epoch, providerId: provider.id, kind: provider.kind, capture, status: 'listening',
    createdAt: clockMs(host), ratePerMinuteMinor: provider.ratePerMinuteMinor || '0', capMs };
  await host.store.update(state => { voiceState(state).sessions.push(session); });
  return structuredClone(session);
}
const captureOf = (kind: SpeechKind): Capture => kind === 'browser-transcript' ? 'browser-transcript' : kind === 'live-voice' ? 'live-session' : 'record-audio';
const recordLimit = (kind: SpeechKind) => kind === 'browser-transcript' ? null : kind === 'sarvam-stt' ? SARVAM_MAX_MS : 300000;
function assertAllowed(host: ModuleHost, kind: SpeechKind) {
  check(!(localOnly(host.store.read()) && CLOUD_SPEECH_KINDS.includes(kind)), 'VOICE_LOCAL_ONLY', 'Send is set to nothing or shape, so speech is turned into text on this computer only.');
}

async function start(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  onlyKeys(payload, ['providerId', 'live', 'capMs', 'sessionId', 'approvalId']); notDemo(host); voiceOn(host); desktop(ctx); await sweepVoice(host);
  if (payload.sessionId !== undefined) {
    onlyKeys(payload, ['sessionId', 'approvalId']); check(idOf(payload.approvalId, 'speech_approval_'), 'INVALID_REQUEST', 'Give the approval for this live session.');
    const session = sessionOf(ctx, host, payload.sessionId);
    check(session.capture === 'live-session' && session.status === 'awaiting-approval', 'VOICE_SESSION_CLOSED', 'This live session cannot be started again.');
    assertAllowed(host, session.kind); const provider = await providerFor(ctx, host, session.providerId);
    let result: any;
    try { result = await speechService(host).transcribe(ctx, { previewId: session.previewId!, approvalId: payload.approvalId }, { ...transports(host), liveCapEnforced: true }); }
    catch (error) {
      if (host.store.read().modelReceipts.find(r => r.id === session.previewId)?.status !== 'preview') await patchSession(host, session.id, s => { s.status = 'failed'; });
      throw error;
    }
    const startedAt = clockMs(host); const endsAt = startedAt + session.capMs!;
    await patchSession(host, session.id, (s, state) => {
      s.status = 'live'; s.receiptId = s.previewId; s.startedAt = startedAt; s.endsAt = endsAt;
      const receipt = state.modelReceipts.find(r => r.id === s.previewId); if (receipt) Object.assign(receipt, { voiceSessionId: s.id, liveStartedAt: iso(startedAt), liveEndsAt: iso(endsAt) });
      audit(state, 'voice.live.started', { sessionId: s.id, providerId: s.providerId, capMs: s.capMs, endsAt: iso(endsAt) });
    });
    // The secret goes to the renderer in this reply only; state keeps the session times, never the secret.
    return { sessionId: session.id, capture: session.capture, provider: publicProvider(provider), capMs: session.capMs,
      live: { clientSecret: result.live.clientSecret, expiresAt: result.live.expiresAt, connectEndpoint: result.live.connectEndpoint, model: result.live.model, capMs: session.capMs, endsAt: iso(endsAt) } };
  }
  check(payload.live === undefined || typeof payload.live === 'boolean', 'INVALID_REQUEST', 'Live is true or false.');
  const provider = await providerFor(ctx, host, payload.providerId); const live = payload.live === true;
  check(live === (provider.kind === 'live-voice'), 'VOICE_PROVIDER_MISMATCH', live ? 'Choose a live voice provider for a live session.' : 'Live voice starts with live set to true.');
  assertAllowed(host, provider.kind);
  if (!live) {
    check(payload.capMs === undefined, 'INVALID_REQUEST', 'A minute cap applies to live voice only.');
    const session = await newSession(ctx, host, provider, captureOf(provider.kind), recordLimit(provider.kind));
    return { sessionId: session.id, capture: session.capture, provider: publicProvider(provider), capMs: session.capMs };
  }
  const capMs = payload.capMs ?? DEFAULT_LIVE_CAP_MS;
  check(Number.isSafeInteger(capMs) && capMs >= 1000 && capMs <= LIVE_MAX_MS, 'INVALID_LIVE_CAP', 'Give a live voice minute cap, up to thirty minutes.');
  check(!peekVoice(host.store.read()).sessions.some(s => s.memberId === ctx.memberId && s.capture === 'live-session' && ['awaiting-approval', 'live'].includes(s.status)), 'VOICE_LIVE_BUSY', 'A live voice session is already open. Stop it first.');
  const preview: any = await speechService(host).preview(ctx, { providerId: provider.id, durationMs: capMs }, { liveCapEnforced: true });
  const session = await newSession(ctx, host, provider, 'live-session', capMs);
  await patchSession(host, session.id, s => { s.previewId = preview.id; s.status = 'awaiting-approval'; });
  return { sessionId: session.id, capture: session.capture, provider: publicProvider(provider), capMs, approval: { previewId: preview.id, digest: preview.digest, costCapMinor: preview.estimatedCostMinor } };
}

async function stop(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  onlyKeys(payload, ['sessionId', 'transcript', 'audioBase64', 'mimeType', 'durationMs', 'approvalId']); notDemo(host); voiceOn(host); desktop(ctx);
  const at = clockMs(host); await sweepVoice(host, at); const session = sessionOf(ctx, host, payload.sessionId);
  check(payload.transcript === undefined || (typeof payload.transcript === 'string' && payload.transcript.length <= 10000), 'INVALID_TRANSCRIPT', 'Give the words heard, under ten thousand characters.');
  check(payload.durationMs === undefined || (Number.isSafeInteger(payload.durationMs) && payload.durationMs >= 0 && payload.durationMs <= LIVE_MAX_MS), 'INVALID_REQUEST', 'Give the length heard in milliseconds.');
  const heardText = typeof payload.transcript === 'string' && payload.transcript.trim() ? payload.transcript : null;

  if (session.capture === 'live-session') {
    check(payload.audioBase64 === undefined && payload.mimeType === undefined && payload.approvalId === undefined, 'INVALID_REQUEST', 'A live session sends no recording here.');
    if (session.status === 'awaiting-approval') {
      await patchSession(host, session.id, (s, state) => { s.status = 'closed'; s.closedBy = 'stop'; dropPreview(state, s.previewId, 'dropped'); });
      return heardReply(session.id, null, null);
    }
    check(session.status === 'live' || (session.status === 'closed' && !session.heardRecorded && session.closedBy !== 'voice-off'), 'VOICE_SESSION_CLOSED', 'This voice session has ended.');
    const result = await host.store.update(state => {
      const s = voiceState(state).sessions.find(x => x.id === session.id)!;
      const receipt = state.modelReceipts.find(r => r.id === s.receiptId);
      const closed = s.status === 'live' ? closeLive(state, s, at, 'stop') : { minutesMs: receipt?.liveMinutesMs, costMinor: receipt?.liveChargedMinor, closedBy: s.closedBy };
      s.heardRecorded = true;
      if (heardText !== null && receipt) { receipt.transcript = heardText; s.status = 'heard'; }
      return closed;
    });
    return heardReply(session.id, heardText, heardText === null ? null : session.receiptId!, { live: result });
  }
  check(['listening', 'awaiting-approval'].includes(session.status), 'VOICE_SESSION_CLOSED', 'This voice session has ended.');
  if (session.capture === 'browser-transcript') {
    check(typeof payload.transcript === 'string' && payload.audioBase64 === undefined && payload.approvalId === undefined, 'INVALID_TRANSCRIPT', 'Give the words the browser heard.');
    check(Number.isSafeInteger(payload.durationMs), 'INVALID_REQUEST', 'Give the length heard in milliseconds.');
    if (heardText === null) { await patchSession(host, session.id, s => { s.status = 'closed'; s.closedBy = 'stop'; }); return heardReply(session.id, null, null); }
    const result: any = await speechService(host).transcribe(ctx, { providerId: session.providerId, transcript: heardText, browserProvider: 'voice' });
    await patchSession(host, session.id, (s, state) => {
      s.status = 'heard'; s.receiptId = result.receipt.id; s.heardRecorded = true;
      const receipt = state.modelReceipts.find(r => r.id === result.receipt.id); if (receipt) Object.assign(receipt, { voiceAt: iso(at), voiceSessionId: s.id, durationMs: payload.durationMs });
    });
    return heardReply(session.id, heardText, result.receipt.id);
  }
  check(payload.transcript === undefined, 'INVALID_REQUEST', 'A recording is turned into text by the provider, not given as text.');
  if (session.status === 'awaiting-approval') {
    check(idOf(payload.approvalId, 'speech_approval_') && payload.audioBase64 === undefined, 'OUTBOUND_APPROVAL_REQUIRED', 'An owner must approve this exact recording before it is sent.');
    assertAllowed(host, session.kind); return transcribeSession(ctx, host, session, payload.approvalId);
  }
  check(payload.approvalId === undefined, 'INVALID_REQUEST', 'Give the recording first.');
  return recordOnto(ctx, host, session, recording(payload));
}

async function setEnabled(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  onlyKeys(payload, ['enabled', 'providerId']); notDemo(host); desktop(ctx);
  check(!ctx.sourceTainted, 'VOICE_TAINTED_CONTEXT', 'A request that has read outside text cannot change voice settings.');
  check(typeof payload.enabled === 'boolean', 'INVALID_REQUEST', 'Enabled is true or false.');
  const provider = payload.enabled || payload.providerId !== undefined ? await providerFor(ctx, host, payload.providerId) : null;
  const at = clockMs(host);
  return host.store.update(state => {
    const ns = voiceState(state); ns.enabled = payload.enabled; if (provider) ns.providerId = provider.id;
    if (!ns.enabled) for (const session of ns.sessions) {
      if (session.status === 'live') closeLive(state, session, Math.min(at, session.endsAt!), 'voice-off');
      else if (['listening', 'awaiting-approval'].includes(session.status)) { session.status = 'closed'; session.closedBy = 'voice-off'; dropPreview(state, session.previewId, 'dropped'); }
    }
    if (!ns.enabled) ns.speaking = [];
    audit(state, 'voice.settings', { enabled: ns.enabled, providerId: ns.providerId });
    return { enabled: ns.enabled, providerId: ns.providerId };
  });
}

async function status(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  onlyKeys(payload, []); const at = clockMs(host); await sweepVoice(host, at);
  const state = host.store.read(); const voice = peekVoice(state);
  const provider = voice.providerId ? (await speechService(host).providers(ctx)).find((p: any) => p.id === voice.providerId) ?? null : null;
  const live = voice.sessions.find(s => s.memberId === ctx.memberId && s.status === 'live');
  const speaking = voice.speaking.find(s => s.memberId === ctx.memberId);
  const mode = !voice.enabled || !provider?.enabled ? 'off' : provider.kind === 'browser-transcript' ? 'browser' : provider.kind === 'local-command' ? 'local' : 'paid';
  return { enabled: voice.enabled, mode, send: state.policy.send, localOnly: localOnly(state), provider: provider ? publicProvider(provider) : null,
    live: live ? { sessionId: live.id, startedAt: iso(live.startedAt!), capMs: live.capMs, endsAt: iso(live.endsAt!) } : null,
    speaking: speaking ? { utteranceId: speaking.utteranceId } : null, usage: voiceUsage(state, voiceMonth(at)) };
}

export const voicePart: ModulePart = {
  methods: {
    'voice.status': { permission: 'read', handler: status },
    'voice.setEnabled': { permission: 'admin', handler: setEnabled },
    'voice.providers': { permission: 'read', handler: (ctx, payload, host) => { onlyKeys(payload, []); return catalogue(ctx, host); } },
    'voice.start': { permission: 'prepare', handler: start },
    'voice.stop': { permission: 'prepare', handler: stop },
    'voice.confirm': { permission: 'prepare', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['sessionId', 'digest', 'text']); voiceOn(host); await sweepVoice(host);
      check(typeof payload.digest === 'string' && /^[a-f0-9]{64}$/.test(payload.digest), 'INVALID_REQUEST', 'Confirm the exact reading you were shown.');
      check(payload.text === undefined || (typeof payload.text === 'string' && payload.text.trim().length > 0 && payload.text.length <= 10000), 'INVALID_TRANSCRIPT', 'Give the changed words, under ten thousand characters.');
      const session = sessionOf(ctx, host, payload.sessionId);
      check(session.status === 'heard' && session.receiptId, 'VOICE_NOTHING_HEARD', 'Nothing heard in this session is waiting to be confirmed.');
      const receipt = host.store.read().modelReceipts.find(r => r.id === session.receiptId && r.memberId === ctx.memberId);
      check(receipt && typeof receipt.transcript === 'string', 'SPEECH_RECEIPT_NOT_FOUND', 'That transcript is not available.');
      // An edit is re-read here: the digest must be the reading of the edited words the person was shown.
      const text: string = payload.text ?? receipt.transcript;
      const confirmed = await confirmReading(ctx, host, text, receipt.id, payload.digest, payload.text !== undefined && payload.text !== receipt.transcript);
      await patchSession(host, session.id, s => { s.status = 'confirmed'; s.confirmationId = confirmed.confirmationId; });
      return { confirmationId: confirmed.confirmationId, text, understood: confirmed.understood, digest: confirmed.digest, receiptId: receipt.id };
    } },
    'voice.dropNote': { permission: 'prepare', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['audioBase64', 'mimeType', 'durationMs', 'providerId']); notDemo(host); voiceOn(host); desktop(ctx); await sweepVoice(host);
      const clip = recording(payload); const provider = await providerFor(ctx, host, payload.providerId);
      check(RECORD_KINDS.includes(provider.kind), 'VOICE_PROVIDER_MISMATCH', 'Choose a provider that turns recordings into text: local whisper or a recorded upload.');
      assertAllowed(host, provider.kind);
      const session = await newSession(ctx, host, provider, 'record-audio', recordLimit(provider.kind));
      return recordOnto(ctx, host, session, clip);
    } },
    'voice.speak': { permission: 'read', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['receiptId', 'language']); voiceOn(host);
      check(typeof payload.receiptId === 'string' && payload.receiptId.length <= 200, 'INVALID_REQUEST', 'Name the answer receipt to read aloud.');
      check(payload.language === undefined || payload.language === 'en' || payload.language === 'hi', 'INVALID_REQUEST', 'Speak in en or hi.');
      const language: 'en' | 'hi' = payload.language ?? 'en';
      // The calculator's own receipt, read as this caller with every access check; its written explanation is never read.
      const receipt = await host.call('receipts.get', { id: payload.receiptId }) as { figures: any[]; stale?: boolean };
      const segments = speakFigures({ figures: Array.isArray(receipt?.figures) ? receipt.figures : [], stale: receipt?.stale === true }, language);
      const utteranceId = newId('voice_utterance'); const at = clockMs(host);
      await host.store.update(state => { const ns = voiceState(state); ns.speaking = [...ns.speaking.filter(s => s.memberId !== ctx.memberId), { utteranceId, memberId: ctx.memberId, receiptId: payload.receiptId, at }]; });
      return { utteranceId, language, segments, receiptId: payload.receiptId };
    } },
    'voice.stopSpeaking': { permission: 'read', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['utteranceId']); voiceOn(host); check(idOf(payload.utteranceId, 'voice_utterance_'), 'INVALID_REQUEST', 'Name the answer being spoken.');
      if (peekVoice(host.store.read()).speaking.some(s => s.utteranceId === payload.utteranceId && s.memberId === ctx.memberId))
        await host.store.update(state => { const ns = voiceState(state); ns.speaking = ns.speaking.filter(s => !(s.utteranceId === payload.utteranceId && s.memberId === ctx.memberId)); });
      return { stopped: true };
    } },
    'voice.usage': { permission: 'read', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['month']); check(payload.month === undefined || isVoiceMonth(payload.month), 'INVALID_REQUEST', 'Give the month as YYYY-MM.');
      const at = clockMs(host); await sweepVoice(host, at); return voiceUsage(host.store.read(), payload.month ?? voiceMonth(at));
    } },
    'modelsx.speechKey': { permission: 'admin', handler: async (ctx, payload, host) => {
      onlyKeys(payload, ['providerId', 'secret']); notDemo(host);
      check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'SPEECH_KEY_APP_ONLY', 'Give a speech key inside the desktop app.');
      check(typeof payload.providerId === 'string' && payload.providerId.length <= 80, 'INVALID_REQUEST', 'Name the speech provider.');
      return speechService(host).supplyKey(ctx, payload.providerId, payload.secret);
    } },
  },
  /** A session goes with its speech receipt, and every session older than the retention period goes. */
  purge(state, reason) {
    const voice = peekModuleState<{ voice?: Partial<VoiceNamespace> }>(state, MODULE_ID)?.voice; if (!voice?.sessions) return 0;
    const receipts = new Set(state.modelReceipts.map(r => r.id)); const before = voice.sessions.length;
    voice.sessions = voice.sessions.filter(s => !(s.receiptId && (reason.removedIds.has(s.receiptId) || !receipts.has(s.receiptId))) && !(reason.cutoff !== undefined && s.createdAt < reason.cutoff));
    voice.speaking = (voice.speaking ?? []).filter(s => !reason.removedIds.has(s.receiptId));
    return before - voice.sessions.length;
  },
};
