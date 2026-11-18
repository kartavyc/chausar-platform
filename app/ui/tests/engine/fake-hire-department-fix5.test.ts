import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// Re-check 057 (17 Nov 2026): a captions agent hired by hand was offered Operations. As agents/hire.ts
// (platform/tests/venture-hire-department-fix5.test.ts), a hand hire starts in the department its drafted role speaks
// of, follows the owner's edit of the role, and the owner's own choice stands.
describe('fake hire: the department starts where the role speaks of', () => {
  it('starts a captions and content role in Marketing, follows an edit, and keeps the owner\'s choice', async () => {
    const client = createFakeClient(new FakeEngine());
    const made = await client.request('venture.agents.hire.start', { sentence: 'someone who writes Instagram captions for my cake photos' });
    expect(made.department).toBe('marketing');
    const reads = await client.request('venture.agents.hire.answer', { hireId: made.id, phase: 'role' });
    expect(reads.department).toBe('marketing');
    const other = await client.request('venture.agents.hire.start', { sentence: 'someone for my customers' });
    const edited = await client.request('venture.agents.hire.answer', { hireId: other.id, phase: 'role', edits: { job: 'Lists office customers for you.', duties: ['Tracks follow ups with each lead'] } });
    expect(edited.department).toBe('sales');
    const voice = await client.request('venture.agents.hire.answer', { hireId: made.id, phase: 'reads', edits: { department: 'operations' } });
    expect(voice.department).toBe('operations');
  });
});
