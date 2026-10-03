import {isAbsolute, relative, resolve, sep} from 'node:path';
import {createScratchCensusProtocol} from './postgres-transfer-scratch-census-protocol.mjs';

// Native qualification admission remains C-drive-only. The protocol core does
// resource accounting and cannot authorize or launch a native environment.
const MAX_BYTES = 536870912;
const inside = (root, path) => {const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);};
const error = code => Object.assign(new Error(code), {code});

export function createOwnedScratchCensus({runRoot, permittedRuns, maxBytes, onDiagnostic}, overrides = {}) {
  const root = resolve(runRoot), permitted = resolve(permittedRuns);
  if (!isAbsolute(runRoot) || !isAbsolute(permittedRuns) || !/^C:[\\/]/i.test(root) || !/^C:[\\/]/i.test(permitted)
    || root === permitted || !inside(permitted, root) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BYTES)
    throw error('OWNED_NATIVE_SCRATCH_SCOPE_REQUIRED');
  return createScratchCensusProtocol({runRoot, permittedRuns, maxBytes, onDiagnostic}, overrides);
}
