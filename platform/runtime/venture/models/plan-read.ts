// C7 task 3: "Check now" for Codex. One short app-server start with no thread and no turn: initialize, then the
// account's rate-limit read (account/rateLimits/read on Codex 0.166.0), then close. Nothing is sent to the model and
// nothing is kept but the raw answer, which plan-meter.ts reads. Any failure answers null (the meter reads unknown).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnTree } from '../../process-tree.ts';
import { cliEnv } from './cli.ts';
import { CodexRpc, type CodexChild } from '../agent-runtime/codex-rpc.ts';

export type PlanSpawn = (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => CodexChild;
const defaultSpawn: PlanSpawn = (command, args, options) => spawnTree(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as CodexChild;

/** Codex's own answer to the account's rate-limit read, or null when it could not be read in time. */
export async function readCodexPlan(program: string, options: { spawn?: PlanSpawn; timeoutMs?: number } = {}): Promise<unknown> {
  let folder: string | undefined, rpc: CodexRpc | undefined;
  try {
    folder = await mkdtemp(join(tmpdir(), 'chausar-plan-read-'));
    const child = (options.spawn ?? defaultSpawn)(program, ['app-server', '--listen', 'stdio://'], { cwd: folder, env: cliEnv('codex-cli') });
    rpc = new CodexRpc(child, { requestTimeoutMs: options.timeoutMs ?? 15_000, onRequest: async () => ({}) });
    await rpc.request('initialize', { clientInfo: { name: 'chausar', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    rpc.notify('initialized', {});
    return await rpc.request('account/rateLimits/read', {});
  } catch { return null; }
  finally {
    await rpc?.close().catch(() => undefined);
    if (folder) await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
  }
}
