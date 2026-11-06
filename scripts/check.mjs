// Checks the syntax of every source file and every JSON file under platform/, app/ and scripts/, in one process.
// TypeScript is stripped the way the worker runs it (erasable syntax only; the Vite project under app/ui/ may also use
// syntax Vite transforms), then each file is parsed, never run, as Node would load it: an ES module or CommonJS.
// ES module parsing needs vm.SourceTextModule, so without --experimental-vm-modules the script starts itself once
// with that flag and exits with the child's code.
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import Module, { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (typeof vm.SourceTextModule !== 'function') {
  const child = spawn(process.execPath, ['--experimental-vm-modules', '--no-warnings=ExperimentalWarning', ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('error', error => { process.stderr.write(`check.mjs could not start its parser: ${error.message}\n`); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  await main();
}

async function main() {
  const root = process.cwd();
  const SKIPPED = new Set(['node_modules', '.git', 'data', 'vaults', 'dist', 'release']);
  const files = [];
  const fail = (file, error) => {
    // A parser's message can quote a whole minified line; keep each line short.
    const detail = String(error?.stack ?? error?.message ?? error).split('\n').slice(0, 6).map(line => line.length > 240 ? `${line.slice(0, 240)}...` : line).join('\n');
    process.stderr.write(`${relative(root, file)}: syntax check failed\n${detail}\n`);
    process.exit(1);
  };
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (SKIPPED.has(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      // Declaration files are left to tsc (npm run typecheck reads them); they are types, never run.
      else if (/\.d\.[mc]?ts$/.test(path)) continue;
      else if (/\.(?:[mc]?ts|js|mjs|cjs)$/.test(path)) files.push(path);
      else if (item.name.endsWith('.json')) {
        try { JSON.parse(await readFile(path, 'utf8')); } catch (error) { fail(path, error); }
      }
    }
  }
  await walk(join(root, 'platform'));
  await walk(join(root, 'app'));
  await walk(join(root, 'scripts'));

  // The nearest package.json "type" decides .js and .ts files, as in Node; the search stops at the repo root.
  const typeOf = new Map();
  async function packageType(directory) {
    if (typeOf.has(directory)) return typeOf.get(directory);
    let type;
    try { type = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).type === 'module' ? 'module' : 'commonjs'; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(directory);
      type = directory === root || parent === directory ? 'commonjs' : await packageType(parent);
    }
    typeOf.set(directory, type);
    return type;
  }
  const uiRoot = join(root, 'app', 'ui') + sep;

  for (const file of files) {
    try {
      let text = await readFile(file, 'utf8');
      const extension = file.slice(file.lastIndexOf('.'));
      if (/^\.[mc]?ts$/.test(extension)) {
        text = stripTypeScriptTypes(text, { mode: file.startsWith(uiRoot) ? 'transform' : 'strip' });
      }
      // A hashbang line is legal only as the very first characters, which the CommonJS wrapper moves.
      if (text.startsWith('#!')) text = `//${text.slice(2)}`;
      const kind = extension === '.mjs' || extension === '.mts' ? 'module'
        : extension === '.cjs' || extension === '.cts' ? 'commonjs'
          : await packageType(dirname(file));
      if (kind === 'module') new vm.SourceTextModule(text, { identifier: file });
      else new vm.Script(Module.wrap(text), { filename: file });
    } catch (error) {
      fail(file, error);
    }
  }
  // C7: the in-app help quotes the guide as indexed at build; a guide that changed needs `node scripts/guide-index.mjs`.
  const guideScript = join(root, 'scripts', 'guide-index.mjs');
  const guide = await readFile(join(root, 'docs', 'beta-guide.md'), 'utf8').catch(() => null);
  if (guide !== null && await readFile(guideScript, 'utf8').then(() => true, () => false)) {
    const { guideData } = await import(pathToFileURL(guideScript).href);
    const kept = await readFile(join(root, 'platform', 'runtime', 'venture', 'core', 'guide-data.json'), 'utf8').catch(() => '');
    if (kept.replace(/\r\n/g, '\n') !== guideData(guide)) { process.stderr.write('guide-data.json is out of date with the guide. Run: node scripts/guide-index.mjs\n'); process.exit(1); }
  }
  console.log(`Syntax and JSON validation passed for ${files.length} source files.`);
}
