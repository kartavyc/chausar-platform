// Chausar flagship playbook, YouTube channel: the finishing check on a cut, before the owner watches it. Everything is
// measured on the finished file by ffmpeg's own detectors: black and frozen spans, silences, sound levels, and the
// length and frame read from its header. It runs only when ffmpeg is already on PATH. Chausar never installs it; when
// it is missing the check reports "not run: ffmpeg not found", which never counts as a pass. Captions over a face need
// face boxes, and there is no face detector in this build, so that part says it did not run unless boxes are given.
// The check never changes the client's file: a quiet mix is reported as a fix with the gain it needs, not applied.
//
// Ported, with changes, from krakonjac300-pixel/podcast-shorts-factory (MIT, Copyright (c) 2026 Kosta Rakonjac),
// factory/agents/finishing_editor.py: the detector settings, the severities, the PASS / FIX / FLAG ladder and the
// caption band. Rewritten here with whole milliseconds and tenths of a decibel.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { runCapped } from '../../../capped-run.ts';
import { platformRule } from './platform-rules.ts';
import type { YoutubeCheckResult } from './checks.ts';

/** aborted: the workspace closed while it ran, so it was stopped (a transcript made here listens for that). */
export type FfmpegRun = { code: number | null; stderr: string; timedOut: boolean; startError: string | null; aborted?: boolean };
export type FfmpegPort = {
  /** The ffmpeg program to run, or null when it is not on this computer. Never installs anything. */
  locate(): string | null;
  run(binary: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<FfmpegRun>;
};

/** A program on PATH by its name, with the host's extensions on Windows; null when it is not there. */
export function findOnPath(name: string, env: Record<string, string | undefined> = process.env, platform: string = process.platform): string | null {
  const key = (wanted: string) => Object.keys(env).find(item => item.toUpperCase() === wanted);
  const pathKey = key('PATH');
  const value = pathKey ? env[pathKey] : undefined;
  if (!value) return null;
  const windows = platform === 'win32';
  const extKey = key('PATHEXT');
  const exts = windows ? ((extKey ? env[extKey] : undefined) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of value.split(windows ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) {
      for (const candidate of windows ? [name + ext.toLowerCase(), name + ext] : [name]) {
        const path = join(dir, candidate);
        try { if (statSync(path).isFile()) return path; } catch { /* not here */ }
      }
    }
  }
  return null;
}

/** ffmpeg writes its log to standard error; the finishing check reads it from the start, up to this much. */
const LOG_LIMIT = 32 * 1024 * 1024;

/**
 * An ffmpeg run without a shell through the same capped runner as whisper.cpp (platform/runtime/capped-run.ts): past
 * its time, or when the workspace closes (signal), it is stopped and waited for until it closes, for closeWaitMs at
 * most. spawnChild and closeWaitMs are for tests.
 */
export function ffmpegPort(spawnChild: typeof spawn = spawn, options: { closeWaitMs?: number } = {}): FfmpegPort {
  return Object.freeze({
    locate: () => findOnPath('ffmpeg'),
    run: async (binary: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<FfmpegRun> => {
      const result = await runCapped({
        command: binary, args, env: process.env, timeoutMs, stdoutLimit: LOG_LIMIT, stderrLimit: LOG_LIMIT, stderrKeep: 'head',
        ...(signal ? { signal } : {}), ...(options.closeWaitMs !== undefined ? { closeWaitMs: options.closeWaitMs } : {}),
      }, spawnChild);
      return {
        code: result.end === 'closed' ? result.exitCode : null, stderr: result.stderr, timedOut: result.end === 'timeout', startError: result.startError,
        ...(result.end === 'aborted' ? { aborted: true } : {}),
      };
    },
  });
}

/** The ffmpeg already on this computer. */
export const systemFfmpeg: FfmpegPort = ffmpegPort();

// ---------------------------------------------------------------------------
// Reading ffmpeg's log
// ---------------------------------------------------------------------------

export type Span = { startMs: number; endMs: number };
export type FfmpegLog = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  black: Span[];
  freezeCount: number;
  silence: Span[];
  meanTenthsDb: number | null;
  maxTenthsDb: number | null;
};

/** "4.544" seconds as 4544 milliseconds, from the text, never through a float. */
function secondsMs(text: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  return match ? Number(match[1]) * 1000 + Number(((match[2] ?? '') + '000').slice(0, 3)) : null;
}
/** "-21.1" decibels as -211 tenths. */
function tenthsDb(text: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d))?\d*$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[2]) * 10 + Number(match[3] ?? '0');
  return match[1] ? -value : value;
}

/** The input part of the log only: the output section repeats stream lines for the null muxer. */
const inputPart = (log: string) => log.split(/\r?\n(?:Stream mapping:|Output #)/)[0];

export function parseFfmpegLog(videoLog: string, audioLog: string | null): FfmpegLog {
  const head = inputPart(videoLog);
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{1,3})/.exec(head);
  const durationMs = duration ? ((Number(duration[1]) * 60 + Number(duration[2])) * 60 + Number(duration[3])) * 1000 + Number((duration[4] + '00').slice(0, 3)) : null;
  const videoLine = head.split(/\r?\n/).find(line => /Stream #\d+:\d+.*: Video:/.test(line)) ?? null;
  const frame = videoLine ? /[\s,](\d{2,5})x(\d{2,5})(?=[\s,[])/.exec(videoLine) : null;
  const black: Span[] = [];
  for (const match of videoLog.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) {
    const startMs = secondsMs(match[1]), endMs = secondsMs(match[2]);
    if (startMs !== null && endMs !== null) black.push({ startMs, endMs });
  }
  const silence: Span[] = [];
  let open: number | null = null;
  for (const match of (audioLog ?? '').matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const at = secondsMs(match[2]);
    if (at === null) continue;
    if (match[1] === 'start') open = at;
    else { silence.push({ startMs: open ?? 0, endMs: at }); open = null; }
  }
  if (open !== null) silence.push({ startMs: open, endMs: durationMs ?? open });
  const last = (pattern: RegExp) => { const all = [...(audioLog ?? '').matchAll(pattern)]; return all.length ? tenthsDb(all.at(-1)![1]) : null; };
  return {
    durationMs, width: frame ? Number(frame[1]) : null, height: frame ? Number(frame[2]) : null,
    hasVideo: videoLine !== null, hasAudio: /Stream #\d+:\d+.*: Audio:/.test(head),
    black, freezeCount: (videoLog.match(/freeze_start/g) ?? []).length, silence,
    meanTenthsDb: last(/mean_volume:\s*(-?[\d.]+)\s*dB/g), maxTenthsDb: last(/max_volume:\s*(-?[\d.]+)\s*dB/g),
  };
}

// ---------------------------------------------------------------------------
// Captions over a face
// ---------------------------------------------------------------------------

export type FaceBox = { x: number; y: number; width: number; height: number };
/** The faces found in one sampled frame of the finished cut. */
export type FaceSample = { faces: readonly FaceBox[] };

/** The pixel rows burned captions sit in: bottom-anchored, lifted by a share of the frame height, about 1.6 lines tall. */
export function captionBand(height: number, fontPx = 90, liftPermille = 340): [number, number] {
  const margin = Math.floor((height * liftPermille) / 1000);
  const bottom = height - margin;
  return [Math.max(0, bottom - Math.floor((fontPx * 16) / 10)), bottom + Math.floor((fontPx * 4) / 10)];
}

/** A face (at least 80 pixels wide) covering more than 35% of the band's height counts; half the frames or more is a problem. */
export function captionsOverFace(samples: readonly FaceSample[], band: [number, number]): { hits: number; seen: number; over: boolean } {
  const [top, bottom] = band;
  const span = bottom - top;
  let hits = 0;
  for (const sample of samples) {
    const covered = sample.faces.filter(face => face.width >= 80).some(face => {
      const overlap = Math.max(0, Math.min(face.y + face.height, bottom) - Math.max(face.y, top));
      return span > 0 && overlap * 100 > 35 * span;
    });
    if (covered) hits += 1;
  }
  const seen = samples.length;
  return { hits, seen, over: seen > 0 && hits * 2 >= seen };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type FinishingSeverity = 'critical' | 'fixable' | 'warn';
export type FinishingIssue = { kind: string; severity: FinishingSeverity; detail: string; gainTenthsDb?: number };
export type FinishingPartId = 'duration' | 'frame' | 'black' | 'freeze' | 'silence' | 'levels' | 'captions-over-face';
export type FinishingPart = { id: FinishingPartId; outcome: 'pass' | 'fail' | 'not-run'; detail: string };
/** pass, pass with notes (posted with warnings), fix (a cheap repair is named), flag (blocks), or not run. */
export type FinishingVerdict = 'pass' | 'pass-with-notes' | 'fix' | 'flag' | 'not-run';
export type FinishingReport = { verdict: FinishingVerdict; ran: boolean; detail: string; issues: FinishingIssue[]; parts: FinishingPart[]; log: FfmpegLog | null };
export type FinishingOptions = {
  format: 'long' | 'short';
  ffmpeg?: FfmpegPort;
  /** Face boxes per sampled frame, when a detector produced them. Without them that part does not run. */
  faces?: readonly FaceSample[] | null;
  captions?: { fontPx: number; liftPermille: number };
  timeoutMs?: number;
  exists?: (path: string) => boolean;
};

export const FFMPEG_NOT_FOUND = 'not run: ffmpeg not found';
export const NO_FACE_DETECTOR = 'not run: no face detector on this computer';
const DEFAULT_TIMEOUT_MS = 180000;
const db = (tenths: number) => `${tenths < 0 ? '-' : ''}${Math.floor(Math.abs(tenths) / 10)}.${Math.abs(tenths) % 10} dB`;
const secs = (ms: number) => `${Math.floor(ms / 1000)}.${String(Math.floor((ms % 1000) / 100))} s`;

const notRun = (detail: string): FinishingReport => ({ verdict: 'not-run', ran: false, detail, issues: [], parts: [], log: null });

/** Most severe wins: any critical flags, then any fixable is a fix, then warnings pass with notes. */
export function finishingVerdict(issues: readonly FinishingIssue[]): FinishingVerdict {
  if (issues.some(issue => issue.severity === 'critical')) return 'flag';
  if (issues.some(issue => issue.severity === 'fixable')) return 'fix';
  return issues.length ? 'pass-with-notes' : 'pass';
}

/** The issues and parts from a log, with the platform's Shorts rule from the dated register. */
export function judgeFinishing(log: FfmpegLog, options: Pick<FinishingOptions, 'format' | 'faces' | 'captions'>): { issues: FinishingIssue[]; parts: FinishingPart[] } {
  const issues: FinishingIssue[] = [];
  const parts: FinishingPart[] = [];
  const part = (id: FinishingPartId, outcome: FinishingPart['outcome'], detail: string) => parts.push({ id, outcome, detail });
  const add = (issue: FinishingIssue) => { issues.push(issue); return issue; };

  if (!log.hasVideo || log.durationMs === null || log.durationMs < 1000) {
    add({ kind: 'broken render', severity: 'critical', detail: 'The file has no playable picture, or it is under a second long.' });
    part('duration', 'fail', issues[0].detail);
    return { issues, parts };
  }
  const shortsMax = platformRule('shorts-length').limits.maxSeconds * 1000;
  if (options.format === 'short' && log.durationMs > shortsMax) {
    part('duration', 'fail', add({ kind: 'duration', severity: 'critical', detail: `The cut runs ${secs(log.durationMs)}; a Short is at most three minutes.` }).detail);
  } else part('duration', 'pass', `The cut runs ${secs(log.durationMs)}.`);
  if (options.format === 'short' && log.width !== null && log.height !== null && log.width > log.height) {
    part('frame', 'fail', add({ kind: 'wide frame', severity: 'critical', detail: `The frame is ${log.width} by ${log.height}; a Short needs a vertical or square frame.` }).detail);
  } else part('frame', log.width === null ? 'not-run' : 'pass', log.width === null ? 'not run: the frame size was not in the log.' : `The frame is ${log.width} by ${log.height}.`);

  if (log.black.length) part('black', 'fail', add({ kind: 'black frames', severity: 'critical', detail: `${log.black.length} fully black stretch${log.black.length === 1 ? '' : 'es'} of half a second or more, first at ${secs(log.black[0].startMs)}.` }).detail);
  else part('black', 'pass', 'No black stretches.');
  if (log.freezeCount) part('freeze', 'fail', add({ kind: 'frozen frames', severity: 'warn', detail: `${log.freezeCount} frozen stretch${log.freezeCount === 1 ? '' : 'es'} of two and a half seconds or more. Check for a stall.` }).detail);
  else part('freeze', 'pass', 'No frozen stretches.');

  if (!log.hasAudio) {
    const detail = 'The file has no sound track.';
    add({ kind: 'no sound track', severity: 'critical', detail });
    part('silence', 'fail', detail);
    part('levels', 'fail', detail);
  } else {
    if (log.silence.length) part('silence', 'fail', add({ kind: 'dead air', severity: 'warn', detail: `${log.silence.length} silent gap${log.silence.length === 1 ? '' : 's'} of two seconds or more, first at ${secs(log.silence[0].startMs)}.` }).detail);
    else part('silence', 'pass', 'No silent gaps of two seconds or more.');
    const levels: string[] = [];
    if (log.maxTenthsDb !== null && log.maxTenthsDb >= -3) levels.push(add({ kind: 'audio clipping', severity: 'warn', detail: `The peak is ${db(log.maxTenthsDb)}, which risks distortion.` }).detail);
    if (log.meanTenthsDb !== null && log.meanTenthsDb < -450) levels.push(add({ kind: 'near silent', severity: 'critical', detail: `The average level is ${db(log.meanTenthsDb)}: effectively no sound.` }).detail);
    else if (log.meanTenthsDb !== null && log.meanTenthsDb < -300) {
      const gain = -160 - log.meanTenthsDb;
      levels.push(add({ kind: 'audio too quiet', severity: 'fixable', detail: `The average level is ${db(log.meanTenthsDb)}; raise it by about ${db(gain)}.`, gainTenthsDb: gain }).detail);
    }
    if (log.meanTenthsDb === null) part('levels', 'not-run', 'not run: the sound level was not in the log.');
    else part('levels', levels.length ? 'fail' : 'pass', levels.length ? levels.join(' ') : `The average level is ${db(log.meanTenthsDb)}.`);
  }

  if (!options.faces) part('captions-over-face', 'not-run', NO_FACE_DETECTOR);
  else if (log.height === null) part('captions-over-face', 'not-run', 'not run: the frame size was not in the log.');
  else {
    const band = captionBand(log.height, options.captions?.fontPx, options.captions?.liftPermille);
    const found = captionsOverFace(options.faces, band);
    if (found.over) part('captions-over-face', 'fail', add({ kind: 'captions on face', severity: 'warn', detail: `A face sits under the captions in ${found.hits} of ${found.seen} sampled frames. Raise the captions.` }).detail);
    else part('captions-over-face', 'pass', `Captions clear of faces in ${found.seen - found.hits} of ${found.seen} sampled frames.`);
  }
  return { issues, parts };
}

/** Runs the finishing check on one cut. Nothing is installed and the file is never changed. */
export async function finishingCheck(file: string, options: FinishingOptions): Promise<FinishingReport> {
  const port = options.ffmpeg ?? systemFfmpeg;
  const binary = port.locate();
  if (!binary) return notRun(FFMPEG_NOT_FOUND);
  // An absolute path, so a file name can never be read as an ffmpeg option.
  const path = isAbsolute(file) ? file : resolve(file);
  if (!(options.exists ?? existsSync)(path)) {
    const issues: FinishingIssue[] = [{ kind: 'missing file', severity: 'critical', detail: 'There is no cut at that path to check.' }];
    return { verdict: 'flag', ran: true, detail: issues[0].detail, issues, parts: [], log: null };
  }
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pass = async (args: string[]): Promise<FfmpegRun | FinishingReport> => {
    let run: FfmpegRun;
    try { run = await port.run(binary, ['-hide_banner', '-nostats', '-i', path, ...args, '-f', 'null', '-'], timeout); } catch {
      return notRun('not run: ffmpeg could not start.');
    }
    if (run.startError) return notRun(`not run: ffmpeg could not start (${run.startError}).`);
    if (run.timedOut) return notRun('not run: ffmpeg took too long on this file.');
    return run;
  };
  const video = await pass(['-vf', 'blackdetect=d=0.5:pic_th=0.98,freezedetect=n=-55dB:d=2.5', '-an']);
  if ('verdict' in video) return video;
  const head = parseFfmpegLog(video.stderr, null);
  let audioLog: string | null = null;
  if (head.hasAudio) {
    const audio = await pass(['-af', 'silencedetect=noise=-40dB:d=2.0,volumedetect', '-vn']);
    if ('verdict' in audio) return audio;
    audioLog = audio.stderr;
  }
  const log = parseFfmpegLog(video.stderr, audioLog);
  const { issues, parts } = judgeFinishing(log, options);
  const verdict = finishingVerdict(issues);
  const detail = verdict === 'pass' ? 'The cut has no black, frozen or silent stretches, and its sound and length are in range.'
    : verdict === 'pass-with-notes' ? `The cut passes with notes: ${issues.map(issue => issue.detail).join(' ')}`
      : verdict === 'fix' ? `The cut needs a small fix: ${issues.filter(issue => issue.severity === 'fixable').map(issue => issue.detail).join(' ')}`
        : `The cut is held back: ${issues.filter(issue => issue.severity === 'critical').map(issue => issue.detail).join(' ')}`;
  return { verdict, ran: true, detail, issues, parts, log };
}

/** The finishing report as one check result: a flag or a fix fails, notes pass, and not run stays not run. */
export function finishingResult(report: FinishingReport): YoutubeCheckResult {
  const outcome = report.verdict === 'not-run' ? 'not-run' : report.verdict === 'flag' || report.verdict === 'fix' ? 'fail' : 'pass';
  const notes = [...report.issues.filter(issue => issue.severity === 'warn').map(issue => issue.detail), ...report.parts.filter(part => part.outcome === 'not-run').map(part => part.detail)];
  return { check: 'finishing', outcome, detail: report.detail, notes };
}
