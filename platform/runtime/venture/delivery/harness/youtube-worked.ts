import type { Json, ToolCallRecord, ToolName, WorkTableRecord } from '../../contracts.ts';
import type { WorkedForWriter } from './loop.ts';
import { chapterTimesOf, YOUTUBE_TABLES } from '../../playbooks/youtube/checks.ts';
import { PACKAGE_SECTIONS } from '../../playbooks/youtube/playbook.ts';

// ---------------------------------------------------------------------------
// What the write step gets from these tools
// ---------------------------------------------------------------------------

type Row = Record<string, string>;
/** The result of the run's newest call to a tool that succeeded, as the run stored it; null when there is none. */
function newestResult(calls: readonly ToolCallRecord[], tool: ToolName): Record<string, unknown> | null {
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
 * What the write step uses as given: the hooks the scorer kept and the drafted chapters, and the screened source analyses and their receipt references, excluding other media intermediates
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
  for(const name of ['youtube.afterPublish','youtube.outliers','youtube.niche','youtube.comments','youtube.archive','youtube.publicStats'] as const){
    const call=[...calls].reverse().find(item=>item.tool===name);
    if(!call||call.outcome!=='succeeded'||!call.envelope.ok)continue;
    const result=call.envelope.result;
    if(!result||typeof result!=='object'||Array.isArray(result)||!Object.hasOwn(result,'analysis')||!Object.hasOwn(result,'figures'))continue;
    out.push({name:'YouTube source analysis',tool:name,...result});
  }
  const codes = chapterTimesOf(tables);
  const heading = PACKAGE_SECTIONS.find(section => /chapters/i.test(section)) ?? null;
  return { tables: out, times: codes.length && heading ? { heading, codes } : null };
}
