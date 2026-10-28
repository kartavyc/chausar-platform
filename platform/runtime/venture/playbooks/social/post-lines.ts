// Chausar flagship playbook, social media agency: one post line in a draft, and the social checks on one post's exact
// text. The draft checks (playbooks/draft-checks.ts) and posting (build/posting.ts) both read a draft's posts here, so
// they read them the same way. Light on imports on purpose: posting loads this inside an import cycle (channels.ts
// imports posting), so nothing here runs an import at load time.
import type { ResolvedKit } from '../kit/records-media.ts';
import type { DateOrder, OrderIntake } from '../../contracts.ts';
import type { FileLike } from '../../delivery/harness/files.ts';
import { sourcesFromFiles, type SourceText } from '../../delivery/judge/claim-check.ts';
import { SOCIAL_CHANNELS, channelCapability, type SocialChannel } from './channels.ts';
import { checkSocialDraft, checkWords, countCharacters, splitThread, type ClientRules, type PostDraft, type SocialCheckId } from './checks.ts';

export { postOfLine } from './post-label.ts';
/**
 * The numbered thread parts code splits a post into (checks.ts splitThread), when the text is longer than one post on a
 * channel that has threads (X, Threads). null when it fits in one post, or when the channel has no threads, where a
 * text over the limit stays one post and the length check fails it. The draft checks and posting read threads here.
 */
export function threadParts(channel: SocialChannel, text: string): string[] | null {
  const capability = channelCapability(channel);
  if (!capability.thread || !text.trim() || countCharacters(text, channel) <= capability.maxChars) return null;
  return splitThread(text, channel, { numbered: true });
}

/**
 * The client's rules for the social checks: the order's message and files are the proof, the known names are not
 * claims, and the client's own word lists from intake (banned words and topics, competitors, phrases never flagged)
 * apply when the order has them. A competitor the client listed is never named in any post (ClientRules.clientCompetitors).
 */
export function socialRules(input: { request: string; files: readonly FileLike[]; known: readonly string[]; dateOrder: DateOrder; clientRules?: OrderIntake['clientRules'] | null; brandKit?: ResolvedKit }): ClientRules {
  const sources: SourceText[] = [{ id: 'client-message', text: input.request }, ...sourcesFromFiles(input.files)];
  const explicit = input.clientRules;
  const hasOwn = !!explicit && [explicit.bannedWords, explicit.bannedTopics, explicit.competitors, explicit.protectedPhrases].some(list => list.length > 0);
  const own = hasOwn ? explicit : input.brandKit ? { bannedWords: input.brandKit.bannedWords.value, bannedTopics: input.brandKit.bannedTopics.value, competitors: input.brandKit.competitors.value, protectedPhrases: [] } : explicit;
  return {
    ...(input.known[0] ? { businessName: input.known[0] } : {}), known: [...input.known], proofFiles: sources, dateOrder: input.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year',
    ...(own ? { bannedWords: [...own.bannedWords], bannedTopics: [...own.bannedTopics], clientCompetitors: [...own.competitors], protectedPhrases: [...own.protectedPhrases] } : {}),
  };
}

/**
 * The social checks on the exact text of one post the owner edited (build/posting.ts), on its channel, with the order's
 * message and files as proof and the client's word lists from intake when given. The lines that block. Media rules
 * wait for the media; house style and the prompt-leak lint are left to the caller, which runs them on every post.
 */
export function socialPostBlocks(input: {
  channel: SocialChannel; text: string; request: string; files: readonly FileLike[]; known: readonly string[]; dateOrder: DateOrder;
  paid: boolean; ai: { person: boolean; voice: boolean }; clientRules?: OrderIntake['clientRules'] | null; brandKit?: ResolvedKit; wordsOnly?: boolean;
}): string[] {
  const post: PostDraft = { id: 'post', channel: input.channel, text: input.text, paid: input.paid, ai: input.ai, style: 'post', platformLabels: { paidPartnership: input.paid, aiGenerated: input.ai.person || input.ai.voice } };
  const skip: readonly SocialCheckId[] = ['channel-media', 'house-style', 'prompt-leak'];
  const findings = input.wordsOnly ? checkWords(post, socialRules(input)) : checkSocialDraft(post, socialRules(input)).findings;
  return [...new Set(findings.filter(item => item.severity === 'block' && !skip.includes(item.check)).map(item => item.line))];
}
