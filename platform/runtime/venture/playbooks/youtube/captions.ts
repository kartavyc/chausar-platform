// Chausar 5B1 caption wiring. Kimo (MIT), original adapter over 5A4's caption core.
import { check } from '../../../contracts.ts';
import { groupCues, validateCues, toSrt, toVtt, editCueWord, type CaptionProfileId, type CaptionCue, type TimedWord } from '../kit/captions.ts';
export { editCueWord as reviewCaptionWord };
/** Group only measured words from the current source, never stale derived timings. */
export function youtubeCaptions(input: { words: readonly TimedWord[]; profile: CaptionProfileId; sourceDigest: string; currentDigest: string }) {
  check(typeof input.sourceDigest === 'string' && input.sourceDigest.length > 0 && input.sourceDigest === input.currentDigest, 'DERIVED_STALE', 'The transcript changed. Make the captions again.');
  check(['web', 'broadcast', 'vertical'].includes(input.profile), 'INVALID_VENTURE_REQUEST', 'Choose web, broadcast or vertical captions.');
  const cues = groupCues(input.words, input.profile), validation = captionCoverage(cues, input.profile);
  return { cues, ...validation, srt: toSrt(cues), vtt: toVtt(cues), sourceDigest: input.sourceDigest };
}

/** Timed text checks never imply that caption positions or face boxes were inspected. */
export function captionCoverage(cues: readonly CaptionCue[], profile: CaptionProfileId) {
  const result = validateCues(cues, profile);
  return { findings: result.findings, notRun: [...result.notRun,
    { check: 'safe-area', why: 'Caption positions were not measured.' },
    { check: 'face-overlap', why: 'Face boxes were not supplied.' },
  ] };
}
