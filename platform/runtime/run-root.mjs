// D3: the one source for "where do outputs go" and "is this folder inside the code folder". Plain JavaScript with only
// node: imports, so the scripts (bench, UI bench, benchmarks, the screenshot walk) load it without the engine, and
// data-home.ts re-exports it for the servers and the worker. It never moves, deletes or creates anything.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The package name of this checkout's package.json; a folder with it beside a .git is the code folder. */
export const CHECKOUT_PACKAGE = 'chausar-desktop';

/** True when this folder is a Chausar checkout: package.json named chausar-desktop next to .git (folder or file). */
function isCheckout(folder) {
  if (!existsSync(join(folder, '.git'))) return false;
  try { return JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name === CHECKOUT_PACKAGE; } catch { return false; }
}

/** The checkout that holds this path (walking up from it), or null. The path need not exist. */
export function checkoutOf(path) {
  for (let current = resolve(path); ;) {
    if (isCheckout(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The real location of the deepest part of the path that exists, so a link into the checkout is caught too. */
function realAncestor(path) {
  for (let current = resolve(path); ;) {
    try { return realpathSync.native(current); } catch { /* not there yet */ }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The refusal's error: code DATA_INSIDE_REPO, named like the engine's own refusals. */
export class DataInsideRepoError extends Error {
  constructor(message) { super(message); this.name = 'ChausarError'; this.code = 'DATA_INSIDE_REPO'; }
}

/**
 * Returns the resolved path, or throws DATA_INSIDE_REPO when it is inside this checkout (or a link leads there).
 * `variable` names what set the folder, `fallback` what is used when it is unset. CHAUSAR_ALLOW_REPO_DATA=1 lets a
 * fixture run keep data in the checkout on purpose; CI never sets it.
 */
export function refuseInsideRepo(path, { env = process.env, variable = 'CHAUSAR_HOME', fallback } = {}) {
  const target = resolve(path);
  if (env.CHAUSAR_ALLOW_REPO_DATA === '1') return target;
  const real = realAncestor(target);
  if (checkoutOf(target) || (real && checkoutOf(real))) {
    throw new DataInsideRepoError(`Chausar keeps its data outside the code folder. Set ${variable} to a folder elsewhere${fallback ? `, or leave it unset to use ${fallback}` : ''}.`);
  }
  return target;
}

/** YYYY-MM-DD in the clock's own local day (the owner's day, not UTC). */
export function localDay(date) {
  const two = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The temp-folder run root for a name, used when CHAUSAR_RUN_ROOT is unset. */
export function defaultRunRoot(name, { now = () => new Date(), temp = tmpdir() } = {}) {
  return join(temp, 'chausar-runs', `${localDay(now())}-${name}`);
}

/**
 * Where a run's outputs go: CHAUSAR_RUN_ROOT/<name>, else <temp>/chausar-runs/<YYYY-MM-DD>-<name>. Never inside the
 * checkout. The folder is not created here.
 */
export function runRoot(name, { env = process.env, now = () => new Date(), temp = tmpdir() } = {}) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw Object.assign(new Error('A run name is lower-case letters, digits and hyphens.'), { name: 'ChausarError', code: 'RUN_NAME_INVALID' });
  }
  const fallback = defaultRunRoot(name, { now, temp });
  if (env.CHAUSAR_RUN_ROOT) return refuseInsideRepo(join(env.CHAUSAR_RUN_ROOT, name), { env, variable: 'CHAUSAR_RUN_ROOT', fallback });
  return refuseInsideRepo(fallback, { env, variable: 'CHAUSAR_RUN_ROOT', fallback });
}

/**
 * A script's output file: the given path (relative to the working folder, or absolute), else the run root's file.
 * It must be a .json file and never inside the checkout. Returns the absolute path.
 */
export function outputFile(requested, { name, file, env = process.env, now = () => new Date(), temp = tmpdir() }) {
  if (requested === undefined || requested === null) return join(runRoot(name, { env, now, temp }), file);
  if (typeof requested !== 'string' || !requested || !requested.endsWith('.json')) {
    throw Object.assign(new Error('The output must be a .json file.'), { name: 'ChausarError', code: 'OUTPUT_INVALID' });
  }
  return refuseInsideRepo(requested, { env, variable: '--output', fallback: join(defaultRunRoot(name, { now, temp }), file) });
}
