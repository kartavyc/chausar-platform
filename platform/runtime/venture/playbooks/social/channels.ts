// Chausar flagship playbook, social media agency: the channel capability table (design 7.8, 7.9).
// For each platform: how it counts characters, its text, hashtag and media limits (each tied to a dated rule in
// register.ts), its formats, and what each posting mode can do. Whether a mode is available on this computer is never
// written here: it comes from the posting connector (build/posting.ts), so the table and the connector cannot drift.
// Channels with no posting connector are planned in every mode, and the owner posts from the calendar export.
// A draft's text is the caption, except on YouTube Shorts, where it is the title (the description is not checked here).
//
// Idea taken, code written here: postmill-ai/postmill-app (AGPL-3.0, so ideas only), whose providers declare a
// capability table per channel (video, carousel, alt text, max media, first comment).
import { check } from '../../../contracts.ts';
import type { PostingModeName } from '../../contracts.ts';
import { NOT_PROBED, OWNER_SESSION_RISK, postingOptions, type PostingEnvironment } from '../../build/posting.ts';

import { SOCIAL_CHANNELS, type SocialChannel } from './channel-ids.ts';
export { SOCIAL_CHANNELS, type SocialChannel } from './channel-ids.ts';

export type MediaKind = 'image' | 'video';
/** A width to height ratio in whole numbers, compared by cross-multiplying, never as a fraction. */
export type Ratio = { w: number; h: number };

export type ModeCapability = { can: string[]; cannot: string[]; maxMediaItems?: number };
export type ChannelCapability = {
  id: SocialChannel;
  name: string;
  /** The posting connector in build/posting.ts, or null when this build has none for the channel. */
  connectorId: string | null;
  counting: 'graphemes' | 'x-weighted';
  maxChars: number;
  charsRule: string;
  /** The platform's own hashtag cap, or null when it has none on record. */
  maxHashtags: number | null;
  hashtagsRule: string | null;
  media: {
    required: boolean;
    kinds: MediaKind[];
    /** Most items in one post, or null when no limit is on record. */
    maxItems: number | null;
    /** Aspect bounds for images, inclusive. */
    imageAspect: { min: Ratio; max: Ratio } | null;
    /** Aspect bounds for video, inclusive. */
    videoAspect: { min: Ratio; max: Ratio } | null;
    maxVideoSeconds: number | null;
    /** Every rule the media limits come from. */
    rules: string[];
    /** The rule behind each limit, for the finding's line. */
    ruleFor: { items: string | null; imageAspect: string | null; videoAspect: string | null; video: string | null };
  };
  /** The platform has an alt text field for images. */
  altText: boolean;
  /** A long text can go out as a thread of replies. */
  thread: boolean;
  /** The toggle that marks paid content on the platform, when it has one. */
  paidToggle: { label: string; rule: string } | null;
  /** The toggle that marks AI content on the platform, when it has one. */
  aiToggle: { label: string; rule: string } | null;
  formats: string[];
  modes: Record<PostingModeName, ModeCapability>;
};

const BROWSER_CANNOT = ['Upload a picture or a video', 'Post to an account you did not sign in to yourself', 'Get around a platform limit'];
const HANDOFF = { can: ['Copy the approved text', 'Open the platform for you to post'], cannot: ['Post anything by itself'] };
const NONE: ModeCapability = { can: [], cannot: ['Anything: this build has no posting connector for this channel'] };
const META_PAID = { label: 'Paid partnership label', rule: 'meta-paid-partnership' };
const META_AI = { label: 'AI info label', rule: 'meta-ai-label' };

export const CHANNEL_CAPABILITIES: Readonly<Record<SocialChannel, ChannelCapability>> = Object.freeze({
  instagram: {
    id: 'instagram', name: 'Instagram', connectorId: 'instagram', counting: 'graphemes',
    maxChars: 2200, charsRule: 'ig-caption-2200', maxHashtags: 5, hashtagsRule: 'ig-hashtags-5',
    media: {
      required: true, kinds: ['image', 'video'], maxItems: 20,
      imageAspect: { min: { w: 4, h: 5 }, max: { w: 191, h: 100 } }, videoAspect: null, maxVideoSeconds: 180,
      rules: ['ig-carousel-app-20', 'ig-carousel-api-10', 'ig-image-aspect', 'ig-reels-180'],
      ruleFor: { items: 'ig-carousel-app-20', imageAspect: 'ig-image-aspect', videoAspect: null, video: 'ig-reels-180' },
    },
    altText: true, thread: false, paidToggle: META_PAID, aiToggle: META_AI,
    formats: ['Single image', 'Carousel', 'Reel'],
    modes: {
      api: { can: ['Publish an approved image, carousel or reel'], cannot: ['Publish without your approval', 'Send direct messages'], maxMediaItems: 10 },
      'owner-browser-session': { can: [], cannot: BROWSER_CANNOT },
      handoff: HANDOFF,
    },
  },
  facebook: {
    id: 'facebook', name: 'Facebook Page', connectorId: null, counting: 'graphemes',
    maxChars: 63206, charsRule: 'facebook-63206', maxHashtags: null, hashtagsRule: null,
    media: {
      required: false, kinds: ['image', 'video'], maxItems: null, imageAspect: null, videoAspect: null, maxVideoSeconds: null,
      rules: [], ruleFor: { items: null, imageAspect: null, videoAspect: null, video: null },
    },
    altText: true, thread: false, paidToggle: META_PAID, aiToggle: META_AI,
    formats: ['Text', 'Image', 'Video', 'Link'],
    modes: { api: NONE, 'owner-browser-session': NONE, handoff: NONE },
  },
  linkedin: {
    id: 'linkedin', name: 'LinkedIn', connectorId: 'linkedin', counting: 'graphemes',
    maxChars: 3000, charsRule: 'linkedin-3000', maxHashtags: null, hashtagsRule: null,
    media: {
      required: false, kinds: ['image', 'video'], maxItems: 20, imageAspect: null, videoAspect: null, maxVideoSeconds: null,
      rules: ['linkedin-images-20'], ruleFor: { items: 'linkedin-images-20', imageAspect: null, videoAspect: null, video: null },
    },
    altText: true, thread: false, paidToggle: null, aiToggle: null,
    formats: ['Text', 'Image', 'Video', 'Document'],
    modes: {
      api: { can: [], cannot: ['LinkedIn is copy-and-open only. Post the approved words yourself.'] },
      'owner-browser-session': { can: [], cannot: ['LinkedIn is copy-and-open only. Post the approved words yourself.'] },
      handoff: HANDOFF,
    },
  },
  x: {
    id: 'x', name: 'X', connectorId: 'x', counting: 'x-weighted',
    maxChars: 280, charsRule: 'x-weighted-280', maxHashtags: null, hashtagsRule: null,
    media: {
      required: false, kinds: ['image', 'video'], maxItems: 4, imageAspect: null, videoAspect: null, maxVideoSeconds: null,
      rules: ['x-media-4'], ruleFor: { items: 'x-media-4', imageAspect: null, videoAspect: null, video: null },
    },
    altText: true, thread: true, paidToggle: null, aiToggle: null,
    formats: ['Post', 'Thread', 'Image', 'Video'],
    modes: {
      api: { can: ['Publish an approved post or thread'], cannot: ['Publish without your approval', 'Post the same text across several accounts'] },
      'owner-browser-session': { can: ['Post approved text from the account you signed in to'], cannot: BROWSER_CANNOT },
      handoff: { can: ['Open X with the approved post filled in'], cannot: ['Press Post for you'] },
    },
  },
  threads: {
    id: 'threads', name: 'Threads', connectorId: null, counting: 'graphemes',
    maxChars: 500, charsRule: 'threads-500', maxHashtags: 1, hashtagsRule: 'threads-topic-1',
    media: {
      required: false, kinds: ['image', 'video'], maxItems: 20, imageAspect: null, videoAspect: null, maxVideoSeconds: null,
      rules: ['threads-media-20'], ruleFor: { items: 'threads-media-20', imageAspect: null, videoAspect: null, video: null },
    },
    altText: true, thread: true, paidToggle: null, aiToggle: null,
    formats: ['Post', 'Thread', 'Image', 'Video'],
    modes: { api: NONE, 'owner-browser-session': NONE, handoff: NONE },
  },
  tiktok: {
    id: 'tiktok', name: 'TikTok', connectorId: null, counting: 'graphemes',
    maxChars: 2200, charsRule: 'tiktok-caption-2200', maxHashtags: null, hashtagsRule: null,
    media: {
      required: true, kinds: ['video', 'image'], maxItems: null, imageAspect: null, videoAspect: null, maxVideoSeconds: 600,
      rules: ['tiktok-video-600'], ruleFor: { items: null, imageAspect: null, videoAspect: null, video: 'tiktok-video-600' },
    },
    altText: false, thread: false,
    paidToggle: { label: 'Content disclosure for branded content', rule: 'tiktok-branded-content' },
    aiToggle: { label: 'AI-generated content label', rule: 'tiktok-ai-label' },
    formats: ['Video', 'Photo post'],
    modes: { api: NONE, 'owner-browser-session': NONE, handoff: NONE },
  },
  'youtube-shorts': {
    id: 'youtube-shorts', name: 'YouTube Shorts', connectorId: 'youtube', counting: 'graphemes',
    maxChars: 100, charsRule: 'yt-title-100', maxHashtags: null, hashtagsRule: null,
    media: {
      required: true, kinds: ['video'], maxItems: 1, imageAspect: null, videoAspect: { min: { w: 1, h: 100 }, max: { w: 1, h: 1 } }, maxVideoSeconds: 180,
      rules: ['yt-shorts-180'], ruleFor: { items: 'yt-shorts-180', imageAspect: null, videoAspect: 'yt-shorts-180', video: 'yt-shorts-180' },
    },
    altText: false, thread: false,
    paidToggle: { label: 'Includes paid promotion', rule: 'yt-paid-promotion' },
    aiToggle: { label: 'Altered or synthetic content', rule: 'yt-synthetic-disclosure' },
    formats: ['Short'],
    modes: {
      api: { can: ['Upload an approved Short'], cannot: ['Publish without your approval', 'Make an upload public before the API audit'] },
      'owner-browser-session': { can: [], cannot: BROWSER_CANNOT },
      handoff: { can: ['Copy the title and description', 'Open YouTube Studio for you to upload'], cannot: ['Upload anything by itself'] },
    },
  },
} satisfies Record<SocialChannel, ChannelCapability>);

/** One channel's capabilities. An unknown channel is refused. */
export function channelCapability(id: SocialChannel): ChannelCapability {
  check((SOCIAL_CHANNELS as readonly string[]).includes(id), 'INVALID_VENTURE_REQUEST', `Chausar has no channel called ${JSON.stringify(id)}.`);
  return CHANNEL_CAPABILITIES[id];
}

export type ChannelModeView = {
  mode: PostingModeName;
  status: 'available' | 'planned';
  what: string;
  risk: string | null;
  requires: string[];
  reason: string | null;
  can: string[];
  cannot: string[];
};

/**
 * What each posting mode can do for a channel, with its status on this computer. For a channel the posting connector
 * covers, the status, risk and requirements are the connector's own; otherwise every mode is planned.
 */
export function channelModes(id: SocialChannel, env: PostingEnvironment = NOT_PROBED): ChannelModeView[] {
  const channel = channelCapability(id);
  const order: PostingModeName[] = ['api', 'owner-browser-session', 'handoff'];
  if (!channel.connectorId) {
    const reason = `Chausar has no posting connector for ${channel.name} in this build. Post the approved drafts yourself from the calendar export.`;
    return order.map(mode => ({
      mode, status: 'planned' as const, what: `Not built for ${channel.name}.`, risk: mode === 'owner-browser-session' ? OWNER_SESSION_RISK : null,
      requires: [], reason, can: [...channel.modes[mode].can], cannot: [...channel.modes[mode].cannot],
    }));
  }
  const options = postingOptions(channel.connectorId, env);
  return order.map(mode => {
    const option = options.find(item => item.mode === mode);
    check(option, 'INVALID_VENTURE_REQUEST', `The ${channel.name} connector has no ${mode} mode.`);
    return {
      mode, status: option.status, what: option.what, risk: option.risk, requires: [...option.requires], reason: option.reason,
      can: [...channel.modes[mode].can], cannot: [...channel.modes[mode].cannot],
    };
  });
}
