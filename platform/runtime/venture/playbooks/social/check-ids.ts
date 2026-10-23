// Chausar flagship playbook, social media agency: the ids of the deterministic checks (checks.ts). A leaf with no
// imports, so the playbook data (playbook.ts) and the rules register (register.ts) can name the checks without loading
// the checks themselves; checks.ts reads the register at load time, so importing it here would make a cycle.
export const SOCIAL_CHECK_IDS = [
  'channel-length', 'channel-hashtags', 'channel-media', 'alt-text', 'claims', 'disclosure-paid', 'disclosure-ai', 'synthetic-testimonial',
  'banned-words', 'banned-topics', 'competitor-names', 'regulated-claims', 'engagement-bait', 'house-style', 'prompt-leak',
] as const;
export type SocialCheckId = typeof SOCIAL_CHECK_IDS[number];
/**
 * The social checks a draft's run adds beyond checks.ts (playbooks/draft-checks.ts, Ink v2 wave 2): each calendar slot
 * code planned has its post (draft-posts.ts), and every figure in a report's words has a receipt (report.ts). A rule
 * in the register may name them as what uses it.
 */
export const SOCIAL_RUN_CHECK_IDS = ['calendar-slots', 'narrative-receipted'] as const;
