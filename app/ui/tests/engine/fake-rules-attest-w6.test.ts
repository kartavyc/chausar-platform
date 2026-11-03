// W6 6C5 and 6C6: the fake engine answers venture.rules.locks/attest and venture.compliance.get/set, and refuses what a
// regulator switches off, with the engine's codes and words (playbooks/rules-attest.ts, core/compliance.ts).
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { FakeRulesAttest, FAKE_LOCKED_REGISTER, fakeAttested } from '../../src/engine/fake-rules-attest';
import type { ComplianceLite, RuleLocksLite } from '../../src/engine/types';

function desk(playbookId: string) {
  let changed = 0;
  const attest = new FakeRulesAttest({ current: () => 'b1', playbook: () => ({ id: playbookId, label: 'Desk' }), today: () => '2026-10-27', now: () => '2026-10-27T10:00:00.000Z', changed: () => { changed += 1; } });
  return { attest, changes: () => changed };
}

describe('fake owner attestation (6C5)', () => {
  it('lists the support desk rules, records a dated tick bound to the words, and withdraws it', () => {
    const { attest, changes } = desk('support-desk');
    let view: RuleLocksLite = attest.locks();
    expect(view.rules.map((rule) => [rule.id, rule.attestedOn])).toEqual([['consumer-grievance', null], ['support-privacy', null]]);
    expect(view.line).toBe('2 rules wait for your tick.');
    expect(view.hardStops).toHaveLength(9);
    expect(() => attest.attest({ ruleId: 'consumer-grievance', attest: true, digest: 'rule-stale' })).toThrow(expect.objectContaining({ code: 'APPROVAL_STALE' }));
    expect(() => attest.attest({ ruleId: 'advocate-solicit', attest: true, digest: 'x' })).toThrow(expect.objectContaining({ code: 'HARD_STOP' }));
    expect(() => attest.attest({ ruleId: 'site-form-permission', attest: true, digest: 'x' })).toThrow(expect.objectContaining({ code: 'RULE_NOT_ATTESTABLE' }));
    expect(() => attest.attest({ ruleId: 'nope', attest: true, digest: 'x' })).toThrow(expect.objectContaining({ code: 'RULE_NOT_FOUND' }));
    view = attest.attest({ ruleId: 'consumer-grievance', attest: true, digest: view.rules[0]!.digest });
    expect(view.rules[0]).toMatchObject({ attestedOn: '2026-10-27', line: 'You said you are responsible for this on 2026-10-27.' });
    expect(view.line).toBe('One rule waits for your tick.');
    attest.attest({ ruleId: 'consumer-grievance', attest: true, digest: view.rules[0]!.digest });
    expect(changes()).toBe(1);
    view = attest.attest({ ruleId: 'consumer-grievance', attest: false });
    expect(view.rules[0]!.attestedOn).toBeNull();
    expect(changes()).toBe(2);
  });

  it('lists no rule for a playbook still waiting for a lawyer, and the eight registers each hold a locked rule', () => {
    expect(desk('website-studio').attest.locks().line).toBe('Your rules here wait for a lawyer or CA. Owner attestation for this work is not available yet.');
    expect(desk('youtube').attest.locks().line).toBe('No rule waits for you.');
    for (const [id, rules] of Object.entries(FAKE_LOCKED_REGISTER)) expect(rules.length, id).toBeGreaterThan(0);
  });

  it('feeds the fake rule gates the same standing attestations', () => {
    const { attest } = desk('newsletter-studio');
    const digest = attest.locks().rules[0]!.digest;
    attest.attest({ ruleId: 'newsletter-consent', attest: true, digest });
    expect([...fakeAttested(() => attest.locks())]).toEqual([['newsletter-consent', digest]]);
  });
});

describe('fake compliance check (6C6)', () => {
  it('answers before the vault, records the answer, and switches off advocate outreach', async () => {
    const engine = new FakeEngine();
    const view = await engine.request('venture.compliance.get', { profession: 'advocate' }) as ComplianceLite;
    expect(view.question).toBe('Does your employment contract allow side work? This is your responsibility.');
    expect(view.switchedOff.map((item) => item.tool)).toEqual(['outreach', 'advertising']);
    expect(view.hardStops.map((stop) => stop.id)).toEqual(['advocate-solicit']);
    await expect(engine.request('venture.compliance.set', { profession: 'advocate', sideWork: 'allowed', digest: 'old' })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await expect(engine.request('venture.compliance.get', { profession: 'astronaut' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose a profession.' });
    const recorded = await engine.request('venture.compliance.set', { profession: 'advocate', sideWork: 'not-sure', digest: view.digest }) as ComplianceLite;
    expect(recorded.recorded).toMatchObject({ professionId: 'advocate', sideWork: 'not-sure' });
    await expect(engine.request('venture.outreach.draft', {} as never)).rejects.toMatchObject({ code: 'REGULATOR_FORBIDS' });
    await expect(engine.request('venture.leads.draft', { leadId: 'l', subject: 's', body: 'b' } as never)).rejects.toMatchObject({ code: 'REGULATOR_FORBIDS' });
    await expect(engine.request('venture.posting.propose', { draftId: 'post_x' } as never)).rejects.toMatchObject({ code: 'REGULATOR_FORBIDS' });
  });
});
