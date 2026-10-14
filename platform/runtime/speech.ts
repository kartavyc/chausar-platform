import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { authorize, audit, check, ChausarError, hash, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { moduleState, peekModuleState } from './modules/types.ts';
import { MODULE_ID } from './models-ext/part.ts';
import { assertSourceAccess, isNoResend, trustFingerprint } from './trust.ts';
import { defaultProcess, validateEndpoint } from './gateway.ts';
import type { ProcessRequest, ProcessResult } from './gateway.ts';
import { BHASHINI_COMPUTE_ENDPOINT, BHASHINI_CONFIG_ENDPOINT, LIVE_MAX_MS, LIVE_VOICE_CONNECT, LIVE_VOICE_ENDPOINT, SARVAM_ENDPOINT, SARVAM_LANGUAGES, SARVAM_MAX_MS, SARVAM_MODELS,
  bhashiniComputeBody, bhashiniConfigBody, bhashiniInference, bhashiniTranscript, liveSecret, liveSecretBody, multipartForm, openAiTranscript, sarvamTranscript, wavSampleRate } from './speech-providers.ts';

export const SPEECH_KINDS = ['browser-transcript', 'local-command', 'api-upload', 'sarvam-stt', 'bhashini-asr', 'live-voice'] as const;
export type SpeechKind = typeof SPEECH_KINDS[number];
/** Kinds that send audio, or open a voice session, off this machine: samples policy, exact approval and a key. */
export const CLOUD_SPEECH_KINDS: readonly SpeechKind[] = ['api-upload', 'sarvam-stt', 'bhashini-asr', 'live-voice'];
export const SPEECH_NETWORK: Record<SpeechKind, string> = { 'browser-transcript': 'browser-provider-may-use-network', 'local-command': 'local-executable-operator-verified', 'api-upload': 'explicit-cloud-upload', 'sarvam-stt': 'explicit-cloud-upload', 'bhashini-asr': 'explicit-cloud-upload-two-step', 'live-voice': 'renderer-streams-to-provider-after-approval' };
export const SPEECH_DISCLOSURE: Partial<Record<SpeechKind, string>> = {
  'api-upload': 'The approved recording is uploaded once to the transcription endpoint shown.',
  'sarvam-stt': 'The approved recording is uploaded once to Sarvam at the endpoint shown.',
  'bhashini-asr': 'Chausar first asks Bhashini for its compute endpoint without sending audio, then uploads the approved recording once, only if that endpoint is the one shown.',
  'live-voice': 'Chausar requests a one-minute session secret. Your microphone audio then streams from this app directly to the provider until you stop or the minute cap is reached. Chausar cannot measure the minutes used.',
};
export type SpeechProvider = { id?: string; kind: SpeechKind; label?: string; endpoint?: string; command?: string; model?: string; ratePerMinuteMinor?: string; budgetMinor?: string; credentialEnv?: string; enabled?: boolean; language?: string; pipelineId?: string; serviceId?: string; configEndpoint?: string };
export type SpeechInput = { providerId: string; audioBase64?: string; mimeType?: string; durationMs?: number; transcript?: string; browserProvider?: string; sourceIds?: string[] };
/** A provider's non-secret settings as kept in the encrypted workspace; credentials never enter it. */
export type StoredSpeechProvider = SpeechProvider & { id: string; revision: number; enabled: boolean };
/** Speech settings live in the models-ext namespace, under `speech`, beside the speech part's confirmations and bench runs. */
export function speechNamespace(state: State): { providers?: StoredSpeechProvider[]; [key: string]: unknown } {
  const ns = moduleState<{ speech?: { providers?: StoredSpeechProvider[] } }>(state, MODULE_ID, () => ({})); return ns.speech ??= {};
}
const BROWSER_PROVIDER: StoredSpeechProvider = { id: 'browser', kind: 'browser-transcript', label: 'Browser transcript', enabled: true, revision: 1 };
/** Configured providers, with the built-in browser provider unless the workspace holds its own (revoked) record. */
function storedProviders(state: State): StoredSpeechProvider[] {
  const stored = peekModuleState<{ speech?: { providers?: StoredSpeechProvider[] } }>(state, MODULE_ID)?.speech?.providers ?? [];
  return [...(stored.some(p => p.id === 'browser') ? [] : [BROWSER_PROVIDER]), ...stored].map(p => structuredClone(p));
}
export type SpeechOptions = { http?: (request: { endpoint: string; headers: Record<string, string>; body: Uint8Array; redirect: 'error'; timeoutMs: number }) => Promise<{ status: number; body: string; endpoint?: string; requestId?: string }>; process?: (request: ProcessRequest) => Promise<ProcessResult>; credentialBroker?: (id: string) => string | undefined | Promise<string | undefined>;
  /** Trusted host evidence that its renderer ends a live voice session at the approved minute cap. Without it, live voice is refused. */
  liveVoiceCapEnforced?: boolean };

const AUDIO_EXTENSIONS = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' } as const;
type AudioMime = keyof typeof AUDIO_EXTENSIONS;
function isAudioMime(value: unknown): value is AudioMime { return typeof value === 'string' && Object.hasOwn(AUDIO_EXTENSIONS, value); }
function parseAudio(base64: string | undefined): Buffer {
  check(typeof base64 === 'string' && base64.length > 0 && base64.length <= 12000000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64), 'INVALID_AUDIO', 'Supply a supported audio recording under nine megabytes.');
  const data = Buffer.from(base64, 'base64'); check(data.length > 0 && data.toString('base64') === base64, 'INVALID_AUDIO', 'Audio encoding was invalid.'); return data;
}
function multipart(audio: Buffer, mime: AudioMime, model: string, boundary: string): Buffer {
  const extension = AUDIO_EXTENSIONS[mime];
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.${extension}"\r\nContent-Type: ${mime}\r\n\r\n`), audio, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}
async function upload(request: { endpoint: string; headers: Record<string, string>; body: Uint8Array; redirect: 'error'; timeoutMs: number }) {
  const response = await fetch(request.endpoint, { method: 'POST', headers: request.headers, body: Buffer.from(request.body), redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
  check(!response.headers.get('location'), 'REDIRECT_REFUSED', 'Speech redirects are refused.');
  const body = await response.text(); check(Buffer.byteLength(body) <= 262144, 'RESPONSE_TOO_LARGE', 'Speech transcription was too large.');
  return { status: response.status, body, endpoint: response.url, requestId: response.headers.get('x-request-id') || undefined };
}

export class SpeechService {
  store: StateStore; options: SpeechOptions; #credentials = new Map<string, string>();
  constructor(store: StateStore, options: SpeechOptions = {}) { this.store = store; this.options = options; }
  #provider(id: unknown): StoredSpeechProvider | undefined { return typeof id === 'string' ? storedProviders(this.store.read()).find(p => p.id === id) : undefined; }
  async configure(context: Context, config: SpeechProvider, secret?: string) {
    authorize(this.store, context, 'admin');
    check((SPEECH_KINDS as readonly string[]).includes(config.kind), 'INVALID_SPEECH_PROVIDER', 'Choose browser transcript, local command, API upload, Sarvam, Bhashini or live voice.');
    check(Object.keys(config).every(k => ['id', 'kind', 'label', 'endpoint', 'command', 'model', 'ratePerMinuteMinor', 'budgetMinor', 'credentialEnv', 'enabled', 'language', 'pipelineId', 'serviceId', 'configEndpoint'].includes(k)), 'INVALID_SPEECH_PROVIDER', 'Unknown speech provider configuration.');
    check(!['language', 'pipelineId', 'serviceId', 'configEndpoint'].some(k => (config as any)[k] !== undefined) || ['sarvam-stt', 'bhashini-asr'].includes(config.kind), 'INVALID_SPEECH_PROVIDER', 'Language and pipeline settings apply only to Sarvam or Bhashini.');
    const settings: Partial<SpeechProvider> = {};
    if (config.kind === 'sarvam-stt') {
      check((SARVAM_MODELS as readonly unknown[]).includes(config.model) && (config.language === undefined || (SARVAM_LANGUAGES as readonly unknown[]).includes(config.language)) && config.pipelineId === undefined && config.serviceId === undefined && config.configEndpoint === undefined, 'INVALID_SPEECH_PROVIDER', 'Choose a Sarvam saaras model and a supported language code.');
      Object.assign(settings, { endpoint: validateEndpoint(config.endpoint || SARVAM_ENDPOINT, 'openai-responses'), language: config.language ?? 'unknown' });
    }
    if (config.kind === 'bhashini-asr') {
      check(typeof config.language === 'string' && /^[a-z]{2,3}$/.test(config.language) && typeof config.pipelineId === 'string' && /^[A-Za-z0-9]{6,64}$/.test(config.pipelineId) && typeof config.serviceId === 'string' && /^[A-Za-z0-9_.:/-]{1,200}$/.test(config.serviceId) && config.model === undefined, 'INVALID_SPEECH_PROVIDER', 'Configure the Bhashini language, pipeline and speech service.');
      Object.assign(settings, { endpoint: validateEndpoint(config.endpoint || BHASHINI_COMPUTE_ENDPOINT, 'openai-responses'), configEndpoint: validateEndpoint(config.configEndpoint || BHASHINI_CONFIG_ENDPOINT, 'openai-responses') });
    }
    if (config.kind === 'live-voice') {
      check((config.endpoint ?? LIVE_VOICE_ENDPOINT) === LIVE_VOICE_ENDPOINT, 'LIVE_VOICE_NOT_VERIFIED', 'Only the documented realtime session endpoint is supported for live voice.');
      check(typeof config.model === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(config.model), 'INVALID_SPEECH_PROVIDER', 'Configure an explicit realtime voice model.');
      settings.endpoint = LIVE_VOICE_ENDPOINT;
    }
    if (config.kind === 'sarvam-stt' || config.kind === 'live-voice') check(typeof config.ratePerMinuteMinor === 'string' && /^[1-9]\d{0,29}$/.test(config.ratePerMinuteMinor), 'RATE_REQUIRED', 'Paid speech needs its cost per minute in paise.');
    if (config.kind === 'api-upload') { check(typeof config.model === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(config.model), 'INVALID_SPEECH_PROVIDER', 'Configure an explicit transcription model.'); validateEndpoint(config.endpoint || 'https://api.openai.com/v1/audio/transcriptions', 'openai-responses'); }
    if (config.kind === 'local-command') check(typeof config.command === 'string' && isAbsolute(config.command) && /(?:^|[\\/])whisper-cli(?:\.exe)?$/.test(config.command) && typeof config.model === 'string' && isAbsolute(config.model), 'INVALID_SPEECH_PROVIDER', 'Choose absolute paths to your installed whisper.cpp whisper-cli executable and model file.');
    for (const key of ['ratePerMinuteMinor', 'budgetMinor'] as const) if (config[key] !== undefined) check(typeof config[key] === 'string' && /^\d{1,30}$/.test(config[key]), 'INVALID_BUDGET', 'Speech costs use integer paise strings.');
    if (config.credentialEnv) check(/^CHAUSAR_[A-Z0-9_]+$/.test(config.credentialEnv), 'INVALID_CREDENTIAL', 'Use a dedicated CHAUSAR credential environment variable.');
    if (secret !== undefined) check(CLOUD_SPEECH_KINDS.includes(config.kind) && typeof secret === 'string' && secret.length <= 8192 && !/[\r\n]/.test(secret) && (config.kind !== 'bhashini-asr' || /^[^:\s]{1,256}:\S{1,4096}$/.test(secret)), 'INVALID_CREDENTIAL', 'Only cloud speech providers take an API key. Bhashini takes userID:ulcaApiKey.');
    check(config.id === undefined || (typeof config.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(config.id)), 'INVALID_SPEECH_PROVIDER', 'Use letters, digits, hyphens or underscores for the speech provider id.');
    check(config.label === undefined || (typeof config.label === 'string' && config.label.length <= 120), 'INVALID_SPEECH_PROVIDER', 'Use a short speech provider label.');
    check(config.enabled === undefined || typeof config.enabled === 'boolean', 'INVALID_SPEECH_PROVIDER', 'Enabled is true or false.');
    const id = config.id || newId('speech_provider');
    const provider: StoredSpeechProvider = await this.store.update(state => {
      authorize(this.store, context, 'admin'); const ns = speechNamespace(state); const providers = ns.providers ??= [];
      const previous = storedProviders(state).find(p => p.id === id);
      const next: StoredSpeechProvider = { ...structuredClone(config), ...settings, id, revision: (previous?.revision || 0) + 1, enabled: config.enabled ?? true, budgetMinor: config.budgetMinor || '10000', ratePerMinuteMinor: config.ratePerMinuteMinor || '0' };
      // A key given for one service is never sent to another: a changed kind or endpoint forgets the key held in memory.
      if (secret === undefined && previous && (previous.kind !== next.kind || previous.endpoint !== next.endpoint || previous.configEndpoint !== next.configEndpoint)) this.#credentials.delete(id);
      ns.providers = [...providers.filter(p => p.id !== id), next];
      audit(state, 'speech.provider.configured', { id, kind: next.kind, revision: next.revision, enabled: next.enabled }); return structuredClone(next);
    });
    if (secret) this.#credentials.set(id, secret);
    return this.#public(provider);
  }
  async #public(provider: StoredSpeechProvider) {
    const credentialConfigured = !CLOUD_SPEECH_KINDS.includes(provider.kind) || this.#credentials.has(provider.id) || Boolean(provider.credentialEnv && process.env[provider.credentialEnv]) || Boolean(await this.options.credentialBroker?.(provider.id));
    return { ...structuredClone(provider), credentialConfigured, experimental: true, verification: 'not-live-verified', network: SPEECH_NETWORK[provider.kind] };
  }
  async providers(context: Context) { authorize(this.store, context); return Promise.all(storedProviders(this.store.read()).map(p => this.#public(p))); }
  async preview(context: Context, input: SpeechInput) {
    authorize(this.store, context, 'prepare'); const provider = this.#provider(input.providerId);
    check(provider?.enabled, 'SPEECH_UNAVAILABLE', 'Configure a speech provider first.');
    const sourceIds = input.sourceIds || []; assertSourceAccess(this.store.read(), context, sourceIds);
    if (provider.kind === 'browser-transcript') {
      check(typeof input.transcript === 'string' && input.transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Supply the transcript returned by the browser.');
      const record = { id: newId('speech_preview'), kind: 'speech-preview', status: 'preview', createdAt: now(), providerId: provider.id, providerRevision: provider.revision, memberId: context.memberId, epoch: context.epoch, payload: input.transcript, digest: hash(input.transcript), sourceIds, endpoint: 'browser://transcript-received', approvalRequired: false, receiptBoundary: 'browser-transcript-to-application', browserProvider: input.browserProvider || 'unspecified', transcriptProviderVerified: false };
      return this.store.update(state => { authorize(this.store, context, 'prepare'); state.modelReceipts.push(record); return structuredClone(record); });
    }
    const cloud = CLOUD_SPEECH_KINDS.includes(provider.kind); const boundary = `chausar-${newId('audio')}`;
    let bytes: Buffer; let contentType = `multipart/form-data; boundary=${boundary}`; const extra: Record<string, unknown> = {};
    if (provider.kind === 'live-voice') {
      check(this.options.liveVoiceCapEnforced === true, 'LIVE_VOICE_CAP_NOT_ENFORCED', 'Live voice stays off until this app can end a session at its approved minute cap.');
      check(!context.channel || context.channel === 'desktop', 'APP_APPROVAL_REQUIRED', 'Live voice runs only inside the desktop app.');
      check(input.audioBase64 === undefined && input.mimeType === undefined, 'INVALID_AUDIO', 'A live voice preview carries no recording.');
      check(Number.isSafeInteger(input.durationMs) && input.durationMs! > 0 && input.durationMs! <= LIVE_MAX_MS, 'INVALID_LIVE_CAP', 'Give a live voice minute cap, up to thirty minutes.');
      check(this.store.read().policy.send === 'samples', 'SEND_DISABLED', 'Live voice requires the samples privacy setting and an exact approval.');
      bytes = Buffer.from(liveSecretBody(provider.model!)); contentType = 'application/json'; Object.assign(extra, { liveConnectEndpoint: LIVE_VOICE_CONNECT, liveCapMs: input.durationMs });
    } else {
      check(Number.isSafeInteger(input.durationMs) && input.durationMs! > 0 && input.durationMs! <= 300000, 'INVALID_AUDIO', 'Give the recording duration, up to five minutes.');
      if (provider.kind === 'sarvam-stt') check(input.durationMs! <= SARVAM_MAX_MS, 'INVALID_AUDIO', 'Sarvam takes recordings up to thirty seconds here.');
      const mimeType = input.mimeType;
      check(isAudioMime(mimeType), 'INVALID_AUDIO', 'Use wav, mp3, mp4, webm, or ogg audio.');
      if (provider.kind === 'local-command') check(['audio/wav', 'audio/mpeg', 'audio/ogg'].includes(input.mimeType!), 'INVALID_AUDIO', 'The local whisper.cpp adapter supports wav, mp3, and ogg recordings.');
      if (provider.kind === 'bhashini-asr') check(mimeType === 'audio/wav', 'INVALID_AUDIO', 'Bhashini takes wav recordings here.');
      const audio = parseAudio(input.audioBase64);
      if (cloud) check(this.store.read().policy.send === 'samples', 'SEND_DISABLED', 'Audio upload requires the samples privacy setting and an exact upload approval.');
      if (provider.kind === 'api-upload') bytes = multipart(audio, mimeType, provider.model!, boundary);
      else if (provider.kind === 'sarvam-stt') bytes = multipartForm([['model', provider.model!], ['language_code', provider.language!]], { name: 'file', filename: `recording.${AUDIO_EXTENSIONS[mimeType]}`, mime: mimeType, bytes: audio }, boundary);
      else if (provider.kind === 'bhashini-asr') {
        const samplingRate = wavSampleRate(audio); check(samplingRate, 'INVALID_AUDIO', 'The wav recording header could not be read.');
        bytes = Buffer.from(bhashiniComputeBody(provider.language!, provider.serviceId!, samplingRate, audio.toString('base64'))); contentType = 'application/json';
        Object.assign(extra, { configEndpoint: provider.configEndpoint, configPayload: bhashiniConfigBody(provider.language!, provider.pipelineId!), samplingRate });
      } else bytes = audio;
    }
    const digest = hash(bytes.toString('base64')); check(!isNoResend(this.store.read(), digest), 'NO_RESEND', 'This deleted recording cannot be uploaded again.');
    const record = { id: newId('speech_preview'), kind: 'speech-preview', status: 'preview', createdAt: now(), memberId: context.memberId, epoch: context.epoch,
      providerId: provider.id, providerRevision: provider.revision, sourceIds, trustFingerprint: trustFingerprint(this.store.read(), context, sourceIds), payloadBase64: bytes.toString('base64'), digest,
      endpoint: provider.kind === 'api-upload' ? provider.endpoint || 'https://api.openai.com/v1/audio/transcriptions' : cloud ? provider.endpoint : `local-command://${provider.command}`,
      contentType, mimeType: input.mimeType, durationMs: input.durationMs, ...extra, ...(cloud && provider.kind !== 'api-upload' ? { networkDisclosure: SPEECH_DISCLOSURE[provider.kind] } : {}),
      approvalRequired: cloud, receiptBoundary: provider.kind === 'live-voice' ? 'application-to-provider-session-secret' : provider.kind === 'bhashini-asr' ? 'application-to-provider-http-two-step' : cloud ? 'application-to-provider-http' : 'application-to-local-executable',
      costReservedMinor: '0', estimatedCostMinor: String((BigInt(input.durationMs!) * BigInt(provider.ratePerMinuteMinor!) + 59999n) / 60000n), costCurrency: 'INR' };
    return this.store.update(state => { authorize(this.store, context, 'prepare'); state.modelReceipts.push(record); return structuredClone(record); });
  }
  async approve(context: Context, previewId: string) {
    authorize(this.store, context, 'approve'); check(context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Approve an audio upload inside the app.');
    return this.store.update(state => { authorize(this.store, context, 'approve'); const preview = state.modelReceipts.find(r => r.id === previewId && r.kind === 'speech-preview' && r.status === 'preview'); check(preview, 'PREVIEW_NOT_FOUND', 'Create an unused audio preview first.');
      const approval = { id: newId('speech_approval'), kind: 'speech-approval', previewId, digest: preview.digest, endpoint: preview.endpoint, approverId: context.memberId, approverEpoch: context.epoch, createdAt: now(), expiresAt: new Date(Date.now() + 300000).toISOString(), used: false }; state.modelReceipts.push(approval); return approval; });
  }
  #current(context: Context, preview: any) {
    authorize(this.store, context, 'prepare'); const provider = this.#provider(preview.providerId);
    check(provider?.enabled && provider.revision === preview.providerRevision && preview.memberId === context.memberId && preview.epoch === context.epoch, 'SPEECH_REVOKED', 'Speech access changed after preview.');
    assertSourceAccess(this.store.read(), context, preview.sourceIds);
    check(trustFingerprint(this.store.read(), context, preview.sourceIds) === preview.trustFingerprint, 'PREVIEW_STALE', 'Privacy settings changed after the audio preview.');
    check(hash(preview.payloadBase64) === preview.digest && !isNoResend(this.store.read(), preview.digest), 'NO_RESEND', 'This audio preview changed or was deleted.');
    const current = this.store.read().modelReceipts.find(r => r.id === preview.id);
    if (preview.approvalRequired && current?.status === 'dispatching') {
      const approval = this.store.read().modelReceipts.find(a => a.id === current.approvalId && a.kind === 'speech-approval');
      const approver = this.store.read().members.find(m => m.id === approval?.approverId);
      check(approval?.used && approval.digest === preview.digest && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role), 'APPROVAL_REVOKED', 'The audio upload approval has been revoked.');
    }
    return provider;
  }
  async transcribe(context: Context, input: { previewId?: string; approvalId?: string; providerId?: string; transcript?: string; browserProvider?: string }) {
    authorize(this.store, context, 'prepare');
    if (!input.previewId) {
      const provider = this.#provider(input.providerId); check(provider?.enabled && provider.kind === 'browser-transcript', 'SPEECH_UNAVAILABLE', 'Select browser transcript or create an audio preview.');
      check(typeof input.transcript === 'string' && input.transcript.trim().length > 0 && input.transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Supply a browser transcript.');
      return this.store.update(state => { authorize(this.store, context, 'prepare'); const receipt = { id: newId('speech_receipt'), kind: 'speech-receipt', memberId: context.memberId, createdAt: now(), providerId: provider.id, endpoint: 'browser://transcript-received', digest: hash(input.transcript!), transcript: input.transcript, browserProvider: input.browserProvider || 'unspecified', providerVerified: false, networkDisclosure: 'The browser speech provider may process audio remotely. Chausar received text only.', costMeasured: false, actualCostMinor: null, attempts: 0 }; state.modelReceipts.push(receipt); return { transcript: input.transcript!, receipt }; });
    }
    const preview = structuredClone(this.store.read().modelReceipts.find(r => r.id === input.previewId && r.kind === 'speech-preview'));
    const browser = preview && this.#provider(preview.providerId);
    if (browser?.kind === 'browser-transcript') {
      check(browser.enabled && browser.revision === preview.providerRevision && preview.memberId === context.memberId && preview.epoch === context.epoch && preview.status === 'preview', 'SPEECH_REVOKED', 'The browser transcript preview is stale.');
      assertSourceAccess(this.store.read(), context, preview.sourceIds);
      return this.store.update(state => { authorize(this.store, context, 'prepare'); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt?.status === 'preview', 'ALREADY_SENT', 'This transcript has already been accepted.'); receipt.status = 'completed'; receipt.transcript = receipt.payload; receipt.costMeasured = false; receipt.actualCostMinor = null; receipt.attempts = 0; return { transcript: receipt.transcript, receipt: structuredClone(receipt) }; });
    }
    check(preview?.status === 'preview', 'PREVIEW_NOT_FOUND', 'Create an unused audio preview first.'); const provider = this.#current(context, preview);
    if (provider.kind === 'live-voice') check(this.options.liveVoiceCapEnforced === true && (!context.channel || context.channel === 'desktop'), 'LIVE_VOICE_CAP_NOT_ENFORCED', 'Live voice stays off until this app can end a session at its approved minute cap.');
    const key = this.#credentials.get(provider.id) || (provider.credentialEnv ? process.env[provider.credentialEnv] : undefined) || await this.options.credentialBroker?.(provider.id);
    if (CLOUD_SPEECH_KINDS.includes(provider.kind)) check(key, 'CREDENTIAL_REQUIRED', 'The upload provider needs an API key.');
    await this.store.update(state => {
      this.#current(context, preview); const current = state.modelReceipts.find(r => r.id === preview.id); check(current?.status === 'preview', 'ALREADY_SENT', 'Audio previews may be dispatched once.');
      if (preview.approvalRequired) {
        const approval = state.modelReceipts.find(a => a.id === input.approvalId && a.kind === 'speech-approval'); const approver = state.members.find(m => m.id === approval?.approverId);
        check(approval && !approval.used && approval.previewId === preview.id && approval.digest === preview.digest && approval.endpoint === preview.endpoint && Date.parse(approval.expiresAt) > Date.now() && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role), 'OUTBOUND_APPROVAL_REQUIRED', 'An owner must approve this exact audio upload.'); approval.used = true; current.approvalId = approval.id;
      }
      const spent = state.modelReceipts.filter(r => r.providerId === provider.id).reduce((sum, r) => sum + BigInt(r.costReservedMinor || '0'), 0n);
      check(spent + BigInt(preview.estimatedCostMinor) <= BigInt(provider.budgetMinor!), 'BUDGET_EXCEEDED', 'The speech rupee budget is exhausted.'); current.status = 'dispatching'; current.attempts = 1; current.costReservedMinor = preview.estimatedCostMinor;
    });
    let directory: string | undefined;
    try {
      let transcript: string | undefined; let live: { value: string; expiresAt: string } | undefined; const details: Record<string, unknown> = {}; this.#current(context, preview);
      if (provider.kind !== 'local-command') {
        const send = async (endpoint: string, headers: Record<string, string>, body: Uint8Array) => {
          const result = await (this.options.http || upload)({ endpoint, headers, body, redirect: 'error', timeoutMs: 120000 });
          check((!result.endpoint || result.endpoint === endpoint) && !(result.status >= 300 && result.status < 400), 'REDIRECT_REFUSED', 'Speech redirects are refused.'); check(result.status >= 200 && result.status < 300, 'SPEECH_FAILED', 'The speech provider failed without a retry.'); return result;
        };
        const payload = Buffer.from(preview.payloadBase64, 'base64');
        if (provider.kind === 'api-upload') transcript = openAiTranscript((await send(preview.endpoint, { Authorization: `Bearer ${key}`, 'Content-Type': preview.contentType }, payload)).body);
        else if (provider.kind === 'sarvam-stt') { const reply = sarvamTranscript((await send(preview.endpoint, { 'api-subscription-key': key!, 'Content-Type': preview.contentType }, payload)).body); transcript = reply.transcript; Object.assign(details, { detectedLanguage: reply.language ?? null, providerRequestId: reply.requestId ?? null }); }
        else if (provider.kind === 'bhashini-asr') {
          const split = key!.indexOf(':'); check(split > 0, 'INVALID_CREDENTIAL', 'Bhashini takes userID:ulcaApiKey.');
          // Step one sends no audio: only the language and pipeline the owner saw in the preview.
          const config = await send(preview.configEndpoint, { userID: key!.slice(0, split), ulcaApiKey: key!.slice(split + 1), 'Content-Type': 'application/json' }, Buffer.from(preview.configPayload));
          const inference = bhashiniInference(config.body, { endpoint: preview.endpoint, serviceId: provider.serviceId! }); details.configCalls = 1;
          this.#current(context, preview);
          transcript = bhashiniTranscript((await send(preview.endpoint, { [inference.header]: inference.key, 'Content-Type': 'application/json' }, payload)).body);
        } else live = liveSecret((await send(preview.endpoint, { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, payload)).body);
      } else {
        const mimeType: unknown = preview.mimeType; check(isAudioMime(mimeType), 'INVALID_AUDIO', 'Use a supported recording type.');
        directory = await mkdtemp(join(tmpdir(), 'chausar-speech-')); const extension = AUDIO_EXTENSIONS[mimeType]; const audioPath = join(directory, `recording.${extension}`); await writeFile(audioPath, Buffer.from(preview.payloadBase64, 'base64'), { mode: 0o600 });
        this.#current(context, preview);
        const result = await (this.options.process || defaultProcess)({ command: provider.command!, args: ['-m', provider.model!, '-f', audioPath, '-nt', '-np', '-nf', '-l', 'auto'], cwd: directory, env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' }, stdin: '', timeoutMs: 120000, schema: {} });
        check(result.exitCode === 0, 'SPEECH_FAILED', 'The local speech command failed without a retry.'); transcript = result.stdout.trim();
      }
      if (live) {
        const secret = live; this.#current(context, preview);
        return await this.store.update(state => { this.#current(context, preview); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt?.status === 'dispatching', 'SPEECH_REVOKED', 'The speech result has been revoked.');
          receipt.status = 'completed'; receipt.completedAt = now(); receipt.liveSessionExpiresAt = secret.expiresAt; receipt.costMeasured = false; receipt.actualCostMinor = null; audit(state, 'speech.live.session', { receiptId: receipt.id, providerId: provider.id });
          // The secret goes to the renderer in this reply only; state keeps its expiry, never its value.
          return { transcript: null, live: { clientSecret: secret.value, expiresAt: secret.expiresAt, connectEndpoint: LIVE_VOICE_CONNECT, model: provider.model, ratePerMinuteMinor: provider.ratePerMinuteMinor, capMs: preview.durationMs, reservedMinor: preview.estimatedCostMinor, experimental: true, disclosure: SPEECH_DISCLOSURE['live-voice'] }, receipt: structuredClone(receipt) }; });
      }
      this.#current(context, preview); check(typeof transcript === 'string' && transcript.trim().length > 0 && transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Speech provider returned an invalid transcript.');
      return this.store.update(state => { this.#current(context, preview); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt?.status === 'dispatching', 'SPEECH_REVOKED', 'The speech result has been revoked.'); receipt.status = 'completed'; receipt.completedAt = now(); receipt.transcript = transcript; Object.assign(receipt, details); receipt.costMeasured = false; receipt.actualCostMinor = null; audit(state, 'speech.transcribed', { receiptId: receipt.id, providerId: provider.id }); return { transcript, receipt: structuredClone(receipt) }; });
    } catch (error) { await this.store.update(state => { const receipt = state.modelReceipts.find(r => r.id === preview.id); if (receipt) { receipt.status = 'failed'; receipt.errorCode = error instanceof ChausarError ? error.code : 'SPEECH_FAILED'; } }); if (error instanceof ChausarError) throw error; throw new ChausarError('SPEECH_FAILED', 'Speech failed without a retry or fallback.'); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
  /** Disables a provider durably. Its revision moves on, so every earlier preview is refused, also after a restart. */
  async revoke(context: Context, providerId: string) {
    authorize(this.store, context, 'admin');
    const revoked = await this.store.update(state => {
      authorize(this.store, context, 'admin'); const provider = storedProviders(state).find(p => p.id === providerId); check(provider, 'SPEECH_UNAVAILABLE', 'Speech provider was not found.');
      const ns = speechNamespace(state); const next = { ...provider, enabled: false, revision: provider.revision + 1 };
      ns.providers = [...(ns.providers ?? []).filter(p => p.id !== providerId), next]; audit(state, 'speech.provider.revoked', { id: providerId, kind: provider.kind, revision: next.revision }); return next;
    });
    this.#credentials.delete(providerId); return { providerId, enabled: false, revision: revoked.revision };
  }
  clearCredentials() { this.#credentials.clear(); }
}
