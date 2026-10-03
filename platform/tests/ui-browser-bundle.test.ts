import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('shipped browser host evaluates without Node globals', { timeout: 15_000 }, async () => {
  const asset = fileURLToPath(new URL('../../app/ui/public/host.js', import.meta.url));
  const probe = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { createContext, SourceTextModule } from 'node:vm';
    const context = createContext({});
    for (const key of ['process', 'require', 'module']) assert.equal(typeof context[key], 'undefined');
    const module = new SourceTextModule(await readFile(process.argv[1], 'utf8'), { context });
    await module.link(() => { throw Error('Browser bundle must be self-contained'); });
    await module.evaluate({ timeout: 5000 });
    assert.equal(typeof module.namespace.createHostController, 'function');
    assert.equal(typeof module.namespace.mountHost, 'function');
    for (const key of ['process', 'require', 'module']) assert.equal(typeof context[key], 'undefined');
  `;
  const child = spawn(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', probe, asset], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { NODE_DISABLE_COMPILE_CACHE: '1', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
  });
  let stderr = '';
  child.stderr.on('data', value => { stderr += value.toString(); });
  child.stdout.resume();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((fulfill, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => fulfill({ code, signal }));
    timer = setTimeout(() => child.kill(), 10_000);
  }).finally(() => clearTimeout(timer));
  assert.equal(result.signal, null, stderr);
  assert.equal(result.code, 0, stderr);
});
