import {createHash} from 'node:crypto';
import {lstat, readdir, realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';

// Import-safe resource accounting only; no native launch or authority admission.
const PHASES = ['startup', 'live', 'final-stopped', 'post-save-stopped'];
const FS_CODES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM', 'EIO']);
const MAX_ENTRIES = 32768, MAX_BYTES = 536870912, METADATA_READERS = 4;
const inside = (root, path) => {const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);};
const physical = stat => ({dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs)});
const equalPhysical = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const error = code => Object.assign(new Error(code), {code});

export function createOwnedScratchCensus({runRoot, permittedRuns, maxBytes, onDiagnostic}, overrides = {}) {
  const root = resolve(runRoot), permitted = resolve(permittedRuns);
  if (!isAbsolute(runRoot) || !isAbsolute(permittedRuns) || !/^C:[\\/]/i.test(root) || !/^C:[\\/]/i.test(permitted)
    || root === permitted || !inside(permitted, root) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BYTES)
    throw error('OWNED_NATIVE_SCRATCH_SCOPE_REQUIRED');
  // Only explicit protocol tests inject filesystem/clock wrappers. The native
  // lifecycle installs the actual default functions, never caller overrides.
  const io = {lstat, readdir, realpath, now: () => performance.now(), ...overrides};
  let rootPins;
  const emit = diagnostic => {
    if (typeof onDiagnostic !== 'function') return;
    try {const result = onDiagnostic(diagnostic); if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});}
    catch {}
  };
  const scope = phase => {
    if (!PHASES.includes(phase)) throw error('OWNED_NATIVE_SCRATCH_SCOPE_REQUIRED');
    const live = phase === 'startup' || phase === 'live', started = io.now();
    if (!Number.isFinite(started)) throw error('OWNED_NATIVE_SCRATCH_SCOPE_REQUIRED');
    return {phase, live, started, milliseconds: live ? 5000 : 10000, attempt: 1};
  };
  const failure = (run, code, operation, path) => {
    const namespace = path === permitted ? 'permitted-runs' : 'owned-run';
    const raw = namespace === 'permitted-runs' ? '.' : relative(root, path).split(sep).join('/') || '.';
    const safe = inside(root, path) || namespace === 'permitted-runs';
    const relativePath = safe && raw.length <= 1024 && !/[\x00-\x1f\x7f]/.test(raw) ? raw : '[refused-path]';
    const retryable = run.live && code === 'ENOENT' && namespace === 'owned-run' && path !== root && inside(root, path)
      && ['lstat', 'readdir', 'realpath'].includes(operation);
    const censusDiagnostic = Object.freeze({format: 'chausar.native-scratch-census-diagnostic.v1', phase: run.phase,
      attempt: run.attempt, operation, code, namespace, relativePath,
      pathDigest: createHash('sha256').update(raw).digest('hex'), retryable});
    return Object.assign(error(code), {censusDiagnostic});
  };
  const currentDeadline = run => {
    const now = io.now();
    if (!Number.isFinite(now) || now < run.started || now - run.started >= run.milliseconds)
      throw failure(run, 'OWNED_NATIVE_SCRATCH_CENSUS_TIMEOUT', 'deadline', root);
  };
  const read = async (run, operation, path) => {
    currentDeadline(run);
    try {
      const value = operation === 'lstat' ? await io.lstat(path, {bigint: true}) : await io[operation](path);
      currentDeadline(run); return value;
    } catch (caught) {
      if (caught?.censusDiagnostic) throw caught;
      throw failure(run, FS_CODES.has(caught?.code) ? caught.code : 'OWNED_NATIVE_SCRATCH_IO_FAILED', operation, path);
    }
  };
  const directory = async (run, path) => {
    const stat = await read(run, 'lstat', path);
    if (stat.isSymbolicLink()) throw failure(run, 'OWNED_NATIVE_SCRATCH_LINK_REFUSED', 'validation', path);
    if (!stat.isDirectory()) throw failure(run, 'OWNED_NATIVE_SCRATCH_TYPE_REFUSED', 'validation', path);
    const canonical = await read(run, 'realpath', path);
    if (relative(path, canonical) !== '' || path !== permitted && !inside(root, canonical))
      throw failure(run, 'OWNED_NATIVE_SCRATCH_PATH_REFUSED', 'validation', path);
    return physical(stat);
  };
  const roots = async run => {
    const actual = {permitted: await directory(run, permitted), root: await directory(run, root)};
    if (rootPins && (!equalPhysical(actual.permitted, rootPins.permitted) || !equalPhysical(actual.root, rootPins.root)))
      throw failure(run, 'OWNED_NATIVE_SCRATCH_CUSTODY_CHANGED', 'validation', root);
    rootPins ??= actual;
  };
  const inspect = async phase => {
    const run = scope(phase), attempts = run.live ? 3 : 1;
    for (run.attempt = 1; run.attempt <= attempts; run.attempt++) {
      try {
        // An ENOENT discards this ENTIRE traversal. Fresh counts and root pins
        // are used on the next attempt; no missing entry is silently skipped.
        let bytes = 0, entries = 0;
        await roots(run);
        const walk = async path => {
          const before = await directory(run, path);
          const names = await read(run, 'readdir', path);
          if (!Array.isArray(names)) throw failure(run, 'OWNED_NATIVE_SCRATCH_TYPE_REFUSED', 'validation', path);
          if (names.length > MAX_ENTRIES - entries) throw failure(run, 'OWNED_NATIVE_SCRATCH_ENTRY_LIMIT', 'validation', path);
          for (let offset = 0; offset < names.length; offset += METADATA_READERS) {
            const children = [];
            for (const name of names.slice(offset, offset + METADATA_READERS)) {
              currentDeadline(run);
              if (typeof name !== 'string' || !name || name === '.' || name === '..' || isAbsolute(name)
                || name.includes('/') || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name))
                throw failure(run, 'OWNED_NATIVE_SCRATCH_PATH_REFUSED', 'validation', path);
              const child = resolve(path, name);
              if (!inside(root, child)) throw failure(run, 'OWNED_NATIVE_SCRATCH_PATH_REFUSED', 'validation', child);
              if (++entries > MAX_ENTRIES) throw failure(run, 'OWNED_NATIVE_SCRATCH_ENTRY_LIMIT', 'validation', child);
              children.push(child);
            }
            // Bound metadata work and settle every issued operation before a
            // directory descent, complete retry, refusal or lifecycle exit.
            const results = await Promise.allSettled(children.map(child => read(run, 'lstat', child)));
            let refreshAfterDescent = false;
            for (let index = 0; index < children.length; index++) {
              // Later sibling metadata must be fresh after an awaited child
              // traversal, matching the serial walk's accounting boundary.
              if (refreshAfterDescent) {
                const pending = [];
                for (let next = index; next < children.length; next++) {
                  if (results[next].status === 'fulfilled') pending.push(next);
                }
                const fresh = await Promise.allSettled(pending.map(next => read(run, 'lstat', children[next])));
                for (let next = 0; next < pending.length; next++) results[pending[next]] = fresh[next];
                refreshAfterDescent = false;
              }
              const child = children[index], result = results[index];
              if (result.status === 'rejected') throw result.reason;
              const stat = result.value;
              if (stat.isSymbolicLink()) throw failure(run, 'OWNED_NATIVE_SCRATCH_LINK_REFUSED', 'validation', child);
              if (stat.isDirectory()) { await walk(child); refreshAfterDescent = true; }
              else {
                if (!stat.isFile() || stat.size < 0n || stat.size > BigInt(maxBytes))
                  throw failure(run, stat.isFile() ? 'OWNED_NATIVE_SCRATCH_LIMIT' : 'OWNED_NATIVE_SCRATCH_TYPE_REFUSED', 'validation', child);
                bytes += Number(stat.size);
                if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
                  throw failure(run, 'OWNED_NATIVE_SCRATCH_LIMIT', 'validation', child);
              }
            }
          }
          const after = await directory(run, path);
          if (!equalPhysical(before, after)) throw failure(run, 'OWNED_NATIVE_SCRATCH_CUSTODY_CHANGED', 'validation', path);
        };
        await walk(root); await roots(run); currentDeadline(run);
        return bytes;
      } catch (caught) {
        const failed = caught?.censusDiagnostic ? caught : failure(run, 'OWNED_NATIVE_SCRATCH_IO_FAILED', 'validation', root);
        emit(failed.censusDiagnostic);
        if (!failed.censusDiagnostic.retryable || run.attempt === attempts) throw failed;
        // The shared clock budget is not renewed by another complete attempt.
      }
    }
    throw error('OWNED_NATIVE_SCRATCH_IO_FAILED');
  };
  inspect.pin = async () => {
    const run = scope('startup');
    try {await roots(run);}
    catch (caught) {if (caught?.censusDiagnostic) emit(caught.censusDiagnostic); throw caught;}
  };
  return inspect;
}
