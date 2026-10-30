import {fakeYoutubeRights} from './fake-youtube-rights';
/** Chausar 5B1 fake desk, matching the engine's validations and edit transaction shapes. No AI or outside writes. */
import {fakeYoutubePublic} from './fake-youtube-public';
import {fakeYoutubeResearch} from './fake-youtube-research';
import { fakeYoutubeBoard, fakeYoutubeStyle } from './fake-youtube-board';
import type { YoutubeBoardBody } from '../../../../platform/runtime/venture/playbooks/youtube/board-core';
import { bindFakeWordSource, requireFakeWordSource, type WordSourceBinding } from './fake-youtube-source';
import { EngineError, type OrderLite } from './types';
import type { W4DeskHost } from './fake-w4';
import type { FakePlaybookDesk } from './fake-playbooks';
import { applyEditOps, editDigest, wordSource, cleanTranscript, wordsAfterTrim, youtubeCaptions, reviewCaptionWord, scriptCoverage, applyDictionaryFixes, TRANSCRIPT_MODELS, modelDownloadHandoff, toSrt, toVtt, captionCoverage,
  type EditDocument, type EditOp, type EditResult, type YoutubeWordSource, type CaptionCue, type CaptionProfileId, type TranscriptTier, type DictionaryFix } from './fake-youtube-core';

export interface EditItem {
  board?: YoutubeBoardBody;
  id: string; orderId: string; binding: WordSourceBinding; source: YoutubeWordSource; sourceDigest: string; document: EditDocument; history: EditDocument[];
  request: string | null; last: Omit<EditResult, 'undo' | 'document'> | null;
  pending: { ops: EditOp[]; digest: string; request: string; preview: Omit<EditResult, 'undo' | 'document'> } | null;
  transcripts: { tier: string; whisperVersion: string; modelSha256: string; revision: string; model: string; srt: string; dropped: number }[];
  captions: { cues: CaptionCue[]; sourceDigest: string; profile: CaptionProfileId } | null;
}
function exact(value: unknown, fields: string[], required: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  if (Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return value as Record<string, unknown>;
}
function check(value: unknown, code: string, message: string): asserts value { if (!value) throw new EngineError(code, message); }
const clone = <T>(value: T): T => structuredClone(value);
/** Internal fake edit records remain isolated by business, as the real vault is. */
export function fakeYoutubeDesk(host: W4DeskHost): FakePlaybookDesk {
  const byBusiness = new Map<string, Map<string, EditItem>>(), names = new Map<string, { id: string; terms: string[] }>();
  let seq = 0;
  const records = () => { const key = host.current(); if (!byBusiness.has(key)) byBusiness.set(key, new Map()); return byBusiness.get(key)!; };
  const view = (item: EditItem) => ({ ...clone(item), digest: host.digest(item), captionFiles: item.captions ? { srt: toSrt(item.captions.cues), vtt: toVtt(item.captions.cues), ...captionCoverage(item.captions.cues, item.captions.profile) } : null });
  const orderRights=(id:unknown)=>fakeYoutubeRights(host,id);
  const changed = () => host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() });
  const research=fakeYoutubeResearch(host,exact,orderRights),publicRead=fakeYoutubePublic(host,exact,orderRights);
  return { playbook: 'youtube', endSession:publicRead.endSession, workReceipt:id=>research.workReceipt(id)??publicRead.workReceipt(id), forgetPeople:people=>{research.forgetPeople(people);publicRead.forgetPeople(people);}, kinds: {
    public:publicRead.publicKind,
    research:research.research,
    board: fakeYoutubeBoard(host, records, exact, orderRights, changed, research.current),
    style: fakeYoutubeStyle(host, exact, records, orderRights),
    model: { list(p) { exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); exact(p.filter ?? {}, []); return { playbook: 'youtube', kind: 'model', rows: Object.entries(TRANSCRIPT_MODELS).map(([tier, model]) => ({ tier, ...model })), line: 'Local model downloads are handoffs you confirm. No model is downloaded automatically.' }; } },
    edit: {
      list(p) { exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); const filter = exact(p.filter ?? {}, ['orderId']); return { playbook: 'youtube', kind: 'edit', rows: [...records().values()].filter(item => filter.orderId === undefined || item.orderId === filter.orderId).map(item => { try { requireFakeWordSource(host, item); return view(item); } catch (error) { if (!(error instanceof EngineError) || error.code !== 'DERIVED_STALE') throw error; return { ...view(item), captions: null, captionFiles: null, stale: true }; } }), line: 'Edits from measured word times. No footage is overwritten.' }; },
      get(p) { exact(p, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const item = records().get(String(p.id)); check(item, 'EDIT_NOT_FOUND', 'That edit is not in this business.'); requireFakeWordSource(host, item); return { playbook: 'youtube', kind: 'edit', item: view(item), digest: host.digest(item) }; },
      act(p) {
        exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
        const reply = (item: unknown, id = String(p.id), line = 'The edit list is saved. No footage changed or published.') => ({ playbook: 'youtube', kind: 'edit', id, result: item, line });
        if (p.action === 'model-download') { const body = exact(p.payload, ['tier', 'confirmed'], ['tier', 'confirmed']); return reply(modelDownloadHandoff(body.tier as TranscriptTier, body.confirmed === true, host.hosted()), String(p.id), 'Open this exact model download yourself. Nothing was downloaded by Chausar.'); }
        if (p.action === 'create') {
          const body = exact(p.payload, ['orderId', 'source', 'sourceRef'], ['orderId', 'source', 'sourceRef']); check(typeof body.orderId === 'string', 'EDIT_INVALID', 'Choose the order for this transcript.'); orderRights(body.orderId);
          const source = wordSource(body.source), item: EditItem = { id: `ytedit_${++seq}`, orderId: body.orderId, binding: bindFakeWordSource(host, body.orderId, body.sourceRef), source, sourceDigest: editDigest(source.document), document: clone(source.document), history: [], request: null, last: null, pending: null, captions: null, transcripts: [] };
          records().set(item.id, item); changed(); return reply(view(item), item.id, 'Measured word times imported. No footage changed.');
        }
        const record = records().get(String(p.id)); check(record, 'EDIT_NOT_FOUND', 'That edit is not in this business.');
        requireFakeWordSource(host, record);
        check(p.digest === host.digest(record), 'EDIT_STALE', 'This edit changed. Open it again before applying a request.'); orderRights(record.orderId);
        const next = clone(record);
        const remember = (document: EditDocument) => { next.history = [...record.history.slice(-19), clone(record.document)]; next.document = document; next.pending = null; next.captions = null; };
        if (p.action === 'transcribe-tier') {
          exact(p.payload, ['tier'], ['tier']);
          check(record.source.vadMeasured, 'TRANSCRIPT_MEASUREMENTS_REQUIRED', 'Import measured voice-activity regions before running a tier.');
          const order = (host.ask('venture.order.list', {}) as OrderLite[]).find(order => order.id === record.orderId);
          check(order?.intake?.cutFile, 'TRANSCRIBE_NOT_AVAILABLE', 'Set the local footage path on the order first.');
          check(!host.hosted(), 'TIER_UNAVAILABLE', "The shared hosted server can't make a transcript: it never reads a file on your computer. Use the desktop app, or add the transcript as an SRT or VTT file.");
          throw new EngineError('TRANSCRIBE_NOT_AVAILABLE', 'No whisper.cpp is set up on this computer.');
        }
        if (p.action === 'request') { const body = exact(p.payload, ['request'], ['request']); check(typeof body.request === 'string' && body.request.trim() && body.request.length <= 1000, 'EDIT_INVALID', 'Describe the change in up to one thousand characters.'); throw new EngineError('EDIT_AI_UNAVAILABLE', 'Connect your AI and agree to Chats first, or use Suggest without AI.'); }
        if (p.action === 'apply' || p.action === 'confirm') {
          let ops: EditOp[], request: string;
          if (p.action === 'confirm') { exact(p.payload, []); check(record.pending, 'EDIT_NOT_PENDING', 'There is no large edit waiting for confirmation.'); ops = record.pending.ops; request = record.pending.request; }
          else { const body = exact(p.payload, ['request', 'ops'], ['request', 'ops']); check(typeof body.request === 'string' && body.request.trim() && body.request.length <= 1000, 'EDIT_INVALID', 'Describe the change in up to one thousand characters.'); check(Array.isArray(body.ops), 'EDIT_INVALID', 'Give typed operations.'); ops = body.ops as EditOp[]; request = body.request.trim(); }
          try { const made = applyEditOps(record.document, ops, p.action === 'confirm' ? { confirmedDigest: record.pending!.digest } : {}); remember(made.document); const { document: _d, undo: _u, ...last } = made; next.last = last; next.request = request; }
          catch (error) { if (!(error instanceof EngineError) || error.code !== 'EDIT_ASK_AGAIN') throw error; const { document: _d, undo: _u, ...preview } = applyEditOps(record.document, ops, { confirmedDigest: editDigest(record.document) }); next.pending = { ops, digest: editDigest(record.document), request, preview }; next.request = request; }
        } else if (p.action === 'suggest') { exact(p.payload, []); return reply({ ...view(record), cleanup: cleanTranscript({ ...record.source, document: record.document }) }); }
        else if (p.action === 'cleanup') { const body = exact(p.payload, ['confirmed'], ['confirmed']); check(typeof body.confirmed === 'boolean', 'EDIT_INVALID', 'Confirm the measured cleanup or read its preview first.'); const made = cleanTranscript({ ...record.source, document: record.document }); check(made.removedMs * 5 <= record.document.durationMs || body.confirmed, 'EDIT_ASK_AGAIN', 'This cleanup removes more than a fifth of the footage. Confirm its exact preview.'); remember(made.document); next.request = 'Suggest without AI'; next.last = { digest: editDigest(made.document), applied: made.cuts.map((cut, index) => ({ index, op: { kind: 'cut', from: cut.from, to: cut.to } })), refused: [], addedMs: made.removedMs, addedShare: made.removedMs / record.document.durationMs, addedPercent: Math.round(made.removedMs * 10000 / record.document.durationMs) / 100, removedMs: made.removedMs, removedShare: made.removedMs / record.document.durationMs, removedPercent: Math.round(made.removedMs * 10000 / record.document.durationMs) / 100, summary: made.summary }; }
        else if (p.action === 'undo') { exact(p.payload, []); check(record.history.length, 'EDIT_NOTHING_TO_UNDO', 'There is no edit request to undo.'); next.document = clone(record.history.at(-1)!); next.history = record.history.slice(0, -1); next.last = null; next.pending = null; next.captions = null; }
        else if (p.action === 'captions') { const body = exact(p.payload, ['profile'], ['profile']); const made = youtubeCaptions({ words: wordsAfterTrim(record.document), profile: body.profile as CaptionProfileId, sourceDigest: editDigest(record.document), currentDigest: editDigest(record.document) }); next.captions = { cues: made.cues, sourceDigest: made.sourceDigest, profile: body.profile as CaptionProfileId }; }
        else if (p.action === 'caption-word') { const body = exact(p.payload, ['cueId', 'index', 'text'], ['cueId', 'index', 'text']); check(record.captions && record.captions.sourceDigest === editDigest(record.document), 'DERIVED_STALE', 'The transcript changed. Make the captions again.'); next.captions = { ...record.captions, cues: reviewCaptionWord(record.captions.cues, String(body.cueId), body.index as number, String(body.text)) }; }
        else if (p.action === 'dictionary') { const body = exact(p.payload, ['fixes'], ['fixes']); const made = applyDictionaryFixes(record.document.words.map(word => word.text), names.get(host.current())?.terms ?? [], body.fixes as DictionaryFix[]); remember({ ...record.document, words: record.document.words.map((word, index) => ({ ...word, text: made.words[index]! })) }); records().set(record.id, next); changed(); return reply({ ...view(next), corrections: made }); }
        else if (p.action === 'coverage') { const body = exact(p.payload, ['script'], ['script']); return reply({ ...view(record), coverage: scriptCoverage(body.script as string, wordsAfterTrim(record.document)) }); }
        else throw new EngineError('EDIT_ACTION_UNKNOWN', 'Choose an edit action this desk supports.');
        records().set(record.id, next); changed(); return reply(view(next));
      },
    },
    dictionary: {
      list(p) { exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); exact(p.filter ?? {}, []); const item = names.get(host.current()); return { playbook: 'youtube', kind: 'dictionary', rows: item ? [clone(item)] : [], line: 'Your names list.' }; },
      act(p) { exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']); check(p.action === 'set', 'EDIT_ACTION_UNKNOWN', 'Choose Set names for this list.'); const body = exact(p.payload, ['terms'], ['terms']); check(Array.isArray(body.terms) && body.terms.length <= 500 && body.terms.every(term => typeof term === 'string' && term.trim().length && term.length <= 200), 'INVALID_VENTURE_REQUEST', 'Use at most five hundred names of up to two hundred characters.'); const item = { id: `ytdict_${++seq}`, terms: [...new Set(body.terms as string[])] }; names.set(host.current(), item); return { playbook: 'youtube', kind: 'dictionary', id: item.id, result: clone(item), line: 'Names saved.' }; },
    },
  } };
}
