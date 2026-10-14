/**
 * Recorded route transcripts: per route kind, per open-bench case and language, the exact wire
 * response the gateway parses. A list replays one entry per run (run n uses entry n mod length).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError, check } from '../../contracts.ts';
import { BENCH_LANGUAGES, OPEN_BENCH, OPEN_BENCH_DIGEST, type BenchLanguage } from './open-bench.ts';

export const BENCH_ROUTE_KINDS = ['codex-cli', 'claude-cli', 'openai-responses', 'anthropic-messages', 'openai-compatible', 'ollama', 'managed', 'subq-snap'] as const;
export type BenchRouteKind = typeof BENCH_ROUTE_KINDS[number];
export const CLI_KINDS: readonly BenchRouteKind[] = ['codex-cli', 'claude-cli'];

/** HTTP routes: status and body. CLI routes: exit code and stdout (codex events are one JSON line each). */
export type WireEntry = { status: number; body: unknown } | { exitCode: number; stdout: unknown };
export type TranscriptFile = {
  schema: 'chausar.route-transcripts.v1'; recorded: 'synthetic' | 'live'; routeKind: BenchRouteKind; model: string;
  benchVersion: number; benchDigest: string; note: string; recordedAt: string;
  cases: Record<string, Record<BenchLanguage, WireEntry | WireEntry[]>>;
};

export const DEFAULT_TRANSCRIPTS = new URL('./transcripts/', import.meta.url);

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
function validEntry(entry: unknown, cli: boolean): entry is WireEntry {
  if (!record(entry)) return false;
  const keys = Object.keys(entry).sort().join(',');
  return cli ? keys === 'exitCode,stdout' && Number.isInteger(entry.exitCode) : keys === 'body,status' && Number.isInteger(entry.status);
}

export function validateTranscripts(value: unknown, kind: BenchRouteKind): TranscriptFile {
  check(record(value) && value.schema === 'chausar.route-transcripts.v1' && value.routeKind === kind && ['synthetic', 'live'].includes(value.recorded)
    && typeof value.model === 'string' && typeof value.note === 'string' && typeof value.recordedAt === 'string' && record(value.cases),
  'BENCH_TRANSCRIPTS_INVALID', 'A recorded transcript file has the wrong form.');
  check(value.benchVersion === OPEN_BENCH.version && value.benchDigest === OPEN_BENCH_DIGEST, 'BENCH_TRANSCRIPTS_STALE', 'A recorded transcript file was made for a different open bench.');
  const ids = OPEN_BENCH.cases.map(c => c.id), cli = CLI_KINDS.includes(kind);
  check(Object.keys(value.cases).length === ids.length && ids.every(id => record(value.cases[id])
    && Object.keys(value.cases[id]).sort().join(',') === 'en,hi'
    && BENCH_LANGUAGES.every(language => {
      const entry = value.cases[id][language];
      return Array.isArray(entry) ? entry.length >= 1 && entry.length <= 5 && entry.every(item => validEntry(item, cli)) : validEntry(entry, cli);
    })), 'BENCH_TRANSCRIPTS_INVALID', 'A recorded transcript file must hold one response per case and language.');
  return value as TranscriptFile;
}

export async function loadTranscripts(kind: BenchRouteKind, directory: URL | string = DEFAULT_TRANSCRIPTS): Promise<TranscriptFile> {
  const path = typeof directory === 'string' ? join(directory, `${kind}.json`) : new URL(`${kind}.json`, directory);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { throw new ChausarError('BENCH_TRANSCRIPTS_MISSING', 'A recorded transcript file for this route is missing.'); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  return validateTranscripts(parsed, kind);
}

export function entryFor(file: TranscriptFile, caseId: string, language: BenchLanguage, run: number): WireEntry {
  const entry = file.cases[caseId][language];
  return Array.isArray(entry) ? entry[(run - 1) % entry.length] : entry;
}

/** The exact bytes the transport returns: strings verbatim, codex events as JSON lines, other values as JSON. */
export function wireText(kind: BenchRouteKind, entry: WireEntry): string {
  const value = 'body' in entry ? entry.body : entry.stdout;
  if (typeof value === 'string') return value;
  if (kind === 'codex-cli' && Array.isArray(value)) return value.map(event => JSON.stringify(event)).join('\n');
  return JSON.stringify(value);
}

function parsed(text: string): any { try { return JSON.parse(text); } catch { return undefined; } }

/** Model-written text in a response, for the number guard. Never throws; provider metadata is excluded. */
export function modelText(kind: BenchRouteKind, entry: WireEntry): string {
  const text = wireText(kind, entry);
  if (kind === 'codex-cli') return text.split(/\r?\n/).map(parsed).filter(event => event?.item?.type === 'agent_message' && typeof event.item.text === 'string').map(event => event.item.text).join('\n');
  const data = parsed(text);
  if (!record(data)) return text;
  if (kind === 'claude-cli') return data.structured_output !== undefined ? JSON.stringify(data.structured_output) : String(data.result ?? '');
  if (kind === 'ollama') return String(data.message?.content ?? data.response ?? '');
  if (kind === 'openai-compatible') return String(data.choices?.[0]?.message?.content ?? '');
  if (kind === 'anthropic-messages') return Array.isArray(data.content) ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text)).join('') : '';
  if (kind === 'subq-snap') return Object.values(record(data.answers) ? data.answers : {}).map((a: any) => String(a?.choice ?? '')).join(' ');
  if (Array.isArray(data.output)) return data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((chunk: any) => String(chunk?.text ?? chunk?.refusal ?? '')).join('');
  return String(data.output_text ?? '');
}

/** Provider-reported token usage, in the field names each wire format uses. */
export function recordedUsage(kind: BenchRouteKind, entry: WireEntry): { input: number; output: number } | null {
  const text = wireText(kind, entry);
  const usage = kind === 'codex-cli' ? text.split(/\r?\n/).map(parsed).find(event => event?.type === 'turn.completed')?.usage : parsed(text);
  const data = kind === 'codex-cli' ? { usage } : usage;
  if (!record(data)) return null;
  const pair = kind === 'ollama' ? [data.prompt_eval_count, data.eval_count]
    : kind === 'openai-compatible' ? [data.usage?.prompt_tokens, data.usage?.completion_tokens]
    : [data.usage?.input_tokens, kind === 'subq-snap' ? data.usage?.output_tokens ?? 0 : data.usage?.output_tokens];
  return pair.every(n => Number.isSafeInteger(n) && n >= 0) ? { input: pair[0], output: pair[1] } : null;
}
