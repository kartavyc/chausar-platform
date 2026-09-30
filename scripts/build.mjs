import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
await mkdir('dist', { recursive: true });
for (const path of ['app', 'platform', 'fixtures', 'scripts', 'runtime-binaries', 'docs', 'enterprise', 'package.json', 'tsconfig.json', 'README.md', 'SECURITY.md']) await cp(path, join('dist', path), { recursive: true });
const manifest = { name: 'Chausar', version: JSON.parse(await readFile('package.json', 'utf8')).version, builtAt: new Date().toISOString(), status: 'preview', signed: false, runtime: 'Node >=24.13.1; Electron dependency needed for desktop installer' };
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));
const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
console.log(`Portable source build created. Manifest SHA-256: ${checksum}. No signed installer is claimed.`);
