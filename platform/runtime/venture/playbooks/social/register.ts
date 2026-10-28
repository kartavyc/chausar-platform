// Chausar flagship playbook, social media agency: the dated register of platform rules (design 7.8).
// Every limit a check uses and every disclosure rule it enforces is one entry here, with its sources, the day it was
// checked, and how it was read: 'official' (the platform's or regulator's own page), 'secondary' (news or trade
// coverage, the platform page not read whole), 'house' (Chausar's own rule) or 'unconfirmed' (kept from earlier
// notes, not confirmed on the day). A rule goes stale after ninety days and the playbook says so; an unconfirmed rule
// is named for a check. Checks quote the rule id, so a finding always points back here. Each rule also names the
// playbook steps and checks that use it (usedBy), so a changed rule lists what it touches, and what it does not cover
// (limitations); a draft's rules-current result and venture.rules.list read both (playbooks/rules-current.ts).
//
// Idea taken, code written here: xjli360/sealeap-ecommerce-skills (MIT), whose rule files record each official page
// read with its checked-on date and how much of it was read.
import { check } from '../../../contracts.ts';
import type { IsoDate } from '../../contracts.ts';
// playbook.ts and check-ids.ts load nothing that reads this register, so these imports make no cycle. Keep it so:
// playbook.ts must not import checks.ts or this file at runtime.
import { SOCIAL_CHECK_IDS, SOCIAL_RUN_CHECK_IDS } from './check-ids.ts';
import { SOCIAL_STEPS } from './playbook.ts';
// post-limits.ts imports only types from this file, so it loads first and makes no cycle.
import { HOUSE_POSTING_RULES } from './post-limits.ts';
import { socialLegalStatus } from './legal-confirmation.ts';

export type RuleScope = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'youtube-shorts' | 'meta' | 'india' | 'united-states' | 'all';
export type RuleTopic = 'limit' | 'media' | 'disclosure' | 'conduct' | 'export';
export type RuleReading = 'official' | 'secondary' | 'house' | 'unconfirmed';
export type RuleSource = { title: string; url: string };
export type PlatformRule = {
  needs: 'ca' | 'lawyer' | null;
  confirmedBy?: { name: string; on: string } | null;
  id: string;
  scope: RuleScope;
  topic: RuleTopic;
  /**
   * A short name for lists, at most 40 characters ("LinkedIn post length"), so a run's rules-current line names several
   * rules within its length. Without one, lists use the rule's first sentence.
   */
  title?: string;
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
  /**
   * The ids of the social playbook's steps (playbook.ts) and checks (check-ids.ts) that use this rule, so a changed
   * rule lists what it touches and a draft's rules-current result names the rules its checks rest on.
   */
  usedBy: readonly string[];
  /** What the rule does not cover, or how far its source was read, in plain words. At least one line. */
  limitations: readonly string[];
};

export const RULE_STALE_AFTER_DAYS = 90;
const CHECKED = '2026-10-21';
const SEARCH = 'Read through a web search summary of the sources on 21 October 2026.';
const NOT_CONFIRMED = 'Kept from earlier notes; not confirmed against a source on 21 October 2026.';
// Limitations several rules share.
const UNCONFIRMED_LIMIT = 'Not confirmed against a source; kept from earlier notes.';
const HOUSE_LIMIT = "Chausar's own rule, not a platform's or a regulator's.";
const LABEL_LIMIT = 'You turn the label on when posting; Chausar cannot see whether it is on.';
const US_LIMIT = 'United States law: it applies when the client or the audience is there.';

const r = (rule: Omit<PlatformRule, 'checkedOn' | 'note'> & { note?: string }): PlatformRule => ({ ...rule, checkedOn: CHECKED, note: rule.note ?? null });

export const SOCIAL_RULES_REGISTER: readonly PlatformRule[] = Object.freeze([
 {id:'linkedin-manual-only',needs:null,scope:'linkedin',topic:'conduct',title:'LinkedIn copy and open',value:null,read:'official',checkedOn:'2026-10-27',note:null,how:'Read the official User Agreement and prohibited software help page on 27 October 2026. Chausar applies its stricter copy-and-open boundary.',usedBy:['publish'],limitations:['Chausar offers no automated LinkedIn post or message. The owner posts manually.'],rule:'LinkedIn prohibits unauthorized automated access and activity. LinkedIn is copy-and-open only in Chausar; the owner approves the words and posts them manually.',sources:[{title:'LinkedIn User Agreement',url:'https://www.linkedin.com/legal/user-agreement'},{title:'LinkedIn prohibited software',url:'https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions?lang=en'}]},
 {id:'selling-share-house',needs:null,scope:'all',topic:'conduct',title:'Selling share',value:20,read:'house',checkedOn:'2026-10-27',note:null,how:'Checked against socialSlots and the social intake default on 27 October 2026.',usedBy:['calendar','drafts'],limitations:[HOUSE_LIMIT,'The owner can choose a different cap at intake.'],rule:'The default selling share is twenty percent of the planned slots. Every slot has one goal and one audience action.',sources:[]},
 {id:'revision-rounds-house',needs:null,scope:'linkedin',topic:'conduct',title:'Included revision rounds',value:2,read:'house',checkedOn:'2026-10-27',note:null,how:'Checked against the per-post revision desk on 27 October 2026.',usedBy:['approve-drafts'],limitations:[HOUSE_LIMIT,'Applies to the LinkedIn ghostwriting offer. Every extra-round price is owner-set.'],rule:'Two revision rounds are included per ghostwritten post. A later round needs the exact owner-set quote approved before work starts.',sources:[]},
  // Text limits
  r({
    needs: null,
    id: 'x-weighted-280', scope: 'x', topic: 'limit', value: 280, read: 'official', how: 'Read on the X developer page and the twitter-text configuration on 21 October 2026.',
    title: 'X post length',
    usedBy: ['channel-length', 'drafts', 'publish'],
    limitations: ['Premium X accounts can post longer text; the check keeps 280 for every account.', 'Counts the text only; a poll or a quoted post is not counted.'],
    rule: 'A post on X holds up to 280 weighted characters after NFC normalisation. Latin text, common punctuation and the scripts up to U+10FF weigh one per code point; other characters weigh two; every emoji weighs two.',
    sources: [
      { title: 'X developer docs: counting characters', url: 'https://docs.x.com/fundamentals/counting-characters' },
      { title: 'twitter-text configuration, version 3', url: 'https://github.com/twitter/twitter-text/tree/master/config' },
    ],
  }),
  r({
    needs: null,
    id: 'x-url-23', scope: 'x', topic: 'limit', value: 23, read: 'official', how: 'Read on the X developer page on 21 October 2026.',
    title: 'X link length',
    usedBy: ['channel-length', 'drafts', 'publish'],
    limitations: ['The check finds links that start with http or www; a bare name such as example.com counts as text.'],
    rule: 'Every link in a post on X counts as 23 characters, however long it is.',
    sources: [{ title: 'X developer docs: counting characters', url: 'https://docs.x.com/fundamentals/counting-characters' }],
  }),
  r({
    needs: null,
    id: 'ig-caption-2200', scope: 'instagram', topic: 'limit', value: 2200, read: 'secondary', how: SEARCH,
    title: 'Instagram caption length',
    usedBy: ['channel-length', 'publish'],
    limitations: ["Read from secondary coverage, not Instagram's own page.", 'Covers the caption only; comments and alt text have their own limits.'],
    rule: 'An Instagram caption holds up to 2,200 characters.',
    sources: [{ title: 'Publora: Instagram API guide', url: 'https://docs.publora.com/platforms/instagram' }],
  }),
  r({
    needs: null,
    id: 'ig-caption-fold-125', scope: 'instagram', topic: 'limit', value: 125, read: 'secondary', how: SEARCH,
    title: 'Instagram caption fold',
    usedBy: ['disclosure-paid', 'disclosure-ai'],
    limitations: ['An approximate number: where the caption folds depends on the screen and the app.', "Read from secondary coverage, not Instagram's own page."],
    rule: 'About the first 125 characters of an Instagram caption show before the word more. Chausar treats this as the upfront part of any post.',
    sources: [{ title: 'Publora: Instagram API guide', url: 'https://docs.publora.com/platforms/instagram' }],
  }),
  r({
    needs: null,
    id: 'ig-hashtags-5', scope: 'instagram', topic: 'limit', value: 5, read: 'secondary', how: SEARCH,
    title: 'Instagram hashtag cap',
    usedBy: ['channel-hashtags', 'publish'],
    limitations: ["Read from news coverage of the change, not Instagram's own page.", 'Counts hashtags in the caption only, not in a comment.'],
    rule: 'Instagram posts and reels take at most five hashtags, down from thirty.',
    sources: [
      { title: 'Social Media Today: Instagram implements new limits on hashtag use', url: 'https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/' },
      { title: 'Social Samosa: Instagram limits hashtags to five per post', url: 'https://www.socialsamosa.com/news-2/instagram-hashtags-five-per-post-10923075' },
    ],
  }),
  r({
    needs: null,
    id: 'facebook-63206', scope: 'facebook', topic: 'limit', value: 63206, read: 'secondary', how: SEARCH,
    title: 'Facebook post length',
    usedBy: ['channel-length'],
    limitations: ["Read from secondary coverage, not Facebook's own page.", 'A Page post only; ads and stories have other limits.'],
    rule: 'A Facebook post holds up to 63,206 characters.',
    sources: [{ title: 'Metricool: character limits by network', url: 'https://metricool.com/characters-social-media/' }],
  }),
  r({
    needs: null,
    id: 'linkedin-3000', scope: 'linkedin', topic: 'limit', value: 3000, read: 'secondary', how: SEARCH,
    title: 'LinkedIn post length',
    usedBy: ['channel-length', 'publish'],
    limitations: ["Read from secondary coverage, not LinkedIn's own page.", 'A post only; articles and comments have other limits.'],
    rule: 'A LinkedIn post holds up to 3,000 characters.',
    sources: [{ title: 'NapoleonCat: character limits for social platforms', url: 'https://brain.napoleoncat.com/en/articles/11829254-character-limits-for-different-social-media-platforms' }],
  }),
  r({
    needs: null,
    id: 'threads-500', scope: 'threads', topic: 'limit', value: 500, read: 'secondary', how: SEARCH,
    title: 'Threads post length',
    usedBy: ['channel-length', 'drafts'],
    limitations: ['Read from news coverage, not the Threads help centre.', 'Chausar drafts no long text attachment; each post stays within 500.'],
    rule: 'A Threads post holds up to 500 characters; a separate text attachment can hold up to 10,000.',
    sources: [{ title: 'TechCrunch: Threads offers support for up to 10k characters', url: 'https://techcrunch.com/2025/09/04/threads-challenges-x-by-offering-free-support-for-up-to-10k-characters-plus-prominent-links' }],
  }),
  r({
    needs: null,
    id: 'threads-topic-1', scope: 'threads', topic: 'limit', value: 1, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'Threads topic tag',
    usedBy: ['channel-hashtags', 'publish'],
    limitations: [UNCONFIRMED_LIMIT],
    rule: 'A Threads post carries one topic tag.',
    sources: [{ title: 'Threads help centre', url: 'https://help.instagram.com/' }],
  }),
  r({
    needs: null,
    id: 'tiktok-caption-2200', scope: 'tiktok', topic: 'limit', value: 2200, read: 'secondary', how: SEARCH,
    title: 'TikTok caption length',
    usedBy: ['channel-length', 'channel-media'],
    limitations: ['Sources disagree for photo posts; the check uses the lower number for every post.', "Read from secondary coverage, not TikTok's own page."],
    rule: 'A TikTok caption holds up to 2,200 characters.',
    note: 'Sources disagree: one API guide gives 4,000 for photo posts. The check uses the lower number.',
    sources: [{ title: 'NapoleonCat: character limits for social platforms', url: 'https://brain.napoleoncat.com/en/articles/11829254-character-limits-for-different-social-media-platforms' }],
  }),
  r({
    needs: null,
    id: 'yt-title-100', scope: 'youtube-shorts', topic: 'limit', value: 100, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'YouTube title length',
    usedBy: ['channel-length'],
    limitations: [UNCONFIRMED_LIMIT, "The YouTube playbook's own register reads the same limit from YouTube's API page."],
    rule: 'A YouTube title holds up to 100 characters.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  r({
    needs: null,
    id: 'yt-description-5000', scope: 'youtube-shorts', topic: 'limit', value: 5000, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'YouTube description length',
    usedBy: ['publish'],
    limitations: [UNCONFIRMED_LIMIT, 'Posting holds the text to this many characters; YouTube counts a description in bytes, so Hindi text fits less.'],
    rule: 'A YouTube description holds up to 5,000 characters.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  // Media
  r({
    needs: null,
    id: 'ig-carousel-app-20', scope: 'instagram', topic: 'media', value: 20, read: 'secondary', how: SEARCH,
    title: 'Instagram carousel in the app',
    usedBy: ['channel-media'],
    limitations: ["Read from news coverage, not Instagram's own page.", 'Posting in the app only; the API limit is a separate rule.'],
    rule: 'An Instagram carousel posted in the app holds up to 20 photos or videos.',
    sources: [{ title: 'Social Media Today: Instagram expands carousels to 20 frames', url: 'https://www.socialmediatoday.com/news/instagram-expands-carousels-to-20-frames/723792/' }],
  }),
  r({
    needs: null,
    id: 'ig-carousel-api-10', scope: 'instagram', topic: 'media', value: 10, read: 'official', how: SEARCH,
    title: 'Instagram carousel by API',
    usedBy: ['channel-media'],
    limitations: ['Applies only to posts published through the Instagram API.'],
    rule: 'A carousel published through the Instagram API holds up to 10 images or videos.',
    sources: [{ title: 'Meta for Developers: Instagram content publishing', url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing' }],
  }),
  r({
    needs: null,
    id: 'ig-image-aspect', scope: 'instagram', topic: 'media', value: null, read: 'secondary', how: SEARCH,
    title: 'Instagram image shape',
    usedBy: ['channel-media'],
    limitations: ["Read from a scheduler's help page, not Instagram's own.", 'Feed images only; stories and reels use a vertical frame.'],
    rule: 'An Instagram feed image is between 4:5 (portrait) and 1.91:1 (landscape).',
    sources: [{ title: 'Plannthat: auto post restrictions for Instagram', url: 'https://help.plannthat.com/en/articles/10029624-auto-post-restrictions-for-instagram' }],
  }),
  r({
    needs: null,
    id: 'ig-reels-180', scope: 'instagram', topic: 'media', value: 180, read: 'secondary', how: SEARCH,
    title: 'Instagram reel length',
    usedBy: ['channel-media'],
    limitations: ['Some accounts can post longer reels; the check keeps three minutes until you confirm more.', "Read from secondary coverage, not Instagram's own page."],
    rule: 'An Instagram reel runs up to three minutes.',
    note: 'Some accounts can record or upload longer reels; the check keeps three minutes until the owner confirms a longer limit for the account.',
    sources: [{ title: 'Buffer: how long can Instagram reels be', url: 'https://buffer.com/resources/instagram-reels-length' }],
  }),
  r({
    needs: null,
    id: 'yt-shorts-180', scope: 'youtube-shorts', topic: 'media', value: 180, read: 'official', how: SEARCH,
    title: 'YouTube Short length',
    usedBy: ['channel-media'],
    limitations: ['Covers the length and the frame only; music and Content ID claims are not part of the check.'],
    rule: 'A YouTube Short runs up to three minutes and is square or vertical.',
    sources: [{ title: 'YouTube Help: understand three-minute YouTube Shorts', url: 'https://support.google.com/youtube/answer/15424877' }],
  }),
  r({
    needs: null,
    id: 'x-media-4', scope: 'x', topic: 'media', value: 4, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'X media count',
    usedBy: ['channel-media'],
    limitations: [UNCONFIRMED_LIMIT],
    rule: 'A post on X carries up to four images, or one video.',
    sources: [{ title: 'X Help Center', url: 'https://help.x.com/' }],
  }),
  r({
    needs: null,
    id: 'linkedin-images-20', scope: 'linkedin', topic: 'media', value: 20, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'LinkedIn image count',
    usedBy: ['channel-media'],
    limitations: [UNCONFIRMED_LIMIT],
    rule: 'A LinkedIn post carries up to 20 images.',
    sources: [{ title: 'LinkedIn Help', url: 'https://www.linkedin.com/help/linkedin' }],
  }),
  r({
    needs: null,
    id: 'threads-media-20', scope: 'threads', topic: 'media', value: 20, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'Threads media count',
    usedBy: ['channel-media'],
    limitations: [UNCONFIRMED_LIMIT],
    rule: 'A Threads post carries up to 20 images or videos.',
    sources: [{ title: 'Threads help centre', url: 'https://help.instagram.com/' }],
  }),
  r({
    needs: null,
    id: 'tiktok-video-600', scope: 'tiktok', topic: 'media', value: 600, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'TikTok video length',
    usedBy: ['channel-media'],
    limitations: [UNCONFIRMED_LIMIT, 'Videos uploaded in the app only; recording in the app may have another limit.'],
    rule: 'A TikTok video uploaded in the app runs up to ten minutes.',
    sources: [{ title: 'TikTok Support', url: 'https://support.tiktok.com/' }],
  }),
  r({
    needs: null,
    id: 'alt-text-house', scope: 'all', topic: 'media', value: null, read: 'house', how: 'Chausar house rule.',
    title: 'Alt text on images',
    usedBy: ['alt-text', 'drafts'],
    limitations: [HOUSE_LIMIT, 'The check sees whether alt text is there, not whether it describes the picture well.'],
    rule: 'Every image on a channel with an alt text field gets alt text, so people using screen readers know what it shows.',
    sources: [],
  }),
  // Disclosure
  r({
    needs: null,
    id: 'meta-paid-partnership', scope: 'meta', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'Meta paid partnership label',
    usedBy: ['disclosure-paid', 'publish'],
    limitations: ["Read from a trade guide, not Meta's own branded content policy.", LABEL_LIMIT],
    rule: 'Branded content on Instagram and Facebook uses the paid partnership label. A gifted product or service counts as payment.',
    sources: [{ title: 'JoinBrands: paid partnership guide', url: 'https://joinbrands.com/blog/paid-partnership-ig/' }],
  }),
  r({
    needs: null,
    id: 'meta-ai-label', scope: 'meta', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'Meta AI label',
    usedBy: ['disclosure-ai', 'publish'],
    limitations: ["Read from trade coverage of ad labels, not Meta's own policy page.", LABEL_LIMIT],
    rule: 'Photorealistic content made or changed with AI is disclosed with the AI label on Instagram and Facebook.',
    sources: [{ title: 'ContentGrip: Meta adds AI ad labels', url: 'https://www.contentgrip.com/meta-ai-ad-labels/' }],
  }),
  r({
    needs: null,
    id: 'tiktok-ai-label', scope: 'tiktok', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'TikTok AI label',
    usedBy: ['disclosure-ai', 'publish'],
    limitations: ["Read from news coverage, not TikTok's own page.", LABEL_LIMIT],
    rule: 'Realistic AI-generated content on TikTok carries the AI-generated content label; unlabelled content may be removed.',
    sources: [{ title: 'Social Media Today: TikTok adds required labels for AI-generated content', url: 'https://www.socialmediatoday.com/news/tiktok-adds-new-required-labels-for-ai-generated-content/690454/' }],
  }),
  r({
    needs: null,
    id: 'tiktok-branded-content', scope: 'tiktok', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'TikTok branded content',
    usedBy: ['disclosure-paid', 'publish'],
    limitations: [UNCONFIRMED_LIMIT, LABEL_LIMIT],
    rule: 'Paid content on TikTok turns on the content disclosure setting for branded content.',
    sources: [{ title: 'TikTok Support', url: 'https://support.tiktok.com/' }],
  }),
  r({
    needs: null,
    id: 'yt-synthetic-disclosure', scope: 'youtube-shorts', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'YouTube synthetic content',
    usedBy: ['disclosure-ai', 'publish'],
    limitations: ["Read from a creator's blog; the YouTube playbook's own register reads YouTube's help page.", LABEL_LIMIT],
    rule: 'Realistic altered or synthetic content on YouTube is disclosed with the label chosen at upload.',
    sources: [{ title: 'Lindsey Gamble: YouTube requirements for AI-generated content', url: 'https://www.lindseygamble.com/blog/youtube-introduces-requirements-for-ai-generated-content' }],
  }),
  r({
    needs: null,
    id: 'yt-paid-promotion', scope: 'youtube-shorts', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'YouTube paid promotion',
    usedBy: ['disclosure-paid', 'publish'],
    limitations: [UNCONFIRMED_LIMIT, LABEL_LIMIT],
    rule: 'Paid product placements and endorsements on YouTube tick the paid promotion box at upload.',
    sources: [{ title: 'YouTube Help', url: 'https://support.google.com/youtube/' }],
  }),
  r({
    ...socialLegalStatus('ftc-endorsement-guides'),
    id: 'ftc-endorsement-guides', scope: 'united-states', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'FTC endorsement guides',
    usedBy: ['disclosure-paid'],
    limitations: [US_LIMIT, 'Not confirmed against the guides themselves; the paid label check quotes the Indian rule, which also asks for a clear label upfront.'],
    rule: 'A material connection between a brand and the person endorsing it is disclosed clearly and where people will see it.',
    sources: [{ title: 'FTC: Guides concerning the use of endorsements and testimonials in advertising (16 CFR Part 255)', url: 'https://www.ftc.gov/legal-library/browse/rules/guides-concerning-use-endorsements-testimonials-advertising' }],
  }),
  r({
    ...socialLegalStatus('ftc-reviews-rule'),
    id: 'ftc-reviews-rule', scope: 'united-states', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'FTC reviews rule',
    usedBy: ['synthetic-testimonial'],
    limitations: [US_LIMIT, "Read from a law firm's summary, not the rule's own text."],
    rule: 'No fake reviews or testimonials, including AI-made ones from a person who does not exist or did not use the product. In force since 21 October 2024.',
    sources: [{ title: 'Goodwin: FTC finalizes rule on consumer reviews and testimonials (16 CFR Part 465)', url: 'https://www.goodwinlaw.com/en/insights/publications/2024/09/alerts-practices-cldr-ftc-finalizes-rule-on-consumer-reviews' }],
  }),
  r({
    ...socialLegalStatus('asci-influencer-label'),
    id: 'asci-influencer-label', scope: 'india', topic: 'disclosure', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'ASCI influencer label',
    usedBy: ['disclosure-paid'],
    limitations: [UNCONFIRMED_LIMIT, 'Covers influencer posts; ads in other media follow other ASCI rules.'],
    rule: 'An influencer post with a material connection to a brand carries a label such as ad, collab, sponsored or partnership, upfront where it is hard to miss.',
    sources: [{ title: 'ASCI: guidelines for influencer advertising in digital media', url: 'https://www.ascionline.in/' }],
  }),
  r({
    ...socialLegalStatus('asci-ai-draft-2026'),
    id: 'asci-ai-draft-2026', scope: 'india', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'ASCI AI draft guideline',
    usedBy: ['disclosure-ai'],
    limitations: ['A draft guideline: its final words may differ.', "Read from a law firm's summary, not ASCI's own page."],
    rule: 'A draft ASCI guideline asks for a clear, prominent label on ads with virtual or synthetic influencers, such as "Audio/Video created using AI".',
    note: 'A draft: the consultation closed on 13 June 2026 and the final status was not confirmed.',
    sources: [{ title: 'Mondaq: AI in advertising, ASCI draft disclosure guidelines', url: 'https://www.mondaq.com/india/advertising-marketing-branding/1790884/ai-in-advertising-ascis-new-draft-disclosure-guidelines' }],
  }),
  r({
    ...socialLegalStatus('india-it-rules-sgi-2026'),
    id: 'india-it-rules-sgi-2026', scope: 'india', topic: 'disclosure', value: null, read: 'secondary', how: SEARCH,
    title: 'India AI content label',
    usedBy: ['disclosure-ai'],
    limitations: ["Read from an industry body's summary, not the notification's own text.", 'Says what to label, not how a platform shows the label.'],
    rule: 'Under the IT Amendment Rules 2026 (G.S.R. 120(E), in force from 20 February 2026) synthetically generated content that looks authentic carries a prominent label.',
    sources: [{ title: 'DSCI: IT Amendment Rules 2026', url: 'https://www.dsci.in/resource/content/it-amendment-rules-2026' }],
  }),
  // Conduct
  r({
    needs: null,
    id: 'meta-engagement-bait', scope: 'meta', topic: 'conduct', value: null, read: 'secondary', how: SEARCH,
    title: 'Meta engagement bait',
    usedBy: ['engagement-bait', 'publish'],
    limitations: ["The coverage found dates from 2017; Meta's current distribution guidelines were not read.", 'The check looks for set phrases; a request for engagement in other words may get through.'],
    rule: 'Posts that ask people to tag friends, comment a set word, vote with reactions or share to win reach are demoted as engagement bait.',
    note: 'The coverage found dates from 2017; the current distribution guidelines were not read.',
    sources: [{ title: 'Search Engine Journal: Facebook demoting engagement bait', url: 'https://www.searchenginejournal.com/facebook-demoting-engagement-bait/228071' }],
  }),
  r({
    needs: null,
    id: 'owner-session-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule, from the founder decision of 21 October 2026.',
    title: 'Your own browser session',
    usedBy: ['publish'],
    limitations: [HOUSE_LIMIT, 'Lowers the risk without removing it: a platform may still limit an account that posts from a browser session.'],
    rule: 'LinkedIn is copy-and-open only. On supported channels, posting from a browser session uses the account the owner signed in to, after the owner approves each post, labelled with the risk that the platform may restrict the account.',
    sources: [],
  }),
  r({
    needs: null,
    id: 'no-evasion-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule.',
    title: 'No evasion',
    usedBy: ['publish'],
    limitations: [HOUSE_LIMIT],
    rule: 'Chausar never routes posting through proxies or VPNs to dodge platform limits, never hides the automation, and never buys followers or engagement.',
    sources: [],
  }),
  r({
    needs: null,
    id: 'claims-house', scope: 'all', topic: 'conduct', value: null, read: 'house', how: 'Chausar house rule.',
    title: 'Claims from proof',
    usedBy: ['claims'],
    limitations: [HOUSE_LIMIT, 'The check matches specifics by their words; a claim put in other words than the proof may be missed.'],
    rule: "Every figure, date, name, award or certification in a post matches the client's proof files or brand sheet.",
    sources: [],
  }),
  // Exports the monthly report reads: social.report works the figures out of them for the report step, and the
  // narrative check holds the report's words to those figures (Ink v2 wave 2, 2F1).
  r({
    needs: null,
    id: 'export-meta-content', scope: 'instagram', topic: 'export', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'Meta content export',
    usedBy: ['narrative-receipted', 'intake', 'collect-exports', 'figures', 'report'],
    limitations: [UNCONFIRMED_LIMIT, 'Reads the English column names only.'],
    rule: 'The Meta Business Suite content export has one row per post with Post ID, Publish time, Views, Reach, Likes, Shares, Follows, Comments and Saves columns, and writes dates month first.',
    sources: [{ title: 'Meta Business Suite Help', url: 'https://www.facebook.com/business/help' }],
  }),
  r({
    needs: null,
    id: 'export-linkedin-updates', scope: 'linkedin', topic: 'export', value: null, read: 'unconfirmed', how: NOT_CONFIRMED,
    title: 'LinkedIn updates export',
    usedBy: ['narrative-receipted', 'intake', 'collect-exports', 'figures', 'report'],
    limitations: [UNCONFIRMED_LIMIT, 'Reads the English column names only.'],
    rule: 'The LinkedIn page updates export has one row per post with Update link, Created date, Impressions, Clicks, Likes, Comments, Reposts and Follows columns, and writes dates month first. LinkedIn counts engagement as clicks, likes, comments, reposts and follows over impressions.',
    sources: [{ title: 'LinkedIn Help: page analytics', url: 'https://www.linkedin.com/help/linkedin' }],
  }),
  // Chausar's own posting limits for the risk gate (post-limits.ts, Ink v2 wave 2 2B1): house rules, used by publish.
  ...HOUSE_POSTING_RULES,
] satisfies PlatformRule[]);

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCOPES: readonly RuleScope[] = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts', 'meta', 'india', 'united-states', 'all'];
const TOPICS: readonly RuleTopic[] = ['limit', 'media', 'disclosure', 'conduct', 'export'];
const READINGS: readonly RuleReading[] = ['official', 'secondary', 'house', 'unconfirmed'];

/** The social playbook's step ids and check ids (checks.ts and the draft's own, check-ids.ts): what a rule's usedBy may name. */
export function socialRuleTargets(): ReadonlySet<string> {
  return new Set<string>([...SOCIAL_STEPS.map(step => step.id), ...SOCIAL_CHECK_IDS, ...SOCIAL_RUN_CHECK_IDS]);
}

/**
 * Unique short ids, a real date, a known scope, topic and reading, and sources unless it is a house rule. Every rule
 * names the steps or checks that use it (each one the playbook has) and at least one line on what it does not cover.
 */
export function validateRulesRegister(rules: readonly PlatformRule[] = SOCIAL_RULES_REGISTER, targets: ReadonlySet<string> = socialRuleTargets()): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    check(['ca','lawyer',null].includes(rule.needs), 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} must say who needs to confirm it.`);
    check(rule.needs === null || rule.confirmedBy === null || !!rule.confirmedBy?.name && !!rule.confirmedBy?.on, 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs its professional confirmation state.`);
    check(Array.isArray(rule.usedBy) && rule.usedBy.length > 0 && rule.usedBy.every(id => typeof id === 'string'),
      'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs the steps or checks of the playbook that use it.`);
    const unknown = rule.usedBy.filter(id => !targets.has(id));
    check(!unknown.length, 'INVALID_VENTURE_REQUEST', `The rule ${rule.id} is used by ${unknown.join(', ')}, which the social playbook has no step or check for.`);
    check(Array.isArray(rule.limitations) && rule.limitations.length > 0 && rule.limitations.every(line => typeof line === 'string' && line.trim().length > 0),
      'INVALID_VENTURE_REQUEST', `The rule ${rule.id} needs at least one line on what it does not cover.`);
    check(rule.title === undefined || (typeof rule.title === 'string' && rule.title.trim().length > 0 && rule.title.length <= 40),
      'INVALID_VENTURE_REQUEST', `The rule ${rule.id} has a title that is empty or longer than 40 characters.`);
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
