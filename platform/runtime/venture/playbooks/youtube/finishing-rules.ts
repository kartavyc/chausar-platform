// Chausar 5B2 dated finishing preferences. FFmpeg public documentation; source-card ideas only, no copied code.
export const FINISHING_HOUSE = Object.freeze({ checkedOn: '2026-10-28', lufsTenths: -140, peakTenths: -10, commentaryPermille: 250, wordsPerMinute: 180 });
export const SAFE_ZONES = Object.freeze({ reels: { bottomPermille: 350, rightPx: 0 }, stories: { bottomPermille: 200, rightPx: 0 }, tiktok: { bottomPermille: 0, rightPx: 64 }, youtube: { bottomPermille: 0, rightPx: 0 } });
const base = { needs: null, platform: 'youtube', sourceKind: 'house', sourceUpdated: null, effectiveFrom: null, checkedOn: '2026-10-28', recheckAfterDays: 90, usedBy: ['edit', 'verify'] } as const;
export const FINISHING_RULES = [
  { ...base, id: 'finishing-house', title: 'Finishing and commentary house targets',
    rule: 'Use the house loudness, peak, reading pace and commentary targets. These do not certify platform compliance.',
    effect: 'Code compares completed local measurements and owner-labelled commentary with the dated targets.',
    limits: { loudnessMagnitude: 140, peakMagnitude: 10, commentaryPermille: 250, wordsPerMinute: 180 },
    sourceTitle: 'Chausar house targets; FFmpeg loudnorm documentation', sourceUrl: 'house:youtube-finishing',
    limitations: ['FFmpeg filter documentation checked on 28 October 2026: https://www.ffmpeg.org/ffmpeg-filters.html . No official YouTube numeric loudness target was verified; these are house targets.', 'The commentary share is a house minimum, not a platform monetization decision. YouTube assesses added value: https://support.google.com/youtube/answer/1311392 . Face detection is not installed.'],
  },
  ...(['reels', 'stories', 'tiktok'] as const).map(platform => ({ ...base, id: `safe-zone-${platform}` as const,
    title: `${platform} framing house check`, rule: 'Keep text outside the recorded house margin and inspect the platform preview before posting.',
    effect: 'The local box check uses this margin. It does not certify the complete platform safe area.', limits: SAFE_ZONES[platform],
    sourceTitle: 'Chausar house preflight margin, from the wave five research card', sourceUrl: `house:youtube-safe-zone-${platform}`,
    limitations: platform === 'tiktok'
      ? ['TikTok official guidance checked on 28 October 2026 says safe zones vary with dimensions, captions and add-ons: https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?lang=en . A fixed right margin is not a verified platform safe area. Download the appropriate official overlay and inspect it yourself.']
      : ['The Meta official page required login on 28 October 2026: https://www.facebook.com/business/help/980593475366490 . The research-card margin was not reverified as a platform specification. Treat it as a house check and inspect the complete current platform preview.'],
  })),
] as const;
