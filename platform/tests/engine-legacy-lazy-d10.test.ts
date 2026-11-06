import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));

test('older request handlers load only after an admitted legacy request and keep unknown-request behavior', () => {
  const source = `
    import { registerHooks } from 'node:module';
    import { mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const loaded = new Set(); let engineAtLoad; let contextChanged = false;
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); loaded.add(result.url); if (engineAtLoad && result.url.endsWith('/legacy/dispatch.ts')) { engineAtLoad.context = { memberId: 'not-the-admitted-owner', role: 'viewer', epoch: 1, channel: 'desktop' }; contextChanged = true; } return result; } });
    const { Engine } = await import('./platform/runtime/engine.ts');
    const directory = await mkdtemp(join(tmpdir(), 'chausar-legacy-lazy-'));
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
    const legacy = () => [...loaded].filter(url => url.includes('/runtime/legacy/'));
    try {
      await engine.request('workspace.status');
      await engine.request('venture.countries');
      const before = legacy();
      await engine.request('workspace.create', { name: 'Synthetic legacy boundary', passphrase: 'synthetic legacy passphrase' });
      const policy = await engine.request('trust.update', { send: 'nothing' });
      if (policy.send !== 'nothing') throw new Error('Core disclosure policy route changed');
      let unknown;
      try { await engine.request('unknown.d10'); } catch (error) { unknown = { name: error.name, message: error.message }; }
      const afterUnknown = legacy();
      engineAtLoad = engine;
      const jobs = await engine.request('jobs.list');
      console.log(JSON.stringify({ before, afterUnknown, after: legacy(), unknown, jobs, contextChanged }));
    } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout.trim());
  assert.deepEqual(result.before, []);
  assert.deepEqual(result.afterUnknown, []);
  assert.deepEqual(result.unknown, { name: 'Error', message: 'Unknown request: unknown.d10' });
  assert.deepEqual(result.jobs, []);
  assert.equal(result.contextChanged, true, 'The handler must retain the context admitted before its module load.');
  assert.ok(result.after.some((url: string) => url.endsWith('/legacy/dispatch.ts')), 'jobs.list must load the isolated legacy dispatcher');
});

test('the existing method registry owns the exact legacy surface without renderer authority', async () => {
  const registry = await import('../runtime/method-registry.ts');
  const rows = registry.CORE_METHODS.filter(row => 'legacy' in row && row.legacy);
  assert.equal(rows.length, 163);
  assert.equal(rows.some(row => row.renderer), false);
  assert.equal(new Set(rows.map(row => row.name)).size, 163);
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /case ['"](?:jobs|trials|conversation|auth|phone|sync)\./);
  assert.match(source, /import\('\.\/legacy\/dispatch\.ts'\)/);
});

test('legacy parity files remain in full qualification and are excluded from the fast tier', async () => {
  const tiers = JSON.parse(await readFile(new URL('./tiers.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(tiers.legacy) && tiers.legacy.length >= 64, 'The existing legacy parity files need their own tier.');
  const listed = (tier: string) => {
    const child = spawnSync(process.execPath, ['scripts/bench.mjs', '--list', '--tier=' + tier], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout).files as string[];
  };
  const legacy = listed('legacy'), fast = listed('fast'), all = listed('all');
  assert.deepEqual(legacy, [...tiers.legacy].sort());
  assert.equal(legacy.some((file: string) => fast.includes(file)), false);
  assert.equal(legacy.every((file: string) => all.includes(file)), true);
});

