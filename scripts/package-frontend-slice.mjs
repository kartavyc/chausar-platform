import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    ['node_modules', 'dist', 'coverage'].includes(entry.name) ? [] :
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const files = walk(join(root, 'app/ui')).filter(path =>
  ['.ts', '.tsx', '.css', '.json', '.md'].includes(extname(path)));
files.push(...['check-ui-source.mjs', 'generate-design-inventory.mjs', 'package-frontend-slice.mjs'].map(name => join(root, 'scripts', name)));
files.push(...['README.md', 'vite.config.mjs', 'vitest.config.mjs', 'tsconfig.render-tests.json', 'tests/today-ask.test.tsx'].map(name => join(root, 'frontend-validation', name)));
files.sort((a, b) => a.localeCompare(b));
const manifest = [];
const patches = files.map(path => {
  const name = relative(root, path).replaceAll('\\', '/');
  if (!/^(?:app\/ui\/|scripts\/|frontend-validation\/)/.test(name) || /[\r\n\t ]/.test(name)) throw new Error('Unsafe patch path');
  const bytes = readFileSync(path);
  if (bytes.includes(0)) throw new Error(`Non-text source ${name}`);
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const newline = text.endsWith('\n');
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  manifest.push({
    path: name, bytes: Buffer.byteLength(text, 'utf8'), sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    workspaceSource: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  });
  return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join('')}${newline || !lines.length ? '' : '\\ No newline at end of file\n'}`;
});
writeFileSync(join(root, 'frontend-slice.patch'), patches.join(''), 'utf8');
writeFileSync(join(root, 'delivery-manifest.json'), JSON.stringify({
  kind: 'additive-unactivated-source', base: 'ce5dc4f6c432ce637b23cbd26f159346acdcd68e',
  designMappingBase: 'de1608438bef08d263e32f71e599b31aec9142e7',
  normalization: 'Patch content is UTF-8 without BOM and with LF line endings. Top-level file hashes describe that content; workspaceSource records the original local bytes.',
  sourceFiles: manifest, excluded: ['attachments', 'reference pixels', 'Library transfer URLs', 'Claude auth/session files', 'shared renderer/engine/host files'],
}, null, 2) + '\n');
process.stdout.write(`${manifest.length} additive source files packaged; no checkout was modified.\n`);
