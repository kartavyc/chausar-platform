// A2 review: venture.ai.setup.trust, the owner's yes to a found Codex, is answered by the engine itself: in the app, by
// the owner only, never from a phone, an MCP caller, a tainted context, a cofounder or the hosted app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';

const SHA = 'a'.repeat(64);
async function engine(t: any, host: 'desktop' | 'hosted-web' = 'desktop') {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-engine-codex-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recorded: unknown[] = [];
  const codexCli = { profile: () => null, review: async () => null, record: async (sha256: unknown) => { recorded.push(sha256); return { state: 'trusted', origin: 'owner', path: 'x', version: '0.166.0', sha256, line: 'Uses your Codex 0.166.0, which you chose.' }; } };
  return { engine: new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host, codexCli } as never }), recorded };
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };

test('the owner in the app records the choice', async t => {
  const { engine: e, recorded } = await engine(t);
  const answer = await e.requestAs(owner, 'venture.ai.setup.trust', { cli: 'codex', sha256: SHA });
  assert.equal(answer.setup.state, 'trusted');
  assert.deepEqual(recorded, [SHA]);
});

test('a phone, an MCP caller, a tainted context, a cofounder and the hosted app are refused, and nothing is recorded', async t => {
  const { engine: e, recorded } = await engine(t);
  for (const [context, code] of [
    [{ ...owner, channel: 'phone' }, 'APP_APPROVAL_REQUIRED'], [{ ...owner, channel: 'mcp' }, 'APP_APPROVAL_REQUIRED'],
    [{ ...owner, sourceTainted: true }, 'APP_APPROVAL_REQUIRED'], [{ ...owner, role: 'cofounder' }, 'FORBIDDEN'],
  ] as [Context, string][]) {
    await assert.rejects(e.requestAs(context, 'venture.ai.setup.trust', { cli: 'codex', sha256: SHA }), { code }, JSON.stringify(context));
  }
  await assert.rejects(e.requestAs(owner, 'venture.ai.setup.trust', { cli: 'claude-code', sha256: SHA }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(e.requestAs(owner, 'venture.ai.setup.trust', { cli: 'codex', sha256: SHA, extra: 1 }), { code: 'INVALID_VENTURE_REQUEST' });
  const hosted = await engine(t, 'hosted-web');
  await assert.rejects(hosted.engine.requestAs(owner, 'venture.ai.setup.trust', { cli: 'codex', sha256: SHA }), { code: 'CODEX_SETUP_UNAVAILABLE' });
  assert.deepEqual([...recorded, ...hosted.recorded], []);
});
