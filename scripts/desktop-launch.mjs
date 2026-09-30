import { readFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLocalElectronDistribution } from './desktop-package.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function desktopLaunchArguments(args) {
  const allowed = new Set(['--demo', '--production', '--background', '--check']);
  if (new Set(args).size !== args.length || args.some(arg => !allowed.has(arg))) throw new Error('Use --demo or --production, with optional --background and --check.');
  if (args.includes('--demo') === args.includes('--production')) throw new Error('Select exactly one launch mode: --demo or --production.');
  return { demo: args.includes('--demo'), background: args.includes('--background'), checkOnly: args.includes('--check') };
}
/** Launch the already validated native executable; do not invoke the npm loader or its automatic installer. */
export function desktopLaunchEnvironment(environment = process.env) {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (/^(ELECTRON_RUN_AS_NODE|ELECTRON_OVERRIDE_DIST_PATH|ELECTRON_INSTALL_PLATFORM|ELECTRON_INSTALL_ARCH|npm_config_platform|npm_config_arch)$/i.test(name)) delete result[name];
  }
  return result;
}
export async function desktopLaunchPrerequisites(root = projectRoot) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const electronRoot = join(root, 'node_modules/electron');
  const electron = JSON.parse(await readFile(join(electronRoot, 'package.json'), 'utf8'));
  if (electron.version !== pkg.devDependencies?.electron) throw new Error('Installed Electron must match its exact project pin.');
  const bin = typeof electron.bin === 'string' ? electron.bin : electron.bin?.electron;
  if (typeof bin !== 'string') throw new Error('Installed Electron has no local CLI.');
  const cli = resolve(electronRoot, bin), rel = relative(electronRoot, cli);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Electron CLI must be inside its installed package.');
  const info = await lstat(cli);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Installed Electron CLI must be a regular local file.');
  const executable = (await readFile(join(electronRoot, 'path.txt'), 'utf8')).trim();
  const expected = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron' }[process.platform];
  if (!expected || executable !== expected) throw new Error('Electron distribution must match this operating system.');
  await validateLocalElectronDistribution(electronRoot, electron.version, process.platform, process.arch);
  return { cli, executablePath: join(electronRoot, 'dist', executable), version: electron.version };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { demo, background, checkOnly } = desktopLaunchArguments(process.argv.slice(2));
    const prerequisites = await desktopLaunchPrerequisites();
    if (checkOnly) console.log(`Desktop launch prerequisites passed for ${process.platform}-${process.arch}; no window was launched.`);
    else {
      const child = spawn(prerequisites.executablePath, [projectRoot, demo ? '--demo' : '--production', ...(background ? ['--background'] : [])], { cwd: projectRoot, env: desktopLaunchEnvironment(), shell: false, windowsHide: true, stdio: 'inherit' });
      child.once('error', error => { console.error(error.message); process.exitCode = 1; });
      child.once('exit', code => { process.exitCode = code ?? 1; });
    }
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'Desktop launch blocked: pinned local Electron dependencies/distribution are absent. No install or download was attempted.' : error.message);
    process.exitCode = 1;
  }
}
