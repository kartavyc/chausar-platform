// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): accept detection for connection notes, without
// scraping (catalogue C8). When the owner imports their own LinkedIn Connections export again, a person on it whose
// Connected On day is on or after the day the owner sent them a connection note marks that note accepted, and the
// note's card shows the line. That is the only thing Chausar learns about LinkedIn activity; nothing else is read.
import type { State } from '../../contracts.ts';
import type { DateOrder, IsoDate, NetworkImportRecord, OutreachRecord, PipelineCardView, VentureRecord } from '../contracts.ts';
import { listRecords, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { shortDay } from './followups.ts';

/** 'Sameer Kulkarni accepted your connection note on LinkedIn, 16 Oct.' */
export function acceptedLine(name: string, on: IsoDate, order: DateOrder): string {
  return `${name} accepted your connection note on LinkedIn, ${shortDay(on, order)}.`;
}

/**
 * After an import (network/import.ts, one line): when it is a LinkedIn Connections export, marks every sent connection
 * note accepted whose person this import shows connected on or after the day it was sent. Announces each card it
 * touched (ids only). Answers how many notes it marked.
 */
export function markAcceptedNotes(tx: VentureTx, record: NetworkImportRecord): number {
  const venture = tx.venture;
  if (record.importKind !== 'linkedin-connections' || !venture?.country) return 0;
  let marked = 0;
  for (const draft of tx.list('venture-outreach')) {
    if (draft.outreachKind !== 'connection-note' || !draft.sent || draft.acceptedOn || !draft.personId) continue;
    const person = tx.find('venture-person', draft.personId);
    const sentOn = localDayAt(draft.sent.at, venture.country);
    const fact = person?.facts.find(item => item.kind === 'connection' && item.source.importId === record.id && item.date !== null && item.date >= sentOn);
    if (!fact) continue;
    tx.replace<OutreachRecord>({ ...draft, acceptedOn: fact.date, acceptedBy: record.id });
    marked += 1;
    tx.emit('pipeline.changed', { id: draft.opportunityId ?? draft.id });
  }
  return marked;
}

/**
 * When one import is undone (network/import.ts, one line): the connection notes only its export showed accepted are
 * not accepted any more. Answers how many it cleared.
 */
export function clearAcceptedNotes(tx: VentureTx, record: NetworkImportRecord): number {
  let cleared = 0;
  for (const draft of tx.list('venture-outreach')) {
    if (draft.acceptedBy !== record.id) continue;
    tx.replace<OutreachRecord>({ ...draft, acceptedOn: null, acceptedBy: null });
    cleared += 1;
    tx.emit('pipeline.changed', { id: draft.opportunityId ?? draft.id });
  }
  return cleared;
}

/** The accepted lines of a card's connection notes, for its timeline (4E1's card view reads them). */
export function acceptedTimeline(state: State, venture: VentureRecord, card: { stored: { id: string } | null; name: string }): PipelineCardView['timeline'] {
  if (!card.stored) return [];
  return listRecords(state, 'venture-outreach', venture.id)
    .filter(draft => draft.opportunityId === card.stored!.id && draft.outreachKind === 'connection-note' && draft.acceptedOn)
    .map(draft => ({ what: 'accepted' as const, at: draft.acceptedOn!, line: acceptedLine(card.name, draft.acceptedOn!, venture.country?.dateOrder ?? 'year-month-day'), estimated: false }));
}
