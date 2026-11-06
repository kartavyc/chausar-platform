// Chausar flagship playbook, YouTube channel: a transcript made on this computer from the client's footage (Ink v2
// wave 2, package 2E2, catalogue K12). The ffmpeg already on this computer takes the sound out of the finished cut
// named at intake (mono, 16 kHz, in a temporary folder removed afterwards). The owner's own whisper.cpp, set up in
// Connections > Your AI with full paths (venture.transcription.set, kept in the vault), turns it into timed lines
// once, with the business dictionary's words as its prompt so they are spelled the business's way. Cues that hold no
// speech ([BLANK_AUDIO], (music)) are dropped and the rest numbered again. Nothing is installed, no model is
// downloaded, no network share is read and nothing leaves the computer; when ffmpeg or whisper.cpp is missing Chausar
// says so in plain words. Draft, final and refined tiers, word timings and model hashes (the rest of K12) are the
// YouTube deepening in wave 5.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { check, ChausarError, type Context, type State } from '../../../contracts.ts';
import { isWhisperCli, localPathProblem, STOPPED_WORKSPACE_CLOSED, WHISPER_CLI_MISSING, WHISPER_MODEL_MISSING } from '../../../speech.ts';
import type { TranscriptionSetupRecord, TranscriptionSetupView, VentureDeps } from '../../contracts.ts';
import type { DictionaryEntry } from '../../delivery/harness/dictionary.ts';
import { readAs } from '../../delivery/shared.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import { systemFfmpeg, type FfmpegRun } from './finishing.ts';
import { parseTranscript, type Cue } from './transcript.ts';

export const FFMPEG_MISSING = 'ffmpeg not found on this computer. Chausar never installs it.';
export const WHISPER_MISSING = 'No whisper.cpp is set up on this computer.';
export const WHISPER_SET_UP = 'whisper.cpp is set up on this computer.';
export const HOSTED_NO_TRANSCRIBE = "The shared hosted server can't make a transcript: it never reads a file on your computer. Use the desktop app, or add the transcript as an SRT or VTT file.";
/** Under the desktop's fifteen minute request limit, together. */
const FFMPEG_TIMEOUT_MS = 120000;
const WHISPER_TIMEOUT_MS = 720000;
const PROMPT_MAX = 600;

/** What this computer has for a transcript made here, with the plain reason for each missing part. */
export type LocalTranscription = { ffmpeg: boolean; speech: boolean; reasons: string[] };

/** Whether ffmpeg and the owner's whisper.cpp are both here. Looks only; runs nothing and installs nothing. */
export function localTranscription(deps: VentureDeps): LocalTranscription {
  if (deps.host === 'hosted-web') return { ffmpeg: false, speech: false, reasons: [HOSTED_NO_TRANSCRIBE] };
  const ffmpeg = (deps.ffmpeg ?? systemFfmpeg).locate() !== null;
  const local = deps.services.speech?.localTranscriber() ?? { ready: false as const, reason: WHISPER_MISSING };
  return { ffmpeg, speech: local.ready, reasons: [...(ffmpeg ? [] : [FFMPEG_MISSING]), ...(local.ready ? [] : [local.reason])] };
}

/** The transcription card's note on Connections: what it does here, or what is missing and where to set it up. */
export function transcriptionNote(here: LocalTranscription, hosted: boolean): string {
  if (here.ffmpeg && here.speech) return 'Makes the transcript on this computer with the ffmpeg and whisper.cpp already here. Nothing is uploaded.';
  return [...here.reasons, ...(!here.speech && !hosted ? ['Set it up in Connections, Your AI.'] : [])].join(' ');
}

/**
 * whisper.cpp's prompt: the business dictionary's own words (its terms, offers, money definitions and the service
 * type's glossary), each once, up to 600 characters. Names in snake_case (an id, not a spoken word) are left out.
 * Empty when the dictionary has none.
 */
export function transcriptPrompt(entries: readonly DictionaryEntry[]): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const entry of entries) {
    if (!['term', 'offer', 'definition', 'concept'].includes(entry.kind)) continue;
    for (const raw of [entry.name, ...entry.aliases]) {
      const word = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!word || word.length > 60 || word.includes('_') || seen.has(word.toLowerCase())) continue;
      seen.add(word.toLowerCase());
      words.push(word);
    }
  }
  let prompt = '';
  for (const word of words) {
    const next = prompt ? `${prompt}, ${word}` : `Glossary: ${word}`;
    if (next.length + 1 > PROMPT_MAX) break;
    prompt = next;
  }
  return prompt ? `${prompt}.` : '';
}

/** A cue made only of sound labels or music marks, such as [BLANK_AUDIO], (music) or ♪, holds no speech. */
const NO_SPEECH = /^(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[\s♪♫.,!?-])*$/u;

/** The cues that hold speech, numbered again from seg-1. */
export function speechCues(cues: readonly Cue[]): Cue[] {
  return cues.filter(cue => cue.text.trim() && !NO_SPEECH.test(cue.text)).map((cue, index) => ({ ...cue, id: `seg-${index + 1}` }));
}

const stamp = (ms: number) => {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** Cues as an SRT file, numbered from one. */
export function srtOf(cues: readonly Cue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`).join('\n\n')}\n`;
}

/** The transcript's file name: the cut's name with .srt, so the owner knows which footage it came from. */
export function transcriptName(cutFile: string): string {
  const name = basename(cutFile.replace(/\\/g, '/'), extname(cutFile)).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 100);
  return `${name || 'transcript'}.srt`;
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
function isFileNow(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/**
 * The cut on this computer as an SRT transcript of what was said: ffmpeg once, whisper.cpp once, never retried, the
 * temporary sound file removed whatever happens (tried again while a program still holds it, never hiding the
 * outcome). Refuses before running anything when a part is missing or the cut is not a plain file on this computer.
 */
export async function makeLocalTranscript(deps: VentureDeps, ctx: Context, input: { cutFile: string; prompt: string }): Promise<{ srt: string; cues: number; providerId: string }> {
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_TRANSCRIBE);
  const port = deps.ffmpeg ?? systemFfmpeg;
  const binary = port.locate();
  check(binary, 'TRANSCRIBE_NOT_AVAILABLE', FFMPEG_MISSING);
  const speech = deps.services.speech;
  check(speech, 'TRANSCRIBE_NOT_AVAILABLE', WHISPER_MISSING);
  const local = speech.localTranscriber();
  if (!local.ready) throw new ChausarError('TRANSCRIBE_NOT_AVAILABLE', local.reason);
  const problem = localPathProblem(input.cutFile);
  check(!problem, 'INVALID_VENTURE_REQUEST', `The cut: ${problem}`);
  check(await isFile(input.cutFile), 'INVALID_VENTURE_REQUEST', "There is no file at the cut's path on this computer. Put the cut back, or make a new order that names where it is now.");
  // The workspace closing (lock, close, switch, quit) stops this: the engine holds off and waits instead of VAULT_BUSY.
  const signal = deps.closing?.signal;
  check(!signal?.aborted, 'TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
  const release = deps.closing?.hold();
  const folder = await mkdtemp(join(tmpdir(), 'chausar-transcribe-'));
  try {
    const sound = join(folder, 'sound.wav');
    // The cut's path is a full local path, so it can never be read as an ffmpeg option.
    let run: FfmpegRun | null = null;
    try { run = await port.run(binary, ['-hide_banner', '-nostats', '-nostdin', '-i', input.cutFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', sound], FFMPEG_TIMEOUT_MS, signal); } catch { run = null; }
    check(!run?.aborted && !signal?.aborted, 'TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
    check(run && run.code === 0 && !run.timedOut && !run.startError && await isFile(sound), 'SPEECH_FAILED', 'ffmpeg could not take the sound out of the cut. Nothing was kept.');
    const made = await speech.transcribeFile(ctx, { path: sound, prompt: input.prompt, timeoutMs: WHISPER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
    check(!signal?.aborted, 'TRANSCRIBE_STOPPED', STOPPED_WORKSPACE_CLOSED);
    const cues = speechCues(parseTranscript(made.srt));
    check(cues.length > 0, 'SPEECH_FAILED', 'whisper.cpp heard no speech in the cut. Nothing was kept.');
    return { srt: srtOf(cues), cues: cues.length, providerId: made.providerId };
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    release?.();
  }
}

// ---------------------------------------------------------------------------
// The owner's whisper.cpp, set up in the app and kept in the vault
// ---------------------------------------------------------------------------

/** The newest setup, or null when none was ever made. */
export function transcriptionSetupOf(state: State, ventureId: string): TranscriptionSetupRecord | null {
  return listRecords(state, 'venture-transcription-setup', ventureId).at(-1) ?? null;
}

/** The setup as the owner sees it, with its files checked on disk now. */
export function transcriptionSetupView(deps: VentureDeps, record: TranscriptionSetupRecord | null): TranscriptionSetupView {
  if (deps.host === 'hosted-web') return { status: 'not-set-up', command: null, model: null, ffmpeg: false, line: HOSTED_NO_TRANSCRIBE };
  const ffmpeg = (deps.ffmpeg ?? systemFfmpeg).locate() !== null;
  const tail = ffmpeg ? '' : ` ${FFMPEG_MISSING}`;
  const command = record?.command ?? null, model = record?.model ?? null;
  if (!command || !model) return { status: 'not-set-up', command: null, model: null, ffmpeg, line: `${WHISPER_MISSING}${tail}` };
  const missing = !isFileNow(command) ? WHISPER_CLI_MISSING : !isFileNow(model) ? WHISPER_MODEL_MISSING : null;
  return { status: missing ? 'files-missing' : 'set-up', command, model, ffmpeg, line: `${missing ?? WHISPER_SET_UP}${tail}` };
}

/** venture.transcription.get {}: the owner's whisper.cpp setup and its honest status. */
export async function transcriptionGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TranscriptionSetupView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return transcriptionSetupView(deps, transcriptionSetupOf(state, venture.id));
}

/**
 * venture.transcription.set { command, model } or { clear: true } (app only, the owner's, desktop only): the full paths
 * to whisper-cli and to its model file, both on this computer now, kept in the vault and put in place at once. Never
 * a network share; the program must be named whisper-cli. Clearing keeps a record with no paths.
 */
export async function transcriptionSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TranscriptionSetupView> {
  requireAppChannel(ctx, 'venture.transcription.set');
  check(ctx.role === 'owner' || ctx.role === 'cofounder', 'APP_APPROVAL_REQUIRED', 'Only you set up whisper.cpp, inside the Chausar app.');
  const body = exactPayload(payload, ['command', 'model', 'clear']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_TRANSCRIBE);
  // Access first: nothing on disk is looked at for a session that may not change this.
  readAs(deps, ctx, 'approve');
  let setup: { command: string; model: string } | null = null;
  if (Object.hasOwn(body, 'clear')) {
    check(body.clear === true && body.command === undefined && body.model === undefined, 'INVALID_VENTURE_REQUEST', 'Send clear: true on its own to remove the setup.');
  } else {
    check(typeof body.command === 'string' && typeof body.model === 'string', 'INVALID_VENTURE_REQUEST', 'Give the full paths to whisper-cli and to its model file.');
    const command = body.command, model = body.model;
    for (const [path, what] of [[command, 'whisper-cli'], [model, 'The model file']] as const) {
      const problem = localPathProblem(path);
      check(!problem, 'INVALID_VENTURE_REQUEST', `${what}: ${problem}`);
    }
    check(isWhisperCli(command), 'INVALID_VENTURE_REQUEST', process.platform === 'win32'
      ? 'Choose the whisper-cli.exe program from your whisper.cpp folder. Windows only starts it with its .exe ending.'
      : 'Choose the whisper-cli program from your whisper.cpp folder.');
    check(await isFile(command), 'INVALID_VENTURE_REQUEST', 'whisper-cli is not at that path on this computer. Chausar never installs it.');
    check(await isFile(model), 'INVALID_VENTURE_REQUEST', 'The model file is not at that path on this computer. Chausar never downloads one.');
    setup = { command, model };
  }
  const record = await ventureAction(deps, ctx, 'approve', 'transcription.setup', tx =>
    tx.put<TranscriptionSetupRecord>({ ...tx.base('venture-transcription-setup'), command: setup?.command ?? null, model: setup?.model ?? null }));
  deps.services.speech?.useLocal(setup);
  return transcriptionSetupView(deps, record);
}
