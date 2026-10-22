// Chausar flagship playbook, social media agency: the dated register of platform rules (design 7.8).
// Every limit a check uses and every disclosure rule it enforces is one entry here, with its sources, the day it was
// checked, and how it was read: 'official' (the platform's or regulator's own page), 'secondary' (news or trade
// coverage, the platform page not read whole), 'house' (Chausar's own rule) or 'unconfirmed' (kept from earlier
// notes, not confirmed on the day). A rule goes stale after ninety days and the playbook says so; an unconfirmed rule
// is named for a check. Checks quote the rule id, so a finding always points back here.
//
// Idea taken, code written here: xjli360/sealeap-ecommerce-skills (MIT), whose rule files record each official page
// read with its checked-on date and how much of it was read.
import { check } from '../../../contracts.ts';
import type { IsoDate } from '../../contracts.ts';

export type RuleScope = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'youtube-shorts' | 'meta' | 'india' | 'united-states' | 'all';
export type RuleTopic = 'limit' | 'media' | 'disclosure' | 'conduct' | 'export';
export type RuleReading = 'official' | 'secondary' | 'house' | 'unconfirmed';
export type RuleSource = { title: string; url: string };
export type PlatformRule = {
  id: string;
  scope: RuleScope;
  topic: RuleTopic;
  /** The rule in plain words. */
  rule: string;
  /** The number a check uses, when the rule is a limit. */
  value: number | null;
  sources: RuleSource[];
  checkedOn: IsoDate;
  read: RuleReading;
  /** How it was read on that day, in plain words. */
  how: string;
  note: string | null;
};

export const RULE_STALE_AFTER_DAYS = 90;
const CHECKED = '2026-10-21';
const SEARCH = 'Read through a web search summary of the sources on 21 October 2026.';
const NOT_CONFIRMED = 'Kept from earlier notes; not confirmed against a source on 21 October 2026.';

const r = (rule: Omit<PlatformRule, 'checkedOn' | 'note'> & { note?: string }): PlatformRule => ({ ...rule, checkedOn: CHECKED, note: rule.note ?? null });

export const SOCIAL_RULES_REGISTER: readonly PlatformRule[] = Object.freeze([
  // Text limits
  r({
    id: 'x-weighted-280', scope: 'x', topic: 'limit', value: 280, read: 'official', how: 'Read on the X developer page and the twitter-text configuration on 21 October 2026.',
    rule: 'A post on X holds up to 280 weighted characters after NFC normalisation. Latin text, common punctuation and the scripts up to U+10FF weigh one per code point; other characters weigh two; every emoji weighs two.',
    sources: [
      { title: 'X developer docs: counting characters', url: 'https://docs.x.com/fundamentals/counting-characters' },
      { title: 'twitter-text configuration, version 3', url: 'https://github.com/twitter/twitter-text/tree/master/config' },
    ],
  }),
  r({
    id: 'x-url-23', scope: 'x', topic: 'limit', value: 23, read: 'official', how: 'Read on the X developer page on 21 October 2026.',
    rule: 'Every link in a post on X counts as 23 characters, however long it is.',
    sources: [{ title: 'X developer docs: counting characters', url: 'https://docs.x.com/fundamentals/counting-characters' }],
  }),
  r({
    id: 'ig-caption-2200', scope: 'instagram', topic: 'limit', value: 2200, read: 'secondary', how: SEARCH,
    rule: 'An Instagram caption holds up to 2,200 characters.',
    sources: [{ title: 'Publora: Instagram API guide', url: 'https://docs.publora.com/platforms/instagram' }],
  }),
  r({
    id: 'ig-caption-fold-125', scope: 'instagram', topic: 'limit', value: 125, read: 'secondary', how: SEARCH,
    rule: 'About the first 125 characters of an Instagram caption show before the word more. Chausar treats this as the upfront part of any post.',
    sources: [{ title: 'Publora: Instagram API guide', url: 'https://docs.publora.com/platforms/instagram' }],
  }),
  r({
    id: 'ig-hashtags-5', scope: 'instagram', topic: 'limit', value: 5, read: 'secondary', how: SEARCH,
    rule: 'Instagram posts and reels take at most five hashtags, down from thirty.',
    sources: [
      { title: 'Social Media Today: Instagram implements new limits on hashtag use', url: 'https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/' },
      { title: 'Social Samosa: Instagram limits hashtags to five per post', url: 'https://www.socialsamosa.com/news-2/instagram-hashtags-five-per-post-10923075' },
    ],
  }),
  r({
    id: 'facebook-63206', scope: 'facebook', topic: 'limit', value: 63206, read: 'secondary', how: SEARCH,
    rule: 'A Facebook post holds up to 63,206 characters.',
    sources: [{ title: 'Metricool: character limits by network', url: 'https://metricool.com/characters-social-media/' }],
  }),
  r({
    id: 'linkedin-3000', scope: 'linkedin', topic: 'limit', value: 3000, read: 'secondary', how: SEARCH,
    rule: 'A LinkedIn post holds up to 3,000 characters.',
    sources: [{ title: 'NapoleonCat: character limits for social platforms', url: 'https://brain.napoleoncat.com/en/articles/11829254-character-limits-for-different-social-media-platforms' }],
  }),
  r({
    id: 'threads-500', scope: 'threads', topic: 'limit', value: 500, read: 'secondary', how: SEARCH,
    rule: 'A Threads post holds up to 500 characters; a separate text attachment can hold up to 10,000.',
    sources: [{ title: 'TechCrunch: Threads offers support for up to 10k characters', url: 'https://techcrunch.com/2025/09/04/threads-challenges-x-by-offering-free-support-for-up-to-10k-characters-plus-prominent-links' }],
  }),
  r({
    id: 'threads-topic-1', scope: 'threads', topic: 'limit', value: 1, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A Threads post carries one topic tag.',
    sources: [{ title: 'Threads help centre', url: 'https://help.instagram.com/' }],
  }),
  r({
    id: 'tiktok-caption-2200', scope: 'tiktok', topic: 'limit', value: 2200, read: 'secondary', how: SEARCH,
    rule: 'A TikTok caption holds up to 2,200 characters.',
    note: 'Sources disagree: one API guide gives 4,000 for photo posts. The check uses the lower number.',
    sources: [{ title: 'NapoleonCat: character limits for social platforms', url: 'https://brain.napoleoncat.com/en/articles/11829254-character-limits-for-different-social-media-platforms' }],
  }),
  r({
    id: 'yt-title-100', scope: 'youtube-shorts', topic: 'limit', value: 100, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A YouTube title holds up to 100 characters.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  r({
    id: 'yt-description-5000', scope: 'youtube-shorts', topic: 'limit', value: 5000, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A YouTube description holds up to 5,000 characters.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  // Media
  r({
    id: 'ig-carousel-app-20', scope: 'instagram', topic: 'media', value: 20, read: 'secondary', how: SEARCH,
    rule: 'An Instagram carousel posted in the app holds up to 20 photos or videos.',
    sources: [{ title: 'Social Media Today: Instagram expands carousels to 20 frames', url: 'https://www.socialmediatoday.com/news/instagram-expands-carousels-to-20-frames/723792/' }],
  }),
  r({
    id: 'ig-carousel-api-10', scope: 'instagram', topic: 'media', value: 10, read: 'official', how: SEARCH,
    rule: 'A carousel published through the Instagram API holds up to 10 images or videos.',
    sources: [{ title: 'Meta for Developers: Instagram content publishing', url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing' }],
  }),
  r({
    id: 'ig-image-aspect', scope: 'instagram', topic: 'media', value: null, read: 'secondary', how: SEARCH,
    rule: 'An Instagram feed image is between 4:5 (portrait) and 1.91:1 (landscape).',
    sources: [{ title: 'Plannthat: auto post restrictions for Instagram', url: 'https://help.plannthat.com/en/articles/10029624-auto-post-restrictions-for-instagram' }],
  }),
  r({
    id: 'ig-reels-180', scope: 'instagram', topic: 'media', value: 180, read: 'secondary', how: SEARCH,
    rule: 'An Instagram reel runs up to three minutes.',
    note: 'Some accounts can record or upload longer reels; the check keeps three minutes until the owner confirms a longer limit for the account.',
    sources: [{ title: 'Buffer: how long can Instagram reels be', url: 'https://buffer.com/resources/instagram-reels-length' }],
  }),
  r({
    id: 'yt-shorts-180', scope: 'youtube-shorts', topic: 'media', value: 180, read: 'official', how: SEARCH,
    rule: 'A YouTube Short runs up to three minutes and is square or vertical.',
    sources: [{ title: 'YouTube Help: understand three-minute YouTube Shorts', url: 'https://support.google.com/youtube/answer/15424877' }],
  }),
  r({
    id: 'x-media-4', scope: 'x', topic: 'media', value: 4, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A post on X carries up to four images, or one video.',
    sources: [{ title: 'X Help Center', url: 'https://help.x.com/' }],
  }),
  r({
    id: 'linkedin-images-20', scope: 'linkedin', topic: 'media', value: 20, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A LinkedIn post carries up to 20 images.',
    sources: [{ title: 'LinkedIn Help', url: 'https://www.linkedin.com/help/linkedin' }],
  }),
  r({
    id: 'threads-media-20', scope: 'threads', topic: 'media', value: 20, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A Threads post carries up to 20 images or videos.',
    sources: [{ title: 'Threads help centre', url: 'https://help.instagram.com/' }],
  }),
  r({
    id: 'tiktok-video-600', scope: 'tiktok', topic: 'media', value: 600, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A TikTok video uploaded in the app runs up to ten minutes.',
    sources: [{ title: 'TikTok Support', url: 'https://support.tiktok.com/' }],
  }),
  r({
    id: 'alt-text-house', scope: 'all', topic: 'media', value: null, read: 'house', how: 'Chausar house rule.',
    rule: 'Every image on a channel with an alt text field gets alt text, so people using screen readers know what it shows.',
    sources: [],
  }),
  // Disclosure
  r({
    id: 'meta-paid-partnership', scope: 'meta', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'Branded content on Instagram and Facebook uses the paid partnership label. A gifted product or service counts as payment.',
    sources: [{ title: 'JoinBrands: paid partnership guide', url: 'https://joinbrands.com/blog/paid-partnership-ig/' }],
  }),
  r({
    id: 'meta-ai-label', scope: 'meta', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'Photorealistic content made or changed with AI is disclosed with the AI label on Instagram and Facebook.',
    sources: [{ title: 'ContentGrip: Meta adds AI ad labels', url: 'https://www.contentgrip.com/meta-ai-ad-labels/' }],
  }),
  r({
    id: 'tiktok-ai-label', scope: 'tiktok', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'Realistic AI-generated content on TikTok carries the AI-generated content label; unlabelled content may be removed.',
    sources: [{ title: 'Social Media Today: TikTok adds required labels for AI-generated content', url: 'https://www.socialmediatoday.com/news/tiktok-adds-new-required-labels-for-ai-generated-content/690454/' }],
  }),
  r({
    id: 'tiktok-branded-content', scope: 'tiktok', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'Paid content on TikTok turns on the content disclosure setting for branded content.',
    sources: [{ title: 'TikTok Support', url: 'https://support.tiktok.com/' }],
  }),
  r({
    id: 'yt-synthetic-disclosure', scope: 'youtube-shorts', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'Realistic altered or synthetic content on YouTube is disclosed with the label chosen at upload.',
    sources: [{ title: 'Lindsey Gamble: YouTube requirements for AI-generated content', url: 'https://www.lindseygamble.com/blog/youtube-introduces-requirements-for-ai-generated-content' }],
  }),
  r({
    id: 'yt-paid-promotion', scope: 'youtube-shorts', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'Paid product placements and endorsements on YouTube tick the paid promotion box at upload.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  r({
    id: 'ftc-endorsement-guides', scope: 'united-states', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'A material connection between a brand and the person endorsing it is disclosed clearly and where people will see it.',
    sources: [{ title: 'FTC: Guides concerning the use of endorsements and testimonials in advertising (16 CFR Part 255)', url: 'https://www.ftc.gov/legal-library/browse/rules/guides-concerning-use-endorsements-testimonials-advertising' }],
  }),
  r({
    id: 'ftc-reviews-rule', scope: 'united-states', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'No fake reviews or testimonials, including AI-made ones from a person who does not exist or did not use the product. In force since 21 October 2024.',
    sources: [{ title: 'Goodwin: FTC finalizes rule on consumer reviews and testimonials (16 CFR Part 465)', url: 'https://www.goodwinlaw.com/en/insights/publications/2024/09/alerts-practices-cldr-ftc-finalizes-rule-on-consumer-reviews' }],
  }),
  r({
    id: 'asci-influencer-label', scope: 'india', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'An influencer post with a material connection to a brand carries a label such as ad, collab, sponsored or partnership, upfront where it is hard to miss.',
    sources: [{ title: 'ASCI: guidelines for influencer advertising in digital media', url: 'https://www.ascionline.in/' }],
  }),
  r({
    id: 'asci-ai-draft-2026', scope: 'india', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'A draft ASCI guideline asks for a clear, prominent label on ads with virtual or synthetic influencers, such as "Audio/Video created using AI".',
    note: 'A draft: the consultation closed on 13 June 2026 and the final status was not confirmed.',
    sources: [{ title: 'Mondaq: AI in advertising, ASCI draft disclosure guidelines', url: 'https://www.mondaq.com/india/advertising-marketing-branding/1790884/ai-in-advertising-ascis-new-draft-disclosure-guidelines' }],
  }),
  r({
    id: 'india-it-rules-sgi-2026', scope: 'india', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    rule: 'Under the IT Amendment Rules 2026 (G.S.R. 120(E), in force from 20 February 2026) synthetically generated content that looks authentic carries a prominent label.',
    sources: [{ title: 'DSCI: IT Amendment Rules 2026', url: 'https://www.dsci.in/resource/content/it-amendment-rules-2026' }],
  }),
  // Conduct
  r({
    id: 'meta-engagement-bait', scope: 'meta', topic: 'conduct', value: null, read: 'secondary', how: SEARCH,
    rule: 'Posts that ask people to tag friends, comment a set word, vote with reactions or share to win reach are demoted as engagement bait.',
    note: 'The coverage found dates from 2017; the current distribution guidelines were not read.',
    sources: [{ title: 'Search Engine Journal: Facebook demoting engagement bait', url: 'https://www.searchenginejournal.com/facebook-demoting-engagement-bait/228071' }],
  }),
  r({
    id: 'owner-session-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule, from the founder decision of 21 October 2026.',
    rule: 'Posting from a browser session uses the account the owner signed in to, after the owner approves each post, labelled with the risk that the platform may restrict the account.',
    sources: [],
  }),
  r({
    id: 'no-evasion-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule.',
    rule: 'Chausar never routes posting through proxies or VPNs to dodge platform limits, never hides the automation, and never buys followers or engagement.',
    sources: [],
  }),
  r({
    id: 'claims-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule.',
    rule: "Every figure, date, name, award or certification in a post matches the client's proof files or brand sheet.",
    sources: [],
  }),
  // Exports the monthly report reads
  r({
    id: 'export-meta-content', scope: 'instagram', topic: 'export', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'The Meta Business Suite content export has one row per post with Post ID, Publish time, Views, Reach, Likes, Shares, Follows, Comments and Saves columns, and writes dates month first.',
    sources: [{ title: 'Meta Business Suite Help', url: 'https://www.facebook.com/business/help' }],
  }),
  r({
    id: 'export-linkedin-updates', scope: 'linkedin', topic: 'export', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    rule: 'The LinkedIn page updates export has one row per post with Update link, Created date, Impressions, Clicks, Likes, Comments, Reposts and Follows columns, and writes dates month first. LinkedIn counts engagement as clicks, likes, comments, reposts and follows over impressions.',
    sources: [{ title: 'LinkedIn Help: page analytics', url: 'https://www.linkedin.com/help/linkedin' }],
  }),
] satisfies PlatformRule[]);

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCOPES: readonly RuleScope[] = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts', 'meta', 'india', 'united-states', 'all'];
const TOPICS: readonly RuleTopic[] = ['limit', 'media', 'disclosure', 'conduct', 'export'];
const READINGS: readonly RuleReading[] = ['official', 'secondary', 'house', 'unconfirmed'];

/** Unique short ids, a real date, a known scope, topic and reading, and sources unless it is a house rule. */
export function validateRulesRegister(rules: readonly PlatformRule[] = SOCIAL_RULES_REGISTER): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    check(ID.test(rule.id), 'INVALID_VENTURE_REQUEST', `The rule id ${JSON.stringify(rule.id)} is not a short lowercase name.`);
    check(!seen.has(rule.id), 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} is listed twice.`);
    seen.add(rule.id);
    check(SCOPES.includes(rule.scope) && TOPICS.includes(rule.topic) && READINGS.includes(rule.read), 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} has an unknown scope, topic or reading.`);
    check(dayNumber(rule.checkedOn) !== null, 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs the day it was checked.`);
    check(typeof rule.rule === 'string' && rule.rule.trim().length > 0 && typeof rule.how === 'string' && rule.how.trim().length > 0, 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs its words and how it was read.`);
    check(rule.value === null || (Number.isInteger(rule.value) && rule.value > 0), 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} has a value that is not a whole number.`);
    if (rule.read !== 'house') {
      check(rule.sources.length > 0 && rule.sources.every(source => /^https:\/\/[^\s]+$/.test(source.url) && source.title.trim().length > 0),
        'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs at least one source with a title and an https link.`);
    }
  }
}

/** One rule by id. A check that names a rule this register does not hold is a bug, so it is refused. */
export function platformRule(id: string, rules: readonly PlatformRule[] = SOCIAL_RULES_REGISTER): PlatformRule {
  const rule = rules.find(item => item.id === id);
  check(rule, 'INVALID_VENTURE_REQUEST', `There is no platform rule ${JSON.stringify(id)} in the register.`);
  return rule;
}

/** Days since 1970-01-01 for a real calendar date; null for anything else. */
function dayNumber(date: string): number | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return time / 86400000;
}

/** Whole days from one date to a later one. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  check(start !== null && end !== null, 'INVALID_VENTURE_REQUEST', 'Give dates like 2026-10-21.');
  return end - start;
}

export type RuleFreshness = { id: string; checkedOn: IsoDate; ageDays: number; stale: boolean; unconfirmed: boolean; line: string };

/**
 * How fresh the register is on a day: rules checked more than ninety days ago are stale, and rules marked unconfirmed
 * are named so the owner or the founder checks them. lines holds one plain sentence per rule that needs a look.
 */
export function rulesFreshness(today: IsoDate, rules: readonly PlatformRule[] = SOCIAL_RULES_REGISTER): {
  fresh: number; stale: RuleFreshness[]; unconfirmed: RuleFreshness[]; lines: string[];
} {
  const all = rules.map(rule => {
    const ageDays = daysBetween(rule.checkedOn, today);
    const stale = ageDays > RULE_STALE_AFTER_DAYS;
    const unconfirmed = rule.read === 'unconfirmed';
    const line = stale
      ? `The rule "${rule.rule}" was checked ${ageDays} days ago, on ${rule.checkedOn}. Check it again before relying on it.`
      : unconfirmed
        ? `The rule "${rule.rule}" is not confirmed against a source yet.`
        : '';
    return { id: rule.id, checkedOn: rule.checkedOn, ageDays, stale, unconfirmed, line };
  });
  const stale = all.filter(item => item.stale);
  const unconfirmed = all.filter(item => item.unconfirmed);
  return {
    fresh: all.filter(item => !item.stale && !item.unconfirmed).length,
    stale, unconfirmed,
    lines: all.filter(item => item.line).map(item => item.line),
  };
}
