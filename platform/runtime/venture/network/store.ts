// Chausar venture launcher, network (Ink v2 wave 4, package 4-0): the reads of the owner's people that the network
// packages share (4D1 to 4E3), so they can run side by side. Reads only; people are written by network/import.ts.
import type { State } from '../../contracts.ts';
import type { PersonRecord } from '../contracts.ts';
import { findRecord, listRecords } from '../records.ts';

/** One person by id, or null. Hidden people are returned too; the views decide what to show. */
export function personById(state: State, id: string): PersonRecord | null {
  return findRecord(state, 'venture-person', id) ?? null;
}

/** Every person of one business, oldest first, hidden ones included. */
export function listPeople(state: State, ventureId: string): PersonRecord[] {
  return listRecords(state, 'venture-person', ventureId);
}
