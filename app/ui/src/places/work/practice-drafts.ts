/**
 * One-shot C4 task 17: a rehearsal's practice drafts, for the draft sheet (`draft:practice:<run>:<client>:<episode>`). Memory
 * only, like the rehearsal result on the page: a rehearsal's drafts live on its result, and made-up clients are never kept
 * as work. After a reload the sheet says it isn't here.
 */

import type { CheckLite, EngineClient, EpisodeLite } from '../../engine/types';

export interface PracticeDraft { client: string; text: string; checks: readonly CheckLite[] }

const kept = new WeakMap<EngineClient, Map<string, PracticeDraft>>();

export const practiceDraftId = (runId: string, episode: Pick<EpisodeLite, 'scenarioId' | 'index'>) => `practice:${runId}:${episode.scenarioId}:${episode.index}`;

export function keepPracticeDraft(client: EngineClient, id: string, draft: PracticeDraft): void {
  const drafts = kept.get(client) ?? new Map<string, PracticeDraft>();
  drafts.set(id, draft);
  kept.set(client, drafts);
}

export function practiceDraft(client: EngineClient, id: string): PracticeDraft | undefined {
  return kept.get(client)?.get(id);
}
