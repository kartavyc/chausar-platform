// Chausar flagship playbook, social media agency: one post line in a draft, and the social checks on one post's exact
// text. The draft checks (playbooks/draft-checks.ts) and posting (build/posting.ts) both read a draft's posts here, so
// they read them the same way. Light on imports on purpose: posting loads this inside an import cycle (channels.ts
// imports posting), so nothing here runs an import at load time.
import type { DateOrder } from '../../contracts.ts';
import type { FileLike } from '../../delivery/harness/files.ts';
import { sourcesFromFiles, type SourceText } from '../../delivery/judge/claim-check.ts';
import { SOCIAL_CHANNELS, channelCapability, type SocialChannel } from './channels.ts';
import { checkSocialDraft, type ClientRules, type PostDraft, type SocialCheckId } from './checks.ts';

const POST = /^\s*([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.+)$/;
let channelNames: Map<string, SocialChannel> | null = null;
/** Channel ids and names (lower case) to channels, built on first use. */
const channelByName = () => (channelNames ??= new Map<string, SocialChannel>(
  SOCIAL_CHANNELS.flatMap(id => [[id, id], [channelCapability(id).name.toLowerCase(), id]] as [string, SocialChannel][]),
));

/**
 * One post in a draft: a line "Channel: text" naming a social channel by its id or name ("X: ...", "LinkedIn: ...",
 * "YouTube Shorts: ..."). null for any other line.
 */
export function postOfLine(line: string): { channel: SocialChannel; text: string } | null {
  const match = POST.exec(line);
  const channel = match ? channelByName().get(match[1].trim().toLowerCase()) : undefined;
  return channel ? { channel, text: match![2].trim() } : null;
}

/** The client's rules for the social checks: the order's message and files are the proof, the known names are not claims. */
export function socialRules(input: { request: string; files: readonly FileLike[]; known: readonly string[]; dateOrder: DateOrder }): ClientRules {
  const sources: SourceText[] = [{ id: 'client-message', text: input.request }, ...sourcesFromFiles(input.files)];
  return { ...(input.known[0] ? { businessName: input.known[0] } : {}), known: [...input.known], proofFiles: sources, dateOrder: input.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year' };
}

/**
 * The social checks on the exact text of one post the owner edited (build/posting.ts), on its channel, with the order's
 * message and files as proof. The lines that block. Media rules wait for the media; house style and the prompt-leak
 * lint are left to the caller, which runs them on every post.
 */
export function socialPostBlocks(input: {
  channel: SocialChannel; text: string; request: string; files: readonly FileLike[]; known: readonly string[]; dateOrder: DateOrder;
  paid: boolean; ai: { person: boolean; voice: boolean };
}): string[] {
  const post: PostDraft = { id: 'post', channel: input.channel, text: input.text, paid: input.paid, ai: input.ai, style: 'post', platformLabels: { paidPartnership: input.paid, aiGenerated: input.ai.person || input.ai.voice } };
  const skip: readonly SocialCheckId[] = ['channel-media', 'house-style', 'prompt-leak'];
  return [...new Set(checkSocialDraft(post, socialRules(input)).findings.filter(item => item.severity === 'block' && !skip.includes(item.check)).map(item => item.line))];
}
