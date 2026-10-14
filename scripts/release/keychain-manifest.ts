import { createHash } from 'node:crypto';
import { copyFile, chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import type { KeychainHelperManifest } from '../../platform/runtime/engine-keychain-host.ts';

/** Release step after CI compiles platform/native/keychain (and pre-signs it on signed builds):
 * places the helper at runtime-binaries/keychain/<executable> and pins its final bytes in manifest.json.
 * It never runs the helper. */
const MAX_HELPER = 8 * 1024 * 1024;

export async function writeKeychainManifest(input: { helper: string; platform: string; architecture: string; out: string }): Promise<KeychainHelperManifest> {
  const { helper, platform, architecture, out } = input;
  check(platform === 'win32' || platform === 'darwin' || platform === 'linux', 'KEYCHAIN_MANIFEST_INVALID', 'Use win32, darwin or linux.');
  check(architecture === 'x64' || architecture === 'arm64', 'KEYCHAIN_MANIFEST_INVALID', 'Use x64 or arm64.');
  const info = await lstat(helper);
  check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= MAX_HELPER, 'KEYCHAIN_HELPER_INVALID', 'The compiled helper must be a bounded regular file.');
  const executable = platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain';
  await mkdir(out, { recursive: true });
  const target = join(out, executable);
  if (resolve(target) !== resolve(helper)) await copyFile(helper, target);
  if (platform !== 'win32') await chmod(target, 0o755);
  const sha256 = createHash('sha256').update(await readFile(target)).digest('hex');
  const manifest: KeychainHelperManifest = { format: 'chausar.keychain-helper.v1', platform, architecture, executable, sha256 };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options: Record<string, string> = {}, args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      check(['--helper', '--platform', '--arch', '--out'].includes(args[index]) && args[index + 1] && !(args[index].slice(2) in options),
        'USAGE', 'usage: node scripts/release/keychain-manifest.ts --helper <compiled helper> --platform <p> --arch <a> [--out runtime-binaries/keychain]');
      options[args[index].slice(2)] = args[index + 1];
    }
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const manifest = await writeKeychainManifest({ helper: resolve(options.helper ?? ''), platform: options.platform ?? process.platform,
      architecture: options.arch ?? process.arch, out: resolve(options.out ?? join(root, 'runtime-binaries', 'keychain')) });
    console.log(`Keychain helper pinned: ${manifest.executable} sha256 ${manifest.sha256}`);
  } catch (error: any) { console.error(`${error.code ?? 'KEYCHAIN_MANIFEST_FAILED'}: ${error.message}`); process.exitCode = 1; }
}
