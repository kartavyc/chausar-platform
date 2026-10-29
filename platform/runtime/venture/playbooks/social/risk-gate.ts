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
import type { IsoTime } from '../../contracts.ts';
import { checkChannelLimits, checkWords } from './checks.ts';
import { channelCapability, type SocialChannel } from './channels.ts';
import { HOUSE_LIMITS, HOUSE_POSTING_RULES, type PostingLimits } from './post-limits.ts';
import { RULE_STALE_AFTER_DAYS, SOCIAL_RULES_REGISTER, rulesFreshness } from './register.ts';

import {historyRisk,type RiskFinding,type RiskResult,type SentPost} from './risk-history.ts';
export {similarityPermille,linkDomains,postPrint,type RiskFinding,type RiskResult,type SentPost} from './risk-history.ts';
/** Native platform content and dated-register checks extend the shared history calculations. */
export function postingRisk(input: { channel: SocialChannel; name: string; text: string; now: IsoTime; history: readonly SentPost[]; limits?: Readonly<PostingLimits> }): RiskResult {
 const findings:RiskFinding[]=historyRisk({...input,limits:input.limits??HOUSE_LIMITS}).findings;
 const block=(ruleId:string,line:string)=>findings.push({ruleId,severity:'block',line:`${line} (rule ${ruleId})`});
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
