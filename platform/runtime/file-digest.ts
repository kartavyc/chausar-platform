// One digest of a program while the file stays the same (seen on Windows, 15 Nov 2026: "Checking this computer" took
// 25 to 39 seconds). The trusted Codex setup reads and hashes the whole program before every start of it (codex-cli-host.ts
// verifyBinary, codex-trust.ts verifiedProgram): a look at the tool starts it four times within seconds, so the same
// file of many megabytes was read and hashed four times over, and again for every status check and model call.
//
// The check is not skipped and not weakened: the digest still has to match before anything starts. What is kept is the
// digest of a file that has not changed, told by the file's own identity as the system reports it: the device and file
// number, the size, the modified time and the change time, in nanoseconds. Writing to a file, replacing it, renaming
// another over it or setting its times changes at least one of these, and then the file is read and hashed again. A
// kept digest is used for a minute at most, so a file is read again every minute it is in use whatever its identity
// says. A file that cannot be looked at is read every time, and a reader that fails is not remembered.
import { stat } from 'node:fs/promises';

/** How long a digest of an unchanged file is used before the file is read again. */
export const DIGEST_REUSE_MS = 60_000;

type Kept = { identity: string; digest: string; atMs: number };
const kept = new Map<string, Kept>();

async function identityOf(path: string): Promise<string | null> {
  try {
    const info = await stat(path, { bigint: true });
    return info.isFile() ? [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':') : null;
  } catch { return null; }
}

/**
 * The digest of the file at `path`: the one worked out for this same unchanged file within the last minute, else what
 * `read` works out now (the caller's own bounded reader, which may refuse the file). now: the clock, for tests.
 */
export async function digestOfUnchanged(path: string, read: () => Promise<string>, now: () => number = Date.now): Promise<string> {
  const identity = await identityOf(path);
  const was = kept.get(path);
  const at = now();
  if (identity !== null && was && was.identity === identity && at >= was.atMs && at - was.atMs < DIGEST_REUSE_MS) return was.digest;
  kept.delete(path);
  const digest = await read();
  // Kept under the identity seen before the read: a file changed while it was read has another identity at the next
  // ask, and is read again.
  if (identity !== null) kept.set(path, { identity, digest, atMs: now() });
  return digest;
}
