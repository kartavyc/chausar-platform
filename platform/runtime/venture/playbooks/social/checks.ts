// Chausar flagship playbook, social media agency: the deterministic checks every draft passes before the owner sees
// it (design 7.5, 7.8). No model runs here. Channel limits come from the capability table, each finding names the
// dated rule it rests on, and only 'block' findings stop a draft; 'ask-owner' findings go to the owner with the draft.
// - Channel limits: length counted the platform's way, hashtags, media count, kind, aspect and length, alt text.
// - Claims: every figure, date, name, award or certification must be in the client's proof files (the judge's claim
//   check). Hashtags, handles and links are not claims.
// - Disclosure: paid content says so upfront and sets the platform's toggle; an AI person, voice or realistic scene is
//   labelled as AI; an AI creator never speaks as a real customer.
// - Words: the client's banned words and topics, competitors in ads, health and money claims, engagement bait, house style.
// - Thread splitting: by explicit breaks, then paragraphs, sentences, words and graphemes, so every part fits.
//
// Ideas taken, code written here: cogsend/cogsend (MIT, Copyright (c) cogsend contributors) splits long text into
// thread posts by breaks, paragraphs, sentences, words and grapheme-safe slices; motiful/product-shots (MIT) protects
// the client's own words before filtering; twitter-text (Apache-2.0) publishes X's character weights, used as data.
import { check } from '../../../contracts.ts';
import type { PostingModeName } from '../../contracts.ts';
import { houseStyleFindings } from '../../records.ts';
import { checkClaims, type ClaimCheck, type SourceText } from '../../delivery/judge/claim-check.ts';
import { channelCapability, type MediaKind, type Ratio, type SocialChannel } from './channels.ts';
import { platformRule } from './register.ts';

export const SOCIAL_CHECK_IDS = [
  'channel-length', 'channel-hashtags', 'channel-media', 'alt-text', 'claims', 'disclosure-paid', 'disclosure-ai', 'synthetic-testimonial',
  'banned-words', 'banned-topics', 'competitor-names', 'regulated-claims', 'engagement-bait', 'house-style',
] as const;
export type SocialCheckId = typeof SOCIAL_CHECK_IDS[number];
/** 'block': the draft does not reach the owner as ready. 'ask-owner': it does, with this line for the owner to decide. */
export type Finding = { check: SocialCheckId; severity: 'block' | 'ask-owner'; line: string; ruleId: string | null };

export type SocialMedia = { kind: MediaKind; width: number; height: number; seconds?: number; altText?: string; fileId?: string };
/** person, voice and realisticScene need an AI label; illustration (art that looks made) does not. */
export type AiUse = { person?: boolean; voice?: boolean; realisticScene?: boolean; illustration?: boolean };
export type PostDraft = {
  id: string;
  channel: SocialChannel;
  text: string;
  media?: SocialMedia[];
  /** Paid by a brand, a gifted product, or a paid creator: anything that is a material connection. */
  paid?: boolean;
  /** The toggles the owner will turn on when posting. */
  platformLabels?: { paidPartnership?: boolean; aiGenerated?: boolean };
  ai?: AiUse;
  style?: 'post' | 'ugc-ad' | 'reply';
  /** The parts when the text goes out as a thread, made by splitThread. */
  thread?: string[];
};
export type ClientRules = {
  businessName?: string;
  /** Names that are never claims: the business, the owner, products, handles. */
  known?: string[];
  bannedWords?: string[];
  bannedTopics?: string[];
  competitors?: string[];
  /** The client's own words that a filter must never touch, for example a brand name with a banned word in it. */
  protectedPhrases?: string[];
  proofFiles: SourceText[];
  brandSheet?: string;
  maxHashtags?: number;
  dateOrder?: 'day-month-year' | 'month-day-year';
};

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const URL_PATTERN = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/giu;
const TRAILING = /[.,;:!?)\]}'"’”]+$/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
/** X's weight-one ranges, from twitter-text config v3; every other code point weighs two. */
const X_LIGHT: readonly [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const X_URL = platformRule('x-url-23').value!;

const graphemes = (text: string) => [...GRAPHEMES.segment(text)].map(part => part.segment);

function xWeight(grapheme: string): number {
  if (EMOJI.test(grapheme)) return 2;
  let weight = 0;
  for (const char of grapheme) {
    const point = char.codePointAt(0)!;
    weight += X_LIGHT.some(([low, high]) => point >= low && point <= high) ? 1 : 2;
  }
  return weight;
}

/** Links in a text with their spans, trailing punctuation left out as X and readers leave it out. */
function linksOf(text: string): { start: number; end: number }[] {
  return [...text.matchAll(URL_PATTERN)].map(match => {
    const trimmed = match[0].replace(TRAILING, '');
    return { start: match.index!, end: match.index! + trimmed.length };
  });
}

/** Characters as the platform counts them, after NFC. X weighs scripts, emoji and links; the rest count graphemes. */
export function countCharacters(text: string, channel: SocialChannel): number {
  const normal = text.normalize('NFC');
  if (channelCapability(channel).counting === 'graphemes') return graphemes(normal).length;
  let total = 0;
  let at = 0;
  for (const link of linksOf(normal)) {
    for (const grapheme of graphemes(normal.slice(at, link.start))) total += xWeight(grapheme);
    total += X_URL;
    at = link.end;
  }
  for (const grapheme of graphemes(normal.slice(at))) total += xWeight(grapheme);
  return total;
}

const blank = (text: string, spans: { start: number; end: number }[]) => {
  let out = text;
  for (const span of spans) out = out.slice(0, span.start) + ' '.repeat(span.end - span.start) + out.slice(span.end);
  return out;
};
const HASHTAG = /(?<![^\s])#[\p{L}\p{M}\p{N}_]+/gu;
const HANDLE = /(?<![^\s])@[\p{L}\p{N}_.]+/gu;

/** Hashtags that start the text or follow a space; a # inside a word or a link is not one. */
export function hashtagsOf(text: string): string[] {
  return [...blank(text, linksOf(text)).matchAll(HASHTAG)].map(match => match[0]);
}

const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const partsOf = (draft: PostDraft) => (draft.thread?.length ? draft.thread : [draft.text]);
const finding = (check: SocialCheckId, line: string, ruleId: string | null, severity: Finding['severity'] = 'block'): Finding => ({ check, severity, line, ruleId });

// ---------------------------------------------------------------------------
// Channel limits
// ---------------------------------------------------------------------------

const atLeast = (size: { width: number; height: number }, ratio: Ratio) => size.width * ratio.h >= ratio.w * size.height;
const atMost = (size: { width: number; height: number }, ratio: Ratio) => size.width * ratio.h <= ratio.w * size.height;
const ratioWords = (ratio: Ratio) => (ratio.w === 191 && ratio.h === 100 ? '1.91:1' : `${ratio.w}:${ratio.h}`);

export type LimitOptions = { mode?: PostingModeName; maxHashtags?: number };

/** Text length per part, hashtags, media and alt text against the channel's table. */
export function checkChannelLimits(draft: PostDraft, options: LimitOptions = {}): Finding[] {
  const channel = channelCapability(draft.channel);
  const found: Finding[] = [];
  const parts = partsOf(draft);
  if (draft.thread?.length && !channel.thread) found.push(finding('channel-length', `${channel.name} has no threads. Post one text of at most ${grouped(channel.maxChars)} characters.`, channel.charsRule));
  parts.forEach((part, index) => {
    const count = countCharacters(part, draft.channel);
    const which = parts.length > 1 ? `Part ${index + 1} of the thread` : 'The text';
    if (count > channel.maxChars) found.push(finding('channel-length', `${which} is ${grouped(count)} of ${grouped(channel.maxChars)} characters ${channel.name} allows.`, channel.charsRule));
  });
  const clientCap = options.maxHashtags;
  const cap = channel.maxHashtags !== null && (clientCap === undefined || channel.maxHashtags <= clientCap) ? channel.maxHashtags : clientCap ?? null;
  if (cap !== null) {
    const byClient = cap !== channel.maxHashtags;
    for (const part of parts) {
      const tags = hashtagsOf(part).length;
      if (tags > cap) {
        found.push(finding('channel-hashtags', `${tags} hashtags; ${byClient ? "your client's limit" : channel.name} is ${cap}.`, byClient ? null : channel.hashtagsRule));
        break;
      }
    }
  }
  found.push(...checkMedia(draft, options.mode));
  if (channel.altText) {
    const missing = (draft.media ?? []).filter(item => item.kind === 'image' && !(item.altText ?? '').trim()).length;
    if (missing) found.push(finding('alt-text', `${missing === 1 ? 'One picture has' : `${missing} pictures have`} no alt text. Describe what each shows.`, 'alt-text-house'));
  }
  return found;
}

function checkMedia(draft: PostDraft, mode: PostingModeName | undefined): Finding[] {
  const channel = channelCapability(draft.channel);
  const media = draft.media ?? [];
  const rules = channel.media.ruleFor;
  const found: Finding[] = [];
  if (channel.media.required && media.length === 0 && draft.style !== 'reply') found.push(finding('channel-media', `${channel.name} needs a picture or a video with the post.`, rules.items ?? channel.charsRule));
  const apiCap = mode === 'api' ? channel.modes.api.maxMediaItems : undefined;
  const cap = apiCap ?? channel.media.maxItems;
  if (cap !== null && media.length > cap) {
    const how = apiCap !== undefined ? ` through the ${channel.name} API` : '';
    found.push(finding('channel-media', `${media.length} pictures or videos; ${channel.name} takes ${cap} in one post${how}.`, apiCap !== undefined ? 'ig-carousel-api-10' : rules.items));
  }
  media.forEach((item, index) => {
    const label = media.length > 1 ? `Item ${index + 1}` : 'The media';
    if (!channel.media.kinds.includes(item.kind)) { found.push(finding('channel-media', `${label} is a ${item.kind}; ${channel.name} takes ${channel.media.kinds.join(' or ')} here.`, rules.items)); return; }
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0) { found.push(finding('channel-media', `${label} has no readable size.`, null)); return; }
    const bounds = item.kind === 'image' ? channel.media.imageAspect : channel.media.videoAspect;
    const boundsRule = item.kind === 'image' ? rules.imageAspect : rules.videoAspect;
    if (bounds && (!atLeast(item, bounds.min) || !atMost(item, bounds.max))) {
      found.push(finding('channel-media', `${label} is ${item.width} by ${item.height}; ${channel.name} takes ${ratioWords(bounds.min)} to ${ratioWords(bounds.max)}.`, boundsRule));
    }
    if (item.kind === 'video' && channel.media.maxVideoSeconds !== null) {
      if (item.seconds === undefined || !Number.isInteger(item.seconds) || item.seconds <= 0) found.push(finding('channel-media', `${label} has no length in whole seconds.`, rules.video));
      else if (item.seconds > channel.media.maxVideoSeconds) found.push(finding('channel-media', `${label} runs ${item.seconds} seconds; ${channel.name} takes ${channel.media.maxVideoSeconds}.`, rules.video));
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Claims against the client's proof files
// ---------------------------------------------------------------------------

/** The specifics in a post against the proof files and the brand sheet. Hashtags, handles and links are blanked first. */
export function checkDraftClaims(draft: PostDraft, client: ClientRules): { findings: Finding[]; claims: ClaimCheck } {
  const text = partsOf(draft).join('\n');
  const spans = [
    ...linksOf(text),
    ...[...blank(text, linksOf(text)).matchAll(HASHTAG)].map(match => ({ start: match.index!, end: match.index! + match[0].length })),
    ...[...text.matchAll(HANDLE)].map(match => ({ start: match.index!, end: match.index! + match[0].length })),
  ];
  const sources: SourceText[] = [...client.proofFiles, ...(client.brandSheet ? [{ id: 'brand-sheet', text: client.brandSheet }] : [])];
  const known = [client.businessName, ...(client.known ?? []), ...(client.protectedPhrases ?? [])].filter((name): name is string => !!name && !!name.trim());
  const claims = checkClaims(blank(text, spans), sources, { known, dateOrder: client.dateOrder });
  const findings = claims.passed ? [] : [finding('claims', `${claims.detail} Every specific in a post needs a proof file from the client.`, 'claims-house')];
  return { findings, claims };
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}])';
const PAID_LABEL = new RegExp(`${EDGE_BEFORE}(?:#ad|#ads|#sponsored|#paidpartnership|#partnership|#collab|#advertisement|ad|advertisement|sponsored|paid partnership)${EDGE_AFTER}`, 'iu');
const AI_LABEL = new RegExp(`${EDGE_BEFORE}(?:made with ai|created (?:using|with) ai|generated (?:by|with|using) ai|ai[- ]generated|ai[- ]made|ai creator|ai voice|ai avatar|#aigenerated|#madewithai|audio/video created using ai)${EDGE_AFTER}`, 'iu');
/** A person who does not exist saying they used the product. */
const FIRST_PERSON_EXPERIENCE: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])(?:I|we)(?:['’]ve|\s+have|['’]d|\s+had)?\s+(?:been\s+)?(?:using|used|tried|bought|ordered|switched\s+to|loved?|swear\s+by)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])my\s+(?:skin|hair|body|results?|orders?|mornings?|life|kids?|family|business|sales|clients?)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])changed\s+my(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])as\s+a\s+(?:customer|mom|mum|dad|user|buyer)(?![\p{L}\p{N}])/giu,
];
const FOLD = platformRule('ig-caption-fold-125').value!;

/** Where a label sits: 'upfront' within the first part's fold, 'late' after it, or 'missing'. */
function labelPlace(parts: string[], label: RegExp): 'upfront' | 'late' | 'missing' {
  const first = graphemes(parts[0].normalize('NFC')).slice(0, FOLD).join('');
  if (label.test(first)) return 'upfront';
  return parts.some(part => label.test(part)) ? 'late' : 'missing';
}

/** Paid and AI disclosure, and the synthetic testimonial check. */
export function checkDisclosure(draft: PostDraft): Finding[] {
  const channel = channelCapability(draft.channel);
  const parts = partsOf(draft);
  const found: Finding[] = [];
  if (draft.paid) {
    const place = labelPlace(parts, PAID_LABEL);
    if (place === 'missing') found.push(finding('disclosure-paid', 'This post is paid, but it never says so. Start it with Ad, Sponsored or Paid partnership.', 'asci-influencer-label'));
    if (place === 'late') found.push(finding('disclosure-paid', `The paid label comes after the first ${FOLD} characters, where people may not see it. Move it to the first line.`, 'asci-influencer-label'));
    if (channel.paidToggle && !draft.platformLabels?.paidPartnership) found.push(finding('disclosure-paid', `Turn on the ${channel.paidToggle.label} when this goes out on ${channel.name}.`, channel.paidToggle.rule));
  }
  const ai = draft.ai ?? {};
  const realistic = !!(ai.person || ai.voice || ai.realisticScene);
  if (realistic) {
    const place = labelPlace(parts, AI_LABEL);
    if (place === 'missing') found.push(finding('disclosure-ai', 'An AI person, voice or realistic scene is in this post, but the text never says so. Say Made with AI in the first line.', 'india-it-rules-sgi-2026'));
    if (place === 'late') found.push(finding('disclosure-ai', `The AI label comes after the first ${FOLD} characters. Move it to the first line.`, 'india-it-rules-sgi-2026'));
    if (channel.aiToggle && !draft.platformLabels?.aiGenerated) found.push(finding('disclosure-ai', `Turn on the ${channel.aiToggle.label} when this goes out on ${channel.name}.`, channel.aiToggle.rule));
  }
  if (ai.person || ai.voice) {
    const text = parts.join('\n');
    const said = FIRST_PERSON_EXPERIENCE.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[0]));
    if (said.length) {
      found.push(finding('synthetic-testimonial',
        `An AI creator speaks as a customer (${said.map(phrase => `"${phrase}"`).join(', ')}). Someone who does not exist cannot have used the product: write it as a demo, not a testimonial.`,
        'ftc-reviews-rule'));
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const wholeWord = (phrase: string) => new RegExp(`${EDGE_BEFORE}${escapeRe(phrase.trim()).replace(/\s+/g, '\\s+')}${EDGE_AFTER}`, 'iu');

/** Health and money words a regulator cares about. They go to the owner; they do not block. */
const REGULATED: readonly string[] = [
  'cure', 'cures', 'cured', 'heal', 'heals', 'healing', 'treats', 'treatment', 'clinically proven', 'doctor recommended', 'weight loss', 'lose weight',
  'fat burning', 'diabetes', 'cancer', 'immunity', 'detox', 'guarantee', 'guaranteed', 'risk-free', 'risk free', 'double your money', 'get rich',
  'assured returns', 'credit score', 'loan approval',
];
const ENGAGEMENT_BAIT: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])tag\s+(?:a|your|that|\d+)\s+(?:friends?|bestie|buddy|someone|people)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])comment\s+["“'‘]?[\p{L}\p{N}]+["”'’]?\s+(?:below|if|to|for)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:like|share)\s+if(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:vote|react)\s+with(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])share\s+(?:this\s+)?with\s+\d+\s+friends(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:follow\s*(?:for|4)\s*follow|f4f|like\s*(?:for|4)\s*like|l4l)(?![\p{L}\p{N}])/iu,
];

/** The client's protected words are blanked first, so a filter never touches them. */
function withoutProtected(text: string, client: ClientRules): string {
  let out = text;
  for (const phrase of [client.businessName, ...(client.protectedPhrases ?? [])]) {
    if (!phrase || !phrase.trim()) continue;
    out = out.replace(new RegExp(escapeRe(phrase.trim()), 'giu'), match => ' '.repeat(match.length));
  }
  return out;
}

/** Banned words and topics, competitors, regulated words, engagement bait and house style. */
export function checkWords(draft: PostDraft, client: ClientRules): Finding[] {
  const raw = partsOf(draft).join('\n');
  const text = withoutProtected(raw, client);
  const who = client.businessName ? `${client.businessName}'s` : "your client's";
  const found: Finding[] = [];
  for (const word of client.bannedWords ?? []) {
    if (word.trim() && wholeWord(word).test(text)) found.push(finding('banned-words', `"${word}" is on ${who} list of words to avoid.`, null));
  }
  for (const topic of client.bannedTopics ?? []) {
    if (topic.trim() && wholeWord(topic).test(text)) found.push(finding('banned-topics', `The post touches "${topic}", a topic ${who} brand stays away from.`, null));
  }
  const ad = !!draft.paid || draft.style === 'ugc-ad';
  for (const name of client.competitors ?? []) {
    if (!name.trim() || !wholeWord(name).test(text)) continue;
    found.push(ad
      ? finding('competitor-names', `This ad names ${name}, a competitor. Ads never use another brand's name.`, null)
      : finding('competitor-names', `The post names ${name}, a competitor. Check that your client is happy with it.`, null, 'ask-owner'));
  }
  for (const term of REGULATED) {
    const match = wholeWord(term).exec(text);
    if (match) found.push(finding('regulated-claims', `"${match[0]}" is a health or money claim. Check it with your client and their proof before it goes out.`, null, 'ask-owner'));
  }
  for (const pattern of ENGAGEMENT_BAIT) {
    const match = pattern.exec(text);
    if (match) found.push(finding('engagement-bait', `"${match[0]}" asks for engagement in a way platforms demote. Ask a real question instead.`, 'meta-engagement-bait'));
  }
  for (const item of houseStyleFindings(raw)) {
    found.push(finding('house-style', item.rule === 'em-dash' ? 'The post uses a long dash. Use a comma or a full stop.' : `The post uses "${item.match}", a word on the house avoid list.`, null));
  }
  return found;
}

// ---------------------------------------------------------------------------
// All checks together
// ---------------------------------------------------------------------------

export type SocialCheck = { passed: boolean; findings: Finding[]; claims: ClaimCheck };

/** Every check on one draft, in a fixed order. passed is false when any finding blocks. */
export function checkSocialDraft(draft: PostDraft, client: ClientRules, options: LimitOptions = {}): SocialCheck {
  const claims = checkDraftClaims(draft, client);
  const findings = [
    ...checkChannelLimits(draft, { maxHashtags: client.maxHashtags, ...options }),
    ...claims.findings,
    ...checkDisclosure(draft),
    ...checkWords(draft, client),
  ];
  return { passed: findings.every(item => item.severity !== 'block'), findings, claims: claims.claims };
}

// ---------------------------------------------------------------------------
// Thread splitting
// ---------------------------------------------------------------------------

const SENTENCES = new Intl.Segmenter('en', { granularity: 'sentence' });
type Count = (text: string) => number;

function pack(units: string[], separator: string, max: number, count: Count): string[] {
  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    const next = current ? `${current}${separator}${unit}` : unit;
    if (count(next) <= max) current = next;
    else { if (current) out.push(current); current = unit; }
  }
  if (current) out.push(current);
  return out;
}

function sliceWord(word: string, max: number, count: Count): string[] {
  const out: string[] = [];
  let current = '';
  for (const grapheme of graphemes(word)) {
    if (current && count(current + grapheme) > max) { out.push(current); current = ''; }
    current += grapheme;
  }
  if (current) out.push(current);
  return out;
}

function splitWords(text: string, max: number, count: Count): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap(word => (count(word) <= max ? [word] : sliceWord(word, max, count)));
  return pack(words, ' ', max, count);
}

function splitSentences(text: string, max: number, count: Count): string[] {
  const sentences = [...SENTENCES.segment(text)].map(part => part.segment.trim()).filter(Boolean)
    .flatMap(sentence => (count(sentence) <= max ? [sentence] : splitWords(sentence, max, count)));
  return pack(sentences, ' ', max, count);
}

function splitBlock(block: string, max: number, count: Count): string[] {
  if (count(block) <= max) return [block];
  const paragraphs = block.split(/\n[ \t]*\n/).map(part => part.trim()).filter(Boolean)
    .flatMap(paragraph => (count(paragraph) <= max ? [paragraph] : splitSentences(paragraph, max, count)));
  return pack(paragraphs, '\n\n', max, count);
}

/**
 * Splits a long text into thread parts by code: a line of three dashes always breaks; then paragraphs, sentences,
 * words and grapheme slices, each part as full as it can be. numbered adds " 1/4" to each part and keeps room for it.
 * A text that fits stays one part; on a channel with no threads a text that does not fit is refused.
 */
export function splitThread(text: string, channel: SocialChannel, options: { numbered?: boolean } = {}): string[] {
  const capability = channelCapability(channel);
  const count: Count = value => countCharacters(value, channel);
  const whole = text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  check(whole.length > 0, 'INVALID_VENTURE_REQUEST', 'There is no text to split.');
  const blocks = whole.split(/\n[ \t]*---[ \t]*\n/).map(part => part.trim()).filter(Boolean);
  const max = capability.maxChars;
  if (blocks.length === 1 && count(blocks[0]) <= max) return [blocks[0]];
  check(capability.thread, 'INVALID_VENTURE_REQUEST', `${capability.name} has no threads. Shorten the text to ${grouped(max)} characters.`);
  const split = (limit: number) => blocks.flatMap(block => splitBlock(block, limit, count));
  if (!options.numbered) return split(max);
  let total = split(max).length;
  for (let round = 0; round < 6; round += 1) {
    const parts = split(max - count(` ${total}/${total}`));
    if (parts.length === total || round === 5) return parts.map((part, index) => `${part} ${index + 1}/${parts.length}`);
    total = parts.length;
  }
  return [];
}
