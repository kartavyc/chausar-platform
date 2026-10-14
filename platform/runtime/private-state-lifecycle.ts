import { hash, newId, type State } from './contracts.ts';
import type { ScenarioRecord } from './scenario-contracts.ts';
import type { LessonEpisode, LessonRecord } from './lesson-contracts.ts';
import type { CalculationReceipt } from './calculator.ts';

const coreStores = ['facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning',
  'conversations', 'modelReceipts', 'conflicts', 'merges'] as const;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const expiredDate = (value: unknown, cutoff: number, optional = false) => optional && value === undefined ? false
  : typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) < cutoff;
function addSources(output: Set<string>, ids: readonly string[] | undefined) { for (const id of ids ?? []) if (text(id)) output.add(id); }
function scenarioSources(record: ScenarioRecord): Set<string> {
  const result = new Set<string>();
  // Imported fields, retained input, labels and authority metadata never establish source roots.
  for (const evidence of record.evidence) {
    for (const fact of evidence.state.facts) if (text(fact.sourceId)) result.add(fact.sourceId);
    for (const imported of evidence.state.imports) if (text(imported.sourceId)) result.add(imported.sourceId);
  }
  for (const revision of record.revisions) for (const job of revision.jobs) {
    addSources(result, job.request.sourceIds); addSources(result, job.authoredRequest.sourceIds);
  }
  for (const output of record.results) {
    addSources(result, output.receipt.sourceIds); addSources(result, output.receipt.requestedSourceIds);
    for (const row of output.receipt.rows) if (text(row.sourceId)) result.add(row.sourceId);
  }
  return result;
}
function episodeSources(episode: LessonEpisode): Set<string> {
  const result = new Set<string>(); addSources(result, episode.evidence.pin.sourceIds);
  for (const marking of episode.evidence.sourceMarkings) if (text(marking.sourceId)) result.add(marking.sourceId);
  return result;
}
function lessonSources(record: LessonRecord): Set<string> {
  const result = new Set<string>();
  for (const candidate of record.revisions) {
    addSources(result, candidate.applicability.sourceIds);
    for (const evidence of candidate.evidence) {
      addSources(result, evidence.pin.sourceIds);
      for (const marking of evidence.sourceMarkings) if (text(marking.sourceId)) result.add(marking.sourceId);
    }
  }
  for (const event of record.events) if (event.binding) {
    addSources(result, event.binding.open.sourceIds); addSources(result, event.binding.hidden.sourceIds);
  }
  return result;
}
function intersects(left: Iterable<string>, right: ReadonlySet<string>) { for (const id of left) if (right.has(id)) return true; return false; }

/** Explicit typed private roots; arbitrary labels or lesson change values do not establish a source. */
export function privateSourceIds(state: State): string[] {
  const result = new Set<string>();
  for (const record of state.scenarioRecords ?? []) for (const id of scenarioSources(record)) result.add(id);
  for (const episode of state.lessonState?.episodes ?? []) for (const id of episodeSources(episode)) result.add(id);
  for (const lesson of state.lessonState?.lessons ?? []) for (const id of lessonSources(lesson)) result.add(id);
  return [...result].sort();
}
export function privateSourceExists(state: State, sourceId: string): boolean { return privateSourceIds(state).includes(sourceId); }
export function coreLifecycleIds(state: State): Set<string> {
  const result = new Set<string>();
  for (const key of coreStores) for (const record of state[key]) if (text(record.id)) result.add(record.id);
  return result;
}
function scenarioArtifactIds(record: ScenarioRecord): string[] {
  return [record.id, ...record.revisions.flatMap(revision => [revision.id, ...revision.jobs.map(job => job.id), ...revision.branches.map(branch => branch.id)]),
    ...record.runs.map(run => run.id), ...record.results.map(result => result.receipt.id), ...record.comparisons.map(comparison => comparison.id)];
}
function receiptReferences(receipt: CalculationReceipt, ids: ReadonlySet<string>): boolean {
  return ids.has(receipt.id) || intersects(receipt.rowIds, ids) || receipt.rows.some(row => ids.has(row.factId))
    || receipt.exclusions.some(exclusion => ids.has(exclusion.rowId)) || intersects(receipt.coverage.importIds, ids)
    || Boolean(receipt.restatement && (ids.has(receipt.restatement.originalAnswerId) || ids.has(receipt.restatement.originalReceiptId)));
}
function scenarioReferences(record: ScenarioRecord, ids: ReadonlySet<string>): boolean {
  // The full retained snapshot is private custody: deletion of any actual retained core record purges it.
  return record.evidence.some(evidence => intersects(coreLifecycleIds(evidence.state), ids)
    || evidence.state.imports.some(imported => Array.isArray(imported.rowIds) && intersects(imported.rowIds, ids)))
    || record.results.some(result => receiptReferences(result.receipt, ids));
}
function scenarioExpired(record: ScenarioRecord, cutoff: number): boolean {
  if (record.revisions.some(revision => expiredDate(revision.createdAt, cutoff))
    || record.runs.some(run => expiredDate(run.createdAt, cutoff))
    || record.comparisons.some(comparison => expiredDate(comparison.createdAt, cutoff))
    || record.results.some(result => expiredDate(result.receipt.createdAt, cutoff))) return true;
  return record.evidence.some(evidence => expiredDate(evidence.knowledgeCut, cutoff)
    || evidence.state.facts.some(fact => expiredDate(fact.learnedAt, cutoff))
    || evidence.state.imports.some(imported => expiredDate(imported.at, cutoff, true))
    || coreStores.some(key => key !== 'facts' && key !== 'imports' && evidence.state[key].some(item => expiredDate(
      item.learnedAt !== undefined ? item.learnedAt : item.createdAt !== undefined ? item.createdAt : item.at, cutoff, true))));
}
function episodeExpired(episode: LessonEpisode, cutoff: number) { return expiredDate(episode.recordedAt, cutoff); }
function lessonExpired(record: LessonRecord, cutoff: number) {
  return record.revisions.some(candidate => expiredDate(candidate.proposedAt, cutoff)) || record.events.some(event => expiredDate(event.at, cutoff));
}

export type PrivateStatePurge = { sourceIds?: Iterable<string>; removedIds?: Iterable<string>; expiredFactIds?: Iterable<string>; cutoff?: number; at: string };
/** Remove complete immutable derivatives in the caller's existing transaction, never redact/reseal their records. */
export type PrivateStatePurgeHook = (state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; at: string; cutoff?: number }) => number;
const purgeHooks = new Set<PrivateStatePurgeHook>();
/** Engine modules register their namespace purge here (late-bound to avoid import cycles). */
export function registerPrivateStatePurgeHook(hook: PrivateStatePurgeHook): void { purgeHooks.add(hook); }
export function purgePrivateState(state: State, reason: PrivateStatePurge): number {
  const sourceIds = [...(reason.sourceIds ?? [])], removedIds = new Set(reason.removedIds ?? []);
  let removed = purgeCorePrivateState(state, { ...reason, sourceIds, removedIds });
  for (const hook of purgeHooks) removed += hook(state, { sourceIds, removedIds, at: reason.at, ...(reason.cutoff === undefined ? {} : { cutoff: reason.cutoff }) });
  return removed;
}
function purgeCorePrivateState(state: State, reason: PrivateStatePurge): number {
  const sources = new Set(reason.sourceIds ?? []), removedIds = new Set(reason.removedIds ?? []), facts = new Set(reason.expiredFactIds ?? []);
  let removed = 0;
  function tombstone(kind: 'scenario' | 'lesson' | 'lesson-episode', record: { id: string; digest?: string }) {
    state.tombstones.push({ id: newId('tombstone'), kind: reason.cutoff === undefined ? 'private-lineage' : 'retention',
      privateKind: kind, recordId: record.id, digest: record.digest || hash(record), deletedAt: reason.at });
    removedIds.add(record.id); removed++;
  }
  if (state.scenarioRecords) state.scenarioRecords = state.scenarioRecords.filter(record => {
    const affected = intersects(scenarioSources(record), sources) || scenarioReferences(record, removedIds)
      || record.evidence.some(evidence => evidence.state.facts.some(fact => facts.has(fact.id)))
      || reason.cutoff !== undefined && scenarioExpired(record, reason.cutoff);
    if (affected) { for (const id of scenarioArtifactIds(record)) removedIds.add(id); tombstone('scenario', record); }
    return !affected;
  });
  const lessons = state.lessonState;
  if (!lessons) return removed;
  let changed = true;
  while (changed) {
    changed = false;
    lessons.episodes = lessons.episodes.filter(episode => {
      const affected = intersects(episodeSources(episode), sources) || removedIds.has(episode.id) || removedIds.has(episode.evidence.pin.id)
        || reason.cutoff !== undefined && episodeExpired(episode, reason.cutoff);
      if (affected) { tombstone('lesson-episode', episode); changed = true; }
      return !affected;
    });
    lessons.lessons = lessons.lessons.filter(record => {
      const affected = intersects(lessonSources(record), sources)
        || record.revisions.some(candidate => candidate.evidence.some(evidence => removedIds.has(evidence.pin.id)) || intersects(candidate.episodeIds, removedIds)
          || candidate.supersedes && removedIds.has(candidate.supersedes.id))
        || record.events.some(event => event.successor && removedIds.has(event.successor.id))
        || reason.cutoff !== undefined && lessonExpired(record, reason.cutoff);
      if (affected) {
        for (const candidate of record.revisions) for (const episodeId of candidate.episodeIds) removedIds.add(episodeId);
        tombstone('lesson', record); changed = true;
      }
      return !affected;
    });
  }
  return removed;
}
