import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopLaunchPrerequisites } from './desktop-launch.mjs';

// Explicit CI qualification of Electron's Node embedding. No BrowserWindow or HTTP listener.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  if (process.argv.slice(2).some(argument => argument !== '--check') || process.argv.slice(2).length > 1) throw new Error('Use only the optional --check argument.');
  const { executablePath } = await desktopLaunchPrerequisites();
  if (process.argv.includes('--check')) console.log('Electron headless smoke prerequisites passed; no process was launched.');
  else {
    const child = spawn(executablePath, [join(root, 'scripts/desktop-smoke.mjs')], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) { console.error(error.code === 'ENOENT' ? 'Electron headless smoke blocked: pinned local dependencies/distribution are absent. No download was attempted.' : error.message); process.exitCode = 1; }
