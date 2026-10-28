// Chausar 5B1 transcription tiers. FilmCraft (MIT/Apache-2.0), model provenance ideas; no source copied.
// Pins read 27 Oct 2026 from the publisher's immutable LFS pointers:
// https://huggingface.co/ggerganov/whisper.cpp/commit/80da2d8bfee42b0e836fc3a9890373e5defc00a6
import { check } from '../../../contracts.ts';
import type { Cue } from './transcript.ts';
export type TranscriptTier = 'draft' | 'final' | 'refined';
const REVISION = '80da2d8bfee42b0e836fc3a9890373e5defc00a6';
export const TRANSCRIPT_MODELS = Object.freeze({
  draft: { id: 'base', revision: REVISION, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', bytes: 147951465, licence: 'MIT' },
  final: { id: 'small', revision: REVISION, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', bytes: 487601967, licence: 'MIT' },
  refined: { id: 'medium', revision: REVISION, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', bytes: 1533763059, licence: 'MIT' },
});
/** Metadata is accepted only for the pinned bytes; never infer the model from a filename. */
export function tierTranscript(input: { tier: TranscriptTier; whisperVersion: string; modelSha256: string; segments: readonly Cue[]; voiceActivity: readonly { startMs: number; endMs: number }[] }) {
  check(Object.hasOwn(TRANSCRIPT_MODELS, input.tier), 'INVALID_VENTURE_REQUEST', 'Choose draft, final or refined transcription.');
  const model = TRANSCRIPT_MODELS[input.tier];
  check(input.modelSha256 === model.sha256, 'MODEL_HASH_MISMATCH', 'The model file differs from the pinned table. Choose the verified model before transcribing.');
  check(typeof input.whisperVersion === 'string' && input.whisperVersion.trim().length > 0 && input.whisperVersion.length <= 200
    && Array.isArray(input.segments) && input.segments.length <= 20000 && Array.isArray(input.voiceActivity) && input.voiceActivity.length <= 20000
    && input.voiceActivity.every(region => Number.isSafeInteger(region.startMs) && Number.isSafeInteger(region.endMs) && region.startMs >= 0 && region.endMs > region.startMs),
  'TRANSCRIPT_MEASUREMENTS_REQUIRED', 'Keep the whisper version and measured voice-activity regions with the transcript.');
  const segments = input.segments.filter(segment => input.voiceActivity.some(region => segment.startMs < region.endMs && segment.endMs > region.startMs)).map(segment => ({ ...segment }));
  return { tier: input.tier, whisperVersion: input.whisperVersion, modelSha256: model.sha256, revision: model.revision, model: model.id, segments, dropped: input.segments.length - segments.length };
}
/** The owner downloads the named bytes in their browser; Chausar never downloads without this exact confirmation. */
export function modelDownloadHandoff(tier: TranscriptTier, confirmed: boolean, hosted: boolean) {
  check(!hosted, 'TIER_UNAVAILABLE', 'Model downloads are a desktop handoff. Upload an SRT or VTT transcript here.');
  check(confirmed === true, 'APP_APPROVAL_REQUIRED', 'Confirm this model, its source, size and licence before opening the download.');
  check(Object.hasOwn(TRANSCRIPT_MODELS, tier), 'INVALID_VENTURE_REQUEST', 'Choose draft, final or refined transcription.');
  const model = TRANSCRIPT_MODELS[tier];
  return { ...model, url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${model.revision}/ggml-${model.id}.bin`, mode: 'handoff' as const };
}
