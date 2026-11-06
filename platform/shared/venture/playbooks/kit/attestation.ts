// Chausar playbook kit: owner attestation of locked rules (wave 6, 6C5 / D20, D21).
// A rule a lawyer or CA would confirm (needs set, confirmedBy null) used to hold every real client's work (RULE_UNCONFIRMED)
// with no way for the owner to move on. Now the owner can read the rule in plain words and tick "I am responsible for
// this in my business". The tick is recorded with its date in the business records and can be withdrawn; an attested
// rule unlocks real client work like a confirmed one. It is the owner's attestation, not a professional's sign-off:
// the CA firm's sign-off by the CA of record (ICAI number) stays separate and is never unlocked here. Hard stops
// (policy/hard-stops.ts) are not rules and can never be attested.
//
// Pure and shared with the fake engine: no clock, no store, no Node built-ins. The digest is a small stable hash of the
// rule's words, so an attestation lapses when the rule's words change, and the fake computes the same value. It imports
// nothing (not even types), so the browser does not pull the engine's contracts in; DatedRule fits AttestableRule.
/** The fields of a dated rule (kit/define.ts DatedRule) that attestation reads. */
export type AttestableRule = {
  id: string; topic: string; rule: string; limitations: string; needs: 'ca' | 'lawyer' | null;
  confirmedBy?: { name: string; on: string } | null; sources?: readonly { title: string; url: string }[];
};
type DatedRule = AttestableRule;

/** The owner's standing attestations in one business: rule id to the digest of the words they ticked. */
export type AttestedRules = ReadonlyMap<string, string>;
export const NO_ATTESTATIONS: AttestedRules = new Map<string, string>();

/**
 * The playbooks whose locked rules an owner attestation unlocks today: every place their client work checks a rule
 * reads the attestation. Other playbooks still list their locked rules, honestly marked as waiting for a lawyer or CA.
 */
export const ATTESTATION_PLAYBOOKS: readonly string[] = Object.freeze([
  'support-desk', 'lead-generation', 'recruiting-desk', 'job-search-desk', 'newsletter-studio', 'narration-studio', 'data-entry-desk', 'app-testing',
]);

/**
 * The locked rules of the other kit playbooks, by playbook: they still wait for a lawyer or CA, since their client-work
 * checks do not read attestations yet. venture.rules.attest refuses them with RULE_NOT_ATTESTABLE; the attestation
 * screen lists none of them. A test holds this equal to the installed definitions.
 */
export const LOCKED_ELSEWHERE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'online-seller': ['seller-storefront-permission', 'seller-tcs', 'seller-tds', 'seller-india'],
  'translation-studio': ['adaptation-rights', 'dub-cloning-terms'],
  'bookkeeping-cfo': ['seller-tax-credit-review', 'msme-payment-review', 'msme-tax-review', 'spending-only-scope', 'cash-limits-review'],
  'podcast-to-article': ['guest-quotation-rights'],
  'website-studio': ['site-form-permission'],
  'dev-agency': ['written-security-permission', 'incident-reporting'],
  'it-triage': ['slack-commercial'],
  'phone-receptionist': ['calling-law-review'],
  // W6 6E7: the trader's tax pack rules wait for the owner's CA, like bookkeeping's.
  'trading-journal': ['speculative-intraday', 'fno-business', 'capital-gains', 'grandfathering'],
});
export const NOT_ATTESTABLE_WORDS = 'This waits for a lawyer or CA to confirm it. Owner attestation for it is not available yet.';
export const LOCKED_ELSEWHERE_LINE = 'Your rules here wait for a lawyer or CA. Owner attestation for this work is not available yet.';

/** The words the owner ticks, in their own business. */
export const ATTEST_WORDS = 'I am responsible for this in my business.';

/** Whether a rule waits for a lawyer or CA (needs set, nobody confirmed it yet). */
export function ruleIsLocked(rule: Pick<DatedRule, 'needs' | 'confirmedBy'>): boolean {
  return rule.needs !== null && rule.needs !== undefined && !rule.confirmedBy;
}

/**
 * Whether client work may rest on the rule: it needs no one, a professional confirmed it, or the owner attested these
 * exact words (an attestation of older words no longer counts).
 */
export function ruleCleared(rule: Pick<DatedRule, 'id' | 'topic' | 'rule' | 'limitations' | 'needs' | 'confirmedBy'>, attested: AttestedRules = NO_ATTESTATIONS): boolean {
  return !ruleIsLocked(rule) || attested.get(rule.id) === ruleDigest(rule);
}

/** FNV-1a over the text, as 8 hex characters: stable in Node and the browser. A staleness check, not a secret. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The digest an attestation binds to: the rule's id, topic, words, limits and who would confirm it (ids are unique). */
export function ruleDigest(rule: Pick<DatedRule, 'id' | 'topic' | 'rule' | 'limitations' | 'needs'>): string {
  return 'rule-' + fnv(JSON.stringify([rule.id, rule.topic, rule.rule, rule.limitations, rule.needs]));
}
