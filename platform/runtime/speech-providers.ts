/**
 * Wire formats for the cloud speech providers behind `SpeechService`. Pure functions only:
 * request builders whose bytes the owner approves, and strict response readers. No transport here.
 *
 * Sarvam speech-to-text (REST, under 30 seconds):
 *   https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 *   POST https://api.sarvam.ai/speech-to-text, header `api-subscription-key`, multipart fields
 *   `file`, `model` (saaras:v4 | saaras:v3), `language_code` (BCP-47 or `unknown`); reply `{ request_id, transcript, language_code }`.
 * Bhashini (ULCA config call, then Dhruva compute call):
 *   https://bhashini.gitbook.io/bhashini-apis/pipeline-config-call
 *   https://bhashini.gitbook.io/bhashini-apis/pipeline-config-call/request-payload
 *   https://bhashini.gitbook.io/bhashini-apis/pipeline-config-call/response-payload
 *   https://bhashini.gitbook.io/bhashini-apis/pipeline-compute-call/request-payload
 *   https://bhashini.gitbook.io/bhashini-apis/pipeline-compute-call/response-payload
 *   Config: POST getModelsPipeline with headers `userID`, `ulcaApiKey` and `{ pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage } } }], pipelineRequestConfig: { pipelineId } }`;
 *   reply carries `pipelineResponseConfig[].config[].serviceId` and `pipelineInferenceAPIEndPoint.{ callbackUrl, inferenceApiKey: { name, value } }`.
 *   Compute: POST callbackUrl with header `<inferenceApiKey.name>: <inferenceApiKey.value>` and
 *   `{ pipelineTasks: [{ taskType: 'asr', config: { language, serviceId, audioFormat, samplingRate } }], inputData: { audio: [{ audioContent }] } }`;
 *   reply `{ pipelineResponse: [{ taskType: 'asr', output: [{ source }] }] }` (an ASR-only reply may be the bare task object).
 * OpenAI Realtime ephemeral client secret (paid live voice, experimental):
 *   https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
 *   https://developers.openai.com/api/docs/guides/realtime-webrtc
 *   POST https://api.openai.com/v1/realtime/client_secrets `{ expires_after: { anchor: 'created_at', seconds: 10..7200 },
 *   session: { type: 'transcription', audio: { input: { transcription: { model } } } } }` (a transcription session: input text only, no answers);
 *   reply `{ value: 'ek_…', expires_at: <epoch seconds>, session }`. The renderer connects to /v1/realtime/calls itself
 *   (app/ui/src/screens/voice/live-client.ts: POST the SDP offer, `Authorization: Bearer <ek_…>`, `Content-Type: application/sdp`).
 */
import { check, ChausarError } from './contracts.ts';

export const SARVAM_DOCS = 'https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe';
export const SARVAM_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
export const SARVAM_MODELS = ['saaras:v4', 'saaras:v3'] as const;
export const SARVAM_LANGUAGES = ['unknown', 'hi-IN', 'en-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN', 'gu-IN', 'as-IN', 'ur-IN', 'ne-IN', 'kok-IN', 'ks-IN', 'sd-IN', 'sa-IN', 'sat-IN', 'mni-IN', 'brx-IN', 'mai-IN', 'doi-IN'] as const;
export const SARVAM_MAX_MS = 30000;
export const BHASHINI_DOCS = 'https://bhashini.gitbook.io/bhashini-apis/pipeline-config-call';
export const BHASHINI_CONFIG_ENDPOINT = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
export const BHASHINI_COMPUTE_ENDPOINT = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
export const LIVE_VOICE_DOCS = 'https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create';
export const LIVE_VOICE_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
export const LIVE_VOICE_CONNECT = 'https://api.openai.com/v1/realtime/calls';
/** Ephemeral secrets live one minute: long enough to start the call, short enough to be useless if leaked. */
export const LIVE_SECRET_SECONDS = 60;
export const LIVE_MAX_MS = 1800000;

export function multipartForm(fields: readonly (readonly [string, string])[], file: { name: string; filename: string; mime: string; bytes: Buffer }, boundary: string): Buffer {
  const parts = fields.map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  return Buffer.concat([...parts, Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}

/** Sample rate from a canonical RIFF/WAVE `fmt ` chunk; undefined when the header cannot be read. */
export function wavSampleRate(audio: Buffer): number | undefined {
  if (audio.length < 44 || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') return undefined;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString('latin1', offset, offset + 4); const size = audio.readUInt32LE(offset + 4);
    if (id === 'fmt ' && size >= 16 && offset + 16 <= audio.length) { const rate = audio.readUInt32LE(offset + 12); return rate >= 8000 && rate <= 48000 ? rate : undefined; }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

export function bhashiniConfigBody(language: string, pipelineId: string): string {
  return JSON.stringify({ pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage: language } } }], pipelineRequestConfig: { pipelineId } });
}
export function bhashiniComputeBody(language: string, serviceId: string, samplingRate: number, audioBase64: string): string {
  return JSON.stringify({ pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage: language }, serviceId, audioFormat: 'wav', samplingRate } }], inputData: { audio: [{ audioContent: audioBase64 }] } });
}
/** A transcription-only session: the provider turns the person's speech into text and never answers, so no model words reach the app. */
export function liveSecretBody(model: string): string {
  return JSON.stringify({ expires_after: { anchor: 'created_at', seconds: LIVE_SECRET_SECONDS }, session: { type: 'transcription', audio: { input: { transcription: { model } } } } });
}

export function parseJson(body: string): any {
  try { return JSON.parse(body); } catch { throw new ChausarError('INVALID_TRANSCRIPT', 'Speech provider returned invalid JSON.'); }
}
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
export function openAiTranscript(body: string) { return text(parseJson(body)?.text); }
export function sarvamTranscript(body: string): { transcript?: string; language?: string; requestId?: string } {
  const reply = parseJson(body); const language = text(reply?.language_code); const requestId = text(reply?.request_id);
  return { transcript: text(reply?.transcript), language: language && /^[a-z]{2,3}-IN$/.test(language) ? language : undefined, requestId: requestId && /^[A-Za-z0-9_.:-]{1,128}$/.test(requestId) ? requestId : undefined };
}

const RESERVED_HEADERS = new Set(['content-type', 'content-length', 'host', 'cookie', 'transfer-encoding', 'connection']);
/** Reads the config reply. The audio may only go to the endpoint the owner saw, under the configured service. */
export function bhashiniInference(body: string, expected: { endpoint: string; serviceId: string }): { header: string; key: string } {
  const reply = parseJson(body); const point = reply?.pipelineInferenceAPIEndPoint;
  let callback: string | undefined; try { callback = new URL(text(point?.callbackUrl) ?? '').toString(); } catch { callback = undefined; }
  check(callback === expected.endpoint, 'BHASHINI_CALLBACK_MISMATCH', 'Bhashini returned a different compute endpoint from the one approved. Nothing was sent.');
  const asr = Array.isArray(reply?.pipelineResponseConfig) ? reply.pipelineResponseConfig.filter((task: any) => task?.taskType === 'asr') : [];
  check(asr.some((task: any) => Array.isArray(task.config) && task.config.some((entry: any) => entry?.serviceId === expected.serviceId)), 'BHASHINI_SERVICE_MISMATCH', 'Bhashini did not offer the approved speech service. Nothing was sent.');
  const header = text(point?.inferenceApiKey?.name); const key = text(point?.inferenceApiKey?.value);
  check(header && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) && !RESERVED_HEADERS.has(header.toLowerCase()) && key && key.length <= 4096 && !/[\r\n]/.test(key), 'BHASHINI_CONFIG_INVALID', 'Bhashini returned an unusable inference key.');
  return { header, key };
}
export function bhashiniTranscript(body: string): string | undefined {
  const reply = parseJson(body);
  const task = Array.isArray(reply?.pipelineResponse) ? reply.pipelineResponse.find((entry: any) => entry?.taskType === 'asr') : reply?.taskType === 'asr' ? reply : undefined;
  return Array.isArray(task?.output) ? text(task.output[0]?.source) : undefined;
}
export function liveSecret(body: string): { value: string; expiresAt: string } {
  const reply = parseJson(body); const value = text(reply?.value); const seconds = reply?.expires_at;
  check(value && /^[A-Za-z0-9_.-]{8,1024}$/.test(value) && Number.isSafeInteger(seconds) && seconds > 0, 'LIVE_VOICE_INVALID_REPLY', 'The live voice provider returned an unusable session secret.');
  return { value, expiresAt: new Date(seconds * 1000).toISOString() };
}
