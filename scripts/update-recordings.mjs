// Explicit developer command: regenerate sample-only real-engine answers, never a live account.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = new URL('../platform/tests/recordings/', import.meta.url);
const files = (await readdir(folder)).filter(name => name.endsWith('.recording.test.ts')).sort();
if (!files.length) throw new Error('No real-engine recording scenarios found.');
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files.map(name => fileURLToPath(new URL(name, folder)))], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CHAUSAR_RECORDINGS_UPDATE: '1' },
});
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
