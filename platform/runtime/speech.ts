import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { authorize, audit, check, ChausarError, hash, newId, now } from './contracts.ts';
import type { Context, StateStore } from './contracts.ts';
import { assertSourceAccess, isNoResend, trustFingerprint } from './trust.ts';
import { defaultProcess, validateEndpoint } from './gateway.ts';
import type { ProcessRequest, ProcessResult } from './gateway.ts';

export type SpeechProvider = { id?: string; kind: 'browser-transcript' | 'local-command' | 'api-upload'; label?: string; endpoint?: string; command?: string; model?: string; ratePerMinuteMinor?: string; budgetMinor?: string; credentialEnv?: string; enabled?: boolean };
export type SpeechInput = { providerId: string; audioBase64?: string; mimeType?: string; durationMs?: number; transcript?: string; browserProvider?: string; sourceIds?: string[] };
export type SpeechOptions = { http?: (request: { endpoint: string; headers: Record<string, string>; body: Uint8Array; redirect: 'error'; timeoutMs: number }) => Promise<{ status: number; body: string; endpoint?: string; requestId?: string }>; process?: (request: ProcessRequest) => Promise<ProcessResult>; credentialBroker?: (id: string) => string | undefined | Promise<string | undefined> };

const ALLOWED_MIME = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg'];
function parseAudio(base64: string | undefined): Buffer {
  check(typeof base64 === 'string' && base64.length > 0 && base64.length <= 12000000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64), 'INVALID_AUDIO', 'Supply a supported audio recording under nine megabytes.');
  const data = Buffer.from(base64, 'base64'); check(data.length > 0 && data.toString('base64') === base64, 'INVALID_AUDIO', 'Audio encoding was invalid.'); return data;
}
function multipart(audio: Buffer, mime: string, model: string, boundary: string): Buffer {
  const extension = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }[mime];
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.${extension}"\r\nContent-Type: ${mime}\r\n\r\n`), audio, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}
async function upload(request: { endpoint: string; headers: Record<string, string>; body: Uint8Array; redirect: 'error'; timeoutMs: number }) {
  const response = await fetch(request.endpoint, { method: 'POST', headers: request.headers, body: Buffer.from(request.body), redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
  check(!response.headers.get('location'), 'REDIRECT_REFUSED', 'Speech redirects are refused.');
  const body = await response.text(); check(Buffer.byteLength(body) <= 262144, 'RESPONSE_TOO_LARGE', 'Speech transcription was too large.');
  return { status: response.status, body, endpoint: response.url, requestId: response.headers.get('x-request-id') || undefined };
}

export class SpeechService {
  store: StateStore; options: SpeechOptions; #providers = new Map<string, SpeechProvider & { id: string; revision: number }>(); #credentials = new Map<string, string>();
  constructor(store: StateStore, options: SpeechOptions = {}) { this.store = store; this.options = options; this.#providers.set('browser', { id: 'browser', kind: 'browser-transcript', label: 'Browser transcript', enabled: true, revision: 1 }); }
  async configure(context: Context, config: SpeechProvider, secret?: string) {
    authorize(this.store, context, 'admin');
    check(['browser-transcript', 'local-command', 'api-upload'].includes(config.kind), 'INVALID_SPEECH_PROVIDER', 'Choose browser transcript, local command, or API upload.');
    check(Object.keys(config).every(k => ['id', 'kind', 'label', 'endpoint', 'command', 'model', 'ratePerMinuteMinor', 'budgetMinor', 'credentialEnv', 'enabled'].includes(k)), 'INVALID_SPEECH_PROVIDER', 'Unknown speech provider configuration.');
    if (config.kind === 'api-upload') { check(typeof config.model === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(config.model), 'INVALID_SPEECH_PROVIDER', 'Configure an explicit transcription model.'); validateEndpoint(config.endpoint || 'https://api.openai.com/v1/audio/transcriptions', 'openai-responses'); }
    if (config.kind === 'local-command') check(typeof config.command === 'string' && isAbsolute(config.command) && /(?:^|[\\/])whisper-cli(?:\.exe)?$/.test(config.command) && typeof config.model === 'string' && isAbsolute(config.model), 'INVALID_SPEECH_PROVIDER', 'Choose absolute paths to your installed whisper.cpp whisper-cli executable and model file.');
    for (const key of ['ratePerMinuteMinor', 'budgetMinor']) if (config[key] !== undefined) check(typeof config[key] === 'string' && /^\d{1,30}$/.test(config[key]), 'INVALID_BUDGET', 'Speech costs use integer paise strings.');
    if (config.credentialEnv) check(/^CHAUSAR_[A-Z0-9_]+$/.test(config.credentialEnv), 'INVALID_CREDENTIAL', 'Use a dedicated CHAUSAR credential environment variable.');
    if (secret !== undefined) check(config.kind === 'api-upload' && typeof secret === 'string' && secret.length <= 8192 && !/[\r\n]/.test(secret), 'INVALID_CREDENTIAL', 'Only API upload takes an API key.');
    const id = config.id || newId('speech_provider'); const previous = this.#providers.get(id);
    const provider = { ...structuredClone(config), id, revision: (previous?.revision || 0) + 1, enabled: config.enabled ?? true, budgetMinor: config.budgetMinor || '10000', ratePerMinuteMinor: config.ratePerMinuteMinor || '0' };
    this.#providers.set(id, provider); if (secret) this.#credentials.set(id, secret);
    await this.store.update(state => { audit(state, 'speech.provider.configured', { id, kind: config.kind }); }); return this.#public(provider);
  }
  #public(provider: any) { return { ...structuredClone(provider), credentialConfigured: provider.kind !== 'api-upload' || this.#credentials.has(provider.id) || Boolean(provider.credentialEnv && process.env[provider.credentialEnv]), experimental: true, verification: 'not-live-verified', network: provider.kind === 'api-upload' ? 'explicit-cloud-upload' : provider.kind === 'browser-transcript' ? 'browser-provider-may-use-network' : 'local-executable-operator-verified' }; }
  providers(context: Context) { authorize(this.store, context); return [...this.#providers.values()].map(p => this.#public(p)); }
  async preview(context: Context, input: SpeechInput) {
    authorize(this.store, context, 'prepare'); const provider = this.#providers.get(input.providerId);
    check(provider?.enabled, 'SPEECH_UNAVAILABLE', 'Configure a speech provider first.');
    const sourceIds = input.sourceIds || []; assertSourceAccess(this.store.read(), context, sourceIds);
    if (provider.kind === 'browser-transcript') {
      check(typeof input.transcript === 'string' && input.transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Supply the transcript returned by the browser.');
      const record = { id: newId('speech_preview'), kind: 'speech-preview', status: 'preview', createdAt: now(), providerId: provider.id, providerRevision: provider.revision, memberId: context.memberId, epoch: context.epoch, payload: input.transcript, digest: hash(input.transcript), sourceIds, endpoint: 'browser://transcript-received', approvalRequired: false, receiptBoundary: 'browser-transcript-to-application', browserProvider: input.browserProvider || 'unspecified', transcriptProviderVerified: false };
      return this.store.update(state => { authorize(this.store, context, 'prepare'); state.modelReceipts.push(record); return structuredClone(record); });
    }
    check(Number.isSafeInteger(input.durationMs) && input.durationMs! > 0 && input.durationMs! <= 300000, 'INVALID_AUDIO', 'Give the recording duration, up to five minutes.');
    check(ALLOWED_MIME.includes(input.mimeType || ''), 'INVALID_AUDIO', 'Use wav, mp3, mp4, webm, or ogg audio.');
    if (provider.kind === 'local-command') check(['audio/wav', 'audio/mpeg', 'audio/ogg'].includes(input.mimeType!), 'INVALID_AUDIO', 'The local whisper.cpp adapter supports wav, mp3, and ogg recordings.');
    const audio = parseAudio(input.audioBase64);
    if (provider.kind === 'api-upload') check(this.store.read().policy.send === 'samples', 'SEND_DISABLED', 'Audio upload requires the samples privacy setting and an exact upload approval.');
    const boundary = `chausar-${newId('audio')}`;
    const bytes = provider.kind === 'api-upload' ? multipart(audio, input.mimeType!, provider.model!, boundary) : audio;
    const digest = hash(bytes.toString('base64')); check(!isNoResend(this.store.read(), digest), 'NO_RESEND', 'This deleted recording cannot be uploaded again.');
    const record = { id: newId('speech_preview'), kind: 'speech-preview', status: 'preview', createdAt: now(), memberId: context.memberId, epoch: context.epoch,
      providerId: provider.id, providerRevision: provider.revision, sourceIds, trustFingerprint: trustFingerprint(this.store.read(), context, sourceIds), payloadBase64: bytes.toString('base64'), digest,
      endpoint: provider.kind === 'api-upload' ? provider.endpoint || 'https://api.openai.com/v1/audio/transcriptions' : `local-command://${provider.command}`,
      contentType: `multipart/form-data; boundary=${boundary}`, mimeType: input.mimeType, durationMs: input.durationMs,
      approvalRequired: provider.kind === 'api-upload', receiptBoundary: provider.kind === 'api-upload' ? 'application-to-provider-http' : 'application-to-local-executable',
      costReservedMinor: '0', estimatedCostMinor: String((BigInt(input.durationMs!) * BigInt(provider.ratePerMinuteMinor!) + 59999n) / 60000n), costCurrency: 'INR' };
    return this.store.update(state => { authorize(this.store, context, 'prepare'); state.modelReceipts.push(record); return structuredClone(record); });
  }
  async approve(context: Context, previewId: string) {
    authorize(this.store, context, 'approve'); check(context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Approve an audio upload inside the app.');
    return this.store.update(state => { authorize(this.store, context, 'approve'); const preview = state.modelReceipts.find(r => r.id === previewId && r.kind === 'speech-preview' && r.status === 'preview'); check(preview, 'PREVIEW_NOT_FOUND', 'Create an unused audio preview first.');
      const approval = { id: newId('speech_approval'), kind: 'speech-approval', previewId, digest: preview.digest, endpoint: preview.endpoint, approverId: context.memberId, approverEpoch: context.epoch, createdAt: now(), expiresAt: new Date(Date.now() + 300000).toISOString(), used: false }; state.modelReceipts.push(approval); return approval; });
  }
  #current(context: Context, preview: any) {
    authorize(this.store, context, 'prepare'); const provider = this.#providers.get(preview.providerId);
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
      const provider = this.#providers.get(input.providerId || ''); check(provider?.enabled && provider.kind === 'browser-transcript', 'SPEECH_UNAVAILABLE', 'Select browser transcript or create an audio preview.');
      check(typeof input.transcript === 'string' && input.transcript.trim().length > 0 && input.transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Supply a browser transcript.');
      return this.store.update(state => { authorize(this.store, context, 'prepare'); const receipt = { id: newId('speech_receipt'), kind: 'speech-receipt', memberId: context.memberId, createdAt: now(), providerId: provider.id, endpoint: 'browser://transcript-received', digest: hash(input.transcript!), transcript: input.transcript, browserProvider: input.browserProvider || 'unspecified', providerVerified: false, networkDisclosure: 'The browser speech provider may process audio remotely. Chausar received text only.', costMeasured: false, actualCostMinor: null, attempts: 0 }; state.modelReceipts.push(receipt); return { transcript: input.transcript!, receipt }; });
    }
    const preview = structuredClone(this.store.read().modelReceipts.find(r => r.id === input.previewId && r.kind === 'speech-preview'));
    const browser = preview && this.#providers.get(preview.providerId);
    if (browser?.kind === 'browser-transcript') {
      check(browser.enabled && browser.revision === preview.providerRevision && preview.memberId === context.memberId && preview.epoch === context.epoch && preview.status === 'preview', 'SPEECH_REVOKED', 'The browser transcript preview is stale.');
      assertSourceAccess(this.store.read(), context, preview.sourceIds);
      return this.store.update(state => { authorize(this.store, context, 'prepare'); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt?.status === 'preview', 'ALREADY_SENT', 'This transcript has already been accepted.'); receipt.status = 'completed'; receipt.transcript = receipt.payload; receipt.costMeasured = false; receipt.actualCostMinor = null; receipt.attempts = 0; return { transcript: receipt.transcript, receipt: structuredClone(receipt) }; });
    }
    check(preview?.status === 'preview', 'PREVIEW_NOT_FOUND', 'Create an unused audio preview first.'); const provider = this.#current(context, preview);
    const key = this.#credentials.get(provider.id) || (provider.credentialEnv ? process.env[provider.credentialEnv] : undefined) || await this.options.credentialBroker?.(provider.id);
    if (provider.kind === 'api-upload') check(key, 'CREDENTIAL_REQUIRED', 'The upload provider needs an API key.');
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
      let transcript: string; this.#current(context, preview);
      if (provider.kind === 'api-upload') {
        const result = await (this.options.http || upload)({ endpoint: preview.endpoint, headers: { Authorization: `Bearer ${key}`, 'Content-Type': preview.contentType }, body: Buffer.from(preview.payloadBase64, 'base64'), redirect: 'error', timeoutMs: 120000 });
        check((!result.endpoint || result.endpoint === preview.endpoint) && !(result.status >= 300 && result.status < 400), 'REDIRECT_REFUSED', 'Speech redirects are refused.'); check(result.status >= 200 && result.status < 300, 'SPEECH_FAILED', 'The speech provider failed without a retry.');
        let body: any; try { body = JSON.parse(result.body); } catch { throw new ChausarError('INVALID_TRANSCRIPT', 'Speech provider returned invalid JSON.'); } transcript = body.text;
      } else {
        directory = await mkdtemp(join(tmpdir(), 'chausar-speech-')); const extension = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }[preview.mimeType]; const audioPath = join(directory, `recording.${extension}`); await writeFile(audioPath, Buffer.from(preview.payloadBase64, 'base64'), { mode: 0o600 });
        this.#current(context, preview);
        const result = await (this.options.process || defaultProcess)({ command: provider.command!, args: ['-m', provider.model!, '-f', audioPath, '-nt', '-np', '-nf', '-l', 'auto'], cwd: directory, env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' }, stdin: '', timeoutMs: 120000, schema: {} });
        check(result.exitCode === 0, 'SPEECH_FAILED', 'The local speech command failed without a retry.'); transcript = result.stdout.trim();
      }
      this.#current(context, preview); check(typeof transcript === 'string' && transcript.trim().length > 0 && transcript.length <= 10000, 'INVALID_TRANSCRIPT', 'Speech provider returned an invalid transcript.');
      return this.store.update(state => { this.#current(context, preview); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt?.status === 'dispatching', 'SPEECH_REVOKED', 'The speech result has been revoked.'); receipt.status = 'completed'; receipt.completedAt = now(); receipt.transcript = transcript; receipt.costMeasured = false; receipt.actualCostMinor = null; audit(state, 'speech.transcribed', { receiptId: receipt.id, providerId: provider.id }); return { transcript, receipt: structuredClone(receipt) }; });
    } catch (error) { await this.store.update(state => { const receipt = state.modelReceipts.find(r => r.id === preview.id); if (receipt) { receipt.status = 'failed'; receipt.errorCode = error instanceof ChausarError ? error.code : 'SPEECH_FAILED'; } }); if (error instanceof ChausarError) throw error; throw new ChausarError('SPEECH_FAILED', 'Speech failed without a retry or fallback.'); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
  revoke(context: Context, providerId: string) { authorize(this.store, context, 'admin'); const provider = this.#providers.get(providerId); check(provider, 'SPEECH_UNAVAILABLE', 'Speech provider was not found.'); provider.enabled = false; provider.revision++; this.#credentials.delete(providerId); return { providerId, enabled: false }; }
  clearCredentials() { this.#credentials.clear(); }
}
