// Chausar venture launcher, policy (P2-posture): the always-ask floor.
// Money going out, sending to a client or the public, deleting, changing prices, anything on a government portal and
// using a password, key or signed-in account need the owner's approval at every posture, auto with spot checks
// included. Code decides what an action touches, from a table and then word by word, so a new effect is never quietly
// off the floor; a caller may add kinds, never remove them.
// The floor that applies in every posture follows yc-software/qm command-policy (MIT); this is a rewrite, not a copy.
import { check } from '../../contracts.ts';
import type { ToolEffect } from '../contracts.ts';

export const FLOOR_KINDS = ['money-out', 'send', 'delete', 'price-change', 'government-portal', 'credential'] as const;
export type FloorKind = typeof FLOOR_KINDS[number];

export const FLOOR_WORDS: Readonly<Record<FloorKind, string>> = Object.freeze({
  'money-out': 'Money going out always asks you first.',
  send: 'Sending to a client or the public always asks you first.',
  delete: 'Deleting anything always asks you first.',
  'price-change': 'Changing a price always asks you first.',
  'government-portal': 'Anything on a government portal always asks you first.',
  credential: 'Using a password, a key or a signed-in account always asks you first.',
});

/**
 * What a policy is asked about. tool-call: one harness tool call, before it runs. outside-effect: one effect that
 * leaves Chausar, before it is applied. digest: what an owner approval binds to. inputDigest: a tool call's exact input.
 */
export type PolicyAction = {
  phase: 'tool-call' | 'outside-effect';
  name: string;
  effect?: ToolEffect | null;
  touches?: readonly FloorKind[];
  inputDigest?: string;
  digest?: string;
};

/** Known names. The two harness tools that only record a request carry the floor of what they would do once applied. */
const TABLE: Readonly<Record<string, readonly FloorKind[]>> = Object.freeze({
  'payment.send': ['money-out'], 'payment.refund': ['money-out'], 'payout.send': ['money-out'], 'purchase.make': ['money-out'],
  'connector.post': ['send'], 'outbox.send': ['send'], 'message.send': ['send'], 'invoice.issue': ['send'], 'deliverable.send': ['send'],
  'site.edit.apply': ['send'], 'site.publish': ['send'],
  'record.delete': ['delete'], 'file.delete': ['delete'],
  'price.change': ['price-change'],
  'portal.gst.file': ['government-portal'], 'portal.itr.file': ['government-portal'],
  'delegate.start': ['credential'], 'credential.use': ['credential'], 'browser.session': ['credential'],
  'outbox.propose': ['send'], 'agent.delegate': ['credential'],
});

/** Words that put an unlisted name on the floor. Whole words of the name, split at any of . - _ : */
const WORDS: readonly [FloorKind, RegExp][] = [
  ['money-out', /^(pay|payment|payments|payout|refund|transfer|purchase|buy|withdraw)$/],
  ['send', /^(send|post|publish|email|mail|share|reply|message|dm|tweet)$/],
  ['delete', /^(delete|remove|erase|purge|drop|destroy)$/],
  ['price-change', /^(price|prices|pricing|reprice)$/],
  ['government-portal', /^(portal|gst|gstn|itr|tds|mca|epfo|incometax|traces)$/],
  ['credential', /^(credential|credentials|password|token|secret|login|cookie|cookies|session|key|keys)$/],
];
/** Tool effects that stay inside Chausar: reading, the calculator, the sandbox and asking a person (the owner relays). */
const INTERNAL: readonly ToolEffect[] = ['read', 'compute', 'sandbox', 'handoff'];

/** The floor kinds an action touches, in FLOOR_KINDS order. Empty means off the floor. */
export function floorOf(action: PolicyAction): FloorKind[] {
  const found = new Set<FloorKind>();
  for (const kind of action.touches ?? []) {
    check((FLOOR_KINDS as readonly string[]).includes(kind), 'INVALID_VENTURE_REQUEST', 'That is not a floor kind.');
    found.add(kind);
  }
  const listed = TABLE[action.name];
  if (listed) for (const kind of listed) found.add(kind);
  else if (action.phase === 'outside-effect' || !INTERNAL.includes(action.effect as ToolEffect)) {
    const words = action.name.toLowerCase().split(/[.\-_:]+/).filter(Boolean);
    for (const [kind, pattern] of WORDS) if (words.some(word => pattern.test(word))) found.add(kind);
    if (action.phase === 'tool-call' && action.effect === 'outside-write') found.add('send');
    if (action.phase === 'tool-call' && action.effect === 'delegate') found.add('credential');
  }
  return FLOOR_KINDS.filter(kind => found.has(kind));
}
