// Follow explicit source-thread identity, including source words that omit a candidate name.
import type {VentureTx} from '../../records.ts';
import type {RecruitCandidateBody} from './records.ts';
import {threadIdOf} from '../../build/mail-in.ts';
export function recruitSourceMail(tx:VentureTx,candidates:readonly RecruitCandidateBody[]){const threads=new Set(candidates.filter(c=>c.source.kind==='mail').map(c=>c.source.id));return tx.list('venture-inbound').filter(m=>m.source==='file-import'&&threads.has(threadIdOf(tx.state,tx.venture!,m.id)));}
