// W6 founder decisions of 3 November 2026: the fake engine asks the business's size only when a rule counts it, judges
// each sized rule the way core/compliance.ts does (the same pure core/business-size.ts), and records the range answer.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { ComplianceLite } from '../../src/engine/types';

const UP_TO = 'up-to-1500000000';
const ABOVE = 'above-1500000000';

describe('fake business size (W6, 3 November 2026)', () => {
  it('asks the size for a home chef only, previews verdicts, and records and changes the answer', async () => {
    const engine = new FakeEngine();
    const get = (params: Record<string, unknown>) => engine.request('venture.compliance.get', params as never) as Promise<ComplianceLite>;
    const set = (params: Record<string, unknown>) => engine.request('venture.compliance.set', params as never) as Promise<ComplianceLite>;
    expect((await get({ profession: 'advocate' })).size).toBeNull();
    const view = await get({ profession: 'home-chef-tiffin' });
    expect(view.size?.questions.map((question) => [question.question, question.choices.map((choice) => choice.label), question.answer])).toEqual([
      ["What's your yearly turnover?", ['Up to ₹1.5 crore a year', 'More than ₹1.5 crore a year', "I'd rather not say"], null],
    ]);
    expect(view.rules.map((rule) => rule.verdict)).toEqual(['Add your yearly turnover to see which applies.']);
    expect((await get({ profession: 'home-chef-tiffin', size: { turnover: ABOVE } })).rules[0]!.verdict).toBe('Above ₹1.5 crore a year: an FSSAI state licence.');
    await expect(get({ profession: 'home-chef-tiffin', size: { turnover: 'above-1' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose one of the size ranges shown.' });
    await expect(set({ size: { turnover: UP_TO } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Answer the side-work question first.' });

    const recorded = await set({ profession: 'home-chef-tiffin', sideWork: 'allowed', digest: view.digest, size: { turnover: UP_TO } });
    expect([recorded.size?.questions[0]!.answer, recorded.rules[0]!.verdict]).toEqual([UP_TO, 'At your size: an FSSAI registration.']);
    const changed = await set({ size: { turnover: 'not-say' } });
    expect([changed.recorded?.sideWork, changed.size?.questions[0]!.answer, changed.rules[0]!.verdict]).toEqual(['allowed', 'not-say', 'Add your yearly turnover to see which applies.']);
    await expect(set({ size: { headcount: 'up-to-10' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Answer only the size questions shown.' });
    // Recording the side-work answer again without a size keeps it.
    expect((await set({ profession: 'home-chef-tiffin', sideWork: 'not-sure', digest: view.digest })).size?.questions[0]!.answer).toBe('not-say');
    expect((await get({})).size?.questions[0]!.answer).toBe('not-say');
  });
});
