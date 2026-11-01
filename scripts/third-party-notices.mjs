// Writes and checks NOTICE: every third-party package the desktop app ships, read from the installed node_modules.
// `node scripts/third-party-notices.mjs --write` rewrites NOTICE; `--check` exits 1 when NOTICE is out of date.
// It reads package.json files only. It never reads credentials, never runs package scripts and never downloads.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// SPDX ids that may be bundled inside an AGPL-3.0 program (permissive, weak copyleft or GPLv3-family).
const COMPATIBLE = new Set(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'BlueOak-1.0.0',
  'Python-2.0', 'PSF-2.0', 'CC0-1.0', 'CC-BY-4.0', 'Unlicense', 'Zlib', 'BSL-1.0', 'Artistic-2.0', 'PostgreSQL', 'X11',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'GPL-2.0-or-later',
  'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later']);
// SPDX ids that cannot be combined with an AGPL-3.0 program, or forbid distribution.
const INCOMPATIBLE = new Set(['UNLICENSED', 'GPL-2.0', 'GPL-2.0-only', 'SSPL-1.0', 'BUSL-1.1', 'Elastic-2.0', 'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0', 'Commons-Clause', 'EPL-1.0', 'CDDL-1.0', 'CDDL-1.1', 'MS-PL']);

function single(id) {
  if (COMPATIBLE.has(id)) return 'compatible';
  if (INCOMPATIBLE.has(id)) return 'incompatible';
  return 'unknown';
}

/** Whether a package's declared licence can ship inside an AGPL-3.0 program. A judgement aid, not legal advice. */
export function licenceVerdict(license) {
  const text = typeof license === 'string' ? license.trim() : '';
  if (!text) return { verdict: 'unknown', reason: 'no licence declared; read the package files before shipping' };
  if (/^SEE LICEN[CS]E IN\b/i.test(text)) return { verdict: 'unknown', reason: 'custom licence in the package files; read it before shipping' };
  const bare = text.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const verdicts = (parts) => parts.map(part => single(part.trim()));
  if (/ OR /.test(bare)) {
    const all = verdicts(bare.split(/ OR | AND /));
    if (/ AND /.test(bare)) return all.every(v => v === 'compatible') ? { verdict: 'compatible', reason: '' } : { verdict: 'unknown', reason: 'mixed licence expression; read it before shipping' };
    if (all.includes('compatible')) return { verdict: 'compatible', reason: '' };
    return all.includes('unknown') ? { verdict: 'unknown', reason: 'no option in the expression is known to fit the AGPL' } : { verdict: 'incompatible', reason: 'no option in the expression fits the AGPL' };
  }
  const all = verdicts(bare.split(/ AND /));
  if (all.every(v => v === 'compatible')) return { verdict: 'compatible', reason: '' };
  if (all.includes('incompatible')) return { verdict: 'incompatible', reason: 'this licence cannot be combined with the AGPL' };
  return { verdict: 'unknown', reason: 'licence id not on the known list; read it before shipping' };
}

function readManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return null; }
}

function declaredLicence(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map(item => typeof item === 'string' ? item : item?.type).filter(Boolean).join(' OR ');
  return '';
}

/** Node's lookup: the nearest node_modules/<name> from `fromDir` upward, never above `root`. */
function resolvePackage(fromDir, name, root) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (resolve(dir) === resolve(root)) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function walk(root, startNames) {
  const found = new Map();
  const seen = new Set();
  const visit = (fromDir, names) => {
    for (const name of names) {
      if (name.startsWith('@types/')) continue; // type declarations are erased at build time and never ship
      const dir = resolvePackage(fromDir, name, root);
      if (!dir) continue; // an optional dependency for another platform, or a peer nobody installed
      const real = realpathSync(dir);
      if (seen.has(real)) continue;
      seen.add(real);
      const manifest = readManifest(dir);
      if (!manifest) continue;
      const entry = { name: manifest.name ?? name, version: String(manifest.version ?? ''), license: declaredLicence(manifest),
        platformSpecific: Boolean(manifest.os || manifest.cpu), path: relative(root, dir).split(sep).join('/') };
      const key = `${entry.name}@${entry.version}`;
      if (!found.has(key)) found.set(key, entry);
      visit(dir, Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }));
    }
  };
  visit(root, startNames);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

/** Every package electron-builder copies into the app: the production dependencies and theirs. Dev tools are left out. */
export function collectShippedPackages(root) {
  const manifest = readManifest(root) ?? {};
  return walk(root, Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }));
}

// Built into app/ui/dist by Vite (imported by app/ui/src), so they ship even though package.json lists them for development.
const SCREEN_LIBRARIES = ['react', 'react-dom', 'lucide-react', '@noble/hashes'];

// Plain-English detail for packages whose terms need the founder's decision before publishing or shipping.
const FLAG_DETAIL = {
  '@anthropic-ai/claude-agent-sdk': 'Its LICENSE.md reads "Anthropic PBC. All rights reserved" and points to Anthropic\'s legal agreements. It is not open source, so it cannot become part of an AGPL program as is. Founder decision: an AGPL section 7 additional permission for it, or do not ship it and ask the owner to install it.',
  '@anthropic-ai/claude-agent-sdk-win32-x64': "the Agent SDK's Claude Code program file for this system, under the same terms as the Agent SDK.",
};
// Each platform build of the Agent SDK carries the same terms as the SDK itself.
const flagDetail = name => FLAG_DETAIL[name] ?? (name.startsWith('@anthropic-ai/claude-agent-sdk-') ? FLAG_DETAIL['@anthropic-ai/claude-agent-sdk-win32-x64'] : null);

function line(item) {
  const { verdict, reason } = licenceVerdict(item.license);
  const detail = flagDetail(item.name);
  const flag = verdict === 'compatible' ? '' : detail ? `  FLAG (proprietary): ${detail}` : `  FLAG (${verdict}): ${reason}`;
  return `${item.name} ${item.version} ${item.license || '(none declared)'}${flag}`;
}

/** NOTICE text. Deterministic: the same node_modules always gives the same file. */
export function renderNotice(shipped, root) {
  const screens = walk(root, SCREEN_LIBRARIES);
  const electron = readManifest(join(root, 'node_modules', 'electron'));
  const flagged = [...shipped, ...screens].filter(item => licenceVerdict(item.license).verdict !== 'compatible');
  return [
    'Chausar',
    'Copyright (C) 2026 The Chausar authors',
    '',
    'Chausar is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General',
    'Public License version 3 as published by the Free Software Foundation. It is distributed in the hope that it',
    'will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A',
    'PARTICULAR PURPOSE. See the GNU Affero General Public License in the LICENSE file for more details.',
    '',
    'Chausar includes third-party software under its own licences, listed below as name, version and the licence the',
    'package declares. Each package\'s full licence text is in its folder inside the app (node_modules/<name>).',
    'This file is generated from the installed packages by `node scripts/third-party-notices.mjs --write`; run it on',
    'the packaging machine, because platform-specific builds (DuckDB bindings, the Agent SDK binary) differ per system.',
    'A line marked FLAG has a licence that is not known to fit the AGPL and needs a decision before shipping.',
    '',
    `Flagged packages: ${flagged.length}`,
    '',
    '== Packages shipped with the desktop app (production dependencies and theirs) ==',
    '',
    ...shipped.map(line),
    '',
    '== Libraries built into the app screens (app/ui/dist) ==',
    '',
    ...screens.map(line),
    '',
    '== Runtime ==',
    '',
    ...(electron ? [line({ name: 'electron', version: String(electron.version), license: declaredLicence(electron) })] : []),
    'Electron includes Chromium, Node.js and other components. Their notices travel inside every installed copy as',
    'LICENSE.electron.txt and LICENSES.chromium.html next to the Chausar program file.',
    '',
    '== Tools installed alongside Chausar ==',
    '',
    'Codex CLI (OpenAI, Apache-2.0) and the parts inside it (Ratatui, ripgrep, PCRE2) are bundled by the beta',
    'installer. Their notices are in app/desktop/notices/THIRD-PARTY-NOTICES.md with each licence text beside it',
    '(resources/notices in an installed app); Codex also keeps its own LICENSE and NOTICE in resources/codex.',
    'Chausar does not install Claude Code itself. The Agent SDK platform package (flagged above) contains a Claude',
    "Code program file under Anthropic's terms.",
    'PostgreSQL (PostgreSQL License) and Python (Python Software Foundation License) ship only in a native release,',
    'under runtime-binaries/, with their licence files listed in runtime-binaries/manifest.json.',
    '',
  ].join('\n');
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = renderNotice(collectShippedPackages(projectRoot), projectRoot);
  const target = join(projectRoot, 'NOTICE');
  if (process.argv.includes('--write')) {
    writeFileSync(target, text);
    console.log(`NOTICE written (${text.split('\n').length} lines).`);
  } else if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) { console.error('NOTICE is out of date: run node scripts/third-party-notices.mjs --write'); process.exit(1); }
    console.log('NOTICE matches the installed packages.');
  } else {
    process.stdout.write(text);
  }
}
