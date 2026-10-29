// Chausar 5B1 YouTube desk. Tomada (AGPL), edit request/undo ideas only; original Chausar code.
import { styleDesk, styleView } from './style-desk.ts';
import {youtubePublicDesk} from './public-desk.ts';
import {researchDesk} from './research-desk.ts';
import { boardDesk, boardView } from './board-desk.ts';
import { check, ChausarError, type Context, type State } from '../../../contracts.ts';
import type { Json, VentureDeps, YoutubeEditRecord, YoutubeDictionaryRecord } from '../../contracts.ts';
import type { DeskHandlers, DeskActPayload, DeskActView, DeskGetPayload } from '../desk-types.ts';
import { digest, exactPayload, findRecord, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { requireRights } from '../../delivery/rights.ts';
import { localDayAt } from '../../local-day.ts';
import { applyEditOps, editDigest, type EditDocument, type EditOp } from './edit-ops.ts';
import { cleanTranscript, wordsAfterTrim } from './clean.ts';
import { applyDictionaryFixes, type DictionaryFix } from './dictionary.ts';
import { youtubeCaptions, reviewCaptionWord, captionCoverage } from './captions.ts';
import { scriptCoverage } from './coverage.ts';
import { wordSource } from './source.ts';
import { bindWordSource, requireCurrentWordSource } from './bound-source.ts';
import { askEditOps } from './ask-edit.ts';
import { makePinnedLocalTranscript, transcriptPrompt } from './transcribe.ts';
import { dictionaryEntries } from '../../delivery/harness/dictionary.ts';
import { TRANSCRIPT_MODELS, modelDownloadHandoff, type TranscriptTier } from './tiers.ts';
import { toSrt, toVtt, type CaptionProfileId } from '../kit/captions.ts';
import type { YoutubeEditBody, YoutubeEditView } from './records.ts';

export type YoutubeDeskTypes = {
  public: {filter:Json;row:unknown;item:unknown;actions:Record<string,{payload:Json;result:unknown}>};
  research: {filter:Json;row:unknown;item:unknown;actions:Record<string,{payload:Json;result:unknown}>};
  style: { filter: Json; row: ReturnType<typeof styleView>; item: ReturnType<typeof styleView>; actions: Record<string, { payload: Json; result: ReturnType<typeof styleView> | Json }> };
  board: { filter: Json; row: ReturnType<typeof boardView>; item: ReturnType<typeof boardView>; actions: Record<string, { payload: Json; result: ReturnType<typeof boardView> | Json }> };
  edit: { filter: Json; row: YoutubeEditView; item: YoutubeEditView; actions: Record<string, { payload: Json; result: YoutubeEditView | Json }> };
  model: { filter: Json; row: { tier: string; id: string; revision: string; sha256: string; bytes: number; licence: string }; item: never; actions: Record<string, never> };
  dictionary: { filter: Json; row: { id: string; terms: string[] }; item: { id: string; terms: string[] }; actions: Record<string, { payload: Json; result: { id: string; terms: string[] } }> };
};
const view = (item: YoutubeEditRecord) => {
  const { kind: _k, ventureId: _v, memberId: _m, epoch: _e, at: _a, ...body } = structuredClone(item);
  return { ...body, digest: digest(item), captionFiles: item.captions ? { srt: toSrt(item.captions.cues), vtt: toVtt(item.captions.cues), ...captionCoverage(item.captions.cues, item.captions.profile) } : null };
};
function owned(state: State, ventureId: string, id: string): YoutubeEditRecord {
  const record = findRecord(state, 'venture-youtube-edit', id);
  check(record && record.ventureId === ventureId, 'EDIT_NOT_FOUND', 'That edit is not in this business.');
  return record;
}
function orderRights(state: State, ventureId: string, orderId: string, now: string) {
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === ventureId && order.status !== 'cancelled', 'ORDER_NOT_FOUND', 'Choose an open order in this business.');
  requireRights({ id: 'assemble', clipping: true }, order.intake ?? null, localDayAt(now, { code: 'IN' }));
  return order;
}
function checkedRequest(value: unknown): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= 1000, 'EDIT_INVALID', 'Describe the change in up to one thousand characters.');
  return value.trim();
}
/** Read one current edit with a digest for every mutating action. */
async function getEdit(deps: VentureDeps, ctx: Context, payload: DeskGetPayload) {
  exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
  const { state, venture } = readAs(deps, ctx, 'read'), item = owned(state, venture.id, payload.id);
  requireCurrentWordSource(state, item);
  return { playbook: 'youtube' as const, kind: 'edit', item: view(item), digest: digest(item) };
}
/** Internal edits are approved in the app. No action writes footage or publishes anything. */
async function actEdit(deps: VentureDeps, ctx: Context, payload: DeskActPayload): Promise<DeskActView> {
  requireAppChannel(ctx, 'venture.desk.act');
  exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const body = payload.payload;
  if (payload.action === 'model-download') {
    const p = exactPayload(body, ['tier', 'confirmed'], ['tier', 'confirmed']);
    return { playbook: 'youtube', kind: 'edit', id: payload.id, result: modelDownloadHandoff(p.tier as TranscriptTier, p.confirmed === true, deps.host === 'hosted-web'), line: 'Open this exact model download yourself. Nothing was downloaded by Chausar.' };
  }
  if (payload.action === 'create') {
    const p = exactPayload(body, ['orderId', 'source', 'sourceRef'], ['orderId', 'source', 'sourceRef']);
    check(typeof p.orderId === 'string', 'EDIT_INVALID', 'Choose the order for this transcript.');
    orderRights(state, venture.id, p.orderId, deps.clock().toISOString());
    const source = wordSource(p.source);
    bindWordSource(state, venture.id, p.orderId, p.sourceRef);
    const item = await ventureAction(deps, ctx, 'approve', 'youtube.edit.create', tx => {
      orderRights(tx.state, venture.id, p.orderId as string, tx.now);
      const record = tx.put<YoutubeEditRecord>({ ...tx.base('venture-youtube-edit'), orderId: p.orderId as string, binding: bindWordSource(tx.state, venture.id, p.orderId as string, p.sourceRef), source, sourceDigest: editDigest(source.document), document: source.document, history: [], request: null, last: null, pending: null, captions: null, transcripts: [] });
      tx.emit('desk.changed', { playbook: 'youtube', kind: 'edit', id: record.id }); return record;
    });
    return { playbook: 'youtube', kind: 'edit', id: item.id, result: view(item), line: 'Measured word times imported. No footage changed.' };
  }
  const original = owned(state, venture.id, payload.id);
  requireCurrentWordSource(state, original);
  check(payload.digest === digest(original), 'EDIT_STALE', 'This edit changed. Open it again before applying a request.');
  orderRights(state, venture.id, original.orderId, deps.clock().toISOString());
  let transcript: Awaited<ReturnType<typeof makePinnedLocalTranscript>> | null = null;
  if (payload.action === 'transcribe-tier') {
    const p = exactPayload(body, ['tier'], ['tier']);
    check(original.source.vadMeasured, 'TRANSCRIPT_MEASUREMENTS_REQUIRED', 'Import measured voice-activity regions before running a tier.');
    const order = orderRights(state, venture.id, original.orderId, deps.clock().toISOString());
    check(order.intake?.cutFile, 'TRANSCRIBE_NOT_AVAILABLE', 'Set the local footage path on the order first.');
    let at = 0;
    const voiceActivity: { startMs: number; endMs: number }[] = [];
    for (const quiet of [...original.source.vadQuiet].sort((a, b) => a.startMs - b.startMs)) {
      if (quiet.startMs > at) voiceActivity.push({ startMs: at, endMs: quiet.startMs });
      at = Math.max(at, quiet.endMs);
    }
    if (at < original.document.durationMs) voiceActivity.push({ startMs: at, endMs: original.document.durationMs });
    transcript = await makePinnedLocalTranscript(deps, ctx, { cutFile: order.intake.cutFile, prompt: transcriptPrompt(dictionaryEntries(state, venture)), tier: p.tier as TranscriptTier, voiceActivity });
  }
  let ops: EditOp[] | null = null, request: string | null = null;
  if (payload.action === 'request') {
    const p = exactPayload(body, ['request'], ['request']);
    request = checkedRequest(p.request);
    ops = await askEditOps(deps, ctx, original.document, request);
  }
  const item = await ventureAction(deps, ctx, 'approve', 'youtube.edit.change', tx => {
    const record = owned(tx.state, venture.id, payload.id);
    requireCurrentWordSource(tx.state, record);
    check(digest(record) === payload.digest, 'EDIT_STALE', 'This edit changed while the request was being prepared. Nothing changed.');
    orderRights(tx.state, venture.id, record.orderId, tx.now);
    let next: YoutubeEditBody = structuredClone(record);
    const remember = (document: EditDocument) => { next.history = [...record.history.slice(-19), structuredClone(record.document)]; next.document = document; next.captions = null; next.pending = null; };
    if (payload.action === 'transcribe-tier') {
      check(transcript, 'TRANSCRIBE_NOT_AVAILABLE', 'The local transcript was not made.');
      next.transcripts = [...record.transcripts.filter(item => item.tier !== transcript!.tier), transcript];
    } else if (payload.action === 'apply' || payload.action === 'request' || payload.action === 'confirm') {
      if (payload.action === 'apply') { const p = exactPayload(body, ['request', 'ops'], ['request', 'ops']); request = checkedRequest(p.request); check(Array.isArray(p.ops), 'EDIT_INVALID', 'Give typed operations.'); ops = p.ops as EditOp[]; }
      if (payload.action === 'confirm') { exactPayload(body, []); check(record.pending, 'EDIT_NOT_PENDING', 'There is no large edit waiting for confirmation.'); ops = record.pending.ops; request = record.pending.request; }
      check(ops, 'EDIT_INVALID', 'Give typed operations.');
      try {
        const made = applyEditOps(record.document, ops, payload.action === 'confirm' ? { confirmedDigest: record.pending!.digest } : {});
        remember(made.document); const { document: _d, undo: _u, ...last } = made; next.last = last; next.request = request;
      } catch (error) {
        if (!(error instanceof ChausarError) || error.code !== 'EDIT_ASK_AGAIN') throw error;
        const { document: _d, undo: _u, ...preview } = applyEditOps(record.document, ops, { confirmedDigest: editDigest(record.document) });
        next.pending = { ops, digest: editDigest(record.document), request: request!, preview }; next.request = request;
      }
    } else if (payload.action === 'suggest') {
      exactPayload(body, []);
      const made = cleanTranscript({ ...record.source, document: record.document });
      // Cleanup is a preview until the owner chooses the named cut ranges; no AI and no hidden application.
      return { ...view(record), cleanup: made };
    } else if (payload.action === 'cleanup') {
      const p = exactPayload(body, ['confirmed'], ['confirmed']);
      check(typeof p.confirmed === 'boolean', 'EDIT_INVALID', 'Confirm the measured cleanup or read its preview first.');
      const made = cleanTranscript({ ...record.source, document: record.document });
      check(made.removedMs * 5 <= record.document.durationMs || p.confirmed, 'EDIT_ASK_AGAIN', 'This cleanup removes more than a fifth of the footage. Confirm its exact preview.');
      remember(made.document);
      next.request = 'Suggest without AI';
      next.last = { digest: editDigest(made.document), applied: made.cuts.map((cut, index) => ({ index, op: { kind: 'cut', from: cut.from, to: cut.to } })), refused: [], addedMs: made.removedMs, addedShare: made.removedMs / record.document.durationMs, addedPercent: Math.round(made.removedMs * 10000 / record.document.durationMs) / 100, removedMs: made.removedMs, removedShare: made.removedMs / record.document.durationMs, removedPercent: Math.round(made.removedMs * 10000 / record.document.durationMs) / 100, summary: made.summary };
    } else if (payload.action === 'undo') {
      exactPayload(body, []); check(record.history.length, 'EDIT_NOTHING_TO_UNDO', 'There is no edit request to undo.');
      next.document = structuredClone(record.history.at(-1)!); next.history = record.history.slice(0, -1); next.last = null; next.pending = null; next.captions = null;
    } else if (payload.action === 'captions') {
      const p = exactPayload(body, ['profile'], ['profile']);
      const made = youtubeCaptions({ words: wordsAfterTrim(record.document), profile: p.profile as CaptionProfileId, sourceDigest: editDigest(record.document), currentDigest: editDigest(record.document) });
      next.captions = { cues: made.cues, sourceDigest: made.sourceDigest, profile: p.profile as CaptionProfileId };
    } else if (payload.action === 'caption-word') {
      const p = exactPayload(body, ['cueId', 'index', 'text'], ['cueId', 'index', 'text']);
      check(record.captions && record.captions.sourceDigest === editDigest(record.document), 'DERIVED_STALE', 'The transcript changed. Make the captions again.');
      next.captions = { ...record.captions, cues: reviewCaptionWord(record.captions.cues, String(p.cueId), p.index as number, String(p.text)) };
    } else if (payload.action === 'dictionary') {
      const p = exactPayload(body, ['fixes'], ['fixes']);
      const terms = tx.list('venture-youtube-dictionary').at(-1)?.terms ?? [];
      const made = applyDictionaryFixes(record.document.words.map(word => word.text), terms, p.fixes as DictionaryFix[]);
      remember({ ...record.document, words: record.document.words.map((word, index) => ({ ...word, text: made.words[index] })) });
      return { ...view(tx.replace({ ...record, ...next })), corrections: made };
    } else if (payload.action === 'coverage') {
      const p = exactPayload(body, ['script'], ['script']);
      return { ...view(record), coverage: scriptCoverage(p.script as string, wordsAfterTrim(record.document)) };
    } else throw new ChausarError('EDIT_ACTION_UNKNOWN', 'Choose an edit action this desk supports.');
    const saved = tx.replace({ ...record, ...next }); tx.emit('desk.changed', { playbook: 'youtube', kind: 'edit', id: saved.id }); return view(saved);
  });
  return { playbook: 'youtube', kind: 'edit', id: payload.id, result: item, line: 'The edit list is saved. No footage changed or published.' };
}
export const YOUTUBE_DESK: DeskHandlers = Object.freeze({
  public:youtubePublicDesk,
  research:researchDesk,
  board: boardDesk,
  style: styleDesk,
  model: { async list(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); exactPayload(payload.filter ?? {}, []); readAs(deps, ctx, 'read'); return { playbook: 'youtube', kind: 'model', rows: Object.entries(TRANSCRIPT_MODELS).map(([tier, model]) => ({ tier, ...model })), line: 'Local model downloads are handoffs you confirm. No model is downloaded automatically.' }; } },
  edit: {
    async list(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); const { state, venture } = readAs(deps, ctx, 'read'); const filter = exactPayload(payload.filter ?? {}, ['orderId']); return { playbook: 'youtube', kind: 'edit', rows: listRecords(state, 'venture-youtube-edit', venture.id).filter(item => filter.orderId === undefined || item.orderId === filter.orderId).map(item => { try { requireCurrentWordSource(state, item); return view(item); } catch (error) { if (!(error instanceof ChausarError) || error.code !== 'DERIVED_STALE') throw error; return { ...view(item), captions: null, captionFiles: null, stale: true }; } }), line: 'Edits from measured word times. No footage is overwritten.' }; },
    get: getEdit, act: actEdit,
  },
  dictionary: {
    async list(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); exactPayload(payload.filter ?? {}, []); const { state, venture } = readAs(deps, ctx, 'read'); return { playbook: 'youtube', kind: 'dictionary', rows: listRecords(state, 'venture-youtube-dictionary', venture.id).slice(-1).map(item => ({ id: item.id, terms: item.terms })), line: 'Your names list.' }; },
    async act(deps, ctx, payload) { requireAppChannel(ctx, 'venture.desk.act'); exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']); check(payload.action === 'set', 'EDIT_ACTION_UNKNOWN', 'Choose Set names for this list.'); const p = exactPayload(payload.payload, ['terms'], ['terms']); check(Array.isArray(p.terms) && p.terms.length <= 500 && p.terms.every(term => typeof term === 'string' && term.trim().length > 0 && term.length <= 200), 'INVALID_VENTURE_REQUEST', 'Use at most five hundred names of up to two hundred characters.'); const saved = await ventureAction(deps, ctx, 'approve', 'youtube.dictionary.set', tx => tx.put<YoutubeDictionaryRecord>({ ...tx.base('venture-youtube-dictionary'), terms: [...new Set(p.terms as string[])] })); return { playbook: 'youtube', kind: 'dictionary', id: saved.id, result: { id: saved.id, terms: saved.terms }, line: 'Names saved.' }; },
  },
});
