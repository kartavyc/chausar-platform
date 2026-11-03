import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// A2 review: the fake answers venture.ai.setup.trust as engine.ts and codex-trust.ts do, and its Your AI shows the setup.
describe('fake Codex setup', () => {
  it('refuses a choice when no review is held, in the engine words', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'CODEX_SETUP_CHANGED', message: 'That Codex changed since you looked at it. Check it again.' });
  });
  it('refuses the hosted app as the engine does', async () => {
    const client = createFakeClient(new FakeEngine({ hosted: true }));
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED', message: 'Do this inside the Chausar app.' });
  });
  it('Your AI shows the found Codex for the owner’s yes, and after it the Codex in use', async () => {
    const client = createFakeClient(new FakeEngine());
    const before = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect(before.setup?.state).toBe('review');
    await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: before.setup!.sha256! });
    const after = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect([after.setup?.state, after.setup?.origin, after.state, after.line]).toEqual(['trusted', 'owner', 'unverified', 'Codex 0.166.0 is on this computer. Not yet tried on a real task.']);
  });
});
