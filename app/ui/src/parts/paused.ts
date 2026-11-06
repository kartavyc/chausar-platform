import { createContext, useContext } from 'react';
import type { QueueActionId } from '../engine/types';

/**
 * One-shot C4 task 5: whether the open business is paused (venture.get `paused`), for the cards that would start work.
 * Today provides it; a card or the next best step whose primary starts work locks that primary while it is true. A
 * decision on work already made (approve a draft, send back) stays open.
 */
export const PausedWork = createContext(false);
export const usePausedWork = () => useContext(PausedWork);

/** The primaries that start new work: the engine refuses them while paused (delivery/run-guards.ts refuseNewWork). */
export const STARTS_WORK: ReadonlySet<QueueActionId> = new Set<QueueActionId>(['run-again', 'continue', 'resume']);
