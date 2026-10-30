// Original browser-safe Chausar social format router, catalogue S2 (MIT ideas only).
import {SOCIAL_CHANNELS,type SocialChannel} from './channel-ids.ts';
export type SocialFormat = {
    channel: SocialChannel;
    format: 'text' | 'thread' | 'image' | 'image-brief' | 'video' | 'video-brief';
    ready: boolean;
    trace: string[];
};
const CHANNELS: readonly SocialChannel[] = SOCIAL_CHANNELS;
/** Draft formats are limited to supplied media; a brief is visibly not a finished picture or video. */
export function socialFormats(input: {
    channels: SocialChannel[];
    footage: boolean;
    images: boolean;
}): SocialFormat[] {
    if (!Array.isArray(input.channels) || input.channels.length < 3 || input.channels.length > 5 || new Set(input.channels).size !== input.channels.length || input.channels.some(channel => !CHANNELS.includes(channel)) || typeof input.footage !== 'boolean' || typeof input.images !== 'boolean') {
        throw Object.assign(new Error('Pick three to five different channels and say which media the order contains.'), { code: 'SOCIAL_INPUT_INVALID' });
    }
    return input.channels.map(channel => socialFormat(channel, input));
}
/** A single card uses the same format rule as a repurposing pack. */
export function socialFormat(channel: SocialChannel, input: {
    footage: boolean;
    images: boolean;
}): SocialFormat {
    if (channel === 'tiktok' || channel === 'youtube-shorts')
        return { channel, format: input.footage ? 'video' : 'video-brief', ready: input.footage, trace: ['channel-needs-video', input.footage ? 'source-footage-present' : 'source-footage-missing'] };
    if (channel === 'instagram')
        return { channel, format: input.images ? 'image' : 'image-brief', ready: input.images, trace: ['channel-needs-media', input.images ? 'source-image-present' : 'source-image-missing'] };
    return { channel, format: channel === 'x' || channel === 'threads' ? 'thread' : 'text', ready: true, trace: ['text-supported', channel === 'x' || channel === 'threads' ? 'bounded-thread-split' : 'single-post'] };
}
