#!/usr/bin/env node
// D11: `npm run doctor`, the developer loop's first check. One line per check, with its fix when it fails:
//   node          Node is at least MIN_NODE (the engines line in package.json and CI's version);
//   run root      where test receipts and the screenshot walk write (D3), never inside the checkout;
//   data home     where a local server keeps its data (D3), never inside the checkout;
//   codex, claude the owner's Codex and Claude Code, found on PATH by name only (nothing is run, no login is read);
//   node_modules  what npm installed matches package-lock.json (node_modules/.package-lock.json against the lock).
// It reads files and PATH only and changes nothing. Exit 1 when a check fails. Usage: npm run doctor
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoot } from '../platform/runtime/run-root.mjs';
import { dataHome } from '../platform/runtime/data-home.ts';

export const MIN_NODE = '24.13.1';

const atLeast = (version, minimum) => {
  const have = version.replace(/^v/, '').split('.').map(Number), want = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index++) if ((have[index] ?? 0) !== want[index]) return (have[index] ?? 0) > want[index];
  return true;
};

/** A command on PATH, by name: the first matching file (PATHEXT on Windows). Never runs it. */
async function onPath(name, env, platform) {
  const folders = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  const endings = platform === 'win32' ? [...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).flatMap(ext => [ext.toLowerCase(), ext.toUpperCase()]), ''] : [''];
  for (const folder of folders) {
    for (const ending of endings) {
      const candidate = join(folder, `${name}${ending}`);
      try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; } catch { /* next */ }
    }
  }
  return null;
}

/** Each installed package against the lock: same version, nothing installed that the lock lacks, nothing missing. */
async function lockMatch(root) {
  let lock, installed;
  try { lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')).packages ?? {}; }
  catch { return { ok: false, text: 'package-lock.json is missing or unreadable', fix: 'Restore package-lock.json from git (it is committed), then run npm ci.' }; }
  try { installed = JSON.parse(await readFile(join(root, 'node_modules', '.package-lock.json'), 'utf8')).packages ?? {}; }
  catch { return { ok: false, text: 'node_modules is not installed (no node_modules/.package-lock.json)', fix: 'Run npm ci.' }; }
  const problems = [];
  for (const [path, entry] of Object.entries(installed)) {
    if (!path) continue;
    if (!lock[path]) problems.push(`${path} is installed but not in the lockfile`);
    else if (lock[path].version !== entry.version) problems.push(`${path} is ${entry.version}, the lockfile says ${lock[path].version}`);
  }
  for (const [path, entry] of Object.entries(lock)) if (path && !installed[path] && !entry.optional && !entry.peer) problems.push(`${path} is not installed`);
  if (problems.length) return { ok: false, text: `node_modules differs from package-lock.json: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? `; and ${problems.length - 3} more` : ''}`, fix: 'Run npm ci.' };
  return { ok: true, text: `node_modules matches package-lock.json (${Object.keys(installed).length - (installed[''] ? 1 : 0)} packages)` };
}

const TOOLS = [
  ['codex', 'Codex', 'Install Codex (npm install -g @openai/codex) or put it on PATH; Chausar also ships its own Codex in the packaged app.'],
  ['claude', 'Claude Code', 'Install Claude Code with Anthropic\'s installer, or put it on PATH, if you test the Claude Code way.'],
];

/** Every check, in order: [{ name, ok, text, fix?, required? }] (required: false for the two AI tools). All inputs can be injected; the defaults read this computer. */
export async function doctor({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), env = process.env, nodeVersion = process.version, platform = process.platform } = {}) {
  const lines = [];
  lines.push(atLeast(nodeVersion, MIN_NODE)
    ? { name: 'node', ok: true, text: `Node ${nodeVersion}` }
    : { name: 'node', ok: false, text: `Node ${nodeVersion} is older than ${MIN_NODE}`, fix: `Install Node ${MIN_NODE} or newer (the version CI uses).` });
  try { lines.push({ name: 'run root', ok: true, text: `test receipts and the screenshot walk write to ${runRoot('engine-tests', { env })} (and its siblings)` }); }
  catch (error) { lines.push({ name: 'run root', ok: false, text: error.message, fix: 'Set CHAUSAR_RUN_ROOT to a folder outside the code folder, or unset it to use the temp folder.' }); }
  try { lines.push({ name: 'data home', ok: true, text: `a local server keeps its data in ${dataHome('local-web', { env })}` }); }
  catch (error) { lines.push({ name: 'data home', ok: false, text: error.message, fix: 'Set CHAUSAR_HOME (or CHAUSAR_VAULT_DIRECTORY) to a folder outside the code folder, or unset it.' }); }
  for (const [name, label, fix] of TOOLS) {
    const found = await onPath(name, env, platform);
    lines.push(found ? { name, ok: true, required: false, text: `${label} found at ${found} (not run)` } : { name, ok: false, required: false, text: `${label} is not on PATH`, fix });
  }
  lines.push({ name: 'node_modules', ...await lockMatch(root) });
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = await doctor();
  for (const line of lines) process.stdout.write(`${line.ok ? 'ok  ' : 'FIX '} ${line.name}: ${line.text}${line.ok ? '' : `\n      ${line.fix}`}\n`);
  // A missing Codex or Claude Code is reported, not failed: a developer may test only one of them, or neither.
  if (lines.some(line => !line.ok && line.required !== false)) process.exitCode = 1;
}
