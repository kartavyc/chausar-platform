#!/usr/bin/env node
// C5 task 30: makes the Ed25519 key pair that signs the update feed. The private half is written once, to a file outside
// the checkout (owner-only on Linux and macOS), and never printed; the public half is printed, to be pinned in the build
// metadata (package.json chausarUpdatePublicKey, C5 task 31). Run it once on the founder's own computer; the private
// file becomes the CHAUSAR_RELEASE_KEY Actions secret and stays with him.
// Usage: node scripts/release-key.mjs --out <file outside the checkout>
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseInsideRepo } from '../platform/runtime/run-root.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || args[1].startsWith('--')) {
    process.stderr.write('Usage: node scripts/release-key.mjs --out <file outside the checkout>\n');
    process.exit(2);
  }
  try {
    const out = refuseInsideRepo(args[1], { variable: '--out' });
    const pair = generateKeyPairSync('ed25519');
    await mkdir(dirname(out), { recursive: true });
    try {
      await writeFile(out, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`A key is already at ${out}. Nothing was changed; choose another file.`);
      throw error;
    }
    process.stdout.write(`The private key is in ${out}. Keep it safe and out of every repository.\n`);
    process.stdout.write(`${pair.publicKey.export({ format: 'pem', type: 'spki' })}`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
