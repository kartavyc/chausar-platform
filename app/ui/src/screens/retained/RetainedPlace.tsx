/**
 * RetainedPlace: the composition of the two retained-reader surfaces by address.
 *   ask / saved           RetainedScenario, for the exact trusted host pin, if any
 *   reports / weekahead   LessonReview (the Friday review's proposed lessons)
 *   work / approvals      LessonReview (which lessons become personal guidance)
 * Any other address is not this slice's: the host keeps its existing fallback. The surface
 * starts one fresh read when it is shown at rest and the controller is idle; it owns no data
 * and no transport, and it never lists, persists or recomputes anything.
 *
 * Every read, whether started by an effect or by a Read again press, is fenced by the host's
 * `live` check for this exact address, both before it starts and at every awaited boundary
 * inside the controller: after a same-batch route change, Help, lock or context invalidation
 * an obsolete still-connected control dispatches nothing, and a held reply that returns after
 * an actual hash departure, before React has committed it, publishes nothing. A surface behind
 * an open sheet never revives itself; returning to it at rest requires the fresh read.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Address } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import type { RetainedScenarioView } from '../../host/retained-contracts.ts';
import type { RetainedController } from '../../host/retained-controller.ts';
import { RetainedScenario } from '../ask/RetainedScenario';
import { LessonReviewList, type LessonRowOrigin } from '../reports/LessonReview';

export type RetainedSurface = 'scenario' | 'lessons';

/** Which retained surface an address names, by place and sub-place only. */
export function retainedSurface(address: Address): RetainedSurface | null {
  if (address.place === 'ask' && address.sub === 'saved') return 'scenario';
  if ((address.place === 'reports' && address.sub === 'weekahead') || (address.place === 'work' && address.sub === 'approvals')) return 'lessons';
  return null;
}

export interface RetainedPlaceProps {
  address: Address;
  retained: RetainedController;
  /** The exact pin the trusted mount supplied, unchecked here; null when none was supplied. */
  scenarioSelection: unknown;
  /** Whether this exact address is still the live authorized surface at the moment of a press or an effect. */
  live: (address: Address) => boolean;
  /** Opens the proof behind a figure of the exact rendered view the control belongs to. */
  onProof: (runId: string, origin: HTMLElement | null, view: RetainedScenarioView) => void;
  onProvenance: (origin: HTMLElement | null, view: RetainedScenarioView) => void;
  /** Opens a lesson row: the exact candidate id, the pressed control and the exact rendered list, page and selection it came from. */
  onOpenLesson: (id: string, origin: HTMLElement, from: LessonRowOrigin) => void;
  legacy?: ReactNode;
}

export function RetainedPlace({ address, retained, scenarioSelection, live, onProof, onProvenance, onOpenLesson, legacy }: RetainedPlaceProps) {
  const t = useT();
  const state = useSyncExternalStore(retained.subscribe, retained.snapshot, retained.snapshot);
  const surface = retainedSurface(address);
  const atRest = address.sheet === undefined;
  const selectionSupplied = scenarioSelection !== null && scenarioSelection !== undefined;
  const scenarioIdle = state.scenario.kind === 'idle', lessonsIdle = state.lessons.kind === 'idle';
  useEffect(() => {
    if (surface === 'scenario' && atRest && selectionSupplied && scenarioIdle && live(address)) void retained.openScenario(scenarioSelection, () => live(address));
  }, [surface, atRest, selectionSupplied, scenarioIdle, retained, scenarioSelection, live, address]);
  useEffect(() => {
    if (surface === 'lessons' && atRest && lessonsIdle && live(address)) void retained.readLessons(() => live(address));
  }, [surface, atRest, lessonsIdle, retained, live, address]);

  if (surface === 'scenario') {
    return <RetainedScenario state={state.scenario} selectionSupplied={selectionSupplied}
      onRead={() => { if (selectionSupplied && live(address)) void retained.openScenario(scenarioSelection, () => live(address)); }}
      onProof={onProof} onProvenance={onProvenance} legacy={legacy} />;
  }
  if (surface === 'lessons') {
    const approvals = address.place === 'work';
    return <LessonReviewList state={state.lessons} where={t(approvals ? 'SH-01.place.work' : 'SH-01.place.reports')}
      title={t(approvals ? 'SH-01.sub.work.approvals' : 'SH-01.sub.reports.weekahead')}
      onRead={() => { if (live(address)) void retained.readLessons(() => live(address)); }}
      onOpen={onOpenLesson}
      onPage={(list, from, page) => { if (live(address)) retained.pageLessons(list, from, page); }}
      legacy={legacy} />;
  }
  return null;
}
