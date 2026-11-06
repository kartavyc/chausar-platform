// The fake engine's owner attestation (wave 6, 6C5 / D20, D21), answering exactly as playbooks/rules-attest.ts does:
// venture.rules.locks lists the open business's locked rules (a lawyer or CA would confirm them, nobody has) with their
// plain words and the date the owner ticked them, then the hard stops; venture.rules.attest records or withdraws a tick
// bound to the rule's words. The rules, the digest, the words and the hard stops come from the engine's own pure modules
// (the eight attestation playbooks' rule registers only), and the browser parity test holds them equal to the engine.
import { EngineError, type RuleLocksLite } from './types';
import type { AttestableRule } from '../../../../platform/runtime/venture/playbooks/kit/attestation.ts';
import { ATTESTATION_PLAYBOOKS, ATTEST_WORDS, LOCKED_ELSEWHERE, LOCKED_ELSEWHERE_LINE, NOT_ATTESTABLE_WORDS, ruleDigest, ruleIsLocked } from '../../../../platform/shared/venture/playbooks/kit/attestation.ts';
import { HARD_STOPS, HARD_STOP_WORDS } from '../../../../platform/shared/venture/policy/hard-stops.ts';
import { SUPPORT_RULES } from '../../../../platform/shared/venture/playbooks/support-desk/rules.ts';
import { LEAD_RULES } from '../../../../platform/shared/venture/playbooks/lead-generation/rules.ts';
import { RECRUITING_RULES } from '../../../../platform/shared/venture/playbooks/recruiting-desk/rules.ts';
import { CAREER_PRIVACY_RULE } from '../../../../platform/shared/venture/playbooks/job-search-desk/metadata-core.ts';
import { NEWSLETTER_PRIVACY_RULE, NEWSLETTER_SPONSOR_RULE, NEWSLETTER_US_RULE } from '../../../../platform/shared/venture/playbooks/newsletter-studio/legal-core.ts';
import { NARRATION_RULES } from '../../../../platform/shared/venture/playbooks/narration-studio/rules.ts';
import { FORMS_ACCESS_RULE } from '../../../../platform/shared/venture/playbooks/data-entry-desk/rules.ts';
import { APP_TESTING_RULES } from '../../../../platform/shared/venture/playbooks/app-testing/rules.ts';

type Rule = AttestableRule & { sources: readonly { title: string; url: string }[] };
const locked = (rules: readonly unknown[]): readonly Rule[] => (rules as readonly Rule[]).filter(ruleIsLocked);
/** The eight attestation playbooks' locked rules, in each definition's order. */
export const FAKE_LOCKED_REGISTER: Readonly<Record<string, readonly Rule[]>> = Object.freeze({
  'support-desk': locked(SUPPORT_RULES),
  'recruiting-desk': locked(RECRUITING_RULES),
  'job-search-desk': locked([CAREER_PRIVACY_RULE]),
  'lead-generation': locked(LEAD_RULES),
  'newsletter-studio': locked([NEWSLETTER_PRIVACY_RULE, NEWSLETTER_SPONSOR_RULE, NEWSLETTER_US_RULE]),
  'narration-studio': locked(NARRATION_RULES),
  'data-entry-desk': locked([FORMS_ACCESS_RULE]),
  'app-testing': locked(APP_TESTING_RULES),
});

type Stored = { ruleId: string; digest: string; attestedOn: string; withdrawnAt: string | null };
const STALE = 'The rule changed. Read it again before you tick it.';
const NOT_FOUND = 'Choose a rule that waits for you.';

/** One business's attestations, kept by the fake per business. */
export class FakeRulesAttest {
  private readonly records = new Map<string, Stored[]>();
  constructor(private readonly host: { current(): string; playbook(): { id: string; label: string } | null; today(): string; now(): string; changed(): void }) {}

  private all(): Stored[] { return this.records.get(this.host.current()) ?? []; }
  private latest(ruleId: string): Stored | undefined { return this.all().filter(record => record.ruleId === ruleId).at(-1); }

  locks(): RuleLocksLite {
    const playbook = this.host.playbook();
    const attestable = !!playbook && ATTESTATION_PLAYBOOKS.includes(playbook.id);
    const rules = (attestable ? FAKE_LOCKED_REGISTER[playbook!.id] ?? [] : []).map(rule => {
      const digest = ruleDigest(rule), record = this.latest(rule.id);
      const active = !!record && !record.withdrawnAt && record.digest === digest;
      return {
        id: rule.id, playbook: playbook!.id, topic: rule.topic, rule: rule.rule, limitations: rule.limitations, needs: rule.needs as 'lawyer' | 'ca',
        sources: rule.sources.map(source => ({ title: source.title, url: source.url })), digest, attestable: true, attestedOn: active ? record!.attestedOn : null,
        line: active ? `You said you are responsible for this on ${record!.attestedOn}.` : 'Client work that rests on this waits until you tick it.',
      };
    });
    const waiting = rules.filter(rule => !rule.attestedOn).length;
    const line = playbook?.id === 'ca-firm' ? 'Your CA of record signs off regulated papers on Your CA. Owner attestation does not replace that.'
      : playbook && Object.hasOwn(LOCKED_ELSEWHERE, playbook.id) ? LOCKED_ELSEWHERE_LINE
        : !rules.length ? 'No rule waits for you.' : waiting ? `${waiting === 1 ? 'One rule waits' : `${waiting} rules wait`} for your tick.` : 'Every rule you can tick is ticked.';
    return { playbook, rules, words: ATTEST_WORDS, line, hardStops: HARD_STOPS.map(stop => ({ ...stop })) };
  }

  attest(p: Record<string, unknown>): RuleLocksLite {
    const keys = Object.keys(p);
    if (!keys.every(key => ['ruleId', 'attest', 'digest'].includes(key)) || !('ruleId' in p) || !('attest' in p)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const stop = HARD_STOPS.find(item => item.id === p.ruleId);
    if (stop) throw new EngineError('HARD_STOP', `${stop.line} ${HARD_STOP_WORDS}`);
    if (typeof p.ruleId !== 'string' || typeof p.attest !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', NOT_FOUND);
    if (p.digest !== undefined && typeof p.digest !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', STALE);
    const rule = Object.values(FAKE_LOCKED_REGISTER).flat().find(item => item.id === p.ruleId);
    if (!rule) {
      if (Object.values(LOCKED_ELSEWHERE).some(ids => ids.includes(p.ruleId as string))) throw new EngineError('RULE_NOT_ATTESTABLE', NOT_ATTESTABLE_WORDS);
      throw new EngineError('RULE_NOT_FOUND', NOT_FOUND);
    }
    const digest = ruleDigest(rule);
    if (p.attest && p.digest !== digest) throw new EngineError('APPROVAL_STALE', STALE);
    const latest = this.latest(rule.id);
    const active = !!latest && !latest.withdrawnAt && latest.digest === digest;
    const list = [...this.all()];
    if (p.attest && !active) list.push({ ruleId: rule.id, digest, attestedOn: this.host.today(), withdrawnAt: null });
    else if (!p.attest && latest && !latest.withdrawnAt) list[list.lastIndexOf(latest)] = { ...latest, withdrawnAt: this.host.now() };
    else return this.locks();
    this.records.set(this.host.current(), list);
    this.host.changed();
    return this.locks();
  }
}

/** The open business's standing attestations as the engine's guards read them, from the fake's own venture.rules.locks. */
export function fakeAttested(ask?: (method: string, params: Record<string, unknown>) => unknown): ReadonlyMap<string, string> {
  const locks = ask?.('venture.rules.locks', {}) as RuleLocksLite | undefined;
  return new Map((locks?.rules ?? []).filter(rule => rule.attestedOn).map(rule => [rule.id, rule.digest]));
}
