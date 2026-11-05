import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopLaunchPrerequisites } from './desktop-launch.mjs';
import { packagedFolder } from './desktop-smoke.mjs';

// Explicit CI qualification of Electron's Node embedding. No BrowserWindow or HTTP listener.
// D5 task 6: --packaged <unpacked dir> runs the packaged Chausar in Node mode (ELECTRON_RUN_AS_NODE) against the worker
// inside that build; it never starts the program without that variable, so no window can open.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseElectronSmokeArguments(args, { platform = process.platform } = {}) {
  if (args.length === 0) return { check: false, packaged: null };
  if (args.length === 1 && args[0] === '--check') return { check: true, packaged: null };
  if (args[0] !== '--packaged' || args.length > 2) throw new Error('Use only the optional --check argument, or --packaged <unpacked build folder>.');
  return { check: false, packaged: packagedFolder(args[1], platform) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseElectronSmokeArguments(process.argv.slice(2));
    const executablePath = options.packaged ? options.packaged.program : (await desktopLaunchPrerequisites()).executablePath;
    if (options.check) console.log('Electron headless smoke prerequisites passed; no process was launched.');
    else {
      const smokeArgs = [join(root, 'scripts/desktop-smoke.mjs'), ...(options.packaged ? ['--packaged', options.packaged.folder] : [])];
      const child = spawn(executablePath, smokeArgs, { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, shell: false, windowsHide: true, stdio: 'inherit' });
      child.once('error', error => { console.error(error.message); process.exitCode = 1; });
      child.once('exit', code => { process.exitCode = code ?? 1; });
    }
  } catch (error) { console.error(error.code === 'ENOENT' ? 'Electron headless smoke blocked: pinned local dependencies/distribution are absent. No download was attempted.' : error.message); process.exitCode = 1; }
}
