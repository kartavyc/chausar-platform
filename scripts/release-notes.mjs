#!/usr/bin/env node
// D11: the notes of a release, from the conventional commits since the last tag and C7's What's new entry for the
// version (app/ui/src/text/en/whats-new.json, owner words keyed by version and line number). The tag workflow (release.yml) writes
// them into the draft release; a version with no What's new entry fails, so every release says what changed for owners.
// Usage: node scripts/release-notes.mjs --version <x.y.z> [--since <tag>] [--commits <file>] [--whats-new <file>]
//                                       [--unsigned] [--output <file.md>]
//   --commits   one commit subject per line, instead of `git log <since>..HEAD` (the last tag when --since is not given)
//   --output    a file outside the checkout (D3); without it the notes go to the run root's release-notes folder
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseInsideRepo, runRoot } from '../platform/runtime/run-root.mjs';

const GROUPS = [['feat', 'New'], ['fix', 'Fixed'], ['perf', 'Faster']];
const sentence = text => text.charAt(0).toUpperCase() + text.slice(1);

/** One subject read as { type, text }: the conventional prefix and the trailing batch mark, like (D11), removed. */
function readSubject(subject) {
  if (/^Merge /.test(subject)) return null;
  const match = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject.trim());
  const text = (match ? match[2] : subject.trim()).replace(/\s+\((?:[A-E]\d+[a-z]?(?: fix)?(?:, [A-E]\d+[a-z]?(?: fix)?)*)\)$/, '').replace(/\.$/, '');
  return text ? { type: match ? match[1] : 'other', text: sentence(text) } : null;
}

export function releaseNotes({ version, commits, whatsNew, unsigned = false }) {
  const prefix = `whats-new.${version}.`;
  const entries = Object.entries(whatsNew ?? {}).filter(([key]) => key.startsWith(prefix) && /^[1-9]\d*$/.test(key.slice(prefix.length)));
  if (!entries.length) throw new Error(`No What's new entry for ${version}: add it to whats-new.json before tagging.`);
  entries.sort(([a], [b]) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
  const entry = entries.map(([, line]) => line);
  if (entry.some(line => typeof line !== 'string' || !line.trim())) throw new Error(`The What's new entries for ${version} must be non-empty lines.`);
  const lines = [`# Chausar ${version}`, ''];
  if (unsigned) lines.push('The Windows installer is not signed yet: Windows will warn about an unknown publisher.', '');
  if (entry.length) lines.push('## What\'s new', '', ...entry.map(line => `- ${line}`), '');
  const read = commits.map(readSubject).filter(Boolean);
  for (const [type, title] of GROUPS) {
    const items = read.filter(item => item.type === type);
    if (items.length) lines.push(`## ${title}`, '', ...items.map(item => `- ${item.text}`), '');
  }
  const rest = read.filter(item => !GROUPS.some(([type]) => type === item.type));
  if (rest.length) lines.push('## Under the hood', '', ...rest.map(item => `- ${item.text}`), '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2), options = { unsigned: false };
  const usage = 'Usage: node scripts/release-notes.mjs --version <x.y.z> [--since <tag>] [--commits <file>] [--whats-new <file>] [--unsigned] [--output <file.md>]';
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--unsigned') { options.unsigned = true; continue; }
    const value = args[index + 1];
    if (!['--version', '--since', '--commits', '--whats-new', '--output'].includes(flag) || !value || value.startsWith('--')) { process.stderr.write(`${usage}\n`); process.exit(2); }
    options[flag.slice(2)] = value; index++;
  }
  if (!options.version) { process.stderr.write(`${usage}\n`); process.exit(2); }
  try {
    let commits;
    if (options.commits) commits = (await readFile(options.commits, 'utf8')).split(/\r?\n/).filter(Boolean);
    else {
      const since = options.since ?? spawnSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
      const log = spawnSync('git', ['log', '--format=%s', since ? `${since}..HEAD` : 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      if (log.status !== 0) throw new Error(`git log failed: ${log.stderr.trim()}`);
      commits = log.stdout.split(/\r?\n/).filter(Boolean);
    }
    const whatsNewFile = options['whats-new'] ?? resolve(root, 'app/ui/src/text/en/whats-new.json');
    const whatsNew = JSON.parse(await readFile(whatsNewFile, 'utf8').catch(() => { throw new Error(`No What's new file at ${whatsNewFile}.`); }));
    const notes = releaseNotes({ version: options.version, commits, whatsNew, unsigned: options.unsigned });
    const destination = options.output ? refuseInsideRepo(options.output, { variable: '--output', fallback: runRoot('release-notes') }) : join(runRoot('release-notes'), `release-notes-${options.version}.md`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, notes);
    process.stdout.write(`${destination}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
