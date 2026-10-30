// Chausar 5B1 source fingerprint parity. Uses immutable fake uploads and current asset file digests, never client claims.
import { EngineError, type UploadLite, type AssetsView } from './types';
import type { W4DeskHost } from './fake-w4';
export type WordSourceRef = { kind: 'upload' | 'asset'; id: string } | { kind: 'transcript'; orderId: string };
export type WordSourceBinding = { source: WordSourceRef; sourceDigest: string };
const need = (ok: unknown, code: string, words: string) => { if (!ok) throw new EngineError(code, words); };
function current(host: W4DeskHost, orderId: string, source: WordSourceRef): string | null {
  if (source.kind === 'asset') {
    const assets = (host.ask('venture.assets.list', { orderId }) as AssetsView).assets;
    let asset = assets.find(item => item.id === source.id && item.orderId === orderId);
    const seen = new Set<string>();
    while (asset?.supersededBy && !seen.has(asset.id)) { seen.add(asset.id); const next = assets.find(item => item.id === asset!.supersededBy); if (!next || next.state === 'requested') break; asset = next; }
    return asset?.fileDigest ?? null;
  }
  const files = host.ask('venture.files.list', { orderId }) as UploadLite[];
  const file = files.find(item => 'orderId' in item.scope && item.scope.orderId === orderId && (source.kind === 'transcript' ? item.format === 'transcript' && item.scope.kind === 'order' : item.id === source.id));
  return file ? host.uploadFingerprint?.(file.id) ?? null : null;
}
/** Validate the same exact source fields and order ownership as the engine. */
export function bindFakeWordSource(host: W4DeskHost, orderId: string, raw: unknown): WordSourceBinding {
  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const p = raw as Record<string, unknown>;
  need(Object.keys(p).every(key => ['kind', 'id', 'orderId'].includes(key)) && Object.hasOwn(p, 'kind'), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  need(['upload', 'asset', 'transcript'].includes(String(p.kind)), 'WORD_SOURCE_REQUIRED', 'Choose the source file these measured words came from.');
  const keys = p.kind === 'transcript' ? ['kind', 'orderId'] : ['kind', 'id'];
  need(Object.keys(p).length === 2 && keys.every(key => Object.hasOwn(p, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  need(p.kind === 'transcript' ? p.orderId === orderId : typeof p.id === 'string', 'WORD_SOURCE_REQUIRED', 'Choose a source from this order.');
  const source = raw as WordSourceRef, sourceDigest = current(host, orderId, source);
  need(sourceDigest, 'WORD_SOURCE_REQUIRED', 'Choose a current source from this order.');
  return { source: structuredClone(source), sourceDigest: sourceDigest! };
}
/** A new transcript, replaced asset or removed file invalidates its measured words immediately. */
export function requireFakeWordSource(host: W4DeskHost, item: { orderId: string; binding: WordSourceBinding }): void {
  need(item.binding && current(host, item.orderId, item.binding.source) === item.binding.sourceDigest, 'DERIVED_STALE', 'The source changed. Import the measured word times again and choose their source file.');
}
