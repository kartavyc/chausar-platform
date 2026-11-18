import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// Re-check 027 (17 Nov 2026): a rule naming proposals that find customers, then proposals, read "then proposals". As
// views/triage.ts (platform/tests/venture-triage-words-fix5.test.ts): the wider kind after its exact one reads "other
// proposals", and an exact kind named after its wider one is left out, as it would lead nothing.
describe('fake triage: an exact kind and its wider kind', () => {
  it('words the wider kind as "other" and leaves out an exact kind that would lead nothing', async () => {
    const client = createFakeClient(new FakeEngine());
    const dry = await client.request('venture.triage.preview', { text: 'Proposals that find customers first' });
    const saved = await client.request('venture.triage.set', { rule: { keys: [], first: ['find-customers', 'proposal'], words: 'x' }, digest: dry.digest });
    expect(saved.line).toBe('Today is ordered: proposals that find customers first, then other proposals. Nothing is hidden.');
    const again = await client.request('venture.triage.preview', { text: 'Proposals first' });
    const wider = await client.request('venture.triage.set', { rule: { keys: [], first: ['proposal', 'find-customers'], words: 'x' }, digest: again.digest });
    expect(wider.rule.first).toEqual(['proposal']);
    expect(wider.line).toBe('Today is ordered: proposals first. Nothing is hidden.');
  });
});
