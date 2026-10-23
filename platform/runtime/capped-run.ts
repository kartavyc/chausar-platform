// Runs one local program (whisper.cpp, ffmpeg) without a shell, with hard limits Chausar keeps: a time limit, output
// caps, and a stop from outside (the workspace closing). A stopped program is killed and waited for until it closes,
// for at most closeWaitMs more, so the files it held can be removed; the answer never hangs on a program that will
// not close. It never throws: the caller turns the ending into its own words. Never retried.
import { spawn } from 'node:child_process';

export type CappedRun = {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  timeoutMs: number;
  /** Aborting it stops the program (the workspace closing, the app quitting). */
  signal?: AbortSignal;
  /** How long to wait for a stopped program to close before answering anyway. Default ten seconds. */
  closeWaitMs?: number;
  /** Bytes of standard output kept before the program is stopped as printing too much. Default one megabyte. */
  stdoutLimit?: number;
  /** Characters of standard error kept: the first ones (a log read from its start) or the last ones (default, 8192). */
  stderrLimit?: number;
  stderrKeep?: 'head' | 'tail';
};
/** closed: it ended on its own. timeout, aborted, too-much: Chausar stopped it. start-failed: it never started. */
export type CappedEnd = 'closed' | 'timeout' | 'aborted' | 'too-much' | 'start-failed';
export type CappedResult = { end: CappedEnd; exitCode: number | null; stdout: string; stderr: string; closed: boolean; startError: string | null };

export const CLOSE_WAIT_MS = 10000;

/** Runs the program once within the limits above and says how it ended. */
export function runCapped(run: CappedRun, spawnChild: typeof spawn = spawn): Promise<CappedResult> {
  return new Promise(resolve => {
    if (run.signal?.aborted) { resolve({ end: 'aborted', exitCode: null, stdout: '', stderr: '', closed: true, startError: null }); return; }
    const stdoutLimit = run.stdoutLimit ?? 1048576;
    const stderrLimit = run.stderrLimit ?? 8192;
    let stdout = '', stderr = '', settled = false;
    let reason: Exclude<CappedEnd, 'closed' | 'start-failed'> | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => stop('aborted');
    const settle = (result: CappedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      run.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnChild(run.command, [...run.args], { cwd: run.cwd, env: run.env as NodeJS.ProcessEnv | undefined, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      settle({ end: 'start-failed', exitCode: null, stdout, stderr, closed: true, startError: String((error as NodeJS.ErrnoException)?.code ?? 'ERROR') });
      return;
    }
    function stop(why: Exclude<CappedEnd, 'closed' | 'start-failed'>) {
      if (reason || settled) return;
      reason = why;
      try { child.kill(); } catch { /* already gone: its close still comes, or the wait below ends */ }
      grace = setTimeout(() => settle({ end: why, exitCode: null, stdout, stderr, closed: false, startError: null }), run.closeWaitMs ?? CLOSE_WAIT_MS);
    }
    timer = setTimeout(() => stop('timeout'), run.timeoutMs);
    run.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (bytes: Buffer) => { stdout += bytes.toString(); if (Buffer.byteLength(stdout) > stdoutLimit) stop('too-much'); });
    child.stderr?.on('data', (bytes: Buffer) => {
      const next = stderr + bytes.toString();
      stderr = run.stderrKeep === 'head' ? next.slice(0, stderrLimit) : next.slice(-stderrLimit);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      // An error after Chausar stopped it waits for the close (or the close wait); before, it never started.
      if (!reason) settle({ end: 'start-failed', exitCode: null, stdout, stderr, closed: true, startError: String(error?.code ?? 'ERROR') });
    });
    child.on('close', (code: number | null) => settle({ end: reason ?? 'closed', exitCode: code, stdout, stderr, closed: true, startError: null }));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(run.stdin ?? '');
  });
}
