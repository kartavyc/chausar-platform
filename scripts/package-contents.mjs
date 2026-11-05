// D5 task 5: what a packaged build carries, read from the unpacked folder electron-builder leaves (win-unpacked,
// linux-unpacked). It only reads: the locale file names, the app.asar file list from the archive's own header (nothing
// is extracted), the unpacked @anthropic-ai folders, the bundled Codex's BUNDLE.json version and the size of each piece.
// It never starts the build. `node scripts/package-contents.mjs <unpacked dir> [--mode beta|preview|final] [--json]`
// prints the problems and exits 1 when there are any.
import { lstat, open, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIM } from './desktop-package.mjs';

const CODEX_VERSION = '0.166.0';
const INK_ENTRY = 'app/ui/dist/index.html';
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

/**
 * The file paths inside an asar archive, from its header: UInt32 4, UInt32 header size, then the header pickle
 * (UInt32 payload size, UInt32 string length, the JSON). Folders are walked; only files are listed.
 */
export async function readAsarFileList(path) {
  const handle = await open(path, 'r');
  try {
    const sizes = Buffer.alloc(8);
    const { bytesRead } = await handle.read(sizes, 0, 8, 0);
    if (bytesRead !== 8 || sizes.readUInt32LE(0) !== 4) throw new Error(`${path} is not an asar archive`);
    const headerSize = sizes.readUInt32LE(4);
    if (headerSize < 8 || headerSize > MAX_HEADER_BYTES) throw new Error(`${path} is not an asar archive`);
    const header = Buffer.alloc(headerSize);
    if ((await handle.read(header, 0, headerSize, 8)).bytesRead !== headerSize) throw new Error(`${path} is not an asar archive`);
    const length = header.readUInt32LE(4);
    if (length > headerSize - 8) throw new Error(`${path} is not an asar archive`);
    let tree;
    try { tree = JSON.parse(header.subarray(8, 8 + length).toString('utf8')); } catch { throw new Error(`${path} is not an asar archive`); }
    const files = [];
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (child && typeof child === 'object' && child.files) walk(child, path);
        else files.push(path);
      }
    };
    walk(tree, '');
    return files;
  } finally { await handle.close(); }
}

/** Bytes and files under a path, never following links. */
async function measure(path) {
  let info;
  try { info = await lstat(path); } catch { return { bytes: 0, files: 0 }; }
  if (info.isSymbolicLink()) return { bytes: 0, files: 1 };
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  let bytes = 0, files = 0;
  for (const name of await readdir(path)) {
    const inner = await measure(join(path, name));
    bytes += inner.bytes; files += inner.files;
  }
  return { bytes, files };
}
const names = async path => { try { return (await readdir(path)).sort(); } catch { return []; } };

/** What the build carries and every problem, in plain words. mode beta and final need the bundled Codex; preview has none. */
export async function readPackageContents(unpackedDir, { mode = 'beta' } = {}) {
  const resources = join(unpackedDir, 'resources');
  const unpacked = join(resources, 'app.asar.unpacked');
  const problems = [];

  const locales = (await names(join(unpackedDir, 'locales'))).filter(name => name.endsWith('.pak'));
  const languages = locales.map(name => name.slice(0, -'.pak'.length));
  for (const language of languages) if (!TRIM.electronLanguages.includes(language)) problems.push(`locale ${language} is not one of ${TRIM.electronLanguages.join(', ')}`);
  for (const language of TRIM.electronLanguages) if (!languages.includes(language)) problems.push(`locale ${language} is missing`);

  let archive = [];
  try { archive = await readAsarFileList(join(resources, 'app.asar')); }
  catch (error) { problems.push(error.code === 'ENOENT' ? 'resources/app.asar is missing' : error.message); }
  if (archive.length && !archive.includes(INK_ENTRY)) problems.push(`the Ink build (${INK_ENTRY}) is missing from the archive`);
  const inkSource = archive.filter(path => path.startsWith('app/ui/src/'));
  if (inkSource.length) problems.push(`Ink source in the archive: ${inkSource.slice(0, 5).join(', ')}`);

  // The Agent SDK ships; its platform packages (the Claude Code program file) never do (TRIM.claudeBinary 'none').
  const anthropic = await names(join(unpacked, 'node_modules', '@anthropic-ai'));
  const archived = [...new Set(archive.map(path => /^node_modules\/@anthropic-ai\/([^/]+)\//.exec(path)?.[1]).filter(Boolean))];
  const platformPackages = [...new Set([...anthropic, ...archived])].filter(name => name.startsWith('claude-agent-sdk-')).sort();
  if (TRIM.claudeBinary === 'none' && platformPackages.length) problems.push(`a Claude Code program file: ${platformPackages.join(', ')}`);
  if (!anthropic.includes('claude-agent-sdk') && !archived.includes('claude-agent-sdk')) problems.push('the Agent SDK is missing');

  let codexVersion = null;
  try { codexVersion = JSON.parse(await readFile(join(resources, 'codex', 'BUNDLE.json'), 'utf8')).version ?? null; } catch { codexVersion = null; }
  if (mode !== 'preview') {
    if (codexVersion === null) problems.push('the bundled Codex is missing (resources/codex/BUNDLE.json)');
    else if (codexVersion !== CODEX_VERSION) problems.push(`the bundled Codex is Codex ${codexVersion}, not ${CODEX_VERSION}`);
  }

  const total = await measure(unpackedDir);
  const resourceBytes = (await measure(resources)).bytes, localeBytes = (await measure(join(unpackedDir, 'locales'))).bytes;
  const sizes = {
    codex: (await measure(join(resources, 'codex'))).bytes,
    electron: total.bytes - resourceBytes - localeBytes,
    '@anthropic-ai': (await measure(join(unpacked, 'node_modules', '@anthropic-ai'))).bytes,
    '@duckdb': (await measure(join(unpacked, 'node_modules', '@duckdb'))).bytes,
    locales: localeBytes,
    'app.asar.unpacked/platform': (await measure(join(unpacked, 'platform'))).bytes,
    'app.asar.unpacked/platform files': (await measure(join(unpacked, 'platform'))).files,
    'app.asar': (await measure(join(resources, 'app.asar'))).bytes,
  };
  return { unpackedDir: resolve(unpackedDir), mode, locales, anthropic, codexVersion, archive: { files: archive.length }, sizes, totalBytes: total.bytes, fileCount: total.files, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const modeAt = args.indexOf('--mode');
  const mode = modeAt >= 0 ? args[modeAt + 1] : 'beta';
  const folder = args.find((arg, index) => !arg.startsWith('--') && (modeAt < 0 || index !== modeAt + 1));
  if (!folder || !['beta', 'preview', 'final'].includes(mode)) {
    console.error('Usage: node scripts/package-contents.mjs <unpacked dir> [--mode beta|preview|final] [--json]');
    process.exitCode = 1;
  } else {
    try {
      const contents = await readPackageContents(folder, { mode });
      if (json) console.log(JSON.stringify(contents, null, 2));
      else {
        console.log(`${contents.fileCount} files, ${contents.totalBytes} bytes; locales ${contents.locales.join(', ')}; @anthropic-ai ${contents.anthropic.join(', ') || 'none'}; Codex ${contents.codexVersion ?? 'none'}.`);
        for (const problem of contents.problems) console.log(`- ${problem}`);
      }
      if (contents.problems.length) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
