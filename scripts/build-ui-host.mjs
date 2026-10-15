// Consume existing local frontend packages; never acquire dependencies or launch a host.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { hostBuildConfig } from '../frontend-validation/host.vite.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.argv.length, 2, 'No build options or remote acquisition are supported.');
const outputParent = join(root, 'frontend-validation', 'dist');
await mkdir(outputParent, { recursive: true });
const outputRoot = await mkdtemp(join(outputParent, 'host-'));
await build({ ...hostBuildConfig(outputRoot), configFile: false, mode: 'production' });
const bundle = join(outputRoot, 'bundle');
const js = await readFile(join(bundle, 'host.js'));
// Every lane's screens joined by round 4 put the minified host past 2 MB; 2.5 MB is the served limit too (app/desktop/ui-assets.cjs).
assert.ok(js.length > 0 && js.length <= 2_500_000);
assert.equal(/\bprocess\.env\b/.test(js.toString('utf8')), false, 'Browser bundle has unresolved Node environment reads.');
const css = await readFile(join(bundle, 'host.css'));
assert.ok(css.length > 0 && css.length <= 200_000);
const fonts = (await readdir(bundle)).filter(name => name.endsWith('.woff2')).sort();
assert.equal(fonts.length, 8);
for (const name of fonts) assert.deepEqual(await readFile(join(bundle, name)), await readFile(join(root, 'app/ui/assets/fonts', name)));
// Only validated public assets change. Font originals and source maps stay separate.
await writeFile(join(root, 'app/ui/public/host.js'), js);
await writeFile(join(root, 'app/ui/public/host.css'), css);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({ outputRoot, host: { bytes: js.length, sha256: sha(js) }, css: { bytes: css.length, sha256: sha(css) }, fonts: fonts.length }));
