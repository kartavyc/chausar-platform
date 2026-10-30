// Chausar 5B2 measured channel style, from the owner's own local reference files only.
import { check } from '../../../contracts.ts';
import type { VentureDeps, YoutubeStyleRecord } from '../../contracts.ts';
import type { DeskHandler } from '../desk-types.ts';
import { digest, exactPayload, findRecord, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { boardEdit, domainError } from './board-desk.ts';
import { measureLocalStyle, mediaHash } from './local-media.ts';
import { styleCard, compareStyle } from './style.ts';
import { editDigest } from './edit-ops.ts';

export const styleView = (record: YoutubeStyleRecord) => ({ id: record.id, digest: digest(record), references: structuredClone(record.references), card: structuredClone(record.card) });
/** Validate current vault references as well as actual on-disk bytes before using a saved style. */
export async function currentStyle(deps: VentureDeps, ventureId: string, id: string) {
  const state = deps.store.read(), record = findRecord(state, 'venture-youtube-style', id);
  check(record && record.ventureId === ventureId, 'STYLE_NOT_FOUND', 'Choose a measured style card in this business.');
  for (const ref of record.references) {
    const { edit, order } = boardEdit(state, ventureId, ref.editId, deps.clock().toISOString());
    check(order.intake?.rights?.basis === 'own-footage' && order.intake.cutFile === ref.path && digest({ document: editDigest(edit.document), binding: edit.binding }) === ref.editDigest, 'DERIVED_STALE', 'A reference transcript or its footage changed. Measure the style again.');
    check(await mediaHash(ref.path) === ref.sourceDigest, 'DERIVED_STALE', 'A reference file changed. Measure the style again.');
  }
  return record;
}
export const styleDesk: DeskHandler = {
  async list(deps, ctx, payload) {
    exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); exactPayload(payload.filter ?? {}, []);
    const { state, venture } = readAs(deps, ctx, 'read');
    return { playbook: 'youtube', kind: 'style', rows: listRecords(state, 'venture-youtube-style', venture.id).map(styleView), line: 'Measured references are checked again before comparison. Face share stays unmeasured without a detector.' };
  },
  async get(deps, ctx, payload) {
    try {
      exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
      const { venture } = readAs(deps, ctx, 'read'), item = await currentStyle(deps, venture.id, payload.id);
      return { playbook: 'youtube', kind: 'style', item: styleView(item), digest: digest(item) };
    } catch (error) { domainError(error); }
  },
  async act(deps, ctx, payload) {
    try {
      requireAppChannel(ctx, 'venture.desk.act');
      exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
      const { state, venture } = readAs(deps, ctx, 'approve');
      if (payload.action === 'measure') {
        const p = exactPayload(payload.payload, ['editIds'], ['editIds']);
        check(Array.isArray(p.editIds) && p.editIds.length >= 2 && p.editIds.length <= 3 && p.editIds.every(id => typeof id === 'string') && new Set(p.editIds).size === p.editIds.length, 'STYLE_SAMPLES_REQUIRED', 'Choose two or three distinct owned reference videos.');
        const inputs = p.editIds.map(id => {
          const { edit, order } = boardEdit(state, venture.id, id as string, deps.clock().toISOString());
          check(order.intake?.rights?.basis === 'own-footage' && order.intake.cutFile, 'STYLE_OWNED_REQUIRED', 'Use only your own reference videos with their local paths recorded.');
          return { editId: edit.id, editDigest: digest({ document: editDigest(edit.document), binding: edit.binding }), path: order.intake.cutFile, transcript: edit.document.words.map(word => word.text).join(' ') };
        });
        check(new Set(inputs.map(input => input.path.toLowerCase())).size === inputs.length, 'STYLE_SAMPLES_REQUIRED', 'Choose distinct source files for the style references.');
        const samples: Awaited<ReturnType<typeof measureLocalStyle>>[] = [];
        for (const input of inputs) samples.push(await measureLocalStyle(deps, input.path, input.transcript, true));
        check(new Set(samples.map(sample => sample.sourceDigest)).size === samples.length, 'STYLE_SAMPLES_REQUIRED', 'The reference videos must have different file contents.');
        const card = styleCard(samples.map(sample => sample.sample));
        const references = inputs.map((input, index) => ({ editId: input.editId, editDigest: input.editDigest, path: input.path, sourceDigest: samples[index]!.sourceDigest }));
        for (const ref of references) check(await mediaHash(ref.path) === ref.sourceDigest, 'DERIVED_STALE', 'A reference changed while the other videos were measured.');
        const item = await ventureAction(deps, ctx, 'approve', 'youtube.style.measure', tx => {
          for (const ref of references) {
            const { edit, order } = boardEdit(tx.state, venture.id, ref.editId, tx.now);
            check(order.intake?.rights?.basis === 'own-footage' && order.intake.cutFile === ref.path && digest({ document: editDigest(edit.document), binding: edit.binding }) === ref.editDigest, 'DERIVED_STALE', 'A reference changed during measurement.');
          }
          const made = tx.put<YoutubeStyleRecord>({ ...tx.base('venture-youtube-style'), references, card });
          tx.emit('desk.changed', { playbook: 'youtube', kind: 'style', id: made.id }); return made;
        });
        return { playbook: 'youtube', kind: 'style', id: item.id, result: styleView(item), line: card.line };
      }
      check(payload.action === 'compare', 'EDIT_ACTION_UNKNOWN', 'Choose Measure or Compare for a style card.');
      const p = exactPayload(payload.payload, ['editId'], ['editId']);
      const item = await currentStyle(deps, venture.id, payload.id);
      check(digest(item) === payload.digest, 'APPROVAL_STALE', 'This style card changed. Open it again.');
      const { edit, order } = boardEdit(deps.store.read(), venture.id, p.editId as string, deps.clock().toISOString());
      check(order.intake?.cutFile, 'MEDIA_FILE_REQUIRED', 'Set the full local footage path on this order.');
      const measured = await measureLocalStyle(deps, order.intake.cutFile, edit.document.words.map(word => word.text).join(' '), true);
      const fresh = boardEdit(deps.store.read(), venture.id, edit.id, deps.clock().toISOString());
      check(digest(fresh.edit) === digest(edit) && fresh.order.intake?.cutFile === order.intake.cutFile, 'DERIVED_STALE', 'The compared edit changed during measurement.');
      await currentStyle(deps, venture.id, item.id);
      return { playbook: 'youtube', kind: 'style', id: item.id, result: { metrics: measured.metrics, findings: compareStyle(item.card, measured.metrics) }, line: 'Differences above a quarter are flagged. No edit was applied.' };
    } catch (error) { domainError(error); }
  },
};
