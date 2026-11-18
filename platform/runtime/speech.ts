import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { authorize, check, ChausarError } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import type { ProcessRequest, ProcessResult } from './gateway.ts';
import { runCapped } from './capped-run.ts';
import { localPathProblem } from './local-paths.ts';

export type SpeechProvider = { id?: string; kind: 'local-command'; label?: string; command?: string; model?: string; enabled?: boolean };
/**
 * removeFolder: how a temporary folder is removed (tests inject one that fails). spawn and closeWaitMs: how the local
 * whisper.cpp is started and how long a stopped one may take to close (tests inject a stand-in). platform: whose path
 * rules apply (default this computer's).
 */
export type SpeechOptions = {
  process?: (request: ProcessRequest) => Promise<ProcessResult>;
  removeFolder?: (path: string) => Promise<void>; spawn?: typeof spawn; closeWaitMs?: number; platform?: string;
};
/** The whisper.cpp the owner set up in the app: absolute paths to whisper-cli and to its model file. */
export type LocalWhisper = { command: string; model: string };
/** The provider id of the whisper.cpp set up in the app (venture.transcription.set), kept in the vault. */
const APP_WHISPER = 'whisper-local';
/** The vault record that keeps it (platform/runtime/venture/contracts.ts TranscriptionSetupRecord); the newest is in use. */
const SETUP_RECORD = 'venture-transcription-setup';
export const WHISPER_CLI_MISSING = 'whisper-cli is not where it was set up on this computer. Chausar never installs it.';
export const WHISPER_MODEL_MISSING = 'The whisper model file is not where it was set up on this computer. Chausar never downloads one.';
/** The words when the workspace closes (lock, close, switch, quit) while a transcript is being made. */
export const STOPPED_WORKSPACE_CLOSED = 'Stopped because the workspace closed. Nothing was kept.';

/**
 * Whether the program at this path is whisper.cpp's whisper-cli. On Windows only whisper-cli.exe: Windows never starts
 * a file without its extension, so an extensionless name would run some other whisper-cli.exe, or nothing. Elsewhere
 * the exact file is what runs, so whisper-cli or whisper-cli.exe.
 */
export function isWhisperCli(path: string, platform: string = process.platform): boolean {
  const name = path.split(/[\\/]/).pop() ?? '';
  return platform === 'win32' ? /^whisper-cli\.exe$/i.test(name) : /^whisper-cli(?:\.exe)?$/.test(name);
}

export { localPathProblem };

/** Removes a temporary folder, trying again while another program still holds it, and never throws. */
async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
}

/**
 * Runs the local whisper.cpp without a shell through the capped runner (capped-run.ts). Past its time, printing too
 * much, or when the workspace closes (signal), it is stopped, and the answer waits for it to close (closeWaitMs, ten
 * seconds by default), so the files it held are free to remove. Never retried.
 */
export async function runLocalCommand(request: ProcessRequest & { signal?: AbortSignal; closeWaitMs?: number }, spawnChild: typeof spawn = spawn): Promise<ProcessResult> {
  const result = await runCapped({
    command: request.command, args: request.args, cwd: request.cwd, env: request.env, stdin: request.stdin, timeoutMs: request.timeoutMs,
    ...(request.signal ? { signal: request.signal } : {}), ...(request.closeWaitMs !== undefined ? { closeWaitMs: request.closeWaitMs } : {}),
  }, spawnChild);
  const minutes = Math.ceil(request.timeoutMs / 60000);
  if (result.end === 'aborted') throw new ChausarError('TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
  if (result.end === 'timeout') throw new ChausarError('SPEECH_FAILED', `whisper.cpp took longer than ${minutes} minute${minutes === 1 ? '' : 's'} and was stopped. Nothing was kept, and it is not run again on its own.`);
  if (result.end === 'too-much') throw new ChausarError('SPEECH_FAILED', 'whisper.cpp printed too much and was stopped. Nothing was kept.');
  if (result.end === 'start-failed') throw new ChausarError('SPEECH_FAILED', 'whisper.cpp could not start. Nothing was kept, and it is not run again on its own.');
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Whether a file is at this path on this computer. */
function isFile(path: string | undefined): boolean { try { return typeof path === 'string' && statSync(path).isFile(); } catch { return false; } }

export class SpeechService {
  store: StateStore; options: SpeechOptions; #providers = new Map<string, SpeechProvider & { id: string }>();
  constructor(store: StateStore, options: SpeechOptions = {}) { this.store = store; this.options = options; }
  /**
   * Whether the owner's own whisper.cpp can make a transcript on this computer now: the first enabled local command,
   * with its whisper-cli and model file still where they were set up. Chausar never installs one or downloads a model.
   */
  localTranscriber(): { ready: true; providerId: string } | { ready: false; reason: string } {
    // The one the owner set up in the app comes first. A provider whose paths fail the rules is never checked or run.
    const provider = [...this.#providers.values()].sort((a, b) => Number(b.id === APP_WHISPER) - Number(a.id === APP_WHISPER))
      .find(item => item.enabled && item.kind === 'local-command' && this.#localPaths(item));
    if (!provider) return { ready: false, reason: 'No whisper.cpp is set up on this computer.' };
    if (!isFile(provider.command)) return { ready: false, reason: WHISPER_CLI_MISSING };
    if (!isFile(provider.model)) return { ready: false, reason: WHISPER_MODEL_MISSING };
    return { ready: true, providerId: provider.id };
  }
  /**
   * A sound file on this computer as SRT text, through the local whisper.cpp only: one run with the prompt given
   * (the business's words), in a temporary folder removed afterwards. Never uploaded, never retried, no fallback.
   */
  /** 5B1 trusted host read: hash the exact files selected by localTranscriber before a pinned tier runs. */
  localTranscriptionFiles(context: Context): { providerId: string; command: string; model: string } | null {
    authorize(this.store, context, 'prepare');
    const local = this.localTranscriber();
    if (!local.ready) return null;
    const provider = this.#providers.get(local.providerId)!;
    return { providerId: provider.id, command: provider.command!, model: provider.model! };
  }
  async transcribeFile(context: Context, input: { path: string; prompt?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ srt: string; providerId: string }> {
    authorize(this.store, context, 'prepare');
    check(!input.signal?.aborted, 'TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
    const local = this.localTranscriber();
    if (!local.ready) throw new ChausarError('SPEECH_UNAVAILABLE', local.reason);
    check(typeof input.path === 'string' && isAbsolute(input.path) && isFile(input.path), 'INVALID_AUDIO', 'Give the full path to a sound file on this computer.');
    const prompt = input.prompt ?? '';
    check(typeof prompt === 'string' && prompt.length <= 1000 && !/[\u0000-\u001F\u007F]/.test(prompt), 'INVALID_TRANSCRIPT', 'The prompt must be one line of up to 1,000 characters.');
    const timeoutMs = input.timeoutMs ?? 600000;
    check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000, 'INVALID_AUDIO', 'Give a time limit between one second and fifteen minutes.');
    const provider = this.#providers.get(local.providerId)!;
    const directory = await mkdtemp(join(tmpdir(), 'chausar-speech-'));
    try {
      const output = join(directory, 'transcript');
      const args = ['-m', provider.model!, '-f', input.path, '-osrt', '-of', output, '-l', 'auto', '-np', ...(prompt ? ['--prompt', prompt] : [])];
      let result: ProcessResult;
      const request: ProcessRequest = { command: provider.command!, args, cwd: directory, env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' }, stdin: '', timeoutMs, schema: {} };
      try {
        result = this.options.process ? await this.options.process(request)
          : await runLocalCommand({ ...request, ...(input.signal ? { signal: input.signal } : {}), ...(this.options.closeWaitMs !== undefined ? { closeWaitMs: this.options.closeWaitMs } : {}) }, this.options.spawn);
      } catch (error) {
        if (error instanceof ChausarError && (error.code === 'SPEECH_FAILED' || error.code === 'TRANSCRIBE_STOPPED')) throw error;
        throw new ChausarError('SPEECH_FAILED', 'whisper.cpp did not finish. Nothing was kept, and it is not run again on its own.');
      }
      check(!input.signal?.aborted, 'TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
      check(result.exitCode === 0, 'SPEECH_FAILED', 'whisper.cpp stopped with an error. Nothing was kept, and it is not run again on its own.');
      let srt: string;
      try { srt = await readFile(`${output}.srt`, 'utf8'); } catch { throw new ChausarError('SPEECH_FAILED', 'whisper.cpp wrote no transcript. Nothing was kept, and it is not run again on its own.'); }
      check(Buffer.byteLength(srt) <= 4000000, 'SPEECH_FAILED', 'whisper.cpp wrote a transcript too large to keep.');
      // The activity row is written by whoever keeps the transcript, with it (venture.files.transcribe).
      return { srt, providerId: provider.id };
    } finally {
      // A folder another program still holds is tried again, and never hides the outcome above.
      await (this.options.removeFolder ?? removeQuietly)(directory).catch(() => undefined);
    }
  }
  /**
   * Puts in place the whisper.cpp the owner set up in the app (venture.transcription.set), or removes it (null). The
   * paths follow these rules: full paths on this computer, never a network share, and the command
   * named whisper-cli. Whether the files are there is checked on each use (localTranscriber). Trusted host composition.
   */
  useLocal(setup: LocalWhisper | null): void {
    if (!setup) { this.#providers.delete(APP_WHISPER); return; }
    const problem = localPathProblem(setup.command, this.#platform) ?? localPathProblem(setup.model, this.#platform);
    check(!problem && isWhisperCli(setup.command, this.#platform), 'INVALID_SPEECH_PROVIDER', problem ?? 'Choose the whisper-cli program from your whisper.cpp.');
    this.#providers.set(APP_WHISPER, { id: APP_WHISPER, kind: 'local-command', label: 'whisper.cpp on this computer', command: setup.command, model: setup.model, enabled: true });
  }
  /** When the workspace opens: the newest whisper.cpp setup kept in the vault, if any. A setup that no longer passes the rules is left out. */
  restoreLocal(state: State): void {
    const saved = state.conversations.filter((record: any) => record?.kind === SETUP_RECORD).at(-1) as Partial<LocalWhisper> | undefined;
    try { this.useLocal(saved?.command && saved?.model ? { command: saved.command, model: saved.model } : null); } catch { this.useLocal(null); }
  }
  get #platform(): string { return this.options.platform ?? process.platform; }
  /** A local command's paths pass the rules: full local paths, never a network share, and whisper-cli by name. */
  #localPaths(provider: { command?: unknown; model?: unknown }): boolean {
    return typeof provider.command === 'string' && typeof provider.model === 'string' && !localPathProblem(provider.command, this.#platform)
      && !localPathProblem(provider.model, this.#platform) && isWhisperCli(provider.command, this.#platform);
  }
}
