// Chausar delivery harness: the YouTube playbook's built pieces as agent tools (Ink v2 wave 2, package 2E1, row Y1):
// scoring the hooks the agent wrote, the edit list from transcript segments, chapters from the pauses, and the Studio
// retention export. Code ranks, cuts and reads; the agent names hooks, segment ids and files only. Each tool makes a
// table code worked out (computedTable): the run keeps it, the checks read it (the hooks the scorer kept) and the write
// step uses it as given (the chapter times). Only the YouTube playbook's agents may hold these tools (patches.ts
// FLAGSHIP_TOOLS). They read the order's files and send nothing; their effects are declared in policy/effects.ts.
import { ChausarError } from '../../../contracts.ts';
import { assertNoNumbers, findRecord, modelWords } from '../../records.ts';
import type { IsoDate, Json, ToolCallRecord, ToolName, VentureDeps, WorkTableRecord } from '../../contracts.ts';
import { localDayAt } from '../../local-day.ts';
import {
  buildEditList, chapterProblems, chapterTimesOf, clock, draftChapters, rankHooks, readRetentionExport, sameHook, YOUTUBE_TABLES, type HookScore,
} from '../../playbooks/youtube/checks.ts';
import { PACKAGE_SECTIONS } from '../../playbooks/youtube/playbook.ts';
import type { Cue } from '../../playbooks/youtube/transcript.ts';
import { transcriptCues, type FileLike } from './files.ts';
import type { WorkedForWriter } from './loop.ts';
import { computedTable, fail, fileOf, text, type Spec, type ToolEnv } from './tools.ts';
import { notBuiltTool } from './tool-stub.ts';

type YoutubeToolName = Extract<ToolName, 'youtube.hooks' | 'youtube.editList' | 'youtube.chapters' | 'youtube.retention'>;

/** How many hooks the scorer keeps for the package. */
const KEEP_HOOKS = 2;
const FRAME_RATES = ['24', '25', '30', '50', '60'] as const;
const KEPT_NOTE = 'Write the kept hooks word for word as the Hook lines of the package. A score is lint, not a forecast.';
const CHAPTER_NOTE = 'The labels are topic words: retitle them in plain words if you like, but keep each time exactly as given.';
const NO_TRANSCRIPT_SAID = 'none: the order has no transcript, so the drops do not say what was said';

/**
 * The order's transcript: the file named, else the first transcript on the order. Segment ids and times come only from
 * a transcript, so a tool that needs one refuses without it.
 */
function transcriptOf(env: ToolEnv, alias: unknown): { file: FileLike; cues: Cue[] } {
  const file = alias === undefined ? env.files.find(item => item.format === 'transcript') : fileOf(env, alias);
  if (!file) return fail('This order has no transcript. Ask the client for the SRT or VTT file of the footage.');
  if (file.format !== 'transcript') fail(`${String(alias)} is not a transcript. Name the SRT or VTT file, such as f1.`);
  return { file, cues: transcriptCues(file) };
}

/** The engine's own refusal of what the agent picked, in its words, as a tool failure. Other refusals keep their code. */
function inEngineWords<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof ChausarError && error.code === 'INVALID_VENTURE_REQUEST') fail(error.message);
    throw error;
  }
}

/** The run's day on the business's own calendar, for rights that end on a date; the clock's day where no vault is at hand. */
function runDay(env: ToolEnv): IsoDate {
  // A tool environment built by hand (a unit test) has no vault; every run the engine starts has one.
  const store = (env.deps as Partial<VentureDeps>).store;
  if (!store) return env.now().slice(0, 10);
  const venture = findRecord(store.read(), 'venture-record', env.ventureId);
  return venture ? localDayAt(env.now(), venture.country) : env.now().slice(0, 10);
}

const hookRow = (score: HookScore) => ({ Hook: score.hook, Score: String(score.verdict), Band: score.band, Weakest: score.weakest, Fix: score.fix });

export const YOUTUBE_TOOLS: Readonly<Record<YoutubeToolName, Spec>> = Object.freeze({
  'youtube.hooks': {
    name: 'youtube.hooks', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Scores the opening hooks you wrote and keeps the best two in a table. Write two to eight, in words; the package uses the kept two word for word.',
    input: { hooks: { type: 'list', required: true, max: 8, item: text('One opening hook, as it would be said, in words.', 300), about: 'Your hooks. At least two.' } },
    async run(env, input) {
      const hooks = (input.hooks as string[]).map(hook => {
        // Any other refusal of the words (hidden characters, money) keeps its own code and words.
        const words = modelWords(hook, 'hook', 300, { allowed: env.allowed });
        // The kept hooks go into the package, whose words may hold no number the client did not write; so here too.
        try { assertNoNumbers(words, 'hook', env.allowed); } catch {
          return fail("A hook held a number. Write hooks in words; a number may only be one copied from the client's own message.");
        }
        return words;
      });
      if (hooks.length < KEEP_HOOKS) fail('Write at least two hooks, so the scorer has a choice.');
      if (hooks.some((hook, index) => hooks.findIndex(other => sameHook(other, hook)) !== index)) fail('Two of the hooks are the same. Write different ones.');
      const ranked = rankHooks(hooks);
      const kept = ranked.slice(0, KEEP_HOOKS);
      const table = YOUTUBE_TABLES.hooks;
      const out = computedTable(env, table.name, table.columns, kept.map(hookRow), 'youtube.hooks', []);
      return {
        result: {
          table: out.alias, kept: kept.map(score => ({ hook: score.hook, score: score.verdict, band: score.band, weakest: score.weakest, fix: score.fix })),
          others: ranked.slice(KEEP_HOOKS).map(score => ({ hook: score.hook, score: score.verdict, band: score.band })), note: KEPT_NOTE,
        },
        tables: [out.record],
      };
    },
  },
  'youtube.editList': {
    name: 'youtube.editList', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Builds an edit list of frame ranges from transcript segments you pick by id (seg-12 to seg-18), snapped to frames. Cutting needs the rights recorded at intake.',
    input: {
      picks: { type: 'list', required: true, max: 20, about: 'The ranges to keep, in order.', item: { type: 'object', required: true, about: 'One range.', fields: {
        from: text('The first segment id, such as seg-12.', 12), to: text('The last segment id, such as seg-18.', 12),
      } } },
      fps: { type: 'enum', required: true, values: FRAME_RATES, about: 'Frames a second of the footage.' },
      transcript: text('The transcript, such as f1. Defaults to the first transcript on the order.', 12, false),
    },
    async run(env, input) {
      const { file, cues } = transcriptOf(env, input.transcript);
      const picks = (input.picks as { from: string; to: string }[]).map(pick => ({ from: pick.from.trim(), to: pick.to.trim() }));
      // Cutting footage is clipping: buildEditList checks the rights recorded at intake first, on the run's own day.
      const list = inEngineWords(() => buildEditList(cues, picks, { fps: parseInt(input.fps, 10), intake: env.intake ?? null, today: runDay(env) }));
      const table = YOUTUBE_TABLES.editList;
      const rows = list.ranges.map(range => ({ From: range.from, To: range.to, 'Start frame': String(range.startFrame), 'End frame': String(range.endFrame) }));
      const out = computedTable(env, `${table.name} at ${list.fps} frames a second`, table.columns, rows, 'youtube.editList', [file.id]);
      return {
        result: { table: out.alias, fps: list.fps, ranges: list.ranges, runtimeFrames: list.runtimeFrames, runtime: clock(Math.floor((list.runtimeFrames * 1000) / list.fps)) },
        tables: [out.record],
      };
    },
  },
  'youtube.chapters': {
    name: 'youtube.chapters', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Drafts chapters from the pauses in the transcript and says whether YouTube will show them. The package may carry these times, and only these.',
    input: { transcript: text('The transcript, such as f1. Defaults to the first transcript on the order.', 12, false) },
    async run(env, input) {
      const { file, cues } = transcriptOf(env, input.transcript);
      const drafted = draftChapters(cues);
      if (!drafted.chapters.length) return { result: { valid: false, chapters: [], problems: ['The transcript is too short to draft chapters from: it needs at least six timed lines.'] } };
      const table = YOUTUBE_TABLES.chapters;
      const rows = drafted.chapters.map(item => ({ At: clock(item.atMs), Label: item.label, Length: clock(item.lengthMs) }));
      const out = computedTable(env, table.name, table.columns, rows, 'youtube.chapters', [file.id]);
      return {
        result: {
          table: out.alias, valid: drafted.valid, chapters: drafted.chapters.map(item => ({ at: clock(item.atMs), label: item.label, length: clock(item.lengthMs), line: item.line })),
          problems: drafted.valid ? [] : chapterProblems(drafted.chapters, cues.at(-1)!.endMs), note: CHAPTER_NOTE,
        },
        tables: [out.record],
      };
    },
  },
  'youtube.retention': {
    name: 'youtube.retention', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Reads a YouTube Studio audience retention export (CSV): how many leave in the opening, the steepest drops with what was said there, and the slide across the middle.',
    input: {
      file: text('The retention export, such as f2.', 12),
      transcript: text('The transcript, such as f1, for what was said at each drop. Defaults to the first transcript on the order.', 12, false),
    },
    async run(env, input) {
      const file = fileOf(env, input.file);
      if (file.format !== 'csv') fail(`${input.file} is not a CSV. Export the retention report from YouTube Studio as CSV.`);
      const spoken = input.transcript !== undefined || env.files.some(item => item.format === 'transcript') ? transcriptOf(env, input.transcript) : null;
      const csv = Buffer.from(file.contentBase64, 'base64').toString('utf8');
      const report = inEngineWords(() => readRetentionExport(csv, { durationMs: spoken?.cues.at(-1)?.endMs ?? null, ...(spoken ? { cues: spoken.cues } : {}) }));
      const table = YOUTUBE_TABLES.retention;
      const rows = report.cliffs.map(cliff => ({ From: cliff.from, To: cliff.to, Lost: cliff.lost, At: cliff.atSeconds === null ? '' : clock(cliff.atSeconds * 1000), Said: cliff.said ?? '' }));
      // A table only when there is a drop to list; the figures are in the result either way, worked out by code.
      const out = rows.length ? computedTable(env, table.name, table.columns, rows, 'youtube.retention', [file.id, ...(spoken ? [spoken.file.id] : [])]) : null;
      return {
        result: { ...(out ? { table: out.alias } : {}), ...report, transcript: spoken ? 'read' : NO_TRANSCRIPT_SAID },
        ...(out ? { tables: [out.record] } : {}),
      };
    },
  },
});

// ---------------------------------------------------------------------------
// What the write step gets from these tools
// ---------------------------------------------------------------------------

type Row = Record<string, string>;
/** The result of the run's newest call to a tool that succeeded, as the run stored it; null when there is none. */
function newestResult(calls: readonly ToolCallRecord[], tool: YoutubeToolName): Record<string, unknown> | null {
  const call = [...calls].reverse().find(item => item.tool === tool && item.outcome === 'succeeded' && item.envelope.ok);
  if (!call || !call.envelope.ok) return null;
  const result = call.envelope.result;
  return result !== null && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
}
/** The rows of a list in a stored result, each with the given string fields, or null when the shape is not that. */
function rowsOf(value: unknown, fields: Readonly<Record<string, string>>): Row[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const rows: Row[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') return null;
    const row: Row = {};
    for (const [column, field] of Object.entries(fields)) {
      const cell = (item as Record<string, unknown>)[field];
      if (typeof cell !== 'string' && typeof cell !== 'number') return null;
      row[column] = String(cell);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * What the write step uses as given: the hooks the scorer kept and the drafted chapters, and nothing else a tool made
 * (no edit list frames, retention drops or transcript text). Their words come from the results the run stored, which
 * passed the untrusted screen before the agent read them, so a result the screen held gives nothing and a cleaned one
 * stays cleaned. The time codes come from the run's own chapters table, which only code wrote, and are allowed only
 * under the package's chapters heading.
 */
export function youtubeWorked(calls: readonly ToolCallRecord[], tables: readonly WorkTableRecord[]): WorkedForWriter {
  const out: Json[] = [];
  const { hooks, chapters } = YOUTUBE_TABLES;
  const kept = newestResult(calls, 'youtube.hooks');
  const keptRows = rowsOf(kept?.kept, { Hook: 'hook', Score: 'score', Band: 'band', Weakest: 'weakest', Fix: 'fix' });
  if (kept && keptRows) out.push({ table: String(kept.table ?? ''), name: hooks.name, columns: [...hooks.columns], rows: keptRows });
  const drafted = newestResult(calls, 'youtube.chapters');
  const chapterRows = rowsOf(drafted?.chapters, { At: 'at', Label: 'label', Length: 'length' });
  if (drafted && chapterRows) out.push({ table: String(drafted.table ?? ''), name: chapters.name, columns: [...chapters.columns], rows: chapterRows });
  const codes = chapterTimesOf(tables);
  const heading = PACKAGE_SECTIONS.find(section => /chapters/i.test(section)) ?? null;
  return { tables: out, times: codes.length && heading ? { heading, codes } : null };
}

/**
 * Ink v2 wave 5: package 5-0's stubs for the YouTube tools wave 5 builds, each answering NOT_BUILT_YET. A package moves its
 * tool into the table above (and its name into that table's type) and deletes its stub line here
 * (delivery/harness/tools-playbooks.ts spreads this table).
 */
type YoutubeW5ToolName = Extract<ToolName, 'youtube.editOps' | 'youtube.clean' | 'youtube.captions' | 'youtube.coverage' | 'youtube.dictionary' | 'youtube.style' | 'youtube.clips' | 'youtube.broll' | 'youtube.beats' | 'youtube.export' | 'youtube.afterPublish' | 'youtube.outliers' | 'youtube.niche' | 'youtube.comments' | 'youtube.publicStats' | 'youtube.archive'>;
export const YOUTUBE_W5_TOOLS: Readonly<Record<YoutubeW5ToolName, Spec>> = Object.freeze({
  'youtube.editOps': notBuiltTool('youtube.editOps', 'compute', 'Typed edits on the transcript\'s word ids, each applied whole or refused with a reason.'), // 5B1
  'youtube.clean': notBuiltTool('youtube.clean', 'compute', 'Silences and fillers to cut, found by code from the word times and the audio.'), // 5B1
  'youtube.captions': notBuiltTool('youtube.captions', 'compute', 'Captions grouped by code from the stored word times, with findings for each cue.'), // 5B1
  'youtube.coverage': notBuiltTool('youtube.coverage', 'compute', 'How much of the script was said, the missing passages and the retakes, worked out by code.'), // 5B1
  'youtube.dictionary': notBuiltTool('youtube.dictionary', 'compute', 'Fixes to names in the transcript, applied only where your names list matches.'), // 5B1
  'youtube.style': notBuiltTool('youtube.style', 'compute', 'The cut rate, shot length, loudness and pace of your own videos, measured by code.'), // 5B2
  'youtube.clips': notBuiltTool('youtube.clips', 'compute', 'Clips that start and end on a sentence and fit the length rules, checked by code.'), // 5B2
  'youtube.broll': notBuiltTool('youtube.broll', 'compute', 'A b-roll plan placed on the words, from owned or licensed footage only.'), // 5B2
  'youtube.beats': notBuiltTool('youtube.beats', 'compute', 'Timecodes for the lines it wrote, set by code at the speaking rate.'), // 5B2
  'youtube.export': notBuiltTool('youtube.export', 'compute', 'The edit list as files your editor opens, written to the order\'s folder.'), // 5B2
  'youtube.afterPublish': notBuiltTool('youtube.afterPublish', 'compute', 'What to change next, from the Studio export, with its receipts.'), // 5B3
  'youtube.outliers': notBuiltTool('youtube.outliers', 'compute', 'The videos that did best against the channel\'s own median, worked out by code.'), // 5B3
  'youtube.niche': notBuiltTool('youtube.niche', 'compute', 'Medians, ages and coverage for a niche report, worked out by code.'), // 5B3
  'youtube.comments': notBuiltTool('youtube.comments', 'compute', 'The comments from an export, sorted into piles with counts first.'), // 5B3
  'youtube.publicStats': notBuiltTool('youtube.publicStats', 'read', 'Public video and channel stats, read with your own API key, counting the quota.'), // 5B3
  'youtube.archive': notBuiltTool('youtube.archive', 'compute', 'Your own past transcripts, searched in short windows. Speech only.'), // 5B3
});
