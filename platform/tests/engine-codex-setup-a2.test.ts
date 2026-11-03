// A2 review: venture.ai.setup.trust, the owner's yes to a found Codex, is answered by the engine itself: in the app, by
// the owner only, never from a phone, an MCP caller, a tainted context, a cofounder or the hosted app.
// A2 second review: only the owner's click in the desktop main process's own dialog can approve a Codex. The engine
// records the choice only through the worker's host channel, which only main can write to (confirmCodexSetup); every
// request route (the window, the local server's bootstrap session, the phone, MCP) is refused. The dialog is asked for
// once per program: a Codex already in use (the owner's, or the bundled one) is answered without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';

const SHA = 'a'.repeat(64);
const BUNDLED = 'b'.repeat(64);
const HELD = { path: String.raw`C:\Users\owner\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.exe`, version: '0.166.0' };
async function engine(t: any, host: 'desktop' | 'hosted-web' = 'desktop') {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-engine-codex-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recorded: unknown[] = [];
  let current: Record<string, unknown> | null = { state: 'trusted', origin: 'bundled', path: 'C:\\Program Files\\Chausar\\resources\\codex\\bin\\codex.exe', version: '0.166.0', sha256: BUNDLED, line: 'Uses the Codex 0.166.0 that comes with Chausar.' };
  const codexCli = {
    profile: () => null, review: async () => null,
    current: () => (current ? { ...current } : null),
    held: (sha256: unknown) => (sha256 === SHA ? { ...HELD } : null),
    record: async (sha256: unknown) => {
      recorded.push(sha256);
      current = { state: 'trusted', origin: 'owner', path: 'x', version: '0.166.0', sha256, line: 'Uses your Codex 0.166.0, which you chose.' };
      return { ...current };
    },
  };
  return { engine: new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host, codexCli } as never }), recorded };
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };

test('a request without main\'s confirmation is refused on every route, even the owner in the app, and records nothing', async t => {
  const { engine: e, recorded } = await engine(t);
  for (const context of [owner, { ...owner, channel: 'phone' }, { ...owner, channel: 'mcp' }, { ...owner, sourceTainted: true }, { ...owner, role: 'cofounder' }] as Context[]) {
    await assert.rejects(e.requestAs(context, 'venture.ai.setup.trust', { cli: 'codex', sha256: SHA }), { code: 'APP_APPROVAL_REQUIRED', message: 'Do this inside the Chausar app.' }, JSON.stringify(context));
  }
  await assert.rejects(e.request('venture.ai.setup.trust', { cli: 'codex', sha256: SHA }), { code: 'APP_APPROVAL_REQUIRED' });
  assert.deepEqual(recorded, []);
});

test('main\'s confirmation records the owner\'s choice; the dialog\'s words come from the held review', async t => {
  const { engine: e, recorded } = await engine(t);
  e.context = owner;
  assert.deepEqual(await e.codexChoiceFor({ cli: 'codex', sha256: SHA }), HELD);
  await assert.rejects(e.codexChoiceFor({ cli: 'codex', sha256: 'c'.repeat(64) }), { code: 'CODEX_SETUP_CHANGED' }, 'no review held for that program');
  const answer = await e.confirmCodexSetup({ cli: 'codex', sha256: SHA });
  assert.equal((answer.setup as { state?: string }).state, 'trusted');
  assert.deepEqual(recorded, [SHA]);
});

test('the dialog is asked for once: a Codex already in use, chosen or bundled, is answered without it', async t => {
  const { engine: e, recorded } = await engine(t);
  e.context = owner;
  // The bundled Codex, recorded at build time, never needs the owner's dialog.
  assert.deepEqual(await e.codexChoiceFor({ cli: 'codex', sha256: BUNDLED }), { inUse: { state: 'trusted', origin: 'bundled', path: 'C:\\Program Files\\Chausar\\resources\\codex\\bin\\codex.exe', version: '0.166.0', sha256: BUNDLED, line: 'Uses the Codex 0.166.0 that comes with Chausar.' } });
  await e.confirmCodexSetup({ cli: 'codex', sha256: SHA });
  // A second call for the program already chosen asks nothing more.
  assert.equal(((await e.codexChoiceFor({ cli: 'codex', sha256: SHA })) as { inUse?: { origin?: string } }).inUse?.origin, 'owner');
  assert.deepEqual(recorded, [SHA]);
});

test('main\'s confirmation still needs the owner, an untainted app context, the exact payload and a desktop host', async t => {
  const { engine: e, recorded } = await engine(t);
  for (const [context, code] of [
    [{ ...owner, channel: 'phone' }, 'APP_APPROVAL_REQUIRED'], [{ ...owner, sourceTainted: true }, 'APP_APPROVAL_REQUIRED'], [{ ...owner, role: 'cofounder' }, 'FORBIDDEN'],
  ] as [Context, string][]) {
    e.context = context;
    await assert.rejects(e.confirmCodexSetup({ cli: 'codex', sha256: SHA }), { code }, JSON.stringify(context));
    await assert.rejects(e.codexChoiceFor({ cli: 'codex', sha256: SHA }), { code }, JSON.stringify(context));
  }
  e.context = owner;
  await assert.rejects(e.confirmCodexSetup({ cli: 'claude-code', sha256: SHA }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(e.confirmCodexSetup({ cli: 'codex', sha256: SHA, extra: 1 }), { code: 'INVALID_VENTURE_REQUEST' });
  const hosted = await engine(t, 'hosted-web');
  hosted.engine.context = owner;
  await assert.rejects(hosted.engine.confirmCodexSetup({ cli: 'codex', sha256: SHA }), { code: 'CODEX_SETUP_UNAVAILABLE' });
  assert.deepEqual([...recorded, ...hosted.recorded], []);
});
