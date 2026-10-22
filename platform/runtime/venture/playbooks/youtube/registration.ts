// Chausar flagship playbook: the YouTube channel (design 7.8). The registry entry only, with no runtime imports, so the
// registry (and the plan views that read it) never load the checks or the ffmpeg runner.
import type { PlaybookRegistration } from '../registry.ts';

export const YOUTUBE_ID = 'youtube';
export const YOUTUBE_LABEL = 'YouTube channel';

export const YOUTUBE_REGISTRATION: PlaybookRegistration = Object.freeze({
  id: YOUTUBE_ID,
  label: YOUTUBE_LABEL,
  serviceType: 'studio',
  picks: Object.freeze([
    'youtube', 'faceless channel', 'faceless video', 'podcast clips', 'podcast clip', 'podcast shorts', 'video podcast',
    'clip channel', 'clipping channel', 'clip programme', 'clip program', 'long video into shorts', 'shorts from long',
  ]),
  summary: 'Agents script, package and cut videos from footage the client owns or has licensed; the owner checks every draft and publishes it.',
});
