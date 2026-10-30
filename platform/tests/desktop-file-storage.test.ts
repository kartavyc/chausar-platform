import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Engine } from '../runtime/engine.ts';
import { createWorkerEngine } from '../runtime/worker.ts';
import { Vault } from '../runtime/vault.ts';

const passphrase = 'Synthetic desktop storage check only';
const replacement = 'Synthetic recovered desktop check only';
async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-w6-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the real desktop worker selects encrypted files without enabling demo mode or requiring Postgres', async t => {
  const directory = await scratch(t);
  const engine = await createWorkerEngine({ CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '0' });
  t.after(() => engine.close());
  assert.equal(engine.options.storage, 'experimental-file');
  assert.equal(engine.options.demo, false);
  assert.equal(engine.options.venture?.host, 'desktop');
  const made = await engine.request('workspace.create', { name: 'Synthetic desktop business', passphrase, demo: false });
  assert.equal(made.workspace.demo, false);
  assert.equal(engine.vault?.storageKind, 'experimental-file');
});

test('desktop file authority backs up, restores, and opens with its recovery code outside demo mode', async t => {
  const directory = await scratch(t);
  const engine = new Engine({ directory, demo: false, storage: 'experimental-file', venture: { host: 'desktop' } });
  t.after(() => engine.close());
  const made = await engine.request('workspace.create', { name: 'Synthetic backup business', passphrase, demo: false });
  await engine.vault!.update(state => { state.activity.push({ message: 'Synthetic saved business note' }); });
  const backupFile = join(directory, 'desktop.chausar-backup');
  await engine.vault!.backup(backupFile);
  const encrypted = await readFile(backupFile, 'utf8');
  assert.ok(!encrypted.includes('Synthetic saved business note'));
  assert.ok(!encrypted.includes(passphrase));
  await engine.close();
  const restoredDirectory = join(directory, 'restored');
  const restored = await Vault.restore({ directory: restoredDirectory, storage: 'experimental-file', backupFile, passphrase });
  assert.equal(restored.read().workspace.demo, false);
  assert.equal(restored.read().activity.at(-1).message, 'Synthetic saved business note');
  await restored.close();
  const recovered = await Vault.recover({ directory: restoredDirectory, storage: 'experimental-file',
    recoveryCode: made.recoveryCode, newPassphrase: replacement });
  assert.equal(recovered.read().activity.at(-1).message, 'Synthetic saved business note');
  await recovered.close();
  await assert.rejects(Vault.open({ directory: restoredDirectory, storage: 'experimental-file', passphrase }));
  const reopened = await Vault.open({ directory: restoredDirectory, storage: 'experimental-file', passphrase: replacement });
  assert.equal(reopened.read().workspace.demo, false);
  await reopened.close();
});

test('a killed writer halfway through a save preserves the last committed encrypted authority', { timeout: 20_000 }, async t => {
  const directory = await scratch(t);
  const options = { directory, storage: 'experimental-file' as const, passphrase };
  const { vault } = await Vault.create({ ...options, name: 'Synthetic crash business' });
  await vault.update(state => { state.activity.push({ message: 'Committed before interrupted save' }); });
  const revision = vault.read().revision;
  await vault.close();
  const authority = join(directory, 'authority.encrypted.json');
  const before = await readFile(authority);
  // Instrument only this child process's file handle, before loading the real Vault implementation.
  // The child writes actual partial ciphertext and stops before sync/rename; no production fault hook is needed.
  const program = [
    "import fs from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import { join } from 'node:path';",
    'const options = ' + JSON.stringify(options) + ';',
    'const originalOpen = fs.open;',
    'fs.open = async function(path, ...args) {',
    '  const handle = await originalOpen.call(this, path, ...args);',
    "  if (String(path).startsWith(join(options.directory, '.authority.encrypted.json.')) && String(path).endsWith('.tmp') && args[0] === 'wx') {",
    '    const write = handle.writeFile.bind(handle);',
    '    handle.writeFile = async function(content) {',
    "      const bytes = Buffer.from(content, 'utf8');",
    '      const partial = bytes.subarray(0, Math.floor(bytes.length / 2));',
    '      await write(partial);',
    "      process.stdout.write(JSON.stringify({ partial: partial.length, total: bytes.length }) + '\\n');",
    '      await new Promise(() => {});',
    '    };',
    '  }',
    '  return handle;',
    '};',
    'syncBuiltinESMExports();',
    'const { Vault } = await import(' + JSON.stringify(new URL('../runtime/vault.ts', import.meta.url).href) + ');',
    'setInterval(() => {}, 1000);',
    'const vault = await Vault.open(options);',
    "await vault.update(state => { state.activity.push({ message: 'Uncommitted interrupted note' }); });",
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', program],
    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  const progress = await new Promise<{ partial: number; total: number }>((resolve, reject) => {
    let output = '', error = '';
    const deadline = setTimeout(() => reject(new Error('The writer did not reach its partial save. ' + error)), 10_000);
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(deadline); resolve(JSON.parse(output.slice(0, output.indexOf('\n')))); }
    });
    child.once('error', cause => { clearTimeout(deadline); reject(cause); });
    child.once('exit', () => { clearTimeout(deadline); reject(new Error('Writer exited before partial save. ' + error)); });
  });
  const exited = once(child, 'exit');
  assert.equal(child.kill('SIGKILL'), true);
  await exited;
  assert.ok(progress.partial > 0 && progress.partial < progress.total);
  assert.deepEqual(await readFile(authority), before);
  const orphans = (await readdir(directory)).filter(name => name.startsWith('.authority.encrypted.json.') && name.endsWith('.tmp'));
  assert.equal(orphans.length, 1);
  assert.equal((await readFile(join(directory, orphans[0]))).length, progress.partial);
  const reopened = await Vault.open(options);
  assert.equal(reopened.read().revision, revision);
  assert.deepEqual(reopened.read().activity, [{ message: 'Committed before interrupted save' }]);
  await reopened.update(state => { state.activity.push({ message: 'Saved after crash recovery' }); });
  await reopened.close();
  const final = await Vault.open(options);
  assert.equal(final.read().revision, revision + 1);
  assert.equal(final.read().activity.at(-1).message, 'Saved after crash recovery');
  await final.close();
});
