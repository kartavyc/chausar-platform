// Shared browser-safe channel identifiers.
export const SOCIAL_CHANNELS = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts'] as const;
export type SocialChannel = typeof SOCIAL_CHANNELS[number];
