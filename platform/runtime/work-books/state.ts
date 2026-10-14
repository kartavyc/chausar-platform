/**
 * The work-books lane's private namespace inside workspace state.
 *
 * One namespace (`state.extensions['work-books']`) holds two sections: `work` (approvals,
 * actions, jobs and the catalogue) and `books` (sources, meanings, accounts, records,
 * history and memory). Each section is created on first use and is owned by its file.
 */
import type { State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';

export const LANE_ID = 'work-books';
type Namespace = Record<string, unknown>;

export function section<T>(state: State, name: 'work' | 'books', init: () => T): T {
  const ns = moduleState<Namespace>(state, LANE_ID, () => ({}));
  if (!Object.hasOwn(ns, name)) ns[name] = init();
  return ns[name] as T;
}

export function peekSection<T>(state: State, name: 'work' | 'books'): T | undefined {
  const ns = peekModuleState<Namespace>(state, LANE_ID);
  return ns && Object.hasOwn(ns, name) ? ns[name] as T : undefined;
}
