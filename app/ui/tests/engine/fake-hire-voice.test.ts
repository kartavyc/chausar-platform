import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// The hand hire's AI drafts speak to the owner as "you", as the engine turns them (agents/hire.ts with
// core/owner-voice.ts; platform/tests/venture-hire-voice.test.ts): the drafted job and duties say "you" and "your",
// what the owner typed (the sentence, an edit) stays as typed, and the check reads both voices.
const SENTENCE = 'someone who keeps my content calendar and reminds me to post';

describe('fake hire: the drafted role is said to the owner', () => {
  it('turns the draft to "you" and leaves the owner\'s own words as typed', async () => {
    const client = createFakeClient(new FakeEngine());
    const made = await client.request('venture.agents.hire.start', { sentence: SENTENCE });
    expect(made.sentence).toBe(SENTENCE);
    expect(made.role).toEqual({ name: 'Mira', job: 'someone who keeps your content calendar and reminds you to post', duties: ['Keeps the content calendar up to date', 'Drafts captions for your approval'] });
    // The owner rewrites the job in their own voice: kept as typed, and the check passes it.
    const next = await client.request('venture.agents.hire.answer', { hireId: made.id, phase: 'role', edits: { job: 'Keeps my calendar and nudges me.' } });
    expect(next.role!.job).toBe('Keeps my calendar and nudges me.');
    expect(next.role!.duties).toEqual(['Keeps the content calendar up to date', 'Drafts captions for your approval']);
    // An outward act is refused in either voice.
    const other = await client.request('venture.agents.hire.start', { sentence: SENTENCE });
    for (const duty of ['Sends invoices without asking me', 'Sends invoices without asking you']) {
      await expect(client.request('venture.agents.hire.answer', { hireId: other.id, phase: 'role', edits: { duties: [duty] } })).rejects.toMatchObject({ code: 'HIRE_FLOOR' });
    }
  });
});
