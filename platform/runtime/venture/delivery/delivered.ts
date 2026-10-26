// Chausar delivery (Ink v2 wave 4, package 4J3, catalogue A17): the Delivered card at the end of an accepted run. It
// lists what the run handed over, made by its own tools, each with its digest: the tables its succeeded tool calls made
// and what the owner's own command-line tool left for it. Apart from those, it lists the files on the order that
// changed while the run went on (a file added to the order, a transcript or a still made on this computer), labelled
// "Changed during this run, not proven to be the agent's": the run did not make them, and nothing proves it used them.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { DeliveredFile, DeliveredView, DeliveryRunRecord, IsoTime, UploadRecord, VentureRecord } from '../contracts.ts';
import { TOOL_PURPOSE } from './harness/tool-purpose.ts';
import { DELEGATE_LABELS } from './harness/delegate.ts';

export const CHANGED_DURING_RUN = "Changed during this run, not proven to be the agent's.";
const DRAFT_ONLY = 'Handed over the draft only: its tools made no files.';
/** The verdicts that hand a draft over: accepted as it is, or accepted in the owner's edited version. */
const HANDED_OVER: readonly DeliveryRunRecord['status'][] = ['accepted', 'edited'];

/** Where a changed file came from, in a code the screen words for itself, and the engine's words for it. */
function changedSource(upload: UploadRecord): Pick<DeliveredFile, 'source' | 'line'> {
  if (upload.origin === 'poster' || upload.scope.kind === 'poster') return { source: 'poster', line: 'A still from the cut' };
  if (upload.origin === 'local-transcription') return { source: 'transcript', line: 'A transcript made on this computer' };
  return { source: 'order-file', line: 'A file added to the order' };
}

/** The files the run's own tools made: tables from its succeeded calls, in call order, then what a delegated tool left. */
function handedOver(state: State, venture: VentureRecord, run: DeliveryRunRecord): DeliveredFile[] {
  const files: DeliveredFile[] = [];
  const tables = new Map(listRecords(state, 'venture-work-table', venture.id)
    .filter(table => table.runRef.kind === 'delivery' && table.runRef.runId === run.id).map(table => [table.id, table]));
  const seen = new Set<string>();
  for (const call of run.harness?.toolCalls ?? []) {
    if (call.outcome !== 'succeeded' || !call.envelope.ok) continue;
    for (const id of call.tableIds) {
      const table = tables.get(id);
      if (!table || seen.has(id)) continue;
      seen.add(id);
      files.push({ id: table.id, name: table.name, digest: table.digest, at: table.at, source: 'table', line: TOOL_PURPOSE[call.tool] ?? 'Made by a tool' });
    }
  }
  for (const delegated of listRecords(state, 'venture-delegate-run', venture.id).filter(item => item.runId === run.id && item.outcome === 'succeeded')) {
    delegated.outputs.forEach((output, index) => files.push({
      id: `${delegated.id}:${index + 1}`, name: output.name, digest: output.digest, at: delegated.at, source: 'delegate', line: `What ${DELEGATE_LABELS[delegated.cli]} left`,
    }));
  }
  return files;
}

/**
 * The files on the run's order that changed between its start and its verdict and are not the run's own inputs: added
 * to the order, a transcript or a still made here. Oldest first.
 */
function changedDuring(state: State, venture: VentureRecord, run: DeliveryRunRecord, end: IsoTime): DeliveredFile[] {
  const inputs = new Set([...(run.uploadIds ?? []), ...(run.harness?.uploadIds ?? [])]);
  return listRecords(state, 'venture-upload', venture.id)
    .filter(upload => (upload.scope.kind === 'order' || upload.scope.kind === 'poster') && upload.scope.orderId === run.orderId)
    .filter(upload => !inputs.has(upload.id) && upload.at > run.at && upload.at <= end)
    .map((upload, index) => ({ upload, index }))
    .sort((a, b) => a.upload.at.localeCompare(b.upload.at) || a.index - b.index)
    .map(({ upload }) => ({ id: upload.id, name: upload.name, digest: upload.digest, at: upload.at, ...changedSource(upload) }));
}

/** The Delivered card of a run, or null for a run whose draft was not handed over (accepted or edited). */
export function deliveredOf(state: State, venture: VentureRecord, run: DeliveryRunRecord): DeliveredView | null {
  if (!HANDED_OVER.includes(run.status) || run.practice) return null;
  const end = run.verdict?.at ?? run.readyAt ?? run.at;
  const files = handedOver(state, venture, run);
  const changed = changedDuring(state, venture, run, end);
  return {
    line: files.length ? `Handed over ${files.length === 1 ? '1 file' : `${files.length} files`}.` : DRAFT_ONLY,
    files, changed, changedLine: changed.length ? CHANGED_DURING_RUN : null,
  };
}
