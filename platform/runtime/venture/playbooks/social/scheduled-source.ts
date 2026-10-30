// Chausar scheduled post source snapshot, S12. Code hashes actual source bytes and handed-over files.
import type { State } from '../../../contracts.ts';
import { digest, findRecord, listRecords } from '../../records.ts';
import { fileSha, manifestOf } from '../../delivery/file-manifest.ts';
import { sourceDigest } from '../kit/fingerprint.ts';
export function scheduledFilesDigest(state: State, draftId: string): string | null {
    const run = findRecord(state, 'venture-delivery-run', draftId);
    if (!run)
        return null;
    const sources: Record<string, string | null> = {};
    for (const upload of listRecords(state, 'venture-upload', run.ventureId).filter(file => 'orderId' in file.scope && file.scope.orderId === run.orderId))
        sources[upload.id] = fileSha(state, run.ventureId, upload.id);
    for (const asset of listRecords(state, 'venture-asset', run.ventureId).filter(file => file.orderId === run.orderId))
        sources[asset.id] = sourceDigest(state, { kind: 'asset', id: asset.id });
    return digest({ files: manifestOf(state, run), sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) });
}
