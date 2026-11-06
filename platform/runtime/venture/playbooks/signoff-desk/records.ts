import type { SignoffBody } from '../../../../contract/venture/playbooks/signoff-desk/records.ts';
export type { SignoffBody } from '../../../../contract/venture/playbooks/signoff-desk/records.ts';
// Chausar playbook: the sign-off desk (wave 6, 6E5). The body of its one record kind, 'venture-signoff', as
// contracts.ts types it (RecordBase<'venture-signoff'> & SignoffBody). Append-only entries: the professional of record
// for a profession (the newest wins), a run's papers put in front of them (one request per digest of the papers),
// the papers sent to them, and their decision. Types only. Written for Chausar.
import type {SignoffProfession} from './professions.ts';


