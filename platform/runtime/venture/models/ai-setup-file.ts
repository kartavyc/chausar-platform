// A4 fix round (founder, 4 Nov): the host's AiSetupPort as one file beside the business folders (custody/ai-setup.json).
// It holds only the AI setup (models/ai-setup.ts); written whole through a temporary file and a rename, read at most
// 16 KB. A missing or unreadable file is no setup.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AiSetupNote, AiSetupPort } from './ai-setup.ts';

const MAX_BYTES = 16 * 1024;

export function aiSetupFile(path: string): AiSetupPort {
  return {
    async read() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > MAX_BYTES ? null : JSON.parse(text) as unknown;
      } catch { return null; }
    },
    async write(note: AiSetupNote) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(note), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    },
    // A4 review round 2 (M2): when its business disconnects that AI or is deleted.
    async clear() { await rm(path, { force: true }); },
  };
}

/** A4 review round 2 (M2): workspace.delete clears the setup the deleted business saved, so its name goes with it. */
export async function forgetAiSetup(port: AiSetupPort, workspaceId: string): Promise<void> {
  if (savedBy(await port.read()) === workspaceId) await port.clear();
}

/** The business a kept file names, read loosely so an older or damaged note of a deleted business goes too. */
export function savedBy(raw: unknown): string | null {
  const from = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { from?: unknown }).from : null;
  const id = from && typeof from === 'object' ? (from as { workspaceId?: unknown }).workspaceId : null;
  return typeof id === 'string' ? id : null;
}
