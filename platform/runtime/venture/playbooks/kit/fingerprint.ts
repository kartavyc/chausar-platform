// Chausar playbook kit: stale by fingerprint (Ink v2 wave 5, package 5A4; catalogue P10). A derived unit (captions, a
// translation, a dub, an article, a chapter list) is an asset that keeps the digest of the file it was made from. When
// that file changes, or is gone, the unit is stale: it is never delivered (DERIVED_STALE) and never reused silently.
// Code compares digests; nothing here reads the words.
//
// The idea is learned from BaoCut packages/jobs/src/pipelines/dub.ts and translation-document.ts (source-available,
// learn only): no code from it.
import { createHash } from 'node:crypto';
import { check, type State } from '../../../contracts.ts';
import { listRecords } from '../../records.ts';
import type { AssetRecord } from '../../contracts.ts';
import type { DerivedUnit, SourceRef } from './records-media.ts';

/** The sha256 of a file's bytes or a text's UTF-8, in hex: the fingerprint a derived unit keeps of its source. */
export function fingerprint(content: string | Uint8Array): string {
  return createHash('sha256').update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content).digest('hex');
}

/**
 * The source's fingerprint now, or null when it is gone: an upload's stored digest; another asset's file digest,
 * following Rerun to its newest version; an order's transcript, the newest transcript file on that order.
 */
export function sourceDigest(state: State, ref: SourceRef): string | null {
  if (ref.kind === 'upload') return listRecords(state, 'venture-upload').find(upload => upload.id === ref.id)?.digest ?? null;
  if (ref.kind === 'transcript') {
    const transcripts = listRecords(state, 'venture-upload')
      .filter(upload => upload.format === 'transcript' && upload.scope.kind === 'order' && upload.scope.orderId === ref.orderId);
    return transcripts.at(-1)?.digest ?? null;
  }
  const assets = listRecords(state, 'venture-asset');
  let asset = assets.find(item => item.id === ref.id);
  const seen = new Set<string>();
  while (asset?.supersededBy && !seen.has(asset.id)) {
    seen.add(asset.id);
    const next = assets.find(item => item.id === asset!.supersededBy);
    if (!next || next.state === 'requested') break;
    asset = next;
  }
  return asset?.fileDigest ?? null;
}

const UNIT_WORDS: Readonly<Record<DerivedUnit, string>> = Object.freeze({
  narration: 'this narration', captions: 'these captions', translation: 'this translation', dub: 'this dub', article: 'this article', chapters: 'this chapter list',
});
const SOURCE_WORDS: Readonly<Record<SourceRef['kind'], string>> = Object.freeze({ transcript: 'The transcript', upload: 'The file', asset: 'The file' });

/** Whether a derived unit is stale: its source changed since, or is gone. A unit made from nothing derived is never stale. */
export function isStale(state: State, asset: Pick<AssetRecord, 'derived'>): boolean {
  if (!asset.derived) return false;
  const now = sourceDigest(state, asset.derived.source);
  return now === null || now !== asset.derived.sourceDigest;
}

/** Why a stale unit cannot go out, in plain words: "The transcript changed after these captions were made. Make them again." */
export function staleLine(state: State, asset: Pick<AssetRecord, 'derived'>): string {
  const derived = asset.derived!;
  const unit = UNIT_WORDS[derived.unit];
  const source = SOURCE_WORDS[derived.source.kind];
  const plural = derived.unit === 'captions';
  const were = plural ? 'were' : 'was', them = plural ? 'them' : 'it';
  return sourceDigest(state, derived.source) === null
    ? `${source} ${unit} ${were} made from is gone. Make ${them} again.`
    : `${source} changed after ${unit} ${were} made. Make ${them} again.`;
}

export type StaleUnit = { assetId: string; name: string; unit: DerivedUnit; stale: boolean; line: string | null };

/** Every derived unit on an order that is in use (not superseded), each marked stale or not, with why. */
export function staleUnits(state: State, orderId: string): StaleUnit[] {
  return listRecords(state, 'venture-asset')
    .filter(asset => asset.orderId === orderId && asset.derived && asset.supersededBy === null && asset.state !== 'requested')
    .map(asset => {
      const stale = isStale(state, asset);
      return { assetId: asset.id, name: asset.name, unit: asset.derived!.unit, stale, line: stale ? staleLine(state, asset) : null };
    });
}

/** Refuses a stale derived unit with DERIVED_STALE and the reason; a fresh one, or one derived from nothing, passes. */
export function requireFresh(state: State, asset: Pick<AssetRecord, 'derived'>): void {
  check(!isStale(state, asset), 'DERIVED_STALE', asset.derived ? staleLine(state, asset) : '');
}
