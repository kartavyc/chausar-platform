// The one check of the root package-lock.json, shared by desktop packaging, the package preflight and the tests.
// It reads the parsed lock and package.json only: no node_modules, no network. An empty list means the lock is good.
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const integrityHash = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

// The one Git source a build may use: electron-builder's node-gyp at an exact commit, as a dev (build-time) package (6J1).
export const PINNED_BUILD_GIT_SOURCES = Object.freeze({ 'node_modules/@electron/node-gyp': 'git+ssh://git@github.com/electron/node-gyp.git#06b29aafb7708acef8b3669835c8a7857ebc92d2' });

/**
 * Problems with a lock, in the order packaging has always checked them. Each has a code, the package path or name
 * when there is one, and a plain message; callers word their own refusal from the code.
 */
export function lockfileProblems(lock, pkg, { pinnedGitSources = {} } = {}) {
  const problems = [];
  const root = lock?.packages?.[''];
  if (lock?.lockfileVersion !== 3 || !root || root.version !== pkg.version) {
    problems.push({ code: 'version', message: 'the lock must be npm lockfile version 3 and match package.json' });
    return problems;
  }
  for (const kind of ['dependencies', 'devDependencies']) {
    if (JSON.stringify(Object.entries(root[kind] ?? {}).sort()) !== JSON.stringify(Object.entries(pkg[kind] ?? {}).sort())) {
      problems.push({ code: 'dependencies-differ', kind, message: `locked ${kind} differ from package.json` });
    }
    for (const [name, version] of Object.entries(pkg[kind] ?? {})) {
      if (lock.packages[`node_modules/${name}`]?.version !== version) problems.push({ code: 'unresolved-pin', kind, name, message: `the lock does not resolve the exact ${name} pin` });
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (entry.link || !exactVersion.test(entry.version ?? '') || !integrityHash.test(entry.integrity ?? '')) {
      problems.push({ code: 'entry', path, message: `${path} needs an exact version and a registry integrity hash` });
      continue;
    }
    if (entry.dev === true && Object.hasOwn(pinnedGitSources, path) && pinnedGitSources[path] === entry.resolved) continue;
    let url;
    try { url = new URL(entry.resolved); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.username || url.password) problems.push({ code: 'resolved', path, message: `${path} must resolve to an HTTPS registry artifact` });
  }
  return problems;
}
