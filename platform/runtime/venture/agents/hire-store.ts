// C7 task 14: a hired agent's record, read here so the team, the chats and the routines can know it without the interview.
import type { State } from '../../contracts.ts';
import type { DepartmentId, IsoTime, PersonaFields, RecordBase } from '../contracts.ts';
import { listRecords } from '../records.ts';

export type HirePhase = 'role' | 'reads' | 'voice' | 'review';
export type HireReadChoice = { read: import('./hire-check.ts').HireRead; why: string };
/** One hire: the owner's sentence, each phase's answer, and whether it became an agent. The record's id is the agent's id. */
export type HireRecord = RecordBase<'venture-agent-hire'> & {
  sentence: string;
  phase: HirePhase;
  status: 'drafting' | 'hired' | 'cancelled';
  role: { name: string; job: string; duties: string[] } | null;
  reads: HireReadChoice[];
  voice: PersonaFields | null;
  department: DepartmentId;
  digest: string;
  hiredAt: IsoTime | null;
};

/** The agents the owner hired, oldest first, retired ones too (the team's and the routines' lists leave those out). */
export function hiredRecords(state: State, ventureId: string): HireRecord[] {
  return listRecords(state, 'venture-agent-hire', ventureId).filter(record => record.status === 'hired');
}

export function hiredRecord(state: State, ventureId: string, id: string): HireRecord | null {
  return hiredRecords(state, ventureId).find(record => record.id === id) ?? null;
}
