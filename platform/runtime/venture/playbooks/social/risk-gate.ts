// Chausar flagship playbook, social media agency: the pre-post risk gate (catalogue K5, Ink v2 wave 2 2B1).
// Before a post is proposed, and again right before the browser or API starts, code reads the channel's own history
// and Chausar's house limits (post-limits.ts): the 24-hour cap, the minimum gap, the warm-up of a new channel,
// near-duplicates of the last posts (word three-shingles, Jaccard in whole thousandths), and a streak of posts linking
// the same website. The hashtag cap and engagement bait come from the social checks (checks.ts) and their dated rules.
// A block stops the post before any connector is called; a warning goes on the owner's Today row. Each line names its
// rule, so it points back to a dated rule. A rule the gate rests on that is past its recheck on the posting day is a
// warning naming it, never a block. The owner may tighten the limits per channel (venture.posting.limits.set). No
// model runs here.
//
// Idea taken, code written here: yominpost (MIT), platform_risk.py and its tests: the same checks before Publish.
import { createHash } from 'node:crypto';
import type { IsoTime, PostPrint } from '../../contracts.ts';
import { checkChannelLimits, checkWords } from './checks.ts';
import { channelCapability, type SocialChannel } from './channels.ts';
import { HOUSE_LIMITS, HOUSE_POSTING_RULES, type PostingLimits } from './post-limits.ts';
import { RULE_STALE_AFTER_DAYS, SOCIAL_RULES_REGISTER, rulesFreshness } from './register.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A word: letters, numbers and the marks that belong to them (Hindi vowel signs and the like). */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
/** A link with its scheme: the host after any user name and password. */
const SCHEMED = /\bhttps?:\/\/(?:[^\s/?#@]*@)?([^\s/?#:]+)/giu;
/** A bare address such as cafearoma.example/menu: labels and a top-level name of letters, not part of an email address. */
const BARE = /(?<![\p{L}\p{N}@.\-/])(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?![\p{L}\p{N}-])/giu;

/**
 * One post that went out on the channel (or may have: an unknown outcome counts as sent), and when, with its words or
 * only its fingerprint. A time later than now, or one that cannot be read, counts as now.
 */
export type SentPost = { id: string; at: IsoTime | string; text?: string; print?: PostPrint };
export type RiskFinding = { ruleId: string; severity: 'block' | 'warn'; line: string };
export type RiskResult = { blocked: boolean; findings: RiskFinding[]; blocks: string[]; warnings: string[] };

/** The groups of three words in order, lower case, punctuation and spacing ignored. A text under three words is one group. */
function shingles(text: string): Set<string> {
  const words = text.normalize('NFC').toLowerCase().match(WORD) ?? [];
  if (words.length < 3) return new Set(words.length ? [words.join(' ')] : []);
  const out = new Set<string>();
  for (let index = 0; index + 3 <= words.length; index += 1) out.add(words.slice(index, index + 3).join(' '));
  return out;
}

/** Shared items over all items of two sets, in whole thousandths. */
function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : Math.floor((shared * 1000) / union);
}

/** How alike two texts are: shared word three-shingles over all of them, in whole thousandths (1000 is the same words). */
export function similarityPermille(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}

/**
 * The websites a text links to, lower case, without a leading www., each once: links with a scheme first (any user name
 * and password dropped), then bare addresses such as cafearoma.example/menu. An email address is not a link.
 */
export function linkDomains(text: string): string[] {
  const clean = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/[.,;:!?)\]}'"]+$/, '');
  const found: string[] = [];
  const blanked = text.replace(SCHEMED, (whole, host: string) => { found.push(clean(host)); return ' '.repeat(whole.length); });
  for (const match of blanked.matchAll(BARE)) found.push(clean(match[1]));
  return [...new Set(found.filter(Boolean))];
}

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * A text's fingerprint (PostPrint in contracts.ts): short sha256 prefixes of its word three-shingles and of the websites
 * it links. The per-computer post log (build/post-log.ts) keeps only this, never the words; the gate compares the same.
 */
export function postPrint(text: string): PostPrint {
  return { shingles: [...shingles(text)].map(fingerprint), domains: linkDomains(text).map(fingerprint) };
}

const rule = (id: string) => `(rule ${id})`;

/**
 * The risk of one post on one channel now, from that channel's history. history holds the posts that went out or may
 * have, any order; each counts at its time or now, whichever is earlier, so a clock moved back never erases one, and a
 * time that cannot be read counts as now. limits are the house limits unless the owner tightened them.
 */
export function postingRisk(input: { channel: SocialChannel; name: string; text: string; now: IsoTime; history: readonly SentPost[]; limits?: Readonly<PostingLimits> }): RiskResult {
  const limits = input.limits ?? HOUSE_LIMITS;
  const now = Date.parse(input.now);
  const history = input.history.map(post => {
    const at = Date.parse(post.at);
    return { at: Number.isFinite(at) ? Math.min(at, now) : now, print: post.print ?? postPrint(post.text ?? '') };
  }).sort((a, b) => a.at - b.at);
  const findings: RiskFinding[] = [];
  const block = (ruleId: string, line: string) => findings.push({ ruleId, severity: 'block', line: `${line} ${rule(ruleId)}` });
  const warn = (ruleId: string, line: string) => findings.push({ ruleId, severity: 'warn', line: `${line} ${rule(ruleId)}` });

  const lastDay = history.filter(post => now - post.at < DAY);
  const first = history[0];
  if (first && now - first.at < limits.warmUpDays * DAY && lastDay.length >= 1) {
    block('house-warm-up', `${input.name} is new to Chausar: for its first ${limits.warmUpDays} days Chausar posts there once a day, and a post went out in the last 24 hours.`);
  }
  if (lastDay.length >= limits.capPer24h) {
    block('house-post-cap-24h', `${input.name} already had ${lastDay.length} posts in the last 24 hours; the limit is ${limits.capPer24h}.`);
  }
  const last = history.at(-1);
  if (last && now - last.at < limits.minGapMinutes * MINUTE) {
    const minutes = Math.floor((now - last.at) / MINUTE);
    block('house-post-min-gap', `The last post on ${input.name} went out ${minutes} minutes ago; Chausar waits at least ${limits.minGapMinutes} minutes between posts on one channel.`);
  }

  const mine = postPrint(input.text);
  const myShingles = new Set(mine.shingles);
  const recent = history.slice(-limits.duplicateWindow);
  const closest = Math.max(0, ...recent.map(post => jaccard(myShingles, new Set(post.print.shingles))));
  const percent = Math.floor(closest / 10);
  if (closest >= limits.duplicateBlockPermille) {
    block('house-near-duplicate', `This post is ${percent}% the same as one of the last ${limits.duplicateWindow} posts on ${input.name}; Chausar holds a post from ${limits.duplicateBlockPermille / 10}%.`);
  } else if (closest >= limits.duplicateWarnPermille) {
    warn('house-near-duplicate-warn', `This post is ${percent}% the same as one of the last ${limits.duplicateWindow} posts on ${input.name}. Platforms may show near repeats to fewer people.`);
  }

  const domains = linkDomains(input.text);
  const before = history.slice(-(limits.linkStreak - 1));
  if (domains.length && before.length === limits.linkStreak - 1) {
    const streak = domains.find(domain => before.every(post => post.print.domains.includes(fingerprint(domain))));
    if (streak) warn('house-link-streak', `This would be post ${limits.linkStreak} in a row on ${input.name} linking ${streak}. Platforms may show such posts to fewer people.`);
  }

  // The dated platform rules the social checks already hold: the channel's hashtag cap and engagement bait.
  const draft = { id: 'post', channel: input.channel, text: input.text };
  for (const found of checkChannelLimits(draft).filter(item => item.check === 'channel-hashtags')) block(found.ruleId ?? 'channel-hashtags', found.line);
  for (const found of checkWords(draft, { proofFiles: [] }).filter(item => item.check === 'engagement-bait')) block(found.ruleId ?? 'meta-engagement-bait', found.line);

  // The rules all this rests on, past their recheck on the posting day: one warning naming each, never a block.
  const stale = staleRuleIds(input.channel, input.now);
  if (stale.length) {
    findings.push({
      ruleId: stale[0], severity: 'warn',
      line: `These posting rules were last checked more than ${RULE_STALE_AFTER_DAYS} days ago; check them before relying on them: ${stale.map(id => `rule ${id}`).join(', ')}.`,
    });
  }

  const blocks = findings.filter(item => item.severity === 'block').map(item => item.line);
  return { blocked: blocks.length > 0, findings, blocks, warnings: findings.filter(item => item.severity === 'warn').map(item => item.line) };
}

/**
 * The dated rules a post on this channel rests on, past their recheck on the posting day: the channel's length and
 * hashtag rules, the engagement bait rule, and Chausar's own posting limits. Ids in register order.
 */
export function staleRuleIds(channel: SocialChannel, now: IsoTime): string[] {
  const capability = channelCapability(channel);
  const used = new Set([capability.charsRule, capability.hashtagsRule, 'meta-engagement-bait', ...HOUSE_POSTING_RULES.map(rule => rule.id)].filter((id): id is string => !!id));
  const rules = SOCIAL_RULES_REGISTER.filter(rule => used.has(rule.id));
  return rulesFreshness(now.slice(0, 10), rules).stale.map(item => item.id);
}
