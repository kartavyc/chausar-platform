import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';

// The clean public copy (plan day 10, block 6). The working store holds fleet records, server names
// and private links, so it stays private. This copies only allowlisted product files into a fresh
// folder, scans every copied text file for keys and private details, checks every source file for a
// licence tag, and reports counts per kind. A finding names the file, line and kind, never the value.

export const DRAFT_LICENCE = 'LicenseRef-Chausar-Draft';
export const KINDS = ['private-key', 'token', 'email', 'private-link', 'fleet-marker', 'licence'] as const;
export type Kind = (typeof KINDS)[number];
export type Finding = { file: string; line: number; kind: Kind; detail: string; fingerprint: string | null };
export type Allowlist = {
  schemaVersion: 1;
  allow: string[];
  deny: string[];
  licenceMap: { glob: string; licence: string }[];
  allowedEmails: string[];
  allowedEmailDomains: string[];
  allowedEmailsFile: string | null;
  fleetMarkers: { name: string; pattern: string; flags?: string }[];
};
export type PublicCopyReport = {
  schemaVersion: 1;
  mode: 'dry-run' | 'publish';
  out: string;
  copied: number;
  scanned: number;
  binary: number;
  denied: number;
  counts: Record<Kind, number>;
  findings: Finding[];
  licenceDraft: boolean;
  git: { initialised: boolean; reason?: string; commit?: string };
};

const SOURCE = /\.(?:ts|tsx|js|mjs|cjs|css|cpp|hpp|py)$/;

// Converts a path glob to an anchored expression: ** spans folders, * and ? stay inside one.
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') {
      const before = index === 0 || glob[index - 1] === '/';
      const after = glob[index + 2];
      if (before && after === '/') { source += '(?:.*/)?'; index += 2; }
      else if (before && after === undefined) { source = source.endsWith('/') ? `${source.slice(0, -1)}(?:/.*)?` : `${source}.*`; index += 1; }
      else { source += '.*'; index += 1; }
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function validateAllowlist(value: unknown): Allowlist {
  check(value && typeof value === 'object' && !Array.isArray(value), 'ALLOWLIST_INVALID', 'The allowlist file must hold an object.');
  const list = value as Record<string, unknown>;
  const strings = (field: string) => {
    const entries = list[field] ?? [];
    check(Array.isArray(entries) && entries.every((entry) => typeof entry === 'string' && entry !== ''), 'ALLOWLIST_INVALID', 'Allowlist entries must be lists of text.');
    return entries as string[];
  };
  check(list.schemaVersion === 1, 'ALLOWLIST_INVALID', 'The allowlist must use schema version 1.');
  const allow = strings('allow');
  check(allow.length > 0, 'ALLOWLIST_INVALID', 'The allowlist must allow at least one path.');
  for (const glob of [...allow, ...strings('deny')]) check(!glob.startsWith('/') && !glob.split('/').includes('..'), 'ALLOWLIST_INVALID', 'Allowlist paths must be relative to the repository.');
  const licenceMap = (list.licenceMap ?? []) as unknown[];
  check(Array.isArray(licenceMap) && licenceMap.every((entry) => entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).glob === 'string' && typeof (entry as Record<string, unknown>).licence === 'string' && /^[A-Za-z0-9.+-]+$/.test((entry as Record<string, string>).licence)), 'ALLOWLIST_INVALID', 'Each licence map entry needs a glob and an SPDX identifier.');
  const markers = (list.fleetMarkers ?? []) as unknown[];
  check(Array.isArray(markers), 'ALLOWLIST_INVALID', 'Fleet markers must be a list.');
  const fleetMarkers = markers.map((entry) => {
    const marker = entry as Record<string, unknown>;
    check(marker && typeof marker.name === 'string' && typeof marker.pattern === 'string' && (marker.flags === undefined || (typeof marker.flags === 'string' && /^[imsu]*$/.test(marker.flags))), 'ALLOWLIST_INVALID', 'Each fleet marker needs a name and a pattern.');
    try { new RegExp(marker.pattern, marker.flags as string | undefined); } catch { check(false, 'ALLOWLIST_INVALID', 'A fleet marker pattern is not a valid expression.'); }
    return { name: marker.name, pattern: marker.pattern, ...(marker.flags ? { flags: marker.flags as string } : {}) };
  });
  check(list.allowedEmailsFile === undefined || list.allowedEmailsFile === null || typeof list.allowedEmailsFile === 'string', 'ALLOWLIST_INVALID', 'The allowed emails file must be a path or null.');
  return {
    schemaVersion: 1, allow, deny: strings('deny'), licenceMap: licenceMap as Allowlist['licenceMap'],
    allowedEmails: strings('allowedEmails').map((email) => email.toLowerCase()), allowedEmailDomains: strings('allowedEmailDomains').map((domain) => domain.toLowerCase()),
    allowedEmailsFile: (list.allowedEmailsFile as string | null | undefined) ?? null, fleetMarkers,
  };
}

export const fingerprint = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)} len=${value.length}`;

type Detector = { kind: Kind; detail: string; pattern: RegExp; allow?: (match: string) => boolean };

// Patterns are assembled from pieces so this file does not itself look like a key to other scanners.
function detectors(list: Allowlist, extraEmails: Set<string>): Detector[] {
  const emailAllowed = (match: string) => {
    const email = match.toLowerCase();
    const domain = email.slice(email.lastIndexOf('@') + 1);
    return list.allowedEmails.includes(email) || extraEmails.has(email) || list.allowedEmailDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
      || /\.(?:test|example|invalid|localhost)$/.test(domain) || /\.(?:png|jpe?g|gif|svg|webp|avif)$/.test(domain);
  };
  return [
    { kind: 'private-key', detail: 'pem-private-key', pattern: new RegExp('-----BEGIN ' + '[A-Z0-9 ]*' + 'PRIVATE KEY-----', 'g') },
    { kind: 'token', detail: 'aws-access-key', pattern: new RegExp('\\b(?:AKIA|ASIA)' + '[0-9A-Z]{16}\\b', 'g') },
    { kind: 'token', detail: 'github-token', pattern: new RegExp('\\b(?:gh[pousr]_' + '[A-Za-z0-9]{36,}|github_pat_' + '[A-Za-z0-9_]{22,})', 'g') },
    { kind: 'token', detail: 'slack-token', pattern: new RegExp('\\bxox[abposr]-' + '[A-Za-z0-9-]{10,}', 'g') },
    { kind: 'token', detail: 'model-provider-key', pattern: new RegExp('\\bsk-(?:ant-|proj-)?' + '[A-Za-z0-9_-]{32,}', 'g') },
    { kind: 'token', detail: 'google-api-key', pattern: new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}', 'g') },
    { kind: 'token', detail: 'jwt', pattern: new RegExp('\\beyJ[A-Za-z0-9_-]{10,}' + '\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', 'g') },
    { kind: 'email', detail: 'email-address', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, allow: emailAllowed },
    { kind: 'private-link', detail: 'claude-session-link', pattern: new RegExp('claude\\.ai/' + '(?:code/session_|chat/|project/)[A-Za-z0-9_-]+', 'g') },
    { kind: 'private-link', detail: 'private-host', pattern: /(?:\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:internal|local|lan|corp)\b|\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:internal|local):\d{2,5}\b)/gi },
    { kind: 'private-link', detail: 'private-ip-with-port', pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{2,5}\b/g },
    ...list.fleetMarkers.map((marker): Detector => ({ kind: 'fleet-marker', detail: marker.name, pattern: new RegExp(marker.pattern, `${(marker.flags ?? '').replace('g', '')}g`) })),
  ];
}

export function scanText(file: string, text: string, list: Allowlist, extraEmails = new Set<string>()): Finding[] {
  const findings: Finding[] = [];
  const active = detectors(list, extraEmails);
  text.split(/\r?\n/).forEach((content, index) => {
    for (const detector of active) {
      detector.pattern.lastIndex = 0;
      for (const match of content.matchAll(detector.pattern)) {
        if (detector.allow?.(match[0])) continue;
        findings.push({ file, line: index + 1, kind: detector.kind, detail: detector.detail, fingerprint: fingerprint(match[0]) });
      }
    }
  });
  return findings;
}

export function licenceFor(file: string, text: string, list: Allowlist): string | null {
  const tag = /SPDX-License-Identifier:\s*([^\s*]+(?:\s+(?:OR|AND|WITH)\s+[^\s*]+)*)/.exec(text.split(/\r?\n/, 5).join('\n'));
  if (tag) return tag[1];
  return list.licenceMap.find((entry) => globToRegExp(entry.glob).test(file))?.licence ?? null;
}

export function licenceDraftText(list: Allowlist) {
  return `# Licence: draft, not chosen yet

The licence for this code is pending the founder's decision. **Nothing in this copy is licensed until that choice is made and this file is replaced by the chosen licence.** Until then, all rights are reserved by the authors.

Files without their own \`SPDX-License-Identifier\` line carry the placeholder \`${DRAFT_LICENCE}\` through the map below. It names this draft; it grants nothing.

## The two options in the plan

1. **Option one (recommended in the plan).** AGPL-3.0 for the app: whoever changes the app and passes it on, or runs it as a service, must share the changes. Apache-2.0 for the mapping language, its compiler and the SDK, so anyone may build on them. A share-alike data licence for community recipes. The qualified recipe library and the test sets stay private. Contributors sign off for the language and SDK, and grant a licence for the app with a written promise that contributions stay open.
2. **Option two.** Apache-2.0 for everything, with the rule for the name and logo and the private data as the only shields.

## Path to licence map

| Paths | Licence |
|---|---|
${list.licenceMap.map((entry) => `| \`${entry.glob}\` | \`${entry.licence}\` |`).join('\n')}

These are notes for a decision, not legal advice.
`;
}

const toPosix = (path: string) => path.split(sep).join('/');
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); };

// Resolves symbolic links in the part of a path that exists, so a linked folder cannot hide the repository.
async function realOrPlanned(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await realOrPlanned(dirname(path)), relative(dirname(path), path));
  }
}

async function emptyOrMissing(path: string) {
  try { return (await readdir(path)).length === 0; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

export async function buildPublicCopy(options: { root: string; out: string; allowlist: Allowlist; initGit?: boolean; publish?: boolean; report?: string | null }): Promise<PublicCopyReport> {
  const list = validateAllowlist(options.allowlist);
  const draft = list.licenceMap.some((entry) => entry.licence === DRAFT_LICENCE);
  check(!(options.publish && draft), 'LICENCE_UNDECIDED', 'The licence map still holds the draft licence; the founder must choose the licence before the public copy is published.');
  const root = await realpath(resolve(options.root));
  const out = await realOrPlanned(resolve(options.out));
  const fromRoot = toPosix(relative(root, out));
  check(!inside(out, root), 'PUBLIC_COPY_OUT_CONTAINS_SOURCE', 'The public copy folder cannot contain the source repository.');
  check(!inside(root, out) || fromRoot.startsWith('release/'), 'PUBLIC_COPY_OUT_INSIDE_SOURCE', 'The public copy must be written outside the source repository, or under its release folder.');
  check(await emptyOrMissing(out), 'PUBLIC_COPY_OUT_NOT_EMPTY', 'The public copy folder must be empty or not exist yet.');
  const allow = list.allow.map(globToRegExp);
  const deny = list.deny.map(globToRegExp);
  const homes = list.allow.map((glob) => {
    const wild = /[*?]/.test(glob);
    const fixed = wild ? glob.split(/[*?]/)[0] : glob;
    return { wild, folder: fixed.slice(0, fixed.lastIndexOf('/') + 1) };
  });
  const denied = (path: string) => deny.some((pattern) => pattern.test(path));
  const allowed = (path: string) => allow.some((pattern) => pattern.test(path));
  // A folder is walked when it is an ancestor of an allowed path, or sits under a wildcard's fixed folder.
  const mayHoldAllowed = (folder: string) => homes.some((home) => home.folder.startsWith(`${folder}/`) || (home.wild && `${folder}/`.startsWith(home.folder)));
  const files: string[] = [];
  let deniedCount = 0;
  async function walk(folder: string) {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (denied(path)) { deniedCount += 1; continue; }
      if (entry.isSymbolicLink()) {
        check(!allowed(path) && !mayHoldAllowed(path), 'PUBLIC_COPY_SYMLINK', 'An allowed path is a symbolic link; the public copy holds only plain files.');
        continue;
      }
      if (entry.isDirectory()) { if (mayHoldAllowed(path)) await walk(path); continue; }
      if (entry.isFile() && allowed(path)) files.push(path);
    }
  }
  await walk('');
  await mkdir(out, { recursive: true });
  for (const file of files.sort()) {
    const source = join(root, file);
    check(!(await lstat(source)).isSymbolicLink(), 'PUBLIC_COPY_SYMLINK', 'An allowed path is a symbolic link; the public copy holds only plain files.');
    await mkdir(dirname(join(out, file)), { recursive: true });
    await copyFile(source, join(out, file), constants.COPYFILE_EXCL);
  }
  if (draft) await writeFile(join(out, 'LICENSE-DRAFT.md'), licenceDraftText(list), { flag: 'wx' });
  const extraEmails = new Set<string>();
  if (list.allowedEmailsFile) {
    const path = resolve(root, list.allowedEmailsFile);
    check(inside(root, path), 'ALLOWLIST_INVALID', 'The allowed emails file must be inside the repository.');
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) extraEmails.add(line.trim().toLowerCase());
  }
  const findings: Finding[] = [];
  let scanned = 0;
  let binary = 0;
  for (const file of files) {
    const bytes = await readFile(join(out, file));
    if (bytes.subarray(0, 8192).includes(0)) { binary += 1; continue; }
    scanned += 1;
    const text = bytes.toString('utf8');
    findings.push(...scanText(file, text, list, extraEmails));
    if (SOURCE.test(file) && !licenceFor(file, text, list)) findings.push({ file, line: 1, kind: 'licence', detail: 'no SPDX tag and no licence map entry', fingerprint: null });
  }
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, findings.filter((finding) => finding.kind === kind).length])) as Record<Kind, number>;
  const report: PublicCopyReport = {
    schemaVersion: 1, mode: options.publish ? 'publish' : 'dry-run', out, copied: files.length, scanned, binary, denied: deniedCount, counts, findings, licenceDraft: draft,
    git: { initialised: false, reason: options.initGit ? undefined : 'not requested' },
  };
  if (options.initGit) {
    if (findings.length) report.git = { initialised: false, reason: 'The scan has findings, so no history was created.' };
    else report.git = initFreshRepository(out);
  }
  const reportPath = options.report === null ? null : resolve(options.report ?? join(dirname(out), 'public-copy-report.json'));
  if (reportPath) {
    check(!inside(out, reportPath), 'PUBLIC_COPY_REPORT_INSIDE', 'The report must be written outside the public copy.');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

// One commit with a fresh history. The author comes from the environment or a neutral release name.
function initFreshRepository(out: string): PublicCopyReport['git'] {
  const name = process.env.CHAUSAR_RELEASE_AUTHOR_NAME || 'Chausar Release';
  const email = process.env.CHAUSAR_RELEASE_AUTHOR_EMAIL || 'noreply@example.com';
  const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + devNull, '-c', 'commit.gpgsign=false', ...args], { cwd: out, env, encoding: 'utf8', windowsHide: true });
    check(result.status === 0, 'PUBLIC_COPY_GIT_FAILED', 'Git could not create the fresh public history.');
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('add', '-A', '--force'); // The copy is already curated; a copied .gitignore must not drop files from the history.
  git('commit', '-q', '-m', 'Public copy of Chausar');
  return { initialised: true, commit: git('rev-parse', 'HEAD') };
}

export async function main(args: string[]) {
  const value = (name: string) => { const index = args.indexOf(name); if (index === -1) return undefined; check(index + 1 < args.length, 'CLI_OPTION_VALUE', 'An option is missing its value.'); return args[index + 1]; };
  const out = value('--out');
  check(out, 'CLI_OPTION_VALUE', 'Name the folder for the public copy with --out.');
  check(!(args.includes('--publish') && args.includes('--dry-run')), 'CLI_OPTION_VALUE', 'Choose either --dry-run or --publish.');
  const allowlistPath = resolve(value('--allowlist') ?? 'scripts/release/public-allowlist.json');
  const report = await buildPublicCopy({
    root: resolve(value('--root') ?? '.'), out: resolve(out), allowlist: JSON.parse(await readFile(allowlistPath, 'utf8')) as Allowlist,
    initGit: args.includes('--init-git'), publish: args.includes('--publish'), report: value('--report'),
  });
  for (const finding of report.findings) process.stderr.write(`${finding.file}:${finding.line} ${finding.kind} ${finding.detail}${finding.fingerprint ? ` ${finding.fingerprint}` : ''}\n`);
  process.stdout.write(`${report.mode}: copied ${report.copied} files to ${report.out}; ${KINDS.map((kind) => `${kind} ${report.counts[kind]}`).join(', ')}.\n`);
  return report.findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: Error & { code?: string }) => { process.stderr.write(`${error.code ?? 'FAILED'} ${error.message}\n`); process.exitCode = 2; });
}
