// Chausar 5B1 word-source binding over5A4 fingerprints. BaoCut (source available), concept only; original code.
import { check, type State } from '../../../contracts.ts';
import { exactPayload, findRecord, listRecords } from '../../records.ts';
import { sourceDigest, requireFresh } from '../kit/fingerprint.ts';
import type { SourceRef } from '../kit/records-media.ts';
import type { YoutubeEditBody } from './records.ts';

/** Bind measured words to a source in this order, using the kit's actual live file fingerprint. */
export function bindWordSource(state: State, ventureId: string, orderId: string, raw: unknown) {
  const p = exactPayload(raw, ['kind', 'id', 'orderId'], ['kind']);
  check(p.kind === 'upload' || p.kind === 'asset' || p.kind === 'transcript', 'WORD_SOURCE_REQUIRED', 'Choose the source file these measured words came from.');
  let source: SourceRef;
  if (p.kind === 'transcript') {
    exactPayload(raw, ['kind', 'orderId'], ['kind', 'orderId']);
    check(p.orderId === orderId, 'WORD_SOURCE_REQUIRED', 'Choose a source from this order.');
    source = { kind: 'transcript', orderId };
    check(listRecords(state, 'venture-upload', ventureId).some(file => file.format === 'transcript' && file.scope.kind === 'order' && file.scope.orderId === orderId), 'WORD_SOURCE_REQUIRED', 'Add the source transcript to this order first.');
  } else {
    exactPayload(raw, ['kind', 'id'], ['kind', 'id']);
    check(typeof p.id === 'string', 'WORD_SOURCE_REQUIRED', 'Choose the source file these measured words came from.');
    const file = p.kind === 'asset' ? findRecord(state, 'venture-asset', p.id) : findRecord(state, 'venture-upload', p.id);
    check(file && file.ventureId === ventureId && ('orderId' in file ? file.orderId === orderId : 'orderId' in file.scope && file.scope.orderId === orderId), 'WORD_SOURCE_REQUIRED', 'Choose a source from this order.');
    source = { kind: p.kind, id: p.id };
  }
  const current = sourceDigest(state, source);
  check(current, 'WORD_SOURCE_REQUIRED', 'The source file is not ready. Choose a current file.');
  return { source, sourceDigest: current };
}

/** Old unbound imports and changed or removed source files cannot supply fresh captions or edits. */
export function requireCurrentWordSource(state: State, edit: Pick<YoutubeEditBody, 'binding'>): void {
  check(edit.binding, 'DERIVED_STALE', 'Import the measured word times again and choose their source file.');
  requireFresh(state, { derived: { unit: 'captions', ...edit.binding } });
}
