// D7: where the engine finds its own files. From source this module is platform/runtime/engine-paths.ts; in the packaged
// app it is a chunk at the root of app/engine/dist/runtime/ (scripts/bundle-engine.mjs keeps it there), and the bundle
// keeps every copied file (baselines, sandbox workers, the Python helper beside it) at the same place relative to that
// root as in platform/runtime. So one helper answers for both, and nothing else in the engine reads import.meta.url for
// a path (engine-bundle-rules-d7.test.ts).
import { fileURLToPath } from 'node:url';

const SELF = import.meta.url;
/** True when the engine runs from its TypeScript source, false in the bundle. */
export const FROM_SOURCE = SELF.endsWith('.ts');
const ROOT = new URL('./', SELF);

/** A file or folder of the engine, by its path relative to platform/runtime (a folder ends with '/'). */
export function runtimeUrl(path: string): URL {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) throw new Error(`engine paths are relative with forward slashes: ${path}`);
  return new URL(path, ROOT);
}

/** runtimeUrl as a file path. */
export function runtimeFile(path: string): string {
  return fileURLToPath(runtimeUrl(path));
}

/** An engine entry the engine starts by path (the MCP bridge, the DuckDB worker): .ts from source, .js in the bundle. */
export function runtimeEntry(name: string): string {
  return runtimeFile(`${name}${FROM_SOURCE ? '.ts' : '.js'}`);
}
