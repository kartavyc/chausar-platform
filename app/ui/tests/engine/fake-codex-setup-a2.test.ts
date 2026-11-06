import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// A2 review: the fake answers venture.ai.setup.trust as engine.ts and codex-trust.ts do, and its Your AI shows the setup.
describe('fake Codex setup', () => {
  it('refuses a choice when no review is held, in the engine words', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'CODEX_SETUP_CHANGED', message: 'That Codex changed since you looked at it. Check it again.' });
  });
  // A2 second review: the fake desktop models main's own dialog (app/desktop/codex-choice.cjs).
  it('main\'s dialog: Use this Codex records it, with the held review\'s program and version, never the window\'s', async () => {
    const engine = new FakeEngine();
    engine.firstRun.reviewCodex();
    const client = createFakeClient(engine);
    const answer = await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64), path: 'C:/evil/codex.exe', version: '9.9.9' } as never);
    expect([answer.setup.state, answer.setup.origin]).toEqual(['trusted', 'owner']);
    expect(engine.firstRun.dialogs).toEqual([{ title: 'Use this Codex?', detail: String.raw`Chausar will run Codex 0.166.0 from C:\Users\owner\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe for your AI work.`, buttons: ['Use this Codex', 'Cancel'] }]);
    // Once it is in use, a second call asks nothing more.
    await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) });
    expect(engine.firstRun.dialogs.length).toBe(1);
  });
  it('main\'s dialog: Cancel changes nothing and says so calmly', async () => {
    const engine = new FakeEngine();
    engine.firstRun.reviewCodex();
    engine.firstRun.codexDialog('cancel');
    const client = createFakeClient(engine);
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'CODEX_NOT_CHOSEN', message: "Nothing changed. Codex wasn't chosen." });
    const codex = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect(codex.setup?.state).toBe('review');
  });
  it('without main\'s confirmation (no desktop main process on this route) the choice is refused', async () => {
    const engine = new FakeEngine();
    engine.firstRun.reviewCodex();
    engine.firstRun.codexDialog('missing');
    const client = createFakeClient(engine);
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED', message: 'Do this inside the Chausar app.' });
    expect(engine.firstRun.dialogs).toEqual([]);
  });
  it('the bundled Codex in use is answered without a dialog', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const answer = await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'b'.repeat(64) });
    expect([answer.setup.origin, engine.firstRun.dialogs.length]).toEqual(['bundled', 0]);
  });
  it('refuses the hosted app as the engine does', async () => {
    const client = createFakeClient(new FakeEngine({ hosted: true }));
    await expect(client.request('venture.ai.setup.trust', { cli: 'codex', sha256: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED', message: 'Do this inside the Chausar app.' });
  });
  // A2 second review: as the first run, this fake desktop has the Codex that comes with Chausar in use.
  it('Your AI shows the bundled Codex in use, as the first run does', async () => {
    const client = createFakeClient(new FakeEngine());
    const codex = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect([codex.setup?.state, codex.setup?.origin, codex.setup?.line]).toEqual(['trusted', 'bundled', 'Uses the Codex 0.166.0 that comes with Chausar.']);
    expect([codex.state, codex.version, codex.path, codex.line, codex.fix]).toEqual(['unverified', '0.166.0', String.raw`C:\Program Files\Chausar\resources\codex\bin\codex.exe`, 'Codex 0.166.0 is on this computer. Not yet tried on a real task.', null]);
  });
  it('Your AI shows the found Codex for the owner’s yes, and after it the Codex in use', async () => {
    const engine = new FakeEngine();
    engine.firstRun.reviewCodex();
    const client = createFakeClient(engine);
    const before = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect(before.setup?.state).toBe('review');
    await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: before.setup!.sha256! });
    const after = (await client.request('venture.models.cli.status', {})).clis.find((cli) => cli.cli === 'codex')!;
    expect([after.setup?.state, after.setup?.origin, after.state, after.line]).toEqual(['trusted', 'owner', 'unverified', 'Codex 0.166.0 is on this computer. Not yet tried on a real task.']);
  });
});
