// Chausar connectors: publish tiers (Ink v2 wave 5, package 5A6, catalogue K17). One rule for how far Chausar goes
// when something is published, so every playbook labels it the same honest way: a copy block the owner pastes is a
// handoff; a scheduler on the owner's own key (Buffer, a platform's API) is a write; the owner's own command (their own
// tool on their computer) is delegated, which the screens label as a handoff because the owner's tool does it. A
// community post (a group, a forum, a comment thread) is always a handoff whatever is asked: Chausar never posts into a
// community. A provider's quota error is QUOTA_REACHED in the provider's own words, screened, never a plain "failed".
// The backend tiers and the quota reading follow youtube-skills' lib/backend_selector.py and lib/youtube_client.py
// (reusable by licence); written here for Chausar, not copied.
import { ChausarError } from '../../contracts.ts';
import { screenUntrusted } from '../policy/untrusted.ts';

/** How a piece goes out: pasted by the owner, scheduled on the owner's key, or run by the owner's own command. */
export type PublishPath = 'copy-block' | 'owner-key-scheduler' | 'owner-command';
/** What is published: an ordinary post, or a post into a community. */
export type PublishTarget = 'post' | 'community-post';
export type PublishTier = 'handoff' | 'write' | 'delegated';

export const PUBLISH_WORDS = Object.freeze({
  'copy-block': 'Chausar makes the copy; you paste and post it yourself.',
  'owner-key-scheduler': 'Chausar schedules it on your own account key, after you approve that exact post.',
  'owner-command': 'Your own tool posts it, from the exact command you approved.',
  community: 'Posts into a community are always yours to make: Chausar makes the copy, you post it.',
});

/** The tier and the label of one way to publish. A community post is always a handoff. */
export function publishTier(input: { path: PublishPath; target: PublishTarget }): { tier: PublishTier; label: 'handoff' | 'write'; line: string } {
  if (input.target === 'community-post') return { tier: 'handoff', label: 'handoff', line: PUBLISH_WORDS.community };
  if (input.path === 'owner-key-scheduler') return { tier: 'write', label: 'write', line: PUBLISH_WORDS['owner-key-scheduler'] };
  if (input.path === 'owner-command') return { tier: 'delegated', label: 'handoff', line: PUBLISH_WORDS['owner-command'] };
  return { tier: 'handoff', label: 'handoff', line: PUBLISH_WORDS['copy-block'] };
}

const QUOTA_WORDS = /quota|rate.?limit|too many requests|usage limit|limit exceeded|daily limit|insufficient_quota/i;

/** The provider's own message in an answer: a JSON error message, else the text, one line, at most 200 characters. */
function providerMessage(body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const inner = typeof parsed.error === 'object' && parsed.error ? parsed.error.message : typeof parsed.error === 'string' ? parsed.error : parsed.message;
    if (typeof inner === 'string' && inner.trim()) message = inner;
  } catch { /* not JSON: the text as it is */ }
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * A provider's quota answer as QUOTA_REACHED, in its own words after the untrusted screen; null when the answer is not
 * about a quota (a 429, or a 403 or 4xx whose words name a quota or a rate limit).
 */
export function quotaRefusal(provider: string, status: number, body: string): ChausarError | null {
  const quota = status === 429 || (status >= 400 && status < 500 && QUOTA_WORDS.test(body));
  if (!quota) return null;
  const screened = screenUntrusted({ source: 'tool-output', text: providerMessage(body) }, { mode: 'enforce' });
  const words = screened.status === 'quarantined' || !screened.text ? 'its quota is used up' : screened.text;
  return new ChausarError('QUOTA_REACHED', `${provider} says: "${words}" Chausar will try again when the quota resets, not before.`);
}
